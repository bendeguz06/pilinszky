# pilinszky

A minimal Electron application with TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```

## Local Whisper Fallback (Electron)

SpeechRecognition remains the primary mic path. If it fails, the renderer records a short local clip and sends it over IPC to Electron main, where `whisper.cpp` runs locally with Hungarian language.

### 0. Download runtime assets (no binaries in git)

```bash
npm run whisper:download
npm run check:whisper
```

If you upgraded scripts after an earlier install, re-generate the local binary bundle so runtime libraries are copied too:

```bash
npm run whisper:download:bin -- --force
npm run check:whisper
```

What these scripts do (from upstream `whisper.cpp` sources):

- Model list source: `models/download-ggml-model.sh`
- Model download source: HuggingFace `ggerganov/whisper.cpp`
- Windows executable source: latest GitHub release assets
- Linux/macOS executable source: release tag tarball + local CMake build (official releases currently ship Windows binaries)

### 1. Generated runtime file layout

- `resources/whisper/bin/linux/whisper`
- `resources/whisper/bin/darwin/whisper`
- `resources/whisper/bin/win32/whisper.exe`
- `resources/whisper/models/ggml-small.bin` (default)

### 2. Recommended model choice

- Default for broad compatibility on dedicated GPUs: `ggml-small.bin`
- Better HU accuracy (more VRAM/latency): `ggml-medium.bin`

Use environment variable `WHISPER_MODEL_FILE` to switch models without code changes.

### 3. Optional runtime overrides

- `WHISPER_BIN_PATH` absolute path to whisper binary
- `WHISPER_MODEL_PATH` absolute path to model file
- `WHISPER_MODEL_FILE` model file name under `resources/whisper/models`
- `WHISPER_FFMPEG_PATH` path to `ffmpeg` used to convert recorder formats (webm/ogg/mp4) to WAV
- `WHISPER_LANGUAGE` defaults to `hu`
- `WHISPER_TIMEOUT_MS` defaults to `45000`

