# Pilinszky

An Electron kiosk application that lets you converse with an AI embodiment of Hungarian poet János Pilinszky. The avatar speaks and lip-syncs in Hungarian, retrieves context from his poems and interviews (RAG), and uses voice-cloned text-to-speech to respond in his actual voice.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              Electron App (local)            │
│                                              │
│  Renderer (UI + avatar canvas)               │
│       ↕ contextBridge                        │
│  Preload (window.pilinszky.chat())           │
│       ↕ IPC                                  │
│  Main process                                │
│       ↕ HTTP (POD_URL)                       │
└──────────────────┬──────────────────────────┘
                   │
         [Cloudflare tunnel / direct IP]
                   │
┌──────────────────▼──────────────────────────┐
│           FastAPI backend (vast.ai GPU)      │
│                                              │
│  POST /chat                                  │
│    1. Embed query → ChromaDB top-3 chunks    │
│    2. Build prompt (persona + context)       │
│    3. Send to Ollama LLM → reply text        │
│    4. XTTS v2 TTS → base64 WAV audio         │
│    return { reply, audio }                   │
│                                              │
│  POST /tts  (standalone TTS endpoint)        │
│                                              │
│  ┌─────────────┐  ┌──────────┐  ┌────────┐  │
│  │   Ollama    │  │ChromaDB  │  │XTTS v2 │  │
│  │  LLM + emb  │  │  (RAG)   │  │ (TTS)  │  │
│  └─────────────┘  └──────────┘  └────────┘  │
└─────────────────────────────────────────────┘
```

**GPU requirements:** CUDA 12.1, driver ≥ 525.85, ≥ 16 GB VRAM recommended (LLM ~8 GB + XTTS ~3 GB).

---

## Project structure

```
pilinszky/
├── src/
│   ├── main/index.ts          # Electron main process, IPC handlers (chat, speak)
│   ├── preload/index.ts       # contextBridge — exposes window.pilinszky.chat()
│   ├── preload/index.d.ts     # Window type declarations
│   ├── renderer/
│   │   ├── index.html         # UI shell (Hungarian lang, CSP, layout)
│   │   ├── src/index.ts       # Chat logic, mic input, message history
│   │   └── src/avatar.ts      # Canvas avatar: lip-sync, eye tracking, blink
│   └── shared/types.ts        # Shared types: Message, ChatPayload, ChatResponse
├── backend/
│   ├── api.py                 # FastAPI app: /chat and /tts endpoints
│   ├── ingest.py              # One-time corpus ingestion into ChromaDB
│   ├── scrape_corpus.py       # Scrapes poems from konyvtar.dia.hu
│   ├── scrape_interviews.py   # Scrapes interviews from konyvtar.dia.hu
│   ├── Dockerfile             # CUDA 12.1 + Python 3.11 + pip install
│   ├── requirements.txt       # Production deps (torch cu121, coqui-tts, chromadb)
│   ├── requirements-local.txt # Local-only deps (beautifulsoup4 for scraping)
│   ├── corpus/                # .txt files fed to ingest.py
│   ├── chroma_db/             # Persisted ChromaDB vector store (after ingestion)
│   └── voice_samples/         # WAV files for XTTS speaker cloning
├── docker-compose.yml         # Orchestrates ollama + rag-api with GPU passthrough
├── .env                       # POD_URL=<backend URL>
└── electron-builder.yml       # Build targets: AppImage, DMG, portable EXE
```

---

## Prerequisites

**Local machine:**
- Node.js ≥ 20 and [Bun](https://bun.sh) (or npm)
- A `.env` file at the repo root with `POD_URL` set (see below)

**vast.ai GPU instance:**
- NVIDIA GPU with CUDA ≥ 12.1 (driver ≥ 525.85)
- Docker + [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed
- ≥ 16 GB VRAM (LLM ~8 GB + XTTS v2 ~3 GB)
- Ports 8000 and 11434 exposed in the vast.ai instance settings

---

## Development

### 1. Provision a vast.ai instance

On [vast.ai](https://vast.ai), rent a GPU instance with:
- Template: **PyTorch** or **CUDA 12.1** (any image that has Docker + nvidia-container-toolkit)
- VRAM: ≥ 16 GB
- Storage: ≥ 40 GB (models + torch wheels are large)
- Exposed ports: add **8000** and **11434** in the instance config before launching

### 2. SSH into the instance and start the backend

```bash
ssh root@<vast-ai-ip> -p <ssh-port>

