#!/usr/bin/env bash
# Interactive and flag-driven self-hosted setup. Prefer this over hand-editing .env.
# Rendering uses TypeScript when tsx is available; otherwise a bash fallback writes the same keys.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="$(cd "${script_dir}/.." && pwd)"
repo_root="$(cd "${compose_dir}/../.." && pwd)"
env_file="${compose_dir}/.env"
build_network_file="${WISEEFF_BUILD_NETWORK_FILE:-${compose_dir}/.build-network.env}"
# shellcheck source=operation-lock.sh
source "${script_dir}/operation-lock.sh"
# shellcheck source=build-network-lib.sh
source "${script_dir}/build-network-lib.sh"

profile=""
tls_mode=""
host=""
tls_email=""
admin_username="admin.ops"
admin_password=""
admin_name="Platform Admin"
seed="chargelab"
llm="skip"
agent_api_base_url=""
agent_model=""
agent_api_key=""
log_analysis_api_base_url=""
log_analysis_model=""
log_analysis_api_key=""
force="false"
skip_build="false"
skip_up="false"
skip_provision="false"
non_interactive="false"
print_env="false"
json="false"
section=""
action="all"
locale_code="${WISEEFF_SETUP_LOCALE:-${LANG:-en}}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [section|action] [options]

Sections: profile | access | admin | seed | llm
Actions:  init | preflight | up | provision | all   (default: all)

  --profile ip-lab|acme
  --tls-mode http|internal|acme
  --ip, --host ADDR
  --tls-email EMAIL          Required for acme
  --admin-username NAME      Default: admin.ops
  --admin-password PASS      Generated when omitted
  --admin-name NAME
  --seed chargelab|none
  --llm skip|xiaoze|xiaoze+logs
  --agent-api-base-url URL
  --agent-model NAME
  --agent-api-key KEY
  --log-analysis-api-base-url URL
  --log-analysis-model NAME
  --log-analysis-api-key KEY
  --env-file PATH
  --build-network-file PATH  Private proxy/registry/CA data file (defaults to .build-network.env)
  --force                    Overwrite an existing .env (rotates DB/object-store secrets)
  --skip-build --skip-up --skip-provision
  --non-interactive          Require flags; never prompt
  --print-env                Write env to stdout
  --json

With a TTY and no --non-interactive, the script asks only human decisions.
Existing .env is kept unless you pass --force or a section name.
EOF
}

is_zh() {
  case "${locale_code}" in
    zh*|ZH*) return 0 ;;
    *) return 1 ;;
  esac
}

say() {
  printf '%s\n' "$1"
}

url_safe_secret() {
  openssl rand -hex 16
}

detect_host() {
  local candidate=""
  if command -v hostname >/dev/null 2>&1; then
    candidate="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [ -z "${candidate}" ] && command -v ip >/dev/null 2>&1; then
    candidate="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }' || true)"
  fi
  printf '%s\n' "${candidate}"
}

env_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "${env_file}" 2>/dev/null || true
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

has_tsx() {
  if [ "${WISEEFF_SETUP_RENDER:-}" = "bash" ]; then
    return 1
  fi
  [ -x "${repo_root}/node_modules/.bin/tsx" ]
}

read_tty() {
  local prompt="$1"
  local default="${2:-}"
  local secret="${3:-false}"
  local reply=""
  if [ -n "${default}" ]; then
    printf '%s [%s]: ' "${prompt}" "${default}" >/dev/tty
  else
    printf '%s: ' "${prompt}" >/dev/tty
  fi
  if [ "${secret}" = "true" ]; then
    IFS= read -r -s reply </dev/tty || true
    printf '\n' >/dev/tty
  else
    IFS= read -r reply </dev/tty || true
  fi
  if [ -z "${reply}" ]; then
    printf '%s\n' "${default}"
  else
    printf '%s\n' "${reply}"
  fi
}

