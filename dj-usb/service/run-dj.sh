#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CONFIG="$ROOT/spider-dj.json"

if [[ ! -f "$CONFIG" && -f "$ROOT/config.example.json" ]]; then
  cp "$ROOT/config.example.json" "$CONFIG"
fi

MODEL="$ROOT/model/optional-model.gguf"
LLAMA="$ROOT/bin/llama-server"
LLAMA_PID=""

cleanup() {
  if [[ -n "$LLAMA_PID" ]]; then
    kill "$LLAMA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ -x "$LLAMA" && -f "$MODEL" ]]; then
  "$LLAMA" \
    -m "$MODEL" \
    --host 127.0.0.1 \
    --port 11435 \
    --ctx-size 4096 \
    >/tmp/bcn-portable-llama.log 2>&1 &
  LLAMA_PID="$!"
  sleep 2
fi

export SPIDER_DJ_CONFIG="$CONFIG"
exec python3 "$HERE/service.py"
