# Pilinszky Backend

FastAPI service for RAG + XTTS v2, consumed by the Electron client.

Primary runtime path is stream-based chat (`/chat/stream`), not a single full reply payload.

## Recommended setup (Docker Compose)

This is the intended and simplest setup on a GPU server.

### 1) Prepare content

- Put corpus `.txt` files in `backend/corpus/`.
- Put speaker reference `.wav` files in `backend/voice_samples/`.

### 2) Start services

```bash
cd backend

# Optional: only if GHCR package is private
echo "$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin

docker compose pull rag-api
docker compose up -d
docker compose logs -f
```

What this starts:

- `ollama`: model runtime
- `ollama-init`: one-shot model pull (`nomic-embed-text` and `jobautomation/OpenEuroLLM-Hungarian:latest`)
- `rag-api`: FastAPI + XTTS

### 3) Ingest corpus (one-shot service)

```bash
cd backend
docker compose --profile ingest run --rm rag-ingest
```

`rag-ingest` runs scraping + ingestion once (marker-based), then exits.

### 4) Useful deploy controls

```bash
cd backend

# restart API only
docker compose up -d rag-api

# pin deployment to a specific image tag
RAG_API_IMAGE=ghcr.io/bendeguz06/pilinszky-rag-api:sha-<shortsha> docker compose up -d rag-api

# force full scrape+ingest once
FORCE_INGEST=1 docker compose --profile ingest run --rm rag-ingest
```

## API surface

### `POST /chat/stream` (primary)

- Request body:
  `{ "message": string, "history": [{ "role": "user|assistant|system", "content": string }] }`
- Response type: `application/x-ndjson`
- Stream events:
  - `{ "type": "text", "data": "..." }`
  - `{ "type": "audio", "data": "<base64 wav bytes>" }`
  - `{ "type": "done", "reply": "<full reply>" }`
  - `{ "type": "error", "error": "..." }`

### `POST /chat` (non-streaming compatibility)

- Returns full payload at once:
  `{ "reply": string, "audio": "<base64 wav bytes>" }`

### `POST /tts`

- Request body: `{ "text": string }`
- Returns: raw `audio/wav` bytes

## Manual setup (advanced, no Docker)

If you need to run backend directly on the host:

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt -r requirements-local.txt
```

Patch Tortoise after install (same patch as in `docker-entrypoint.sh`):

- In your venv site-packages file `TTS/tts/layers/tortoise/autoregressive.py`
- Replace:
  `from transformers.pytorch_utils import isin_mps_friendly as isin`
- With:
  `isin = torch.isin`

Then run data prep and API:

```bash
cd backend
source .venv/bin/activate

python scrape_corpus.py
python scrape_interviews.py
python ingest.py

python -m uvicorn api:app --host 0.0.0.0 --port 8000
```

Also ensure Ollama is running and both models are pulled before calling `/chat` or `/chat/stream`.

## Google Speech-to-Text note

Speech-to-text is executed by the Electron main process, not by this FastAPI service.
Still, for end-to-end deployments, ensure the app runtime has:

- `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account-key.json`
- A Google Cloud service account with Speech-to-Text API enabled

If your Electron app runs on the same server, this env var must be set there as well.
