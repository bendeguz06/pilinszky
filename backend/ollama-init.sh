#!/bin/sh
set -eu

: "${OLLAMA_MODEL_1:?OLLAMA_MODEL_1 must be set}"
: "${OLLAMA_MODEL_2:?OLLAMA_MODEL_2 must be set}"

until ollama list >/dev/null 2>&1; do
  sleep 2
done

ollama pull "$OLLAMA_MODEL_1"
ollama pull "$OLLAMA_MODEL_2"
