import base64
import glob
import os
import tempfile

import chromadb
import requests
import torch
import torchaudio
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from TTS.api import TTS  # new repo: https://github.com/idiap/coqui-ai-TTS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_PATH = os.path.join(BASE_DIR, "chroma_db")
VOICE_SAMPLES_DIR = os.path.join(BASE_DIR, "voice_samples")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
COLLECTION_NAME = "pilinszky_corpus"
LLM_MODEL = "jobautomation/OpenEuroLLM-Hungarian:latest"
EMBED_MODEL = "nomic-embed-text"
TOP_K = 3

SYSTEM_PROMPT = (
    "Te Pilinszky János vagy, a 20. századi magyar költő. "
    "Töredékesen, mélyen és kontemplatívan válaszolj ahogy ő gondolkodott és írt. "
    "Keresztény miszticizmus, csend, szenvedés és kegyelem hatja át szavaidat. "
    "Beszélj mindig érthető magyarul. Ne használj nem természetes kifejezéseket."
    "Ha releváns, hivatkozz saját verseidre vagy prózádra. "
    "Mindig magyarul válaszolj, tömören, szinte aforisztikusan, mindig költői módon."
    "Használj pontot, vesszőt, gondolatjelet a természetes szünetekhez. "
    "Használj normálisan hosszú mondatokat. "
)

app = FastAPI()

# ChromaDB client
_chroma_collection = None

# XTTS model + cached speaker latents
_tts: TTS | None = None
_gpt_cond_latent = None
_speaker_embedding = None


def get_collection():
    global _chroma_collection
    if _chroma_collection is None:
        client = chromadb.PersistentClient(path=str(CHROMA_PATH))
        _chroma_collection = client.get_collection(COLLECTION_NAME)
    return _chroma_collection


def get_tts():
    global _tts, _gpt_cond_latent, _speaker_embedding
    if _tts is None:
        _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
        speaker_wavs = glob.glob(os.path.join(VOICE_SAMPLES_DIR, "*.wav"))
        if not speaker_wavs:
            raise RuntimeError(f"No .wav files found in {VOICE_SAMPLES_DIR}")
        # Precompute and cache speaker conditioning latents
        _gpt_cond_latent, _speaker_embedding = (
            _tts.synthesizer.tts_model.get_conditioning_latents(
                audio_path=speaker_wavs,
                gpt_cond_len=30,
                max_ref_length=60,
            )
        )
    return _tts, _gpt_cond_latent, _speaker_embedding


@app.on_event("startup")
async def startup():
    get_collection()
    get_tts()  # preload XTTS and cache speaker latents


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[Message] = []


class TTSRequest(BaseModel):
    text: str


def embed(text: str) -> list[float]:
    res = requests.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": EMBED_MODEL, "input": text},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["embeddings"][0]


@app.post("/chat")
def chat(req: ChatRequest):
    query_embedding = embed(req.message)
    collection = get_collection()
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=TOP_K,
        include=["documents", "metadatas"],
    )
    docs = results["documents"][0] if results["documents"] else []
    metas = results["metadatas"][0] if results["metadatas"] else [{}] * len(docs)
    context_parts = []
    for doc, meta in zip(docs, metas):
        typ = meta.get("type", "")
        title = meta.get("title", "")
        label = (
            f"[{typ.upper()}: {title}]" if title else f"[{typ.upper()}]" if typ else ""
        )
        context_parts.append(f"{label}\n{doc}" if label else doc)
    context_text = "\n\n".join(context_parts)

    system_content = SYSTEM_PROMPT
    if context_text:
        system_content += f"\n\nReleváns részletek saját írásaidból:\n{context_text}"

    messages = [{"role": "system", "content": system_content}]
    for m in req.history:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": req.message})

    res = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": LLM_MODEL,
            "messages": messages,
            "stream": False,
            "options": {"num_ctx": 2048, "num_gpu": 49},
        },
        timeout=120,
    )
    res.raise_for_status()
    reply = res.json()["message"]["content"]

    # Generate TTS audio and return it together with the reply
    tts_model, gpt_cond_latent, speaker_embedding = get_tts()
    tts_text = reply.replace("\n", " ").strip()
    out = tts_model.synthesizer.tts_model.inference(
        text=tts_text,
        language="hu",
        gpt_cond_latent=gpt_cond_latent,
        speaker_embedding=speaker_embedding,
    )
    wav = torch.tensor(out["wav"]).unsqueeze(0)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        torchaudio.save(tmp_path, wav, 24000)
        with open(tmp_path, "rb") as f:
            wav_bytes = f.read()
    finally:
        os.unlink(tmp_path)

    return {"reply": reply, "audio": base64.b64encode(wav_bytes).decode("utf-8")}


@app.post("/tts")
def tts(req: TTSRequest):
    tts_model, gpt_cond_latent, speaker_embedding = get_tts()

    text = req.text.replace("\n", " ").strip()
    out = tts_model.synthesizer.tts_model.inference(
        text=text,
        language="hu",
        gpt_cond_latent=gpt_cond_latent,
        speaker_embedding=speaker_embedding,
    )
    wav = torch.tensor(out["wav"]).unsqueeze(0)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        torchaudio.save(tmp_path, wav, 24000)
        with open(tmp_path, "rb") as f:
            wav_bytes = f.read()
    finally:
        os.unlink(tmp_path)

    return Response(content=wav_bytes, media_type="audio/wav")