choose_tty() {
  local prompt="$1"
  shift
  local index=1
  printf '%s\n' "${prompt}" >/dev/tty
  for option in "$@"; do
    printf '  %s) %s\n' "${index}" "${option}" >/dev/tty
    index=$((index + 1))
  done
  local reply
  reply="$(read_tty "$(is_zh && echo 选择 || echo Choice)" 1)"
  if ! [[ "${reply}" =~ ^[0-9]+$ ]] || [ "${reply}" -lt 1 ] || [ "${reply}" -gt $# ]; then
    echo "Invalid choice." >&2
    exit 1
  fi
  printf '%s\n' "${reply}"
}

apply_profile_defaults() {
  if [ "${profile}" = "acme" ]; then
    tls_mode="acme"
    if [ "${tls_email}" = "unused-ip-lab@localhost" ] || [ -z "${tls_email}" ]; then
      tls_email=""
    fi
  else
    profile="ip-lab"
    if [ -z "${tls_mode}" ] || [ "${tls_mode}" = "acme" ]; then
      tls_mode="http"
    fi
    if [ -z "${tls_email}" ]; then
      tls_email="unused-ip-lab@localhost"
    fi
  fi
}

load_existing_answers() {
  [ -f "${env_file}" ] || return 1
  profile="$(env_value WISEEFF_DEPLOY_PROFILE)"
  tls_mode="$(env_value WISEEFF_TLS_MODE)"
  host="$(env_value WISEEFF_SITE_HOST)"
  tls_email="$(env_value WISEEFF_TLS_EMAIL)"
  admin_username="$(env_value WISEEFF_LAB_ADMIN_USERNAME)"
  admin_password="$(env_value WISEEFF_LAB_ADMIN_PASSWORD)"
  admin_name="$(env_value WISEEFF_LAB_ADMIN_NAME)"
  seed="$(env_value WISEEFF_LAB_SEED)"
  agent_api_base_url="$(env_value AGENT_API_BASE_URL)"
  agent_model="$(env_value AGENT_MODEL)"
  agent_api_key="$(env_value AGENT_API_KEY)"
  log_analysis_api_base_url="$(env_value LOG_ANALYSIS_API_BASE_URL)"
  log_analysis_model="$(env_value LOG_ANALYSIS_MODEL)"
  log_analysis_api_key="$(env_value LOG_ANALYSIS_API_KEY)"
  if [ -n "${agent_api_key}" ] && [ -n "${log_analysis_api_key}" ]; then
    llm="xiaoze+logs"
  elif [ -n "${agent_api_key}" ]; then
    llm="xiaoze"
  else
    llm="skip"
  fi
  [ -n "${admin_username}" ] || admin_username="admin.ops"
  [ -n "${admin_name}" ] || admin_name="Platform Admin"
  [ -n "${seed}" ] || seed="chargelab"
  apply_profile_defaults
}

collect_llm_tty() {
  local choice
  if is_zh; then
    choice="$(choose_tty "大模型" "先跳过（确定性模式，健康检查可通过）" "配置小泽 AGENT_API_*" "同时配置小泽和日志分析")"
  else
    choice="$(choose_tty "LLM" "Skip for now (deterministic, keeps /health/ready green)" "Configure Xiaoze AGENT_API_*" "Configure Xiaoze and log-analysis")"
  fi
  case "${choice}" in
    1) llm="skip" ;;
    2) llm="xiaoze" ;;
    3) llm="xiaoze+logs" ;;
  esac
  if [ "${llm}" = "xiaoze" ] || [ "${llm}" = "xiaoze+logs" ]; then
    agent_api_base_url="$(read_tty "AGENT_API_BASE_URL" "${agent_api_base_url}")"
    agent_model="$(read_tty "AGENT_MODEL" "${agent_model}")"
    agent_api_key="$(read_tty "AGENT_API_KEY" "${agent_api_key}" true)"
  fi
  if [ "${llm}" = "xiaoze+logs" ]; then
    log_analysis_api_base_url="$(read_tty "LOG_ANALYSIS_API_BASE_URL" "${log_analysis_api_base_url}")"
    log_analysis_model="$(read_tty "LOG_ANALYSIS_MODEL" "${log_analysis_model}")"
    log_analysis_api_key="$(read_tty "LOG_ANALYSIS_API_KEY" "${log_analysis_api_key}" true)"
  fi
}

