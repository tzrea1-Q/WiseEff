#!/usr/bin/env bash
set -euo pipefail

avail_kb="$(awk '/MemAvailable/ {print $2}' /proc/meminfo)"
swap_free_kb="$(awk '/SwapFree/ {print $2}' /proc/meminfo)"
avail_mb=$((avail_kb / 1024))
swap_free_mb=$((swap_free_kb / 1024))

if [ "$avail_kb" -lt 400000 ]; then
  logger -t mem-watch "CRITICAL MemAvailable=${avail_mb}MB SwapFree=${swap_free_mb}MB — stop builds or run: ops/self-hosted/scripts/memory-mode.sh dev"
fi
