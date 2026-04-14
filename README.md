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

## Speech-to-Text fallback (Electron)

SpeechRecognition remains the primary mic path. If it fails, the renderer records a short clip and sends it over IPC to Electron main, where the app calls **Google Cloud Speech-to-Text** directly.

### Google Cloud setup

1. Create or select a Google Cloud project.
2. Enable **Cloud Speech-to-Text API**.
3. Create a service account with Speech permissions (for example: `roles/speech.client`).
4. Create a JSON key for that service account.
5. Set environment variables before starting Electron:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
STT_LANGUAGE_CODE=hu-HU
STT_MODEL=latest_short
# optional if your input sample rate is fixed:
STT_SAMPLE_RATE_HZ=48000
```

Notes:
- `GOOGLE_APPLICATION_CREDENTIALS` is required for local/service-account auth.
- `STT_LANGUAGE_CODE` defaults to `hu-HU`.
- `STT_MODEL` defaults to `latest_short`.
- `STT_SAMPLE_RATE_HZ` is optional.