run_wizard() {
  if [ ! -t 0 ] && [ ! -r /dev/tty ]; then
    echo "No TTY. Re-run with --non-interactive and the required flags." >&2
    exit 2
  fi

  if [ -f "${env_file}" ] && [ -z "${section}" ]; then
    load_existing_answers
    local choice
    if is_zh; then
      say "检测到已有配置 profile=${profile} host=${host}"
      choice="$(choose_tty "下一步" "保留并继续启动" "只改其中一段" "重新生成（会更换数据库密码，需确认）")"
    else
      say "Found existing config profile=${profile} host=${host}"
      choice="$(choose_tty "Next" "Keep and continue" "Change one section" "Regenerate (rotates database secrets)")"
    fi
    case "${choice}" in
      1) return 0 ;;
      2)
        if is_zh; then
          section_choice="$(choose_tty "改哪一段" "profile" "access" "admin" "seed" "llm")"
        else
          section_choice="$(choose_tty "Section" "profile" "access" "admin" "seed" "llm")"
        fi
        case "${section_choice}" in
          1) section="profile" ;;
          2) section="access" ;;
          3) section="admin" ;;
          4) section="seed" ;;
          5) section="llm" ;;
        esac
        ;;
      3) force="true" ;;
    esac
  fi

  if [ -n "${section}" ]; then
    if [ ! -f "${env_file}" ]; then
      echo "No ${env_file}. Run setup without a section first." >&2
      exit 1
    fi
    load_existing_answers
  fi

  if [ -z "${section}" ] && [ "${force}" != "true" ] && [ -f "${env_file}" ]; then
    return 0
  fi

  if [ -z "${section}" ]; then
    local mode_choice
    if is_zh; then
      say "WiseEff 自托管配置向导（实验室/自托管，不是商用试点声明）"
      mode_choice="$(choose_tty "模式" "Quick（推荐）：IP 实验室 + HTTP + 演示数据" "Full：选择 TLS / 域名 / LLM")"
    else
      say "WiseEff self-hosted setup (lab/self-hosted; not commercial-pilot evidence)"
      mode_choice="$(choose_tty "Mode" "Quick (recommended): IP lab + HTTP + demo seed" "Full: choose TLS / DNS / LLM")"
    fi
    if [ "${mode_choice}" = "1" ]; then
      profile="ip-lab"
      tls_mode="http"
      [ -n "${host}" ] || host="$(detect_host)"
      host="$(read_tty "$(is_zh && echo 访问 IP || echo Public IP)" "${host}")"
      admin_username="$(read_tty "$(is_zh && echo 管理员用户名 || echo Admin username)" "${admin_username}")"
      admin_password="$(read_tty "$(is_zh && echo 管理员密码，空则生成 || echo Admin password, empty to generate)" "" true)"
      seed="chargelab"
      llm="skip"
    else
      local profile_choice
      if is_zh; then
        profile_choice="$(choose_tty "部署 profile" "IP 实验室（无域名）" "域名 + Let's Encrypt")"
      else
        profile_choice="$(choose_tty "Deploy profile" "IP lab (no DNS)" "DNS + Let's Encrypt")"
      fi
      if [ "${profile_choice}" = "2" ]; then
        profile="acme"
        tls_mode="acme"
        host="$(read_tty "$(is_zh && echo 域名 || echo DNS host)" "${host}")"
        tls_email="$(read_tty "Let's Encrypt email" "${tls_email}")"
      else
        profile="ip-lab"
        local tls_choice
        if is_zh; then
          tls_choice="$(choose_tty "TLS" "仅 HTTP" "Caddy 自签证书")"
        else
          tls_choice="$(choose_tty "TLS" "HTTP only" "Caddy internal TLS")"
        fi
        tls_mode="http"
        [ "${tls_choice}" = "2" ] && tls_mode="internal"
        [ -n "${host}" ] || host="$(detect_host)"
        host="$(read_tty "$(is_zh && echo 访问 IP 或主机名 || echo IP or host)" "${host}")"
      fi
      admin_username="$(read_tty "$(is_zh && echo 管理员用户名 || echo Admin username)" "${admin_username}")"
      admin_password="$(read_tty "$(is_zh && echo 管理员密码，空则生成 || echo Admin password, empty to generate)" "" true)"
      admin_name="$(read_tty "$(is_zh && echo 显示名 || echo Display name)" "${admin_name}")"
      local seed_choice
      if is_zh; then
        seed_choice="$(choose_tty "演示数据" "导入 ChargeLab 种子" "空库")"
      else
        seed_choice="$(choose_tty "Demo data" "Import ChargeLab seed" "Empty database")"
      fi
      seed="chargelab"
      [ "${seed_choice}" = "2" ] && seed="none"
      collect_llm_tty
    fi
  elif [ "${section}" = "profile" ]; then
    local profile_choice
    if is_zh; then
      profile_choice="$(choose_tty "部署 profile" "IP 实验室" "域名 + Let's Encrypt")"
    else
      profile_choice="$(choose_tty "Deploy profile" "IP lab" "DNS + Let's Encrypt")"
    fi
    if [ "${profile_choice}" = "2" ]; then
      profile="acme"
      tls_mode="acme"
    else
      profile="ip-lab"
      [ "${tls_mode}" = "acme" ] && tls_mode="http"
    fi
  elif [ "${section}" = "access" ]; then
    if [ "${profile}" = "acme" ]; then
      host="$(read_tty "$(is_zh && echo 域名 || echo DNS host)" "${host}")"
      tls_email="$(read_tty "Let's Encrypt email" "${tls_email}")"
      tls_mode="acme"
    else
      local tls_choice
      if is_zh; then
        tls_choice="$(choose_tty "TLS" "仅 HTTP" "Caddy 自签证书")"
      else
        tls_choice="$(choose_tty "TLS" "HTTP only" "Caddy internal TLS")"
      fi
      tls_mode="http"
      [ "${tls_choice}" = "2" ] && tls_mode="internal"
      host="$(read_tty "$(is_zh && echo 访问 IP 或主机名 || echo IP or host)" "${host}")"
    fi
  elif [ "${section}" = "admin" ]; then
    admin_username="$(read_tty "$(is_zh && echo 管理员用户名 || echo Admin username)" "${admin_username}")"
    admin_password="$(read_tty "$(is_zh && echo 管理员密码，空则保留 || echo Admin password, empty to keep)" "" true)"
    admin_name="$(read_tty "$(is_zh && echo 显示名 || echo Display name)" "${admin_name}")"
  elif [ "${section}" = "seed" ]; then
    local seed_choice
    if is_zh; then
      seed_choice="$(choose_tty "演示数据" "ChargeLab 种子" "空库")"
    else
      seed_choice="$(choose_tty "Demo data" "ChargeLab seed" "Empty database")"
    fi
    seed="chargelab"
    [ "${seed_choice}" = "2" ] && seed="none"
  elif [ "${section}" = "llm" ]; then
    collect_llm_tty
  fi

  apply_profile_defaults
  [ -n "${host}" ] || host="$(detect_host)"
  if [ -z "${host}" ]; then
    echo "Could not detect a host. Re-run with --ip <address>." >&2
    exit 1
  fi

  local public_scheme="http"
  [ "${tls_mode}" = "http" ] || public_scheme="https"
  say ""
  say "Review"
  say "  profile=${profile}  tls=${tls_mode}  host=${host}"
  say "  url=${public_scheme}://${host}"
  say "  admin=${admin_username}  seed=${seed}  llm=${llm}"
  local confirm
  confirm="$(read_tty "$(is_zh && echo 确认写入 .env？yes/no || echo Write .env? yes/no)" "yes")"
  case "${confirm}" in
    y|Y|yes|YES) ;;
    *)
      echo "Cancelled."
      exit 1
      ;;
  esac
}

