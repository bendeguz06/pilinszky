# Local whisper.cpp runtime files

Do not commit raw binaries or `.bin` model blobs. Use setup scripts from repo root:

```bash
npm run whisper:download
```

Sources used by the scripts:

- Models: `https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/download-ggml-model.sh`
- Model files: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<model>.bin`
- Windows binaries: `https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest`
- Linux/macOS executables: source tarball from the same release tag, then local `cmake` build

Generated layout:

- `bin/linux/whisper`
- `bin/darwin/whisper`
- `bin/win32/whisper.exe`
- `models/ggml-small.bin` (default model used by app)

Runtime overrides:

- `WHISPER_BIN_PATH`
- `WHISPER_MODEL_PATH`

