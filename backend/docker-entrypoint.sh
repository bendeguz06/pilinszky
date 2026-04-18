#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace/pilinszky}"
BACKEND_DIR="${BACKEND_DIR:-$WORKSPACE_DIR/backend}"
VENV_DIR="${VENV_DIR:-/workspace/venv}"
UVICORN_HOST="${UVICORN_HOST:-0.0.0.0}"
UVICORN_PORT="${UVICORN_PORT:-8000}"
INGEST_MARKER="${INGEST_MARKER:-$BACKEND_DIR/.ingested}"

cd "$BACKEND_DIR"

# Activate the virtualenv requested by the deployment requirements.
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python - <<'PY'
from pathlib import Path
import site

paths = [Path(p) / "TTS/tts/layers/tortoise/autoregressive.py" for p in site.getsitepackages()]
paths.append(Path(site.getusersitepackages()) / "TTS/tts/layers/tortoise/autoregressive.py")

target = next((p for p in paths if p.exists()), None)
if target is None:
    raise SystemExit("Could not find TTS tortoise autoregressive.py to patch.")

text = target.read_text(encoding="utf-8")
old_import = "from transformers.pytorch_utils import isin_mps_friendly as isin"
new_import = "isin = torch.isin"

if new_import in text:
    print(f"Already patched {target}")
elif old_import in text:
    target.write_text(text.replace(old_import, new_import, 1), encoding="utf-8")
    print(f"Patched {target}")
else:
    raise SystemExit(
        f"Could not find expected import line to patch in {target}: {old_import!r}"
    )
PY

# Prepare the corpus and vector store once, then persist through the compose volume.
if [[ ! -f "$INGEST_MARKER" ]]; then
  python scrape_corpus.py & pid1=$!
  python scrape_interviews.py & pid2=$!

  wait $pid1 || exit 1
  wait $pid2 || exit 1

  python ingest.py
  touch "$INGEST_MARKER"
fi

exec python -m uvicorn api:app --host "$UVICORN_HOST" --port "$UVICORN_PORT"
