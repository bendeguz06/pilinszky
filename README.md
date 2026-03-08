# Pilinszky

A Tauri + React + TypeScript desktop application that integrates with Ollama for local AI interactions.

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) and [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/)
- [Tauri CLI](https://tauri.app/)
- [Ollama](https://ollama.ai/)

### Running the Project

1. **Start Ollama server:**
   ```bash
   ollama serve
   ```
   By default, Ollama runs on `http://localhost:11434`. If you change this port, update it in `src-tauri/src/clanker.rs`.

2. **Run the Tauri dev environment:**
   ```bash
   bun run tauri dev
   ```
   This starts the desktop application with hot reload. The frontend runs on port 1420.

## Configuration

### Changing the Ollama Model

Edit `src-tauri/src/clanker.rs` and modify the model name:

```rust
let req = ChatRequest {
    model: "qwen2.5:0.5b".to_string(),  // Change this
    // ...
};
```

### Changing the Ollama Port

Edit `src-tauri/src/clanker.rs` and update the API endpoint:

```rust
let res = client
    .post("http://localhost:11434/api/chat")  // Change the port here
    .json(&req)
    .send()
    .await?;
```

### Changing the Frontend Port

Edit `vite.config.ts` and modify the `server.port`:

```typescript
server: {
  port: 1420,  // Change this port
  strictPort: true,
  // ...
}
```

## Build for Production

```bash
bun run tauri build
```

This creates a distributable desktop application in `src-tauri/target/release/bundle/`.
