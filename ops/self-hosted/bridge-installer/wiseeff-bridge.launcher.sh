#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="${HOME:-/tmp}/.wiseeff/bridge-launch.log"
mkdir -p "$(dirname "$LOG")"
printf '%s wiseeff-bridge argv=%q\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$*" >> "$LOG"

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
    candidates+=(
      "$user_home/.local/bin/node"
      "$user_home/.nvm/current/bin/node"
      "$user_home/.fnm/current/bin/node"
    )
  fi
  candidates+=("/usr/bin/node")

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done

  local login_node
  login_node="$(/usr/bin/env -i HOME="${HOME:-$user_home}" USER="${USER:-$console_user}" /bin/bash -lc 'command -v node' 2>/dev/null || true)"
  if [[ -n "$login_node" && -x "$login_node" ]]; then
    echo "$login_node"
    return 0
  fi
  return 1
}

NODE_BIN="$(resolve_node)" || {
  echo "wiseeff-bridge: Node.js not found. Install Node 20+ or add it to PATH." >&2
  printf '%s wiseeff-bridge ERROR=node-not-found\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$LOG"
  exit 127
}

exec "$NODE_BIN" "$DIR/cli.js" "$@"
