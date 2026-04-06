# Pilinszky Backend

FastAPI service providing RAG-augmented chat and XTTS v2 text-to-speech for the Pilinszky kiosk.

## Setup

### 1. Place corpus files
Put `.txt` files (Pilinszky poems, essays, interviews) in `backend/corpus/`.

### 2. Place voice samples
Put `.wav` recordings of the target voice in `backend/voice_samples/`.  
XTTS v2 uses these as speaker references for cloning.

### 3. Pull Ollama models
```bash
docker compose up -d ollama
docker exec -it pilinszky-ollama-1 ollama pull nomic-embed-text
docker exec -it pilinszky-ollama-1 ollama pull jobautomation/OpenEuroLLM-Hungarian:latest
```

### 4. Ingest corpus
```bash
docker compose run --rm rag-api python ingest.py
```
This chunks the corpus, embeds each chunk via `nomic-embed-text`, and stores them in ChromaDB at `backend/chroma_db/`.

### 5. Start all services
```bash
docker compose up -d
```
The API is available at `http://localhost:8000`.

### 6. Connect the Electron app
Set `POD_URL` in `src/main/index.ts` to the pod's public URL (e.g. a Cloudflare tunnel URL pointing at port 8000).

## API

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/chat` | `{ message: string, history: Message[] }` | `{ reply: string }` |
| POST | `/tts` | `{ text: string }` | raw WAV audio bytes |

## Re-ingesting
If you add new corpus files, re-run `ingest.py`. It uses `upsert` so existing chunks are updated rather than duplicated.