# Clone the repo
git clone https://github.com/bendeguz06/pilinszky.git
cd pilinszky

# Build and start both services (Ollama + FastAPI)
docker compose up -d --build

# Watch logs to confirm both services started
docker compose logs -f
```

### 3. Pull the Ollama models (first time only)

The LLM and embedding model must be pulled inside the running Ollama container:

```bash
docker exec -it pilinszky-ollama-1 ollama pull nomic-embed-text
docker exec -it pilinszky-ollama-1 ollama pull jobautomation/OpenEuroLLM-Hungarian:latest
```

The LLM is several gigabytes — this takes a few minutes.

### 4. Set up the corpus (first time only)

See [Corpus setup](#corpus-setup-one-time) below.

### 5. Configure POD_URL on your local machine

Get the backend's public address from the vast.ai dashboard (the exposed port 8000 entry). It looks like `http://123.45.67.89:12345`.

```bash
# In the repo root on your local machine:
echo "POD_URL=http://<vast-ai-ip>:<exposed-port-8000>" > .env
```

### 6. Install dependencies and run

```bash
npm install
npm run dev
```

The Electron window opens and connects to the backend on vast.ai.

---

## Corpus setup (one-time)

The RAG system needs text files ingested into ChromaDB before the app can retrieve context.

### Option A — scrape from the web

```bash
# Install scraping deps locally
pip install -r backend/requirements-local.txt

# Scrape poems (~100 poems from konyvtar.dia.hu)
python backend/scrape_corpus.py

# Scrape interviews
python backend/scrape_interviews.py
```

This produces `backend/corpus/versek.txt` and `backend/corpus/interjuk.txt`.

### Option B — write your own

Place `.txt` files in `backend/corpus/` using this format:

```
[TYPE: vers]
[TITLE: Négysoros]

Alvó szegek a jéghideg homokban.
Plakátmagányban ázó éjjelek.
Égve hagytad a folyosón a villanyt.
Ma ontják véremet.

---

[TYPE: vers]
[TITLE: Apokrif]

...
```

Sections separated by `\n\n---\n\n`. `TYPE` and `TITLE` are stored as metadata.

### Run ingestion

```bash
# Inside the rag-api container on vast.ai
docker exec -it pilinszky-rag-api-1 python3.11 ingest.py
```

ChromaDB is persisted in `backend/chroma_db/`. Re-run ingestion any time you add corpus files.

### Voice samples

Place `.wav` recordings of Pilinszky's voice in `backend/voice_samples/`. The four existing files (`interview_pilinszky01-04.wav`) are Hungarian interview recordings used by XTTS v2 for speaker conditioning. Replace or add samples to change the voice character.

---

## Production build

Production packages the Electron app as a standalone binary. The backend still needs to run on vast.ai, but now exposed via a Cloudflare tunnel for a stable public URL.

### 1. Set up a Cloudflare tunnel on the vast.ai instance

```bash
# On the vast.ai instance
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared

# Start a tunnel pointing to the local FastAPI port
./cloudflared tunnel --url http://localhost:8000
```

Copy the generated URL (e.g. `https://something-something.trycloudflare.com`).

### 2. Update .env

```bash
echo "POD_URL=https://something-something.trycloudflare.com" > .env
```

### 3. Build the Electron app

```bash
# Linux (AppImage)
npm run build:linux

# Windows (portable .exe)
npm run build:win

# macOS (.dmg)
npm run build:mac
```

Artifacts are written to `dist/`. The app connects to `POD_URL` at runtime — it is baked in at build time via `dotenv`.

