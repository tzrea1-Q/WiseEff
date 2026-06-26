#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  local console_user
  console_user="$(stat -f '%Su' /dev/console 2>/dev/null || true)"
  local user_home="${HOME:-}"
  if [[ -z "$user_home" && -n "$console_user" && "$console_user" != "root" ]]; then
    user_home="/Users/$console_user"
  fi

  local candidates=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
  )
  if [[ -n "$user_home" ]]; then
    candidates+=("$user_home/.local/bin/node" "$user_home/.nvm/current/bin/node")
  fi
  candidates+=("/usr/bin/node")

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(resolve_node)" || {
  echo "wiseeff-bridge: Node.js not found. Install Node 20+ or add it to PATH." >&2
  exit 127
}

exec "$NODE_BIN" "$DIR/cli.js" "$@"