render_cli_args() {
  local args=(--non-interactive --profile "${profile}" --tls-mode "${tls_mode}" --host "${host}" --env-file "${env_file}")
  [ -n "${tls_email}" ] && args+=(--tls-email "${tls_email}")
  [ -n "${admin_username}" ] && args+=(--admin-username "${admin_username}")
  [ -n "${admin_password}" ] && args+=(--admin-password "${admin_password}")
  [ -n "${admin_name}" ] && args+=(--admin-name "${admin_name}")
  [ -n "${seed}" ] && args+=(--seed "${seed}")
  [ -n "${llm}" ] && args+=(--llm "${llm}")
  [ -n "${agent_api_base_url}" ] && args+=(--agent-api-base-url "${agent_api_base_url}")
  [ -n "${agent_model}" ] && args+=(--agent-model "${agent_model}")
  [ -n "${agent_api_key}" ] && args+=(--agent-api-key "${agent_api_key}")
  [ -n "${log_analysis_api_base_url}" ] && args+=(--log-analysis-api-base-url "${log_analysis_api_base_url}")
  [ -n "${log_analysis_model}" ] && args+=(--log-analysis-model "${log_analysis_model}")
  [ -n "${log_analysis_api_key}" ] && args+=(--log-analysis-api-key "${log_analysis_api_key}")
  [ "${force}" = "true" ] && args+=(--force)
  [ -n "${section}" ] && args+=("${section}")
  printf '%s\n' "${args[@]}"
}

