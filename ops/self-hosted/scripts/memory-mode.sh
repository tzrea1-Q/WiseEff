#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/scripts/compose"

usage() {
  cat <<EOF
Usage: $(basename "$0") <dev|selfhost|status>

  dev       Stop self-hosted Docker stack before local Cursor/npm development.
  selfhost  Start self-hosted stack (refuses when MemAvailable < 800MB).
  status    Show memory, swap, and Docker usage.
EOF
}

mem_available_mb() {
  awk '/MemAvailable/ {printf "%d", $2 / 1024}' /proc/meminfo
}

cmd="${1:-}"
case "$cmd" in
  dev)
    echo "Stopping self-hosted stack for local development..."
    "$COMPOSE" --env-file "$ROOT/.env" down
    echo "Done. Safe to run: npm run dev / npm run dev:all / npm run build"
    ;;
  selfhost)
    avail="$(mem_available_mb)"
    if [ "$avail" -lt 800 ]; then
      echo "Refusing to start stack: MemAvailable=${avail}MB (< 800MB)." >&2
      echo "Run '$(basename "$0") dev' and close heavy dev processes first." >&2
      exit 1
    fi
    echo "Starting self-hosted stack (MemAvailable=${avail}MB)..."
    "$COMPOSE" --env-file "$ROOT/.env" up -d
    ;;
  status)
    free -h
    echo ""
    docker stats --no-stream 2>/dev/null || echo "Docker stack not running."
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
