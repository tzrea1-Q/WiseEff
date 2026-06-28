#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-/Applications/WiseEff Bridge.app}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MACOS_BIN="$APP_PATH/Contents/MacOS/WiseEff Bridge"
SWIFT_SRC="$SCRIPT_DIR/BridgeAppMain.swift"

if [[ ! -d "$APP_PATH" ]]; then
  echo "WiseEff Bridge.app not found at: $APP_PATH" >&2
  exit 1
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

TMP_BIN="$(mktemp)"
swiftc "$SWIFT_SRC" -o "$TMP_BIN" -framework Cocoa
chmod +x "$TMP_BIN"
sudo cp "$TMP_BIN" "$MACOS_BIN"
sudo chown "$(stat -f '%Su' /dev/console):staff" "$MACOS_BIN"
rm -f "$TMP_BIN"

echo "Rebuilt URL handler executable: $MACOS_BIN"
echo "Test with: open 'wiseeff-bridge://connect?server=http%3A%2F%2F101.43.45.27&webOrigin=http%3A%2F%2F101.43.45.27&code=123456'"