write_env_via_tsx() {
  local -a args=()
  local rendered_arg
  while IFS= read -r rendered_arg; do
    args+=("${rendered_arg}")
  done < <(render_cli_args)
  if [ "${print_env}" = "true" ]; then
    args+=(--print-env)
    (cd "${repo_root}" && "${repo_root}/node_modules/.bin/tsx" ops/self-hosted/scripts/setup-selfhost.ts -- "${args[@]}")
    return 0
  fi
  (cd "${repo_root}" && "${repo_root}/node_modules/.bin/tsx" ops/self-hosted/scripts/setup-selfhost.ts -- "${args[@]}")
}

write_env_bash() {
  local postgres_password minio_password public caddyfile object_tls xiaoze_det log_det
  if [ -f "${env_file}" ] && [ "${force}" != "true" ]; then
    postgres_password="$(env_value POSTGRES_PASSWORD)"
    minio_password="$(env_value MINIO_ROOT_PASSWORD)"
    [ -n "${admin_password}" ] || admin_password="$(env_value WISEEFF_LAB_ADMIN_PASSWORD)"
  fi
  [ -n "${postgres_password:-}" ] || postgres_password="$(url_safe_secret)"
  [ -n "${minio_password:-}" ] || minio_password="$(url_safe_secret)"
  [ -n "${admin_password}" ] || admin_password="$(url_safe_secret)"
  if [ "${tls_mode}" = "http" ]; then
    public="http://${host}"
    caddyfile="Caddyfile.ip-lab"
    object_tls="optional"
  elif [ "${tls_mode}" = "internal" ]; then
    public="https://${host}"
    caddyfile="Caddyfile.ip-lab-tls"
    object_tls="optional"
  else
    public="https://${host}"
    caddyfile="Caddyfile.example"
    object_tls="required"
  fi
  if [ "${llm}" = "xiaoze" ] || [ "${llm}" = "xiaoze+logs" ]; then
    xiaoze_det="false"
  else
    xiaoze_det="true"
    agent_api_base_url=""
    agent_model=""
    agent_api_key=""
  fi
  if [ "${llm}" = "xiaoze+logs" ]; then
    log_det="false"
  else
    log_det="true"
    log_analysis_api_base_url=""
    log_analysis_model=""
    log_analysis_api_key=""
  fi
  [ -n "${tls_email}" ] || tls_email="unused-ip-lab@localhost"

  local body
  body="$(cat <<EOF
# WiseEff ${profile} profile — generated by setup.sh.
WISEEFF_DEPLOY_PROFILE=${profile}
WISEEFF_TLS_MODE=${tls_mode}
WISEEFF_CADDYFILE=${caddyfile}
WISEEFF_SITE_HOST=${host}
WISEEFF_TLS_EMAIL=${tls_email}
WISEEFF_PUBLIC_URL=${public}
WISEEFF_LAB_ADMIN_USERNAME=${admin_username}
WISEEFF_LAB_ADMIN_PASSWORD=${admin_password}
WISEEFF_LAB_ADMIN_NAME=${admin_name}
WISEEFF_LAB_SEED=${seed}

NODE_ENV=production
HOST=0.0.0.0
PORT=8787

POSTGRES_PASSWORD=${postgres_password}
DATABASE_URL=postgres://wiseeff:${postgres_password}@postgres:5432/wiseeff

AUTH_MODE=production
AUTH_PROVIDER=local
AUTH_OIDC_ISSUER=
AUTH_OIDC_AUDIENCE=
AUTH_OIDC_JWKS_URI=
M6_SELFHOSTED_SMOKE_AUTHORIZATION=
M6_IDENTITY_AUTHORIZATION=
M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION=
M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION=
M6_IDENTITY_EXPIRED_AUTHORIZATION=
M5_SMOKE_AUTHORIZATION=
WISEEFF_SMOKE_AUTHORIZATION=

WISEEFF_API_BASE_URL=${public}
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=${public}

MINIO_ROOT_USER=wiseeff
MINIO_ROOT_PASSWORD=${minio_password}
OBJECT_STORE_MODE=s3
OBJECT_STORAGE_ENDPOINT=http://minio:9000
OBJECT_STORAGE_BUCKET=wiseeff
OBJECT_STORAGE_ACCESS_KEY_ID=wiseeff
OBJECT_STORAGE_SECRET_ACCESS_KEY=${minio_password}
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_TLS_POLICY=${object_tls}
OBJECT_STORAGE_PATH_STYLE=true
OBJECT_STORAGE_HEALTH_PREFIX=.health/
OBJECT_STORAGE_RETENTION_CLASS=pilot-default

BACKUP_DATABASE_TARGET=file:///var/backups/wiseeff/postgres/wiseeff.dump
BACKUP_OBJECT_STORAGE_TARGET=file:///var/backups/wiseeff/object-store/
RESTORE_DATABASE_URL=postgres://wiseeff_restore:restore-password@postgres:5432/wiseeff_restore
RESTORE_OBJECT_STORAGE_BUCKET=wiseeff-restore
RESTORE_OBJECT_STORAGE_PREFIX=m6-drill/

DEBUG_DEVICE_GATEWAY_MODE=multi
DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true
HDC_TIMEOUT_MS=5000
ADB_TIMEOUT_MS=5000

DEVICE_BRIDGE_ARTIFACT_ROOT=ops/self-hosted/bridge-artifacts
DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT=ops/self-hosted/bridge-tool-artifacts
DEVICE_BRIDGE_PAIRING_TTL_SECONDS=1800
DEVICE_BRIDGE_TOKEN_TTL_DAYS=90
DEVICE_BRIDGE_WS_PATH=/api/v1/device-bridges/ws
DEVICE_BRIDGE_LAB_AVAILABLE=false
DEVICE_BRIDGE_SERVER_URL=${public}

AGENT_API_BASE_URL=${agent_api_base_url}
AGENT_MODEL=${agent_model}
AGENT_API_KEY=${agent_api_key}
AGENT_API_TIMEOUT_MS=30000
XIAOZE_CHECKPOINTER=postgres
XIAOZE_DETERMINISTIC=${xiaoze_det}

LOG_ANALYSIS_API_BASE_URL=${log_analysis_api_base_url}
LOG_ANALYSIS_MODEL=${log_analysis_model}
LOG_ANALYSIS_API_KEY=${log_analysis_api_key}
LOG_ANALYSIS_API_TIMEOUT_MS=30000
LOG_ANALYSIS_TOKEN_BUDGET=8000
LOG_ANALYSIS_DETERMINISTIC=${log_det}

LOG_WORKER_ENABLED=false
LOG_ANALYSIS_QUEUE_MODE=durable
REDIS_URL=redis://redis:6379
LOG_ANALYSIS_QUEUE_PREFIX=wiseeff
LOG_ANALYSIS_QUEUE_ATTEMPTS=4
LOG_ANALYSIS_QUEUE_BACKOFF_MS=1000
LOG_ANALYSIS_QUEUE_CONCURRENCY=1
LOG_WORKER_OBSERVABILITY_HOST=127.0.0.1
LOG_WORKER_OBSERVABILITY_PORT=8788

WISEEFF_GRAFANA_PORT=3000
WISEEFF_PROMETHEUS_PORT=9090
WISEEFF_ALERTMANAGER_PORT=9093
WISEEFF_PROMETHEUS_RETENTION=15d

M5_CONTRACT_CHECK_PASSED=true
M5_BACKUP_RESTORE_DRILL_AT=
M5_SMOKE_ALLOW_NO_API=false
EOF
)"
  if [ "${print_env}" = "true" ]; then
    printf '%s\n' "${body}"
    return 0
  fi
  umask 077
  printf '%s\n' "${body}" > "${env_file}"
  chmod 600 "${env_file}"
  echo "Wrote ${env_file} (mode 600)."
  echo "URL: $(env_value WISEEFF_PUBLIC_URL)"
  echo "Admin username: $(env_value WISEEFF_LAB_ADMIN_USERNAME)"
}

