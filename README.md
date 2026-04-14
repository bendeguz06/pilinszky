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

SpeechRecognition remains the primary mic path. If it fails, the renderer records a short clip and sends it over IPC to Electron main, where the app forwards it to your backend STT endpoint:

- `POST ${POD_URL}/stt`
- request body: `{ audioBase64, mimeType, language }`
- response body: `{ transcript: string }`

Recommended third-party STT providers for reliable Hungarian demo quality:

- **Google Cloud Speech-to-Text** (very reliable HU, production-grade)
- **Azure AI Speech** (very reliable HU, strong enterprise uptime)
- **OpenAI gpt-4o-mini-transcribe** (usually cheapest/easiest for demos, good HU quality)
