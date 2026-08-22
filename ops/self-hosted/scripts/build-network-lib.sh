#!/usr/bin/env bash
# Restricted-network configuration shared by self-hosted setup and upgrade.

wiseeff_build_network_error() {
  printf '%s\n' "$*" >&2
  return 10
}

wiseeff_build_network_file_mode() {
  local path="$1"
  if stat -c '%a' "$path" >/dev/null 2>&1; then
    stat -c '%a' "$path"
  else
    stat -f '%Lp' "$path"
  fi
}

wiseeff_build_network_key_allowed() {
  case "$1" in
    HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|WISEEFF_NPM_REGISTRY|WISEEFF_BUILD_CA_CERT_FILE|WISEEFF_BUILD_TLS_POLICY|WISEEFF_RUNTIME_PROXY)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

wiseeff_build_network_load_file() {
  local config_file="$1"
  local mode raw_line line key value seen_keys="|"

  [ -e "$config_file" ] || return 0
  [ -f "$config_file" ] && [ ! -L "$config_file" ] || {
    wiseeff_build_network_error "Build-network config must be a regular, non-symlink file: ${config_file}"
    return $?
  }
  [ -r "$config_file" ] || {
    wiseeff_build_network_error "Build-network config is not readable by the deployment user: ${config_file}"
    return $?
  }
  mode="$(wiseeff_build_network_file_mode "$config_file")" || return 10
  if (( (8#${mode}) & 8#077 )); then
    wiseeff_build_network_error "Build-network config must not be readable or writable by group/other: ${config_file} (mode ${mode})"
    return $?
  fi

  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="${raw_line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *)
        wiseeff_build_network_error "Malformed build-network entry; expected KEY=value in ${config_file}."
        return $?
        ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    wiseeff_build_network_key_allowed "$key" || {
      wiseeff_build_network_error "Unsupported build-network key: ${key}"
      return $?
    }
    case "$seen_keys" in
      *"|${key}|"*)
        wiseeff_build_network_error "Duplicate build-network key: ${key}"
        return $?
        ;;
    esac
    seen_keys="${seen_keys}${key}|"
    if [ -z "${!key:-}" ] && [ -n "$value" ]; then
      printf -v "$key" '%s' "$value"
      export "$key"
    fi
  done < "$config_file"
}

wiseeff_build_network_normalize_proxy_pair() {
  local upper_name="$1"
  local lower_name="$2"
  local upper_value="${!upper_name:-}"
  local lower_value="${!lower_name:-}"
  local resolved

  if [ -n "$upper_value" ] && [ -n "$lower_value" ] && [ "$upper_value" != "$lower_value" ]; then
    wiseeff_build_network_error "Conflicting ${upper_name}/${lower_name} values; keep one effective proxy value."
    return $?
  fi
  resolved="$upper_value"
  [ -n "$resolved" ] || resolved="$lower_value"
  if [ -n "$resolved" ]; then
    printf -v "$upper_name" '%s' "$resolved"
    printf -v "$lower_name" '%s' "$resolved"
    export "$upper_name" "$lower_name"
  fi
}

wiseeff_build_network_validate_proxy_url() {
  local name="$1"
  local value="${!name:-}"
  [ -n "$value" ] || return 0
  case "$value" in
    *[[:space:]]*)
      wiseeff_build_network_error "${name} must not contain whitespace."
      return $?
      ;;
  esac
  case "$value" in
    http://*|https://*|socks5://*|socks5h://*) return 0 ;;
    *)
      wiseeff_build_network_error "${name} must use http, https, socks5, or socks5h."
      return $?
      ;;
  esac
}

wiseeff_build_network_registry_host() {
  local registry="${WISEEFF_NPM_REGISTRY:-}"
  local authority
  [ -n "$registry" ] || {
    printf 'package-lock defaults\n'
    return 0
  }
  authority="${registry#*://}"
  authority="${authority%%/*}"
  case "$authority" in
    \[*\]*) printf '%s]\n' "${authority%%]*}" ;;
    *) printf '%s\n' "${authority%%:*}" ;;
  esac
}

wiseeff_build_network_ca_status() {
  printf '%s\n' "${WISEEFF_BUILD_NETWORK_CA_STATUS:-not configured}"
}

wiseeff_build_network_tls_policy() {
  printf '%s\n' "${WISEEFF_BUILD_TLS_POLICY:-verify}"
}

wiseeff_build_network_hash_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

wiseeff_build_network_file_fingerprint() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