run_init() {
  apply_profile_defaults
  if [ -z "${host}" ]; then
    host="$(detect_host)"
  fi
  if [ -z "${host}" ]; then
    echo "Could not detect a host. Re-run with --ip <address>." >&2
    exit 1
  fi
  if [ -z "${section}" ] && [ -f "${env_file}" ] && [ "${force}" != "true" ] && [ "${print_env}" != "true" ]; then
    echo "${env_file} already exists. Keeping it. Use --force to overwrite or pass a section name."
    return 0
  fi
  if [ "${profile}" = "acme" ] && [[ ! "${tls_email}" == *"@"* ]]; then
    echo "ACME profile requires --tls-email." >&2
    exit 1
  fi
  if [ "${llm}" = "xiaoze" ] || [ "${llm}" = "xiaoze+logs" ]; then
    if [ -z "${agent_api_base_url}" ] || [ -z "${agent_model}" ] || [ -z "${agent_api_key}" ]; then
      echo "Xiaoze LLM requires --agent-api-base-url, --agent-model, and --agent-api-key." >&2
      exit 1
    fi
  fi
  if [ "${llm}" = "xiaoze+logs" ]; then
    if [ -z "${log_analysis_api_base_url}" ] || [ -z "${log_analysis_model}" ] || [ -z "${log_analysis_api_key}" ]; then
      echo "Log-analysis LLM requires the --log-analysis-api-* flags." >&2
      exit 1
    fi
  fi
  if has_tsx; then
    write_env_via_tsx
  else
    write_env_bash
  fi
}

