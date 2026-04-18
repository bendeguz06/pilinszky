# Pilinszky

Electron kiosk app for speaking with an AI embodiment of János Pilinszky. The app streams text + audio chunks from a GPU backend, uses RAG over Pilinszky texts, and supports microphone transcription via Google Cloud Speech-to-Text.

## Current architecture

- Electron (`src/main/index.ts`) calls backend `POST /chat/stream` and consumes NDJSON events.
- Stream events arrive as `{type: "text" | "audio" | "done" | "error"}`.
- `audio` chunks are base64 WAV payloads; Electron wraps them into `data:audio/wav;base64,...`.
- Backend (`backend/api.py`) uses Ollama for LLM + embeddings, ChromaDB for retrieval, XTTS v2 for speech.
- Legacy `POST /chat` still exists and returns one full `{reply, audio}` payload.

## Project layout

```text
pilinszky/
├── src/                        # Electron app (main/preload/renderer)
├── backend/                    # FastAPI + RAG + XTTS services and compose files
├── .github/workflows/          # CI for app artifacts and backend image publishing
├── .env                        # Local Electron runtime env (POD_URL, STT envs)
└── electron-builder.yml        # Desktop packaging config
```

## Prerequisites

### Local machine (Electron app)

- Node.js 20+
- `npm` (or Bun)
- Google Cloud service-account key file for Speech-to-Text

Google STT setup:

1. Create a Google Cloud service account with Speech-to-Text API access enabled.
2. Save its key JSON as a local file (for example repo-root `.google`, already gitignored).
3. Set `GOOGLE_APPLICATION_CREDENTIALS` to that file path.

Example `.env` at repo root:

```bash
POD_URL=http://<backend-host>:8000
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/pilinszky/.google
STT_LANGUAGE_CODE=hu-HU
STT_MODEL=latest_long
# optional, only if needed
# STT_SAMPLE_RATE_HZ=48000
```

### Backend host (vast.ai or other GPU server)

- NVIDIA GPU with CUDA 13.x capable drivers
- Docker + NVIDIA Container Toolkit
- Open ports 8000 (API), Ollama running but not exposed publicly

## Recommended setup (Docker Compose, simplest)

This is the default deployment path and should be preferred over manual installation.

### 1) Start backend services on the server

```bash
# SSH into your GPU server and run:
git clone https://github.com/bendeguz06/pilinszky.git
cd pilinszky/backend

docker compose pull rag-api
docker compose up -d
docker compose logs -f
```

Notes:

- `rag-api` pulls prebuilt image `ghcr.io/bendeguz06/pilinszky-rag-api:latest` by default.
- `ollama-init` auto-pulls the configured LLM and embedding models.

### 2) Run one-time ingestion (or when corpus changes)

```bash
cd /path/to/pilinszky/backend
docker compose --profile ingest run --rm rag-ingest
```

### 3) Run Electron app locally

```bash
cd /path/to/pilinszky
npm install
npm run dev
```

## Manual backend setup (advanced, no Docker)

Use this only if you intentionally do not want the compose flow.

1. Install Python 3.12, CUDA-compatible PyTorch dependencies, Ollama, ffmpeg/libs.
2. Create and activate a virtualenv in `backend/`.
3. Install `requirements.txt` and `requirements-local.txt`.
4. Apply the Tortoise import patch used by `backend/docker-entrypoint.sh`:
   replace
   `from transformers.pytorch_utils import isin_mps_friendly as isin`
   with
   `isin = torch.isin`
   in `TTS/tts/layers/tortoise/autoregressive.py` in your venv.
5. Ensure Ollama is running and pull models:
   `nomic-embed-text` and `jobautomation/OpenEuroLLM-Hungarian:latest`.
6. Run data prep scripts in `backend/`: `scrape_corpus.py`, `scrape_interviews.py`, then `ingest.py`.
7. Start backend:
   `python -m uvicorn api:app --host 0.0.0.0 --port 8000`

For full backend-focused commands, see `backend/README.md`.

## Streaming API behavior

- `POST /chat/stream` is the primary runtime path.
- Response media type: `application/x-ndjson`.
- Event sequence is typically:
  1. many `text` events
  2. intermittent `audio` events
  3. final `done` event with full reply
- On failures, an `error` event is emitted.

Other endpoints:

- `POST /chat`: non-streaming, returns complete `{reply, audio}`
- `POST /tts`: returns raw `audio/wav`

## Backend deployment and updates

- Backend image publishing is handled by `.github/workflows/publish-backend-image.yml`.
- Pushed image tags include default `latest`, branch, and commit SHA.
- You can pin server deploys with:

```bash
cd backend
RAG_API_IMAGE=ghcr.io/bendeguz06/pilinszky-rag-api:sha-<commit> docker compose up -d rag-api
```

## Frontend development commands

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run format
```
