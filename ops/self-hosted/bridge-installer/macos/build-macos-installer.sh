#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-0.1.0}"
ARCH="${2:-arm64}"
STAGING_DIR="${3:-}"

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
if [[ -z "$STAGING_DIR" ]]; then
  STAGING_DIR="$ROOT/ops/self-hosted/bridge-installer/staging"
fi

APP_NAME="WiseEff Bridge.app"
BUILD_DIR="$ROOT/ops/self-hosted/bridge-installer/macos/build/$ARCH"
APP_DIR="$BUILD_DIR/$APP_NAME"
CONTENTS="$APP_DIR/Contents"
MACOS_BIN="$CONTENTS/MacOS/WiseEff Bridge"
RESOURCES="$CONTENTS/Resources"
OUT_DIR="$ROOT/ops/self-hosted/bridge-artifacts/$VERSION/darwin/$ARCH"
PKG_PATH="$OUT_DIR/WiseEffBridge_${VERSION}_darwin_${ARCH}.pkg"

rm -rf "$BUILD_DIR"
mkdir -p "$CONTENTS/MacOS" "$RESOURCES" "$OUT_DIR"

sed "s/__VERSION__/$VERSION/g" "$ROOT/ops/self-hosted/bridge-installer/macos/Info.plist.template" > "$CONTENTS/Info.plist"
cp "$STAGING_DIR/cli.js" "$RESOURCES/cli.js"
cp "$STAGING_DIR/wiseeff-bridge" "$RESOURCES/wiseeff-bridge"
chmod +x "$RESOURCES/wiseeff-bridge"

cat > "$MACOS_BIN" <<'LAUNCHER'
#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
if [[ $# -eq 1 && "$1" == wiseeff-bridge://* ]]; then
  exec "$DIR/wiseeff-bridge" --handle-url "$1"
fi
exec "$DIR/wiseeff-bridge" "$@"
LAUNCHER
chmod +x "$MACOS_BIN"

pkgbuild --root "$APP_DIR" --identifier com.wiseeff.bridge --version "$VERSION" --install-location "/Applications/$APP_NAME" "$PKG_PATH"
echo "Created macOS installer: $PKG_PATH"

LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.wiseeff.bridge.plist"
mkdir -p "$(dirname "$LAUNCH_AGENT")"
cat > "$LAUNCH_AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.wiseeff.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/$APP_NAME/Contents/Resources/wiseeff-bridge</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
PLIST
