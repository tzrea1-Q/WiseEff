#!/usr/bin/env bash
# Compatibility wrapper for the IP lab profile. Prefer ./scripts/setup.sh.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${script_dir}/setup.sh" --non-interactive --profile ip-lab "$@"
