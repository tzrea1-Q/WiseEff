#!/usr/bin/env bash
# Diagnose a generated self-hosted .env and selected Caddyfile.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${compose_dir}/../.." && pwd)"
env_file="${compose_dir}/.env"
probe_live="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) env_file="${2:-}"; shift 2 ;;
    --probe-live) probe_live="true"; shift ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--env-file PATH] [--probe-live]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -x "${repo_root}/node_modules/.bin/tsx" ]; then
  args=(--env-file "${env_file}")
  [ "${probe_live}" = "true" ] && args+=(--probe-live)
  exec "${repo_root}/node_modules/.bin/tsx" "${script_dir}/doctor-selfhost.ts" -- "${args[@]}"
fi

exec "${script_dir}/setup.sh" --non-interactive --env-file "${env_file}" preflight