run_preflight() {
  require_command docker
  if [ ! -f "${env_file}" ]; then
    echo "Missing ${env_file}. Run: $0 --ip <address> init" >&2
    exit 1
  fi
  wiseeff_build_network_prepare "${compose_dir}" "${build_network_file}"
  if has_tsx; then
    (cd "${repo_root}" && "${repo_root}/node_modules/.bin/tsx" ops/self-hosted/scripts/doctor-selfhost.ts -- --env-file "${env_file}")
    wiseeff_build_network_print_status text
    return 0
  fi
  local site_host postgres_password database_url caddyfile
  site_host="$(env_value WISEEFF_SITE_HOST)"
  postgres_password="$(env_value POSTGRES_PASSWORD)"
  database_url="$(env_value DATABASE_URL)"
  caddyfile="$(env_value WISEEFF_CADDYFILE)"
  [ -n "${site_host}" ] || { echo "WISEEFF_SITE_HOST is required." >&2; exit 1; }
  [ -n "${postgres_password}" ] || { echo "POSTGRES_PASSWORD is required." >&2; exit 1; }
  case "${database_url}" in
    *'${'*) echo "DATABASE_URL must embed the expanded POSTGRES_PASSWORD." >&2; exit 1 ;;
    *"${postgres_password}"*) ;;
    *) echo "DATABASE_URL must embed the expanded POSTGRES_PASSWORD." >&2; exit 1 ;;
  esac
  [ -f "${compose_dir}/${caddyfile}" ] || { echo "Missing Caddyfile: ${compose_dir}/${caddyfile}" >&2; exit 1; }
  [ "$(env_value AUTH_PROVIDER)" = "local" ] || { echo "AUTH_PROVIDER must be local." >&2; exit 1; }
  wiseeff_build_network_print_status text
  echo "Preflight passed for $(env_value WISEEFF_PUBLIC_URL)"
}

run_up() {
  local build_flag=(--build)
  if [ "${skip_build}" = "true" ]; then
    build_flag=()
  else
    echo "Building and starting the stack. The first image build can take several minutes."
  fi
  "${script_dir}/compose" --env-file "${env_file}" up -d "${build_flag[@]}"
}