wiseeff_build_network_authorize_build() {
  local allowed="${1:-false}"
  local operation="${2:-build}"
  local policy="${WISEEFF_BUILD_TLS_POLICY:-verify}"

  case "$allowed" in
    true|false) ;;
    *)
      wiseeff_build_network_error "Internal error: insecure-build authorization must be true or false."
      return $?
      ;;
  esac

  if [ "$policy" = "verify" ]; then
    if [ "$allowed" = "true" ]; then
      wiseeff_build_network_error "--allow-insecure-build is only valid when WISEEFF_BUILD_TLS_POLICY=insecure."
      return $?
    fi
    WISEEFF_BUILD_TLS_ACK=""
    export WISEEFF_BUILD_TLS_ACK
    return 0
  fi

  if [ "$allowed" != "true" ]; then
    wiseeff_build_network_error "${operation} uses WISEEFF_BUILD_TLS_POLICY=insecure. Re-run with --allow-insecure-build to authorize this build only."
    return $?
  fi

  WISEEFF_BUILD_TLS_ACK="allow-insecure-build"
  export WISEEFF_BUILD_TLS_ACK
  printf 'WARNING: TLS certificate verification is disabled for this image build only (%s).\n' "$operation" >&2
}

wiseeff_build_network_prepare() {
  local compose_dir="$1"
  local config_file="${2:-${WISEEFF_BUILD_NETWORK_FILE:-${compose_dir}/.build-network.env}}"
  local ca_file ca_fingerprint registry_authority runtime_proxy tls_policy

  WISEEFF_BUILD_NETWORK_FILE_EFFECTIVE="$config_file"
  WISEEFF_BUILD_TLS_ACK=""
  export WISEEFF_BUILD_NETWORK_FILE_EFFECTIVE WISEEFF_BUILD_TLS_ACK
  wiseeff_build_network_load_file "$config_file" || return $?

  wiseeff_build_network_normalize_proxy_pair HTTP_PROXY http_proxy || return $?
  wiseeff_build_network_normalize_proxy_pair HTTPS_PROXY https_proxy || return $?
  wiseeff_build_network_normalize_proxy_pair ALL_PROXY all_proxy || return $?
  wiseeff_build_network_normalize_proxy_pair NO_PROXY no_proxy || return $?
  wiseeff_build_network_validate_proxy_url HTTP_PROXY || return $?
  wiseeff_build_network_validate_proxy_url HTTPS_PROXY || return $?
  wiseeff_build_network_validate_proxy_url ALL_PROXY || return $?

  if [ -n "${HTTP_PROXY:-}${HTTPS_PROXY:-}${ALL_PROXY:-}" ]; then
    WISEEFF_BUILD_NETWORK_PROXY_STATUS="configured"
  else
    WISEEFF_BUILD_NETWORK_PROXY_STATUS="not configured"
  fi

  if [ -n "${WISEEFF_NPM_REGISTRY:-}" ]; then
    case "$WISEEFF_NPM_REGISTRY" in
      http://*|https://*) ;;
      *)
        wiseeff_build_network_error "WISEEFF_NPM_REGISTRY must use http or https."
        return $?
        ;;
    esac
    case "${WISEEFF_NPM_REGISTRY#*://}" in
      *@*)
        wiseeff_build_network_error "WISEEFF_NPM_REGISTRY must not contain credentials."
        return $?
        ;;
    esac
    registry_authority="${WISEEFF_NPM_REGISTRY#*://}"
    registry_authority="${registry_authority%%/*}"
    if ! printf '%s\n' "$registry_authority" | grep -Eq '^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(:[0-9]+)?$'; then
      wiseeff_build_network_error "WISEEFF_NPM_REGISTRY must contain a valid registry host and optional numeric port."
      return $?
    fi
  fi

  tls_policy="${WISEEFF_BUILD_TLS_POLICY:-verify}"
  case "$tls_policy" in
    verify|insecure) ;;
    *)
      wiseeff_build_network_error "WISEEFF_BUILD_TLS_POLICY must be verify or insecure."
      return $?
      ;;
  esac
  WISEEFF_BUILD_TLS_POLICY="$tls_policy"

  ca_file="${WISEEFF_BUILD_CA_CERT_FILE:-}"
  if [ -n "$ca_file" ]; then
    case "$ca_file" in
      /*) ;;
      *) ca_file="$(cd "$(dirname "$config_file")" && pwd)/${ca_file}" ;;
    esac
    [ -f "$ca_file" ] && [ ! -L "$ca_file" ] && [ -r "$ca_file" ] || {
      wiseeff_build_network_error "WISEEFF_BUILD_CA_CERT_FILE must be a readable, regular, non-symlink PEM file."
      return $?
    }
    grep -q -- '-----BEGIN CERTIFICATE-----' "$ca_file" || {
      wiseeff_build_network_error "WISEEFF_BUILD_CA_CERT_FILE does not contain a PEM certificate."
      return $?
    }
    WISEEFF_BUILD_CA_CERT_FILE="$(cd "$(dirname "$ca_file")" && pwd)/$(basename "$ca_file")"
    WISEEFF_BUILD_NETWORK_CA_STATUS="configured"
  else
    WISEEFF_BUILD_CA_CERT_FILE="${compose_dir}/build-network/empty-ca.pem"
    WISEEFF_BUILD_NETWORK_CA_STATUS="not configured"
  fi
  ca_fingerprint="$(wiseeff_build_network_file_fingerprint "$WISEEFF_BUILD_CA_CERT_FILE")" || return $?
  WISEEFF_BUILD_TRANSPORT_FINGERPRINT="$({
    printf 'tls-policy=%s\n' "$WISEEFF_BUILD_TLS_POLICY"
    printf 'ca-sha256=%s\n' "$ca_fingerprint"
    printf 'npm-registry-host=%s\n' "$(wiseeff_build_network_registry_host)"
    printf 'apk-source=container-default\n'
    printf 'git-source=git.kernel.org\n'
    printf 'pip-sources=pypi.org,files.pythonhosted.org\n'
  } | wiseeff_build_network_hash_stream)" || return $?
  export WISEEFF_BUILD_CA_CERT_FILE WISEEFF_BUILD_NETWORK_CA_STATUS
  export WISEEFF_BUILD_TLS_POLICY WISEEFF_BUILD_TRANSPORT_FINGERPRINT

  runtime_proxy="${WISEEFF_RUNTIME_PROXY:-false}"
  case "$runtime_proxy" in
    true|false) ;;
    *)
      wiseeff_build_network_error "WISEEFF_RUNTIME_PROXY must be true or false."
      return $?
      ;;
  esac
  WISEEFF_RUNTIME_PROXY="$runtime_proxy"
  if [ "$runtime_proxy" = "true" ]; then
    WISEEFF_RUNTIME_HTTP_PROXY="${HTTP_PROXY:-}"
    WISEEFF_RUNTIME_HTTPS_PROXY="${HTTPS_PROXY:-}"
    WISEEFF_RUNTIME_ALL_PROXY="${ALL_PROXY:-}"
    WISEEFF_RUNTIME_NO_PROXY="${NO_PROXY:+${NO_PROXY},}localhost,127.0.0.1,postgres,redis,minio,minio-init,api,worker,web,proxy"
  else
    WISEEFF_RUNTIME_HTTP_PROXY=""
    WISEEFF_RUNTIME_HTTPS_PROXY=""
    WISEEFF_RUNTIME_ALL_PROXY=""
    WISEEFF_RUNTIME_NO_PROXY=""
  fi
  export WISEEFF_RUNTIME_HTTP_PROXY WISEEFF_RUNTIME_HTTPS_PROXY WISEEFF_RUNTIME_ALL_PROXY WISEEFF_RUNTIME_NO_PROXY
  export WISEEFF_RUNTIME_PROXY WISEEFF_BUILD_NETWORK_PROXY_STATUS WISEEFF_NPM_REGISTRY
}

wiseeff_build_network_print_status() {
  local format="${1:-text}"
  local ca_status
  local registry_host
  local tls_policy
  registry_host="$(wiseeff_build_network_registry_host)"
  ca_status="$(wiseeff_build_network_ca_status)"
  tls_policy="$(wiseeff_build_network_tls_policy)"
  if [ "$format" = "json" ]; then
    printf '{"proxy":"%s","npmRegistry":"%s","corporateCa":"%s","buildTlsPolicy":"%s","runtimeProxy":%s}\n' \
      "$WISEEFF_BUILD_NETWORK_PROXY_STATUS" "$registry_host" "$ca_status" "$tls_policy" "$WISEEFF_RUNTIME_PROXY"
    return 0
  fi
  printf 'WiseEff build network\n'
  printf '  proxy: %s\n' "$WISEEFF_BUILD_NETWORK_PROXY_STATUS"
  printf '  npm registry: %s\n' "$registry_host"
  printf '  corporate CA: %s\n' "$ca_status"
  if [ "$tls_policy" = "insecure" ]; then
    printf '  build TLS: INSECURE (build only; explicit authorization required)\n'
  else
    printf '  build TLS: verified\n'
  fi
  if [ "$WISEEFF_RUNTIME_PROXY" = "true" ]; then
    printf '  runtime proxy: enabled\n'
  else
    printf '  runtime proxy: disabled\n'
  fi
}
