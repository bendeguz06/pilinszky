import base64
import glob
import os
import re
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

XTTS_CHAR_LIMIT = 220  # XTTS v2 hard limit per language chunk

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


def split_into_chunks(text: str, limit: int = XTTS_CHAR_LIMIT) -> list[str]:
    """Split text into chunks under `limit` chars, breaking at sentence boundaries."""
    # Split on sentence-ending punctuation, keeping the delimiter
    sentences = re.split(r'(?<=[.!?…\u2014])\s+', text)
    chunks = []
    current = ""
    for sentence in sentences:
        # If a single sentence exceeds the limit, split on commas/semicolons
        if len(sentence) > limit:
            sub_parts = re.split(r'(?<=[,;])\s+', sentence)
            for part in sub_parts:
                if len(current) + len(part) + 1 <= limit:
                    current = (current + " " + part).strip() if current else part
                else:
                    if current:
                        chunks.append(current)
                    # If even a single part is too long, hard-split it
                    while len(part) > limit:
                        chunks.append(part[:limit])
                        part = part[limit:]
                    current = part
        else:
            if len(current) + len(sentence) + 1 <= limit:
                current = (current + " " + sentence).strip() if current else sentence
            else:
                if current:
                    chunks.append(current)
                current = sentence
    if current:
        chunks.append(current)
    return [c for c in chunks if c.strip()]


def synthesize_text(text: str) -> bytes:
    """Synthesize arbitrarily long text by chunking and concatenating WAV audio."""
    tts_model, gpt_cond_latent, speaker_embedding = get_tts()
    chunks = split_into_chunks(text)
    wav_chunks = []
    for chunk in chunks:
        out = tts_model.synthesizer.tts_model.inference(
            text=chunk,
            language="hu",
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
        )
        wav_chunks.append(torch.tensor(out["wav"]))

    combined = torch.cat(wav_chunks).unsqueeze(0)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        torchaudio.save(tmp_path, combined, 24000)
        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        os.unlink(tmp_path)


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

    tts_text = reply.replace("\n", " ").strip()
    wav_bytes = synthesize_text(tts_text)

    return {"reply": reply, "audio": base64.b64encode(wav_bytes).decode("utf-8")}


@app.post("/tts")
def tts(req: TTSRequest):
    text = req.text.replace("\n", " ").strip()
    wav_bytes = synthesize_text(text)
    return Response(content=wav_bytes, media_type="audio/wav")
