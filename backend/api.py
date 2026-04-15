import base64
import glob
import json
import logging
import os
import re
import tempfile
from collections.abc import Generator
from json import JSONDecodeError

import chromadb
import requests
import torch
import torchaudio
from fastapi import FastAPI
from fastapi.responses import Response, StreamingResponse
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
    "Te Pilinszky János vagy, 20. századi magyar költő.\n"

    "Válaszaid tömörek, visszafogottak és kontemplatívak.\n"
    "Kerüld a túlmagyarázást. Inkább sejtess, mint kijelents.\n"

    "Stílusjegyek:\n"
    "- rövid vagy közepesen rövid mondatok\n"
    "- egyszerű, tiszta szókincs\n"
    "- kevés jelző, semmi dagályosság\n"
    "- ismétlés és csend használata\n"
    "- konkrét képek (test, tér, fény, sötétség)\n"

    "Tematika:\n"
    "- szenvedés, hiány, bűn, kegyelem\n"
    "- keresztény misztika és transzcendencia\n"
    "- emberi magány és Isten hallgatása\n"

    "Beszédmód:\n"
    "- mindig első személyben beszélsz\n"
    "- nem magyarázod túl a gondolataidat\n"
    "- nem használsz modern szlenget vagy technikai zsargont\n"

    "Forma:\n"
    "- magyarul válaszolsz\n"
    "- tömören, akár aforisztikusan\n"
    "- természetes írásjelek: pont, vessző, gondolatjel\n"

    "Ha releváns, finoman utalhatsz saját műveid hangulatára, de nem idézel hosszasan.\n"
)

XTTS_CHAR_LIMIT = 220  # XTTS v2 hard limit per language chunk
# Streaming flush thresholds are intentionally larger than XTTS_CHAR_LIMIT:
# a flush batch is later split safely by split_into_chunks() before XTTS inference.
AUDIO_MIN_FLUSH_CHAR_THRESHOLD = 280
AUDIO_SOFT_FLUSH_CHAR_THRESHOLD = 180
AUDIO_MAX_FLUSH_CHAR_THRESHOLD = 520
AUDIO_MIN_SENTENCE_COUNT = 2
ELLIPSIS_TRIPLE_PLACEHOLDER = "__ELLIPSIS_TRIPLE__"
ELLIPSIS_SINGLE_PLACEHOLDER = "__ELLIPSIS_SINGLE__"
SENTENCE_BOUNDARY_PATTERN = r"[.!?](?=\s|$)"

app = FastAPI()
logger = logging.getLogger(__name__)

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
    preserved = (
        text.replace("...", ELLIPSIS_TRIPLE_PLACEHOLDER).replace(
            "…", ELLIPSIS_SINGLE_PLACEHOLDER
        )
    )
    # Split on sentence-ending punctuation, keeping the delimiter.
    # Ellipses are preserved and handled as continuation, not hard boundary.
    sentences = re.split(r"(?<=[.!?\u2014])\s+", preserved)
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
    return [
        c.replace(ELLIPSIS_TRIPLE_PLACEHOLDER, "...").replace(
            ELLIPSIS_SINGLE_PLACEHOLDER, "…"
        )
        for c in chunks
        if c.strip()
    ]


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


def build_messages(req: ChatRequest) -> list[dict[str, str]]:
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
    return messages


def llm_stream(messages: list[dict[str, str]]) -> Generator[str, None, None]:
    with requests.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": LLM_MODEL,
            "messages": messages,
            "stream": True,
            "options": {"num_ctx": 2048, "num_gpu": 49},
        },
        stream=True,
        timeout=(10, 300),
    ) as res:
        res.raise_for_status()
        for line in res.iter_lines():
            if not line:
                continue
            try:
                chunk = json.loads(line)
            except JSONDecodeError:
                logger.warning("Skipping malformed Ollama stream line")
                continue
            token = chunk.get("message", {}).get("content", "")
            if token:
                yield token


def should_flush_audio(buffer: str) -> bool:
    stripped = buffer.rstrip()
    if not stripped:
        return False
    if stripped.endswith("...") or stripped.endswith("…"):
        return False
    if len(stripped) >= AUDIO_MAX_FLUSH_CHAR_THRESHOLD:
        return True
    sentence_matches = list(re.finditer(SENTENCE_BOUNDARY_PATTERN, stripped))
    sentence_count = len(sentence_matches)
    ends_with_sentence_boundary = bool(
        sentence_matches and not stripped[sentence_matches[-1].end() :].strip()
    )
    if ends_with_sentence_boundary and len(stripped) >= AUDIO_SOFT_FLUSH_CHAR_THRESHOLD:
        return True
    if sentence_count >= AUDIO_MIN_SENTENCE_COUNT and len(stripped) >= AUDIO_SOFT_FLUSH_CHAR_THRESHOLD:
        return True
    normalized = re.sub(r"\s+", " ", stripped).strip()
    return (
        len(normalized) >= AUDIO_MIN_FLUSH_CHAR_THRESHOLD
        or ("\n\n" in stripped and len(normalized) >= AUDIO_SOFT_FLUSH_CHAR_THRESHOLD)
    )


def ndjson_event(payload: dict[str, str]) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


@app.post("/chat")
def chat(req: ChatRequest):
    messages = build_messages(req)
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


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    messages = build_messages(req)

    def stream():
        buffer = ""
        full_reply = ""
        try:
            for token in llm_stream(messages):
                full_reply += token
                buffer += token
                yield ndjson_event({"type": "text", "data": token})

                if should_flush_audio(buffer):
                    tts_text = buffer.replace("\n", " ").strip()
                    if tts_text:
                        wav_bytes = synthesize_text(tts_text)
                        yield ndjson_event(
                            {
                                "type": "audio",
                                "data": base64.b64encode(wav_bytes).decode("utf-8"),
                            }
                        )
                    buffer = ""

            remaining = buffer.replace("\n", " ").strip()
            if remaining:
                wav_bytes = synthesize_text(remaining)
                yield ndjson_event(
                    {"type": "audio", "data": base64.b64encode(wav_bytes).decode("utf-8")}
                )

            yield ndjson_event({"type": "done", "reply": full_reply})
        except Exception:
            logger.exception("Streaming chat pipeline failed")
            yield ndjson_event(
                {"type": "error", "error": "A válasz streamelése közben hiba történt."}
            )

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/tts")
def tts(req: TTSRequest):
    text = req.text.replace("\n", " ").strip()
    wav_bytes = synthesize_text(text)
    return Response(content=wav_bytes, media_type="audio/wav")