wait_for_live() {
  local attempt
  echo "Waiting for http://127.0.0.1/health/live ..."
  for attempt in $(seq 1 180); do
    if curl -fsS http://127.0.0.1/health/live >/dev/null 2>&1; then
      echo "API is live."
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for /health/live." >&2
  exit 1
}

run_provision() {
  "${script_dir}/compose" --env-file "${env_file}" exec -T api npm run selfhost:ip-lab:provision
}

print_next_steps() {
  cat <<EOF

WiseEff is ready.
  URL:      $(env_value WISEEFF_PUBLIC_URL)
  Username: $(env_value WISEEFF_LAB_ADMIN_USERNAME)
  Password: stored in ${env_file} as WISEEFF_LAB_ADMIN_PASSWORD
  Seed:     $(env_value WISEEFF_LAB_SEED)
  Doctor:   ./scripts/doctor.sh

This is a self-hosted/lab path, not commercial-pilot evidence.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) profile="${2:-}"; shift 2 ;;
    --tls-mode) tls_mode="${2:-}"; shift 2 ;;
    --ip|--host) host="${2:-}"; shift 2 ;;
    --tls-email) tls_email="${2:-}"; shift 2 ;;
    --admin-username) admin_username="${2:-}"; shift 2 ;;
    --admin-password) admin_password="${2:-}"; shift 2 ;;
    --admin-name) admin_name="${2:-}"; shift 2 ;;
    --seed) seed="${2:-}"; shift 2 ;;
    --llm) llm="${2:-}"; shift 2 ;;
    --agent-api-base-url) agent_api_base_url="${2:-}"; shift 2 ;;
    --agent-model) agent_model="${2:-}"; shift 2 ;;
    --agent-api-key) agent_api_key="${2:-}"; shift 2 ;;
    --log-analysis-api-base-url) log_analysis_api_base_url="${2:-}"; shift 2 ;;
    --log-analysis-model) log_analysis_model="${2:-}"; shift 2 ;;
    --log-analysis-api-key) log_analysis_api_key="${2:-}"; shift 2 ;;
    --env-file) env_file="${2:-}"; shift 2 ;;
    --build-network-file) build_network_file="${2:-}"; shift 2 ;;
    --force) force="true"; shift ;;
    --skip-build) skip_build="true"; shift ;;
    --skip-up) skip_up="true"; shift ;;
    --skip-provision) skip_provision="true"; shift ;;
    --non-interactive) non_interactive="true"; shift ;;
    --print-env) print_env="true"; shift ;;
    --json) json="true"; shift ;;
    -h|--help) usage; exit 0 ;;
    profile|access|admin|seed|llm)
      section="$1"
      action="init"
      shift
      ;;
    init|preflight|up|provision|all)
      action="$1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

wiseeff_operation_lock_acquire "${WISEEFF_OPERATION_LOCK_DIR:-${repo_root}/ops/self-hosted/.state}" \
  "Another WiseEff setup or upgrade operation holds the host lock." \
  "setup:${action}"
trap wiseeff_operation_lock_release EXIT

if [ "${non_interactive}" != "true" ] && { [ -t 0 ] || [ -r /dev/tty ]; }; then
  if [ "${action}" = "all" ] || [ "${action}" = "init" ] || [ -n "${section}" ]; then
    if [ -z "${host}" ] || [ -n "${section}" ] || [ ! -f "${env_file}" ]; then
      run_wizard
    fi
  fi
elif [ "${non_interactive}" = "true" ] && [ -z "${host}" ] && [ -z "${section}" ] && [ ! -f "${env_file}" ] && [ "${action}" != "preflight" ]; then
  echo "Missing --ip/--host. Non-interactive setup cannot prompt." >&2
  usage >&2
  exit 2
fi

apply_profile_defaults

case "${action}" in
  init)
    run_init
    ;;
  preflight)
    run_preflight
    ;;
  up)
    run_preflight
    run_up
    ;;
  provision)
    run_preflight
    wait_for_live
    run_provision
    print_next_steps
    ;;
  all)
    run_init
    if [ "${print_env}" = "true" ]; then
      exit 0
    fi
    run_preflight
    if [ "${skip_up}" != "true" ]; then
      run_up
      wait_for_live
      if [ "${skip_provision}" != "true" ]; then
        run_provision
        print_next_steps
      fi
    fi
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
