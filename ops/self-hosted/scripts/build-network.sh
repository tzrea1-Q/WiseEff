#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="$(cd "${script_dir}/.." && pwd)"
# shellcheck source=build-network-lib.sh
source "${script_dir}/build-network-lib.sh"

action="status"
config_file="${WISEEFF_BUILD_NETWORK_FILE:-${compose_dir}/.build-network.env}"
json="false"

usage() {
  cat <<'EOF'
Usage: build-network.sh init|status [--config PATH] [--json]

`init` creates a mode-0600 config without overwriting an existing file.
`status` loads only allowlisted data and prints a credential-free summary.
The default config is ops/self-hosted/.build-network.env; shell proxy variables
take precedence over empty or matching values in that file.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    init|status) action="$1"; shift ;;
    --config)
      [ "$#" -ge 2 ] || { echo "--config requires a path." >&2; exit 2; }
      config_file="$2"
      shift 2
      ;;
    --json) json="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown action or option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$action" = "init" ]; then
  if [ -e "$config_file" ]; then
    echo "Build-network config already exists: ${config_file}" >&2
    exit 10
  fi
  [ -d "$(dirname "$config_file")" ] || {
    echo "Build-network config parent does not exist: $(dirname "$config_file")" >&2
    exit 10
  }
  install -m 600 "${compose_dir}/.build-network.env.example" "$config_file"
  printf 'Created %s (mode 600). Edit the values, then run: ./scripts/build-network.sh status\n' "$config_file"
  exit 0
fi

wiseeff_build_network_prepare "$compose_dir" "$config_file"
if [ "$json" = "true" ]; then
  wiseeff_build_network_print_status json
else
  wiseeff_build_network_print_status text
fi
