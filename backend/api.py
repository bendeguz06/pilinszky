import glob
import io
import os
import tempfile

import chromadb
import requests
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from TTS.api import TTS

OLLAMA_URL = "http://localhost:11434"
CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "pilinszky_corpus"
VOICE_SAMPLES_DIR = "./voice_samples"
LLM_MODEL = "jobautomation/OpenEuroLLM-Hungarian:latest"
EMBED_MODEL = "nomic-embed-text"
TOP_K = 4

SYSTEM_PROMPT = (
    "Te Pilinszky János vagy, a 20. századi magyar költő. "
    "Töredékesen, mélyen és kontemplatívan válaszolj — ahogy ő gondolkodott és írt. "
    "Keresztény miszticizmus, csend, szenvedés és kegyelem hatja át szavaidat. "
    "Ha releváns, hivatkozz saját verseidre vagy prózádra. "
    "Mindig magyarul válaszolj, tömören, szinte aforisztikusan."
)

app = FastAPI()

# ChromaDB client (lazy-initialised on first request)
_chroma_collection = None

def get_collection():
    global _chroma_collection
    if _chroma_collection is None:
        client = chromadb.PersistentClient(path=CHROMA_PATH)
        _chroma_collection = client.get_collection(COLLECTION_NAME)
    return _chroma_collection

# XTTS model (loaded once at startup)
_tts: TTS | None = None

def get_tts() -> TTS:
    global _tts
    if _tts is None:
        _tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
    return _tts


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
        f"{OLLAMA_URL}/api/embeddings",
        json={"model": EMBED_MODEL, "prompt": text},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["embedding"]


@app.post("/chat")
def chat(req: ChatRequest):
    # Retrieve relevant context from ChromaDB
    query_embedding = embed(req.message)
    collection = get_collection()
    results = collection.query(query_embeddings=[query_embedding], n_results=TOP_K)
    context_chunks = results["documents"][0] if results["documents"] else []
    context_text = "\n\n".join(context_chunks)

    # Build message list for Ollama
    system_content = SYSTEM_PROMPT
    if context_text:
        system_content += f"\n\nReleváns részletek saját írásaidból:\n{context_text}"

    messages = [{"role": "system", "content": system_content}]
    for m in req.history:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": req.message})

    res = requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={"model": LLM_MODEL, "messages": messages, "stream": False},
        timeout=120,
    )
    res.raise_for_status()
    reply = res.json()["message"]["content"]
    return {"reply": reply}


@app.post("/tts")
def tts(req: TTSRequest):
    speaker_wavs = glob.glob(os.path.join(VOICE_SAMPLES_DIR, "*.wav"))
    if not speaker_wavs:
        raise RuntimeError(f"No .wav files found in {VOICE_SAMPLES_DIR}")

    tts_model = get_tts()

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        tts_model.tts_to_file(
            text=req.text,
            language="hu",
            speaker_wav=speaker_wavs,
            file_path=tmp_path,
        )
        with open(tmp_path, "rb") as f:
            wav_bytes = f.read()
    finally:
        os.unlink(tmp_path)

    return Response(content=wav_bytes, media_type="audio/wav")
