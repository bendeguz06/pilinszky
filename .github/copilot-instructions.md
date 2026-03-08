# Copilot Instructions for Pilinszky

## Project Overview

Pilinszky is a **Tauri + React + TypeScript desktop application** that integrates with Ollama for AI functionality. It combines a React frontend (compiled with Vite) with a Rust backend that handles native app functionality and LLM interactions.

## Architecture

- **Frontend**: React 19 + TypeScript in `src/`, built with Vite on port 1420
- **Backend**: Rust (Tauri 2) in `src-tauri/`, handles OS integration and API calls
- **Build Process**: TypeScript compiles first, then Vite bundles React, then Tauri packages both
- **Package Manager**: Bun (configured in `tauri.conf.json`)
- **Key Backend Dependencies**: `ollama-rs`, `tokio`, `reqwest` for async HTTP and LLM communication

## Build and Run Commands

### Development
- **Full dev mode**: `bun run dev` (starts Vite frontend on port 1420)
- **Tauri dev**: `bun run tauri dev` (runs the full desktop app with hot reload)
- **TypeScript check**: `bun run build` (compiles TypeScript; part of the prod build)

### Production
- **Build**: `bun run build` (runs `tsc && vite build`, outputs to `dist/`)
- **Preview**: `bun run preview` (tests production build locally)
- **Tauri build**: `bun run tauri build` (packages the desktop app for distribution)

### Rust Backend
- **Format**: `cargo fmt` (in `src-tauri/`)
- **Check**: `cargo check` (in `src-tauri/`)
- **Build**: `cargo build` (in `src-tauri/`, auto-built by Tauri)

**Note**: There is no test suite configured. Add Vitest, Jest, or Cargo tests if needed.

## Key Conventions

### Tauri Commands (Rust ↔ Frontend IPC)
- Commands are defined in `src-tauri/src/` (typically `commands.rs` or `lib.rs`)
- Use `#[tauri::command]` macro to expose Rust functions to the frontend
- Commands are registered in `lib.rs` via `tauri::generate_handler![...]`
- Frontend calls commands with `invoke()` from `@tauri-apps/api/core`
- **Example**: Rust command `greet(name: &str)` → frontend `await invoke("greet", { name })`

### Frontend Structure
- React components in `src/`, entry point is `src/main.tsx`
- Use TypeScript strictly (strict mode enabled; unused variables/parameters cause errors)
- Tauri API imports from `@tauri-apps/api/core`

### Backend Structure
- Main app setup: `src-tauri/src/lib.rs`
- Commands: `src-tauri/src/commands.rs` (add new Tauri commands here)
- Tauri config: `src-tauri/tauri.conf.json` (window size, app metadata, security)

### Development Workflow
1. Frontend changes are hot-reloaded by Vite during `tauri dev`
2. Rust backend changes require restarting `tauri dev` (Tauri watches for changes)
3. TypeScript errors must be fixed before building (strict mode enforced)
4. Use `bun` instead of `npm` (configured as the package manager)

### File Structure Rules
- `dist/` and `node_modules/` are git-ignored
- `src-tauri/target/` is built output; don't commit
- Vite ignores `src-tauri/` during frontend watch (see `vite.config.ts`)

## Ollama Integration

The backend has `ollama-rs` and `reqwest` dependencies for LLM calls. The `ask` command in `lib.rs` is a placeholder; expand it to make real Ollama requests.

## Important Notes

- TypeScript strict mode is enforced; expect compilation errors for loose practices
- No CSS framework configured; app uses plain CSS (`App.css`)
- Security policy (CSP) is set to `null` in `tauri.conf.json`—update if adding external resources
