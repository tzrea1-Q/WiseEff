#!/usr/bin/env bash
# Operator working-directory entry: same cutover CLIs as scripts/wayfinder,
# invoked from ops/self-hosted. Diagnostics stay sanitized by the Node CLIs.
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"
command="${1:-}"
shift || true
case "${command}" in
  plan)
    exec npx --prefix "${repo_root}" tsx "${repo_root}/scripts/wayfinder/plan-parameter-catalog-cutover.ts" "$@"
    ;;
  execute)
    exec npx --prefix "${repo_root}" tsx "${repo_root}/scripts/wayfinder/execute-parameter-catalog-cutover.ts" "$@"
    ;;
  inspect)
    exec npx --prefix "${repo_root}" tsx "${repo_root}/scripts/wayfinder/inspect-parameter-catalog-cutover.ts" "$@"
    ;;
  recover)
    exec npx --prefix "${repo_root}" tsx "${repo_root}/scripts/wayfinder/recover-parameter-catalog-cutover.ts" "$@"
    ;;
  *)
    printf 'Usage: parameter-catalog-cutover.sh plan|execute|inspect|recover [...args]\n' >&2
    exit 2
    ;;
esac
