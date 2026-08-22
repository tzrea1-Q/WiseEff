#!/bin/sh
# Run npm ci inside the image build and export otherwise-ephemeral npm diagnostics.
set -u

# Deployment builds use the lockfile as the integrity contract. Audit/fund
# reporting remains a CI responsibility, and the update notifier must not add
# an unrelated public-registry request on a restricted host.
export npm_config_audit=false
export npm_config_fund=false
export npm_config_update_notifier=false

case "${WISEEFF_BUILD_TLS_POLICY:-verify}" in
  verify)
    export npm_config_strict_ssl=true
    ;;
  insecure)
    if [ "${WISEEFF_BUILD_TLS_ACK:-}" != "allow-insecure-build" ]; then
      printf '%s\n' 'Insecure npm TLS policy authorization is missing.' >&2
      exit 10
    fi
    export npm_config_strict_ssl=false
    ;;
  *)
    printf 'Unsupported WISEEFF_BUILD_TLS_POLICY: %s\n' "${WISEEFF_BUILD_TLS_POLICY}" >&2
    exit 10
    ;;
esac

if [ -n "${WISEEFF_NPM_REGISTRY:-}" ]; then
  export npm_config_registry="$WISEEFF_NPM_REGISTRY"
  export npm_config_replace_registry_host=always
fi

wiseeff_npm_redact() {
  sed \
    -e 's#\(https\{0,1\}://\)[^/@[:space:]][^/@[:space:]]*@#\1[REDACTED]@#g' \
    -e 's#\(//[^/:[:space:]][^/:[:space:]]*/:_authToken[=:][[:space:]]*\)[^,[:space:]][^,[:space:]]*#\1[REDACTED]#g' \
    -e 's#\(_authToken[=:][[:space:]]*\)[^,[:space:]][^,[:space:]]*#\1[REDACTED]#g' \
    -e 's#\(_password[=:][[:space:]]*\)[^,[:space:]][^,[:space:]]*#\1[REDACTED]#g' \
    -e 's#\(password[=:][[:space:]]*\)[^,[:space:]][^,[:space:]]*#\1[REDACTED]#g' \
    -e 's#\(NPM_TOKEN[=:][[:space:]]*\)[^,[:space:]][^,[:space:]]*#\1[REDACTED]#g' \
    -e 's#\(NODE_AUTH_TOKEN[=:][[:space:]]*\)[^,[:space:]][^,[:space:]]*#\1[REDACTED]#g' \
    -e 's#\("_authToken"[[:space:]]*:[[:space:]]*"\)[^"]*#\1[REDACTED]#g' \
    -e 's#\("password"[[:space:]]*:[[:space:]]*"\)[^"]*#\1[REDACTED]#g' \
    -e 's#\("token"[[:space:]]*:[[:space:]]*"\)[^"]*#\1[REDACTED]#g' \
    -e 's#\(authorization:[[:space:]]*Bearer[[:space:]]*\)[^,[:space:]][^,[:space:]]*#\1[REDACTED]#g' \
    -e 's#\(Authorization:[[:space:]]*Bearer[[:space:]]*\)[^,[:space:]][^,[:space:]]*#\1[REDACTED]#g'
}

npm_status=0
npm ci || npm_status=$?

if [ "$npm_status" -eq 0 ]; then
  exit 0
fi

npm_cache_dir="${NPM_CONFIG_CACHE:-${npm_config_cache:-/root/.npm}}"
npm_log_dir="${npm_cache_dir}/_logs"
npm_log_found=false

printf '%s\n' 'WISEEFF_NPM_CI_DIAGNOSTICS_BEGIN' >&2
printf 'npm_ci_exit_code=%s\n' "$npm_status" >&2

for npm_log in "${npm_log_dir}"/*-debug-*.log; do
  [ -f "$npm_log" ] || continue
  npm_log_found=true
  printf 'npm_debug_log=%s\n' "$npm_log" >&2
  wiseeff_npm_redact < "$npm_log" >&2
done

if [ "$npm_log_found" = false ]; then
  printf 'npm_debug_log=not-found (searched %s)\n' "$npm_log_dir" >&2
fi

printf '%s\n' 'WISEEFF_NPM_CI_DIAGNOSTICS_END' >&2
exit "$npm_status"