---

## Each-time startup (new vast.ai instance)

When you spin up a fresh instance:

```bash
# 1. SSH in
ssh root@<new-ip> -p <ssh-port>

# 2. Clone and start
git clone https://github.com/bendeguz06/pilinszky.git && cd pilinszky
docker compose up -d --build

# 3. Pull models (required every fresh instance unless ollama_data volume was preserved)
docker exec -it pilinszky-ollama-1 ollama pull nomic-embed-text
docker exec -it pilinszky-ollama-1 ollama pull jobautomation/OpenEuroLLM-Hungarian:latest

# 4. Run ingestion if chroma_db/ is empty
docker exec -it pilinszky-rag-api-1 python3.11 ingest.py

# 5. Update POD_URL locally (dev) or start cloudflared tunnel (prod)
echo "POD_URL=http://<new-ip>:<port>" > .env
```

---

## Useful commands

```bash
# Tail all backend logs
docker compose logs -f

# Restart just the API (after code changes)
docker compose restart rag-api

# Check GPU usage inside container
docker exec -it pilinszky-rag-api-1 nvidia-smi

# Check which Ollama models are loaded
docker exec -it pilinszky-ollama-1 ollama list

# Re-run ingestion (after adding corpus files)
docker exec -it pilinszky-rag-api-1 python3.11 ingest.py

# Check dependency conflicts without a GPU
uv pip compile backend/requirements.txt --extra-index-url https://download.pytorch.org/whl/cu121
```

---

## Troubleshooting

### Docker build times out mid-download

```
ReadTimeoutError: HTTPSConnectionPool(host='download.pytorch.org', port=443): Read timed out.
```

pip's default read timeout (~15 s) is too short for the 731 MB `nvidia_cudnn_cu12` wheel. The Dockerfile already uses `--timeout 300` to fix this. If you see this error it means you're running an old version of the Dockerfile — pull the latest and rebuild.

### Wrong Python version (cp310 wheels on Python 3.11)

Ubuntu 22.04's `pip3` targets the system Python 3.10, not the 3.11 you installed. The Dockerfile uses `python3.11 -m pip` to ensure `cp311` wheels are downloaded and the correct interpreter is used. Same fix as above — use the current Dockerfile.

### CUDA driver too old

```bash
nvidia-smi  # check "CUDA Version" in top-right — must be ≥ 12.1
```

If it shows < 12.1, the vast.ai instance has an old driver. Destroy it and pick a newer one. Look for instances with driver ≥ 525.85.

### Ollama models not found / LLM returns empty

```bash
docker exec -it pilinszky-ollama-1 ollama list
```

If the models aren't there, pull them (see step 3 above). The `docker-compose.yml` does not auto-pull models on startup.

### Out of VRAM (both services crash or hang)

Both `ollama` and `rag-api` claim all GPUs. On a 16 GB card:
- OpenEuroLLM-Hungarian (if Q4): ~5–8 GB
- XTTS v2: ~3 GB

If you're on a smaller card, the second service to initialize will OOM. Workaround: use a larger instance, or set `count: 1` and assign specific GPU IDs in `docker-compose.yml`.

### Backend unreachable from Electron

1. Check vast.ai dashboard — port 8000 must be in the **"exposed ports"** list, not just open in the firewall.
2. Confirm `POD_URL` in `.env` matches the exact IP:port shown in the dashboard.
3. `curl $POD_URL/docs` from your laptop — should return FastAPI's Swagger UI HTML.

---

## Frontend development

```bash
npm install          # install dependencies
npm run dev          # start with HMR (hot reload)
npm run typecheck    # run both node and web TypeScript checks
npm run lint         # ESLint
npm run format       # Prettier
```

Recommended IDE: VSCode with ESLint + Prettier extensions.

---

## CI/CD

GitHub Actions (`.github/workflows/build.yml`) builds all three platform targets on every push to `master` and on PRs. Artifacts (AppImage, DMG, portable EXE) are uploaded and available for download from the Actions run page.
