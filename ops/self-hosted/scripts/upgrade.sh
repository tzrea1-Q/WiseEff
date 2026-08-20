#!/usr/bin/env bash
# WiseEff self-hosted upgrade entry. The implementation lives in upgrade-lib.sh
# so the launcher can be replaced safely when a target checkout changes.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=upgrade-lib.sh
source "${script_dir}/upgrade-lib.sh"

wiseeff_upgrade_main "$@"
