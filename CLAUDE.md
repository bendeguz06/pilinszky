# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Start in development mode (with HMR)
npm run build      # Typecheck + build for production
npm run lint       # ESLint
npm run typecheck  # Run both node and web typechecks
npm run format     # Prettier formatting

# Platform-specific production builds
npm run build:linux
npm run build:mac
npm run build:win
```

## Architecture

This is an Electron app built with [electron-vite](https://electron-vite.org/). It follows the standard Electron three-process model:

- **`src/main/index.ts`** — Main process. Creates the `BrowserWindow` in kiosk/fullscreen mode (no navigation, no external links). Registers two IPC handlers:
  - `chat` — POSTs `{ message, history }` to a backend at `POD_URL` (currently empty, intended for a Cloudflare tunnel) and returns the AI reply string.
  - `speak` — POSTs `{ text }` to `POD_URL/tts`, receives audio as an arraybuffer, and returns a base64 `data:audio/wav` URI for the renderer to play.
  - Also wires up `electron-updater` for auto-updates.

- **`src/preload/index.ts`** — Preload script. Bridges the renderer to the main process via `contextBridge`. Exposes `window.pilinszky.chat()` and `window.pilinszky.speak()` as the renderer-facing API. Context isolation is enabled and must stay enabled.

- **`src/renderer/`** — Renderer process (browser context). Plain TypeScript with no framework — just `renderer.ts` and HTML/CSS. Currently minimal (displays Electron/Chromium/Node versions).

- **`src/shared/types.ts`** — Shared TypeScript types (`Message`, `ChatPayload`) used by both main and preload.

## Key Details

- `POD_URL` in `src/main/index.ts` is empty and must be set to the backend URL (e.g., a Cloudflare tunnel) for `chat` and `speak` to work.
- The window type declarations for `window.pilinszky` are in `src/preload/index.d.ts` — extend this when adding new preload APIs.
- Two separate tsconfigs: `tsconfig.node.json` (main + preload) and `tsconfig.web.json` (renderer).
