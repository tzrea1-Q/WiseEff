#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="$(cd "${script_dir}/.." && pwd)"

cd "${compose_dir}"
./scripts/compose --env-file .env exec api npm run db:seed:all
