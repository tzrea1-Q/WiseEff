#!/usr/bin/env bash
# Internal implementation for the self-hosted upgrade module.
set -euo pipefail

# shellcheck source=operation-lock.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/operation-lock.sh"
# shellcheck source=build-network-lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-network-lib.sh"

wiseeff_upgrade_usage() {
  cat <<'EOF'
Usage: upgrade.sh [apply] [options]

Actions:
  apply                         Upgrade the stack (default).
  plan                          Resolve and inspect a target without downtime.
  prepare-host                  Prepare Docker and filesystem permissions (run with sudo --yes).
  lock-status                   Inspect the shared setup/upgrade host lock.
  unlock                        Clear only a proven-stale host lock.
  status                        Show a persisted upgrade run.
  resume                        Continue a recoverable run.
  recover-candidate             Complete an eligible isolated post-migration candidate.
  rollback                     Restore the previous application/recovery point.

Options:
  --ref REF                     Git ref; defaults to WISEEFF_UPGRADE_REF or origin/main.
  --git-proxy URL               HTTP(S)/SOCKS proxy for resolving the Git ref (or WISEEFF_UPGRADE_GIT_PROXY).
  --build-network-file PATH     Private proxy/registry/CA/TLS-policy data file (defaults to .build-network.env).
  --allow-insecure-build        Authorize one candidate build configured with insecure TLS.
  --env-file PATH               Runtime env file; defaults to ops/self-hosted/.env.
  --state-dir PATH              Upgrade journal root.
  --backup-root PATH            Upgrade backup root.
  --run-id ID                   Existing run for status/resume/recover-candidate/rollback.
  --operator USER               Deployment user for prepare-host (defaults to SUDO_USER).
  --restart                     Recreate even when the target SHA is already running.
  --non-interactive --yes       Required together for unattended apply.
  --restore-data                Restore all stores during rollback (confirmation required).
  --confirm TOKEN               Run-bound confirmation token for protected recovery.
  --json                        Emit machine-readable status/plan output where supported.
  -h, --help                   Show this help.

The upgrade path never edits .env, runs seed/provision, rotates credentials, or deletes volumes.
EOF
}

wiseeff_upgrade_die() {
  local code="$1"
  shift
  printf '%s\n' "$*" >&2
  return "$code"
}

wiseeff_upgrade_state_root() {
  printf '%s\n' "${WISEEFF_UPGRADE_STATE_DIR:-${upgrade_repo_root}/ops/self-hosted/.state/upgrades}"
}

wiseeff_upgrade_operation_lock_root() {
  printf '%s\n' "${WISEEFF_OPERATION_LOCK_DIR:-${upgrade_repo_root}/ops/self-hosted/.state}"
}

wiseeff_upgrade_default_backup_root() {
  printf '%s\n' "${WISEEFF_UPGRADE_BACKUP_ROOT:-/var/backups/wiseeff/upgrades}"
}

wiseeff_upgrade_env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$upgrade_env_file" 2>/dev/null || true
}

wiseeff_upgrade_log_value() {
  local value="$1"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  value="${value//$'\t'/ }"
  printf '%s' "$value"
}

wiseeff_upgrade_state_write() {
  local key="$1"
  local value="$2"
  local temp_path="${upgrade_run_dir}/${key}.tmp.$$"
  printf '%s\n' "$value" > "$temp_path"
  chmod 600 "$temp_path"
  mv -f "$temp_path" "${upgrade_run_dir}/${key}"
}

wiseeff_upgrade_record_failure() {
  local failed_phase="$1"
  local failure_service="$2"
  local failure_code="$3"
  local failure_summary="$4"

  failure_summary="$(printf '%s' "$failure_summary" | wiseeff_upgrade_sanitize_diagnostic_stream)"
  failure_summary="$(wiseeff_upgrade_log_value "$failure_summary")"
  failure_summary="${failure_summary:0:240}"
  if [ -n "${upgrade_run_dir:-}" ]; then
    wiseeff_upgrade_state_write failed_phase "$failed_phase"
    wiseeff_upgrade_state_write failure_service "$failure_service"
    wiseeff_upgrade_state_write failure_code "$failure_code"
    wiseeff_upgrade_state_write failure_summary "$failure_summary"
  fi
  printf 'WiseEff failure: phase=%s service=%s code=%s summary=%s\n' \
    "$failed_phase" "$failure_service" "$failure_code" "$failure_summary" >&2
  if [ -n "${upgrade_run_dir:-}" ]; then
    wiseeff_upgrade_event failure "service=${failure_service} code=${failure_code} summary=${failure_summary}"
  fi
}

wiseeff_upgrade_state_read() {
  local key="$1"
  if [ -f "${upgrade_run_dir}/${key}" ]; then
    cat "${upgrade_run_dir}/${key}"
  fi
}

wiseeff_upgrade_event() {
  local event="$1"
  local detail="${2:-}"
  detail="$(wiseeff_upgrade_log_value "$detail")"
  printf '%s phase=%s event=%s detail=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(wiseeff_upgrade_state_read phase)" \
    "$event" \
    "$detail" >> "${upgrade_run_dir}/events.log"
  chmod 600 "${upgrade_run_dir}/events.log"
}

wiseeff_upgrade_set_phase() {
  local phase="$1"
  local outcome="${2:-running}"
  wiseeff_upgrade_state_write phase "$phase"
  wiseeff_upgrade_state_write outcome "$outcome"
  wiseeff_upgrade_state_write updated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  wiseeff_upgrade_event phase "${phase}:${outcome}"
}

wiseeff_upgrade_write_status() {
  local run_id="$1"
  local status_path="${upgrade_run_dir}/status"
  local temp_path="${status_path}.tmp.$$"
  {
    printf 'run_id=%s\n' "$run_id"
    printf 'phase=%s\n' "$(wiseeff_upgrade_state_read phase)"
    printf 'outcome=%s\n' "$(wiseeff_upgrade_state_read outcome)"
    printf 'updated_at=%s\n' "$(wiseeff_upgrade_state_read updated_at)"
    printf 'protocol_version=%s\n' "$(wiseeff_upgrade_state_read protocol_version)"
    printf 'previous_sha=%s\n' "$(wiseeff_upgrade_state_read previous_sha)"
    printf 'target_sha=%s\n' "$(wiseeff_upgrade_state_read target_sha)"
    printf 'backup_dir=%s\n' "$(wiseeff_upgrade_state_read backup_dir)"
    printf 'build_status=%s\n' "$(wiseeff_upgrade_state_read build_status)"
    printf 'diagnostics_dir=%s\n' "$(wiseeff_upgrade_state_read diagnostics_dir)"
    printf 'build_log=%s\n' "$(wiseeff_upgrade_state_read build_log)"
    printf 'build_summary=%s\n' "$(wiseeff_upgrade_state_read build_summary)"
    printf 'base_image_ref=%s\n' "$(wiseeff_upgrade_state_read base_image_ref)"
    printf 'base_image_id=%s\n' "$(wiseeff_upgrade_state_read base_image_id)"
    printf 'base_image_config_id=%s\n' "$(wiseeff_upgrade_state_read base_image_config_id)"
    printf 'base_image_platform=%s\n' "$(wiseeff_upgrade_state_read base_image_platform)"
    printf 'base_image_source=%s\n' "$(wiseeff_upgrade_state_read base_image_source)"
    printf 'base_image_status=%s\n' "$(wiseeff_upgrade_state_read base_image_status)"
    printf 'build_proxy_status=%s\n' "$(wiseeff_upgrade_state_read build_proxy_status)"
    printf 'npm_registry_host=%s\n' "$(wiseeff_upgrade_state_read npm_registry_host)"
    printf 'corporate_ca_status=%s\n' "$(wiseeff_upgrade_state_read corporate_ca_status)"
    printf 'build_tls_policy=%s\n' "$(wiseeff_upgrade_state_read build_tls_policy)"
    printf 'build_transport_fingerprint=%s\n' "$(wiseeff_upgrade_state_read build_transport_fingerprint)"
    printf 'completed_with_insecure_build_transport=%s\n' "$(wiseeff_upgrade_state_read completed_with_insecure_build_transport)"
    printf 'runtime_proxy_status=%s\n' "$(wiseeff_upgrade_state_read runtime_proxy_status)"
    printf 'failed_phase=%s\n' "$(wiseeff_upgrade_state_read failed_phase)"
    printf 'failure_service=%s\n' "$(wiseeff_upgrade_state_read failure_service)"
    printf 'failure_code=%s\n' "$(wiseeff_upgrade_state_read failure_code)"
    printf 'failure_summary=%s\n' "$(wiseeff_upgrade_state_read failure_summary)"
    printf 'recovery_started=%s\n' "$(wiseeff_upgrade_state_read recovery_started)"
    printf 'recovery_verified=%s\n' "$(wiseeff_upgrade_state_read recovery_verified)"
    printf 'recovery_proxy_stopped=%s\n' "$(wiseeff_upgrade_state_read recovery_proxy_stopped)"
    printf 'recovery_queue_paused=%s\n' "$(wiseeff_upgrade_state_read recovery_queue_paused)"
    printf 'recovery_failure_summary=%s\n' "$(wiseeff_upgrade_state_read recovery_failure_summary)"
    printf 'next_action=%s\n' "$(wiseeff_upgrade_state_read next_action)"
  } > "$temp_path"
  chmod 600 "$temp_path"
  mv -f "$temp_path" "$status_path"
}

wiseeff_upgrade_ensure_run_id() {
  if [ -z "$upgrade_run_id" ]; then
    upgrade_run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  fi
  case "$upgrade_run_id" in
    *[!A-Za-z0-9._-]*|"")
      wiseeff_upgrade_die 2 "Invalid run id: ${upgrade_run_id}"
      return $?
      ;;
  esac
}

wiseeff_upgrade_validate_run_id_value() {
  case "${1:-}" in
    *[!A-Za-z0-9._-]*|"")
      wiseeff_upgrade_die 2 "Invalid run id: ${1:-missing}"
      return $?
      ;;
  esac
}

wiseeff_upgrade_acquire_lock() {
  wiseeff_operation_lock_acquire "$(wiseeff_upgrade_operation_lock_root)" \
    "Another WiseEff setup or upgrade operation holds the host lock." \
    "upgrade:${upgrade_action}" || return $?
  upgrade_lock_mode="$operation_lock_mode"
  upgrade_lock_dir="${operation_lock_dir:-}"
}

wiseeff_upgrade_reject_root_runtime() {
  if [ "$(id -u)" != "0" ]; then
    return 0
  fi
  if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
    wiseeff_upgrade_die 10 "Do not run ${upgrade_action} as root. Run sudo ./scripts/upgrade.sh prepare-host --yes once, reconnect, then run the upgrade as ${SUDO_USER} without sudo."
  else
    wiseeff_upgrade_die 10 "Do not run ${upgrade_action} as root. Run sudo ./scripts/upgrade.sh prepare-host --operator USER --yes once, then run the upgrade as that deployment user."
  fi
  return $?
}

wiseeff_upgrade_prepare_host_path() {
  local path="$1"
  local label="$2"
  if [ -z "$path" ] || [ "$path" = "/" ] || [ "$path" = "$upgrade_repo_root" ] || [ -L "$path" ]; then
    wiseeff_upgrade_die 10 "Unsafe ${label}: ${path:-missing}"
    return $?
  fi
  case "$path" in
    /bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var|/var/backups|/var/lib|/var/log|/var/run)
      wiseeff_upgrade_die 10 "Refusing to recursively prepare a broad system directory for ${label}: ${path}"
      return $?
      ;;
  esac
}

wiseeff_upgrade_prepare_host_tree() {
  local path="$1"
  local operator="$2"
  local operator_group="$3"
  chown "${operator}:${operator_group}" "$path" || return 10
  find "$path" -xdev -type d -exec chown "${operator}:${operator_group}" {} + || return 10
  find "$path" -xdev -type f -exec chown "${operator}:${operator_group}" {} + || return 10
  find "$path" -xdev -type d -exec chmod 700 {} + || return 10
  find "$path" -xdev -type f -exec chmod 600 {} + || return 10
}

wiseeff_upgrade_prepare_host_validate_scope() {
  local operation_root="$1"
  local journal_root="$2"
  local backup_root="$3"
  local checkout_state_root="${upgrade_repo_root}/ops/self-hosted/.state"
  local docker_root=""
  local path

  for path in "$operation_root" "$journal_root"; do
    case "$path" in
      "$upgrade_repo_root"/*)
        case "$path" in
          "$checkout_state_root"|"$checkout_state_root"/*) ;;
          *)
            wiseeff_upgrade_die 10 "Host operation state inside the checkout must stay under ${checkout_state_root}: ${path}"
            return $?
            ;;
        esac
        ;;
    esac
  done
  case "$backup_root" in
    "$upgrade_repo_root"|"$upgrade_repo_root"/*)
      wiseeff_upgrade_die 10 "Backup root must stay outside the deployment checkout: ${backup_root}"
      return $?
      ;;
  esac

  docker_root="$(wiseeff_upgrade_docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [ -n "$docker_root" ]; then
    docker_root="$(realpath -m -- "$docker_root")" || return 10
    for path in "$operation_root" "$journal_root" "$backup_root"; do
      case "$path" in
        "$docker_root"|"$docker_root"/*)
          wiseeff_upgrade_die 10 "Host preparation paths must stay outside the Docker data root: ${path}"
          return $?
          ;;
      esac
    done
  fi
}

wiseeff_upgrade_run_prepare_host() {
  if [ "$(id -u)" != "0" ]; then
    wiseeff_upgrade_die 2 "prepare-host must run through sudo so it can configure Docker and protected directories."
    return $?
  fi
  if [ "$upgrade_yes" != "true" ]; then
    wiseeff_upgrade_die 2 "prepare-host changes host permissions; re-run with --yes."
    return $?
  fi

  local operator="${upgrade_operator:-${SUDO_USER:-}}"
  local operator_group docker_group operation_root journal_root backup_root
  local operation_root_raw journal_root_raw backup_root_raw group_added="false"
  if [ -z "$operator" ] || [ "$operator" = "root" ] || ! id "$operator" >/dev/null 2>&1; then
    wiseeff_upgrade_die 2 "Could not determine the non-root deployment user; pass --operator USER."
    return $?
  fi
  if ! command -v realpath >/dev/null 2>&1; then
    wiseeff_upgrade_die 10 "prepare-host requires realpath from GNU coreutils."
    return $?
  fi
  operator_group="$(id -gn "$operator")"
  operation_root_raw="$(wiseeff_upgrade_operation_lock_root)"
  journal_root_raw="$(wiseeff_upgrade_state_root)"
  backup_root_raw="$(wiseeff_upgrade_default_backup_root)"
  wiseeff_upgrade_prepare_host_path "$operation_root_raw" "operation lock root" || return $?
  wiseeff_upgrade_prepare_host_path "$journal_root_raw" "upgrade journal root" || return $?
  wiseeff_upgrade_prepare_host_path "$backup_root_raw" "backup root" || return $?
  operation_root="$(realpath -m -- "$operation_root_raw")" || return 10
  journal_root="$(realpath -m -- "$journal_root_raw")" || return 10
  backup_root="$(realpath -m -- "$backup_root_raw")" || return 10
  wiseeff_upgrade_prepare_host_path "$operation_root" "operation lock root" || return $?
  wiseeff_upgrade_prepare_host_path "$journal_root" "upgrade journal root" || return $?
  wiseeff_upgrade_prepare_host_path "$backup_root" "backup root" || return $?
  wiseeff_upgrade_prepare_host_validate_scope "$operation_root" "$journal_root" "$backup_root" || return $?

  mkdir -p "$operation_root" "$journal_root" "$backup_root" || return 10
  wiseeff_operation_lock_clear_stale "$operation_root" || return $?
  wiseeff_operation_lock_acquire "$operation_root" \
    "Another WiseEff setup or upgrade operation holds the host lock." \
    "upgrade:prepare-host" || return $?
  trap wiseeff_operation_lock_release EXIT

  wiseeff_upgrade_prepare_host_tree "$operation_root" "$operator" "$operator_group" || return $?
  case "$journal_root" in
    "$operation_root"|"$operation_root"/*) ;;
    *)
      wiseeff_upgrade_prepare_host_tree "$journal_root" "$operator" "$operator_group" || return $?
      ;;
  esac
  wiseeff_upgrade_prepare_host_tree "$backup_root" "$operator" "$operator_group" || return $?

  docker_group="docker"
  if [ -S /var/run/docker.sock ]; then
    docker_group="$(stat -c '%G' /var/run/docker.sock 2>/dev/null || printf docker)"
  fi
  if ! getent group "$docker_group" >/dev/null 2>&1; then
    wiseeff_upgrade_die 10 "Docker socket group does not exist: ${docker_group}"
    return $?
  fi
  if ! id -nG "$operator" | tr ' ' '\n' | grep -Fxq "$docker_group"; then
    usermod -aG "$docker_group" "$operator" || return 10
    group_added="true"
  fi

  printf 'WiseEff host preparation completed.\n'
  printf '  operator: %s\n  docker_group: %s\n  operation_root: %s\n  journal_root: %s\n  backup_root: %s\n' \
    "$operator" "$docker_group" "$operation_root" "$journal_root" "$backup_root"
  if [ "$group_added" = "true" ]; then
    printf '  next: log out and reconnect so the Docker group membership takes effect.\n'
  else
    printf '  next: run plan/apply as %s without sudo.\n' "$operator"
  fi
}

wiseeff_upgrade_run_lock_status() {
  wiseeff_operation_lock_status "$(wiseeff_upgrade_operation_lock_root)"
}

wiseeff_upgrade_run_unlock() {
  wiseeff_operation_lock_clear_stale "$(wiseeff_upgrade_operation_lock_root)"
}

wiseeff_upgrade_release_lock() {
  wiseeff_operation_lock_release
  upgrade_lock_mode=""
}

wiseeff_upgrade_compose() {
  "${upgrade_script_dir}/compose" --env-file "$upgrade_env_file" "$@"
}

wiseeff_upgrade_git() {
  if [ -n "${upgrade_git_proxy:-}" ]; then
    git -C "$upgrade_repo_root" -c "http.proxy=${upgrade_git_proxy}" "$@"
  else
    git -C "$upgrade_repo_root" "$@"
  fi
}

wiseeff_upgrade_prepare_git_transport() {
  # Git/libcurl treats the lower-case forms as canonical. Interactive shells
  # often export only upper-case names, so copy them without sourcing a shell
  # profile or the runtime .env file. Git config (http.proxy, URL-specific
  # proxy config, and GIT_SSH_COMMAND/core.sshCommand) remains authoritative
  # and is read by every invocation above.
  if [ -z "${http_proxy:-}" ] && [ -n "${HTTP_PROXY:-}" ]; then
    export http_proxy="$HTTP_PROXY"
  fi
  if [ -z "${https_proxy:-}" ] && [ -n "${HTTPS_PROXY:-}" ]; then
    export https_proxy="$HTTPS_PROXY"
  fi
  if [ -z "${all_proxy:-}" ] && [ -n "${ALL_PROXY:-}" ]; then
    export all_proxy="$ALL_PROXY"
  fi
  if [ -z "${no_proxy:-}" ] && [ -n "${NO_PROXY:-}" ]; then
    export no_proxy="$NO_PROXY"
  fi
}

wiseeff_upgrade_docker() {
  docker "$@"
}

wiseeff_upgrade_base_image_contract_relative_path() {
  printf 'ops/self-hosted/images/base-image-bundle.env\n'
}

wiseeff_upgrade_parse_base_image_contract() {
  local content="$1"
  local key value

  upgrade_base_image_ref=""
  upgrade_base_image_archive=""
  upgrade_base_image_archive_ref=""
  upgrade_base_image_platform=""
  upgrade_base_image_id=""
  upgrade_base_image_config_id=""
  upgrade_base_image_archive_sha256=""

  while IFS='=' read -r key value; do
    key="${key%$'\r'}"
    value="${value%$'\r'}"
    case "$key" in
      ""|\#*) continue ;;
      WISEEFF_BASE_IMAGE_REF)
        [ -z "$upgrade_base_image_ref" ] || { wiseeff_upgrade_die 10 "Duplicate base-image contract key: ${key}"; return $?; }
        upgrade_base_image_ref="$value"
        ;;
      WISEEFF_BASE_IMAGE_ARCHIVE)
        [ -z "$upgrade_base_image_archive" ] || { wiseeff_upgrade_die 10 "Duplicate base-image contract key: ${key}"; return $?; }
        upgrade_base_image_archive="$value"
        ;;
      WISEEFF_BASE_IMAGE_ARCHIVE_REF)
        [ -z "$upgrade_base_image_archive_ref" ] || { wiseeff_upgrade_die 10 "Duplicate base-image contract key: ${key}"; return $?; }
        upgrade_base_image_archive_ref="$value"
        ;;
      WISEEFF_BASE_IMAGE_PLATFORM)
        [ -z "$upgrade_base_image_platform" ] || { wiseeff_upgrade_die 10 "Duplicate base-image contract key: ${key}"; return $?; }
        upgrade_base_image_platform="$value"
        ;;
      WISEEFF_BASE_IMAGE_ID)
        [ -z "$upgrade_base_image_id" ] || { wiseeff_upgrade_die 10 "Duplicate base-image contract key: ${key}"; return $?; }
        upgrade_base_image_id="$value"
        ;;
      WISEEFF_BASE_IMAGE_CONFIG_ID)
        [ -z "$upgrade_base_image_config_id" ] || { wiseeff_upgrade_die 10 "Duplicate base-image contract key: ${key}"; return $?; }
        upgrade_base_image_config_id="$value"
        ;;
      WISEEFF_BASE_IMAGE_ARCHIVE_SHA256)
        [ -z "$upgrade_base_image_archive_sha256" ] || { wiseeff_upgrade_die 10 "Duplicate base-image contract key: ${key}"; return $?; }
        upgrade_base_image_archive_sha256="$value"
        ;;
      *)
        wiseeff_upgrade_die 10 "Unknown base-image contract key: ${key}"
        return $?
        ;;
    esac
  done <<< "$content"

  case "$upgrade_base_image_ref" in
    ""|*[!A-Za-z0-9._:/@+-]*) wiseeff_upgrade_die 10 "Invalid WISEEFF_BASE_IMAGE_REF in the base-image contract."; return $? ;;
  esac
  case "$upgrade_base_image_archive_ref" in
    ""|*[!A-Za-z0-9._:/@+-]*) wiseeff_upgrade_die 10 "Invalid WISEEFF_BASE_IMAGE_ARCHIVE_REF in the base-image contract."; return $? ;;
  esac
  case "$upgrade_base_image_archive" in
    ""|*[!A-Za-z0-9._-]*|*/*|*.tar.tar) wiseeff_upgrade_die 10 "Invalid WISEEFF_BASE_IMAGE_ARCHIVE in the base-image contract."; return $? ;;
  esac
  case "$upgrade_base_image_archive" in
    *.tar) ;;
    *) wiseeff_upgrade_die 10 "The bundled base-image archive must use a .tar filename."; return $? ;;
  esac
  if [[ ! "$upgrade_base_image_platform" =~ ^linux/(amd64|arm64)$ ]]; then
    wiseeff_upgrade_die 10 "Invalid WISEEFF_BASE_IMAGE_PLATFORM in the base-image contract."
    return $?
  fi
  if [[ ! "$upgrade_base_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    wiseeff_upgrade_die 10 "Invalid WISEEFF_BASE_IMAGE_ID in the base-image contract."
    return $?
  fi
  if [[ ! "$upgrade_base_image_config_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    wiseeff_upgrade_die 10 "Invalid WISEEFF_BASE_IMAGE_CONFIG_ID in the base-image contract."
    return $?
  fi
  if [[ ! "$upgrade_base_image_archive_sha256" =~ ^[a-f0-9]{64}$ ]]; then
    wiseeff_upgrade_die 10 "Invalid WISEEFF_BASE_IMAGE_ARCHIVE_SHA256 in the base-image contract."
    return $?
  fi
}

wiseeff_upgrade_load_base_image_contract_file() {
  local contract_path
  contract_path="${upgrade_repo_root}/$(wiseeff_upgrade_base_image_contract_relative_path)"
  if [ ! -f "$contract_path" ] || [ -L "$contract_path" ]; then
    wiseeff_upgrade_die 10 "Missing or unsafe bundled base-image contract: ${contract_path}"
    return $?
  fi
  wiseeff_upgrade_parse_base_image_contract "$(cat "$contract_path")" || return $?
  upgrade_base_image_archive_path="$(dirname "$contract_path")/${upgrade_base_image_archive}"
}

wiseeff_upgrade_stream_fingerprint() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

wiseeff_upgrade_validate_base_image_archive_file() {
  local actual_sha
  if [ ! -f "$upgrade_base_image_archive_path" ] || [ -L "$upgrade_base_image_archive_path" ]; then
    wiseeff_upgrade_die 10 "Missing or unsafe bundled base-image archive: ${upgrade_base_image_archive_path}"
    return $?
  fi
  actual_sha="$(wiseeff_upgrade_fingerprint "$upgrade_base_image_archive_path")" || return $?
  if [ "$actual_sha" != "$upgrade_base_image_archive_sha256" ]; then
    wiseeff_upgrade_die 10 "Bundled base-image archive checksum mismatch: ${upgrade_base_image_archive_path}"
    return $?
  fi
}

wiseeff_upgrade_base_image_identity() {
  wiseeff_upgrade_docker image inspect --format '{{.Id}}|{{.Os}}/{{.Architecture}}' "$1" 2>/dev/null
}

wiseeff_upgrade_base_image_identity_matches_contract() {
  local identity="$1"
  [ "$identity" = "${upgrade_base_image_id}|${upgrade_base_image_platform}" ] ||
    [ "$identity" = "${upgrade_base_image_config_id}|${upgrade_base_image_platform}" ]
}

wiseeff_upgrade_base_image_identity_mismatch() {
  local stage="$1"
  local ref="$2"
  local actual="${3:-missing}"
  wiseeff_upgrade_die 10 "${stage} base-image identity does not match the pinned bundle contract: ref=${ref}; expected manifest=${upgrade_base_image_id}|${upgrade_base_image_platform} or config=${upgrade_base_image_config_id}|${upgrade_base_image_platform}; actual=${actual}"
}

wiseeff_upgrade_validate_docker_platform() {
  local server_platform
  server_platform="$(wiseeff_upgrade_docker version --format '{{.Server.Os}}/{{.Server.Arch}}' 2>/dev/null || true)"
  if [ -z "$server_platform" ]; then
    wiseeff_upgrade_die 10 "Could not determine the Docker server platform for the bundled base image."
    return $?
  fi
  if [ "$server_platform" != "$upgrade_base_image_platform" ]; then
    wiseeff_upgrade_die 10 "Bundled base image platform ${upgrade_base_image_platform} does not match Docker server platform ${server_platform}."
    return $?
  fi
}

wiseeff_upgrade_validate_target_base_image_bundle() {
  local contract_path contract dockerfile archive_spec actual_sha local_identity
  contract_path="$(wiseeff_upgrade_base_image_contract_relative_path)"
  contract="$(wiseeff_upgrade_git show "${upgrade_target_sha}:${contract_path}" 2>/dev/null)" || {
    wiseeff_upgrade_die 10 "Target ${upgrade_target_sha} does not contain ${contract_path}."
    return $?
  }
  wiseeff_upgrade_parse_base_image_contract "$contract" || return $?

  dockerfile="$(wiseeff_upgrade_git show "${upgrade_target_sha}:ops/self-hosted/Dockerfile" 2>/dev/null)" || {
    wiseeff_upgrade_die 10 "Target ${upgrade_target_sha} does not contain the self-hosted Dockerfile."
    return $?
  }
  if ! printf '%s\n' "$dockerfile" | awk -v ref="$upgrade_base_image_ref" '$1 == "FROM" && $2 == ref { found = 1 } END { exit(found ? 0 : 1) }'; then
    wiseeff_upgrade_die 10 "Target Dockerfile does not use the base image pinned by ${contract_path}: ${upgrade_base_image_ref}"
    return $?
  fi

  archive_spec="${upgrade_target_sha}:ops/self-hosted/images/${upgrade_base_image_archive}"
  if [ "$(wiseeff_upgrade_git cat-file -t "$archive_spec" 2>/dev/null || true)" != "blob" ]; then
    wiseeff_upgrade_die 10 "Target ${upgrade_target_sha} does not contain bundled base-image archive ${upgrade_base_image_archive}."
    return $?
  fi
  actual_sha="$(wiseeff_upgrade_git show "$archive_spec" | wiseeff_upgrade_stream_fingerprint)" || {
    wiseeff_upgrade_die 10 "Could not verify bundled base-image archive ${upgrade_base_image_archive} from target ${upgrade_target_sha}."
    return $?
  }
  if [ "$actual_sha" != "$upgrade_base_image_archive_sha256" ]; then
    wiseeff_upgrade_die 10 "Target bundled base-image archive checksum mismatch: ${upgrade_base_image_archive}"
    return $?
  fi

  wiseeff_upgrade_validate_docker_platform || return $?
  local_identity="$(wiseeff_upgrade_base_image_identity "$upgrade_base_image_ref" || true)"
  if wiseeff_upgrade_base_image_identity_matches_contract "$local_identity"; then
    upgrade_base_image_status="ready-local"
    upgrade_base_image_source="local"
  else
    upgrade_base_image_status="ready-bundled"
    upgrade_base_image_source="bundled-archive"
  fi
}

wiseeff_upgrade_record_base_image() {
  [ -n "${upgrade_run_dir:-}" ] || return 0
  wiseeff_upgrade_state_write base_image_ref "$upgrade_base_image_ref" || return $?
  wiseeff_upgrade_state_write base_image_id "$upgrade_base_image_id" || return $?
  wiseeff_upgrade_state_write base_image_config_id "$upgrade_base_image_config_id" || return $?
  wiseeff_upgrade_state_write base_image_platform "$upgrade_base_image_platform" || return $?
  wiseeff_upgrade_state_write base_image_source "$upgrade_base_image_source" || return $?
  wiseeff_upgrade_state_write base_image_status ready || return $?
}

wiseeff_upgrade_ensure_base_image() {
  local identity
  wiseeff_upgrade_load_base_image_contract_file || return $?
  wiseeff_upgrade_validate_base_image_archive_file || return $?
  wiseeff_upgrade_validate_docker_platform || return $?

  identity="$(wiseeff_upgrade_base_image_identity "$upgrade_base_image_ref" || true)"
  if wiseeff_upgrade_base_image_identity_matches_contract "$identity"; then
    upgrade_base_image_source="local"
    wiseeff_upgrade_record_base_image || return $?
    printf 'Verified bundled base-image identity already present: %s (%s)\n' "$upgrade_base_image_ref" "$upgrade_base_image_id"
    return 0
  fi

  wiseeff_upgrade_docker load -i "$upgrade_base_image_archive_path" || {
    wiseeff_upgrade_die 10 "Docker could not load bundled base-image archive: ${upgrade_base_image_archive_path}"
    return $?
  }
  identity="$(wiseeff_upgrade_base_image_identity "$upgrade_base_image_archive_ref" || true)"
  if ! wiseeff_upgrade_base_image_identity_matches_contract "$identity"; then
    wiseeff_upgrade_base_image_identity_mismatch "Loaded" "$upgrade_base_image_archive_ref" "$identity"
    return $?
  fi
  wiseeff_upgrade_docker tag "$upgrade_base_image_archive_ref" "$upgrade_base_image_ref" || {
    wiseeff_upgrade_die 10 "Docker could not tag bundled base image as ${upgrade_base_image_ref}."
    return $?
  }
  identity="$(wiseeff_upgrade_base_image_identity "$upgrade_base_image_ref" || true)"
  if ! wiseeff_upgrade_base_image_identity_matches_contract "$identity"; then
    wiseeff_upgrade_base_image_identity_mismatch "Prepared Dockerfile tag" "$upgrade_base_image_ref" "$identity"
    return $?
  fi
  upgrade_base_image_source="bundled-archive"
  wiseeff_upgrade_record_base_image || return $?
  printf 'Loaded and tagged bundled base image: %s -> %s\n' "$upgrade_base_image_archive_ref" "$upgrade_base_image_ref"
}

wiseeff_upgrade_require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    wiseeff_upgrade_die 10 "Required command is missing: $1"
    return $?
  fi
}

wiseeff_upgrade_stat_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || printf 'unknown\n'
}

wiseeff_upgrade_validate_env() {
  if [ ! -f "$upgrade_env_file" ]; then
    wiseeff_upgrade_die 10 "Missing ${upgrade_env_file}. Run setup.sh before upgrade."
    return $?
  fi
  if [ -L "$upgrade_env_file" ]; then
    wiseeff_upgrade_die 10 "Refusing a symlinked environment file: ${upgrade_env_file}."
    return $?
  fi
  local mode
  mode="$(wiseeff_upgrade_stat_mode "$upgrade_env_file")"
  case "$mode" in
    600|unknown) ;;
    *)
      wiseeff_upgrade_die 10 "Refusing an environment file with unsafe permissions: ${mode}."
      return $?
      ;;
  esac
  local key value
  for key in DATABASE_URL POSTGRES_PASSWORD OBJECT_STORE_MODE OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET OBJECT_STORAGE_ACCESS_KEY_ID OBJECT_STORAGE_SECRET_ACCESS_KEY; do
    value="$(wiseeff_upgrade_env_value "$key")"
    if [ -z "$value" ]; then
      wiseeff_upgrade_die 10 "Missing required self-hosted environment key: ${key}."
      return $?
    fi
  done
  if [ "$(wiseeff_upgrade_env_value LOG_ANALYSIS_QUEUE_MODE)" = "durable" ] && [ -z "$(wiseeff_upgrade_env_value REDIS_URL)" ]; then
    wiseeff_upgrade_die 10 "REDIS_URL is required when LOG_ANALYSIS_QUEUE_MODE=durable."
    return $?
  fi
}

wiseeff_upgrade_validate_backup_root() {
  local backup_root backup_parent docker_root
  backup_root="$(wiseeff_upgrade_default_backup_root)"
  if [ -L "$backup_root" ]; then
    wiseeff_upgrade_die 10 "Backup root must not be a symlink: ${backup_root}"
    return $?
  fi
  case "$backup_root" in
    "${upgrade_repo_root}"|"${upgrade_repo_root}"/*|/var/lib/docker|/var/lib/docker/*)
      wiseeff_upgrade_die 10 "Backup root must be outside the checkout and Docker data root: ${backup_root}."
      return $?
      ;;
  esac
  backup_parent="$backup_root"
  while [ ! -d "$backup_parent" ] && [ "$backup_parent" != "/" ]; do
    backup_parent="$(dirname "$backup_parent")"
  done
  [ -d "$backup_parent" ] || {
    wiseeff_upgrade_die 10 "Backup root parent does not exist: ${backup_root}"
    return $?
  }
  [ -w "$backup_parent" ] || {
    wiseeff_upgrade_die 10 "Backup root parent is not writable by the current operator: ${backup_parent}. Run sudo ./scripts/upgrade.sh prepare-host --yes once."
    return $?
  }
  if [ -L "$backup_parent" ]; then
    wiseeff_upgrade_die 10 "Backup root parent must not be a symlink: ${backup_parent}"
    return $?
  fi
  docker_root="$(wiseeff_upgrade_docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [ -n "$docker_root" ] && { [ "$backup_root" = "$docker_root" ] || [[ "$backup_root" == "$docker_root"/* ]]; }; then
    wiseeff_upgrade_die 10 "Backup root must be outside Docker data root: ${backup_root}."
    return $?
  fi
  local disk_kb inode_count
  disk_kb="$(df -Pk "$backup_parent" 2>/dev/null | awk 'NR == 2 { print $4 }' || true)"
  inode_count="$(df -Pi "$backup_parent" 2>/dev/null | awk 'NR == 2 { print $4 }' || true)"
  if [ -n "$disk_kb" ] && [ "$disk_kb" -lt "${WISEEFF_UPGRADE_MIN_FREE_KB:-4194304}" ]; then
    wiseeff_upgrade_die 10 "Insufficient free space for the recovery point under ${backup_root}."
    return $?
  fi
  if [ -n "$inode_count" ] && [ "$inode_count" -lt "${WISEEFF_UPGRADE_MIN_FREE_INODES:-10000}" ]; then
    wiseeff_upgrade_die 10 "Insufficient free inodes for the recovery point under ${backup_root}."
    return $?
  fi
}

wiseeff_upgrade_validate_worktree() {
  local dirty
  dirty="$(wiseeff_upgrade_git status --porcelain --untracked-files=all)" || {
    wiseeff_upgrade_die 10 "Could not inspect the deployment checkout."
    return $?
  }
  if [ -n "$dirty" ]; then
    wiseeff_upgrade_die 10 "Refusing upgrade from a dirty checkout. Inspect git status --short, then commit or remove tracked/unignored changes; the upgrade never auto-cleans operator files."
    return $?
  fi
}

wiseeff_upgrade_validate_protocol() {
  local target_sha="$1"
  local protocol
  protocol="$(wiseeff_upgrade_git show "${target_sha}:ops/self-hosted/upgrade-protocol.env" 2>/dev/null || true)"
  if [ -z "$protocol" ]; then
    wiseeff_upgrade_die 10 "Target ${target_sha} does not contain a self-hosted upgrade protocol."
    return $?
  fi
  local version
  version="$(printf '%s\n' "$protocol" | awk -F= '$1 == "WISEEFF_UPGRADE_PROTOCOL_VERSION" { print $2; exit }')"
  if [ "$version" != "1" ]; then
    wiseeff_upgrade_die 10 "Unsupported self-hosted upgrade protocol version: ${version:-missing}."
    return $?
  fi
}

wiseeff_upgrade_resolve_target() {
  upgrade_previous_sha="$(wiseeff_upgrade_git rev-parse HEAD)" || {
    wiseeff_upgrade_die 10 "Could not resolve the current checkout commit."
    return $?
  }
  wiseeff_upgrade_prepare_git_transport
  if ! wiseeff_upgrade_git fetch origin --prune >/dev/null; then
    wiseeff_upgrade_die 10 "Git fetch failed for origin. Run as the deployment user and verify its proxy/Git configuration; do not use sudo for plan or apply."
    return $?
  fi
  upgrade_target_sha="$(wiseeff_upgrade_git rev-parse "${upgrade_ref}^{commit}")" || {
    wiseeff_upgrade_die 10 "Could not resolve Git ref: ${upgrade_ref}"
    return $?
  }
  [ -n "$upgrade_target_sha" ] || {
    wiseeff_upgrade_die 10 "Could not resolve Git ref: ${upgrade_ref}"
    return $?
  }
  wiseeff_upgrade_validate_protocol "$upgrade_target_sha" || return $?
  upgrade_migrations="$(wiseeff_upgrade_git diff --name-only "$upgrade_previous_sha" "$upgrade_target_sha" -- server/migrations)" || {
    wiseeff_upgrade_die 10 "Could not compare migrations between the current and target commits."
    return $?
  }
}

wiseeff_upgrade_collect_runtime() {
  local service container image image_ref project app_image image_ref_variable
  upgrade_runtime_services="postgres redis minio api worker web proxy"
  upgrade_compose_project=""
  upgrade_mixed_app_images="false"
  app_image=""
  for service in $upgrade_runtime_services; do
    container="$(wiseeff_upgrade_compose ps -q "$service" 2>/dev/null || true)"
    if [ -z "$container" ]; then
      wiseeff_upgrade_die 10 "Self-hosted service is not running: ${service}"
      return $?
    fi
    if [ -n "${upgrade_run_dir:-}" ]; then
      wiseeff_upgrade_state_write "container_${service}" "$container"
    fi
    image="$(wiseeff_upgrade_docker inspect -f '{{.Image}}' "$container" 2>/dev/null || true)"
    [ -n "$image" ] || {
      wiseeff_upgrade_die 10 "Could not inspect image for service: ${service}"
      return $?
    }
    if [ -n "${upgrade_run_dir:-}" ]; then
      wiseeff_upgrade_state_write "image_${service}" "$image"
    fi
    if [ "$service" = "api" ] || [ "$service" = "worker" ] || [ "$service" = "web" ]; then
      image_ref="$(wiseeff_upgrade_docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)"
      [ -n "$image_ref" ] || {
        wiseeff_upgrade_die 10 "Could not inspect image reference for service: ${service}"
        return $?
      }
      image_ref_variable="upgrade_runtime_image_ref_${service}"
      printf -v "$image_ref_variable" '%s' "$image_ref"
      if [ -n "${upgrade_run_dir:-}" ]; then
        wiseeff_upgrade_state_write "image_ref_${service}" "$image_ref"
      fi
      if [ -z "$app_image" ]; then
        app_image="$image"
      elif [ "$app_image" != "$image" ]; then
        upgrade_mixed_app_images="true"
      fi
    fi
    project="$(wiseeff_upgrade_docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$container" 2>/dev/null || true)"
    [ -n "$project" ] || {
      wiseeff_upgrade_die 10 "Could not determine the Compose project identity for ${service}."
      return $?
    }
    if [ -z "$upgrade_compose_project" ]; then
      upgrade_compose_project="$project"
    elif [ "$upgrade_compose_project" != "$project" ]; then
      wiseeff_upgrade_die 10 "Compose project identity drifted between services."
      return $?
    fi
  done
  upgrade_runtime_network="$(wiseeff_upgrade_docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{printf "%s" $name}}{{end}}' "$(wiseeff_upgrade_compose ps -q api)" 2>/dev/null || true)"
  [ -n "$upgrade_runtime_network" ] || {
    wiseeff_upgrade_die 10 "Could not determine the self-hosted Compose network."
    return $?
  }
  if [ -n "${upgrade_run_dir:-}" ]; then
    wiseeff_upgrade_state_write network "$upgrade_runtime_network"
    wiseeff_upgrade_state_write compose_project "$upgrade_compose_project"
  fi
}

wiseeff_upgrade_target_app_image_is_running() {
  local expected_ref service variable
  [ "${upgrade_mixed_app_images:-false}" != "true" ] || return 1
  expected_ref="$(wiseeff_upgrade_app_image_name):${upgrade_target_sha}"
  for service in api worker web; do
    variable="upgrade_runtime_image_ref_${service}"
    [ "${!variable:-}" = "$expected_ref" ] || return 1
  done
}

wiseeff_upgrade_collect_volumes() {
  local service container mounts
  for service in postgres redis minio proxy; do
    container="$(wiseeff_upgrade_state_read "container_${service}")"
    [ -n "$container" ] || container="$(wiseeff_upgrade_compose ps -q "$service" 2>/dev/null || true)"
    mounts="$(wiseeff_upgrade_docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}={{.Destination}};{{end}}{{end}}' "$container" 2>/dev/null || true)"
    [ -n "$mounts" ] || {
      wiseeff_upgrade_die 10 "Could not inspect persistent volume mounts for service: ${service}"
      return $?
    }
    if [ -n "${upgrade_run_dir:-}" ]; then
      wiseeff_upgrade_state_write "volumes_${service}" "$mounts"
    fi
  done
}

wiseeff_upgrade_compose_config() {
  wiseeff_upgrade_compose config --quiet >/dev/null
}

wiseeff_upgrade_preflight() {
  wiseeff_upgrade_reject_root_runtime || return $?
  wiseeff_upgrade_require_command git || return $?
  wiseeff_upgrade_require_command docker || return $?
  wiseeff_upgrade_require_command curl || return $?
  wiseeff_upgrade_validate_env || return $?
  wiseeff_upgrade_validate_backup_root || return $?
  wiseeff_upgrade_validate_worktree || return $?
  wiseeff_build_network_prepare "$upgrade_compose_dir" "$upgrade_build_network_file" || return $?
  if [ "${upgrade_action:-plan}" = "apply" ]; then
    wiseeff_build_network_authorize_build "${upgrade_allow_insecure_build:-false}" "upgrade apply" || return $?
  fi
  if ! wiseeff_upgrade_docker info >/dev/null; then
    wiseeff_upgrade_die 10 "Docker daemon is unavailable to the deployment user. Run sudo ./scripts/upgrade.sh prepare-host --yes once, reconnect, then retry without sudo."
    return $?
  fi
  wiseeff_upgrade_compose_config || return $?
  wiseeff_upgrade_collect_runtime || return $?
  wiseeff_upgrade_collect_volumes || return $?
  wiseeff_upgrade_resolve_target || return $?
  wiseeff_upgrade_validate_target_base_image_bundle || return $?
}

wiseeff_upgrade_print_plan() {
  local migrations_count=0
  local escaped_ref
  local build_proxy build_registry build_ca build_tls_policy runtime_proxy
  escaped_ref="$(wiseeff_upgrade_json_escape "$upgrade_ref")"
  build_proxy="${WISEEFF_BUILD_NETWORK_PROXY_STATUS:-not configured}"
  build_registry="$(wiseeff_build_network_registry_host)"
  build_ca="$(wiseeff_build_network_ca_status)"
  build_tls_policy="$(wiseeff_build_network_tls_policy)"
  runtime_proxy="${WISEEFF_RUNTIME_PROXY:-false}"
  if [ -n "$upgrade_migrations" ]; then
    migrations_count="$(printf '%s\n' "$upgrade_migrations" | sed '/^$/d' | wc -l | tr -d ' ')"
  fi
  if [ "$upgrade_json" = "true" ]; then
    printf '{"action":"plan","previousSha":"%s","targetSha":"%s","requestedRef":"%s","migrationCount":%s,"restart":%s,"baseImage":{"ref":"%s","id":"%s","configId":"%s","platform":"%s","source":"%s","status":"%s"},"buildNetwork":{"proxy":"%s","npmRegistry":"%s","corporateCa":"%s","buildTlsPolicy":"%s","runtimeProxy":%s}}\n' \
      "$upgrade_previous_sha" "$upgrade_target_sha" "$escaped_ref" "$migrations_count" "$upgrade_restart" \
      "$(wiseeff_upgrade_json_escape "$upgrade_base_image_ref")" \
      "$(wiseeff_upgrade_json_escape "$upgrade_base_image_id")" \
      "$(wiseeff_upgrade_json_escape "$upgrade_base_image_config_id")" \
      "$(wiseeff_upgrade_json_escape "$upgrade_base_image_platform")" \
      "$(wiseeff_upgrade_json_escape "$upgrade_base_image_source")" \
      "$(wiseeff_upgrade_json_escape "$upgrade_base_image_status")" \
      "$(wiseeff_upgrade_json_escape "$build_proxy")" \
      "$(wiseeff_upgrade_json_escape "$build_registry")" \
      "$(wiseeff_upgrade_json_escape "$build_ca")" \
      "$(wiseeff_upgrade_json_escape "$build_tls_policy")" \
      "$runtime_proxy"
    return 0
  fi
  printf 'WiseEff self-hosted upgrade plan\n'
  printf '  current:  %s\n' "$upgrade_previous_sha"
  printf '  target:   %s (%s)\n' "$upgrade_target_sha" "$upgrade_ref"
  printf '  migrations: %s\n' "$migrations_count"
  printf '  backup:   %s\n' "$(wiseeff_upgrade_default_backup_root)"
  printf '  restart:   %s\n' "$upgrade_restart"
  if [ "$upgrade_base_image_status" = "ready-local" ]; then
    printf '  base image: %s (%s, verified local image)\n' "$upgrade_base_image_ref" "$upgrade_base_image_platform"
  else
    printf '  base image: %s (%s, verified bundle; apply will load and tag it)\n' "$upgrade_base_image_ref" "$upgrade_base_image_platform"
  fi
  printf '  base image id: %s\n' "$upgrade_base_image_id"
  printf '  base image config id: %s\n' "$upgrade_base_image_config_id"
  printf '  build proxy: %s\n' "$build_proxy"
  printf '  npm registry: %s\n' "$build_registry"
  printf '  corporate CA: %s\n' "$build_ca"
  if [ "$build_tls_policy" = "insecure" ]; then
    printf '  build TLS: INSECURE (build only; apply requires --allow-insecure-build)\n'
    printf '  warning:   build downloads can be intercepted or replaced\n'
  else
    printf '  build TLS: verified\n'
  fi
  printf '  runtime proxy: %s\n' "$runtime_proxy"
  if [ "${upgrade_mixed_app_images:-false}" = "true" ]; then
    printf '  compatibility: preserving legacy API/worker/web images separately for rollback\n'
  fi
  if [ "$migrations_count" -gt 0 ]; then
    printf '  warning:   database migration starts after the verified recovery point\n'
  fi
}

wiseeff_upgrade_json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

wiseeff_upgrade_fingerprint() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

wiseeff_upgrade_init_run() {
  wiseeff_upgrade_ensure_run_id
  local state_root
  state_root="$(wiseeff_upgrade_state_root)"
  upgrade_run_dir="${state_root}/${upgrade_run_id}"
  if [ -e "$upgrade_run_dir" ]; then
    wiseeff_upgrade_die 10 "Run already exists: ${upgrade_run_id}. Use resume or status."
    return $?
  fi
  mkdir -p "$upgrade_run_dir"
  chmod 700 "$upgrade_run_dir"
  upgrade_backup_dir="$(wiseeff_upgrade_default_backup_root)/${upgrade_run_id}"
  mkdir -p "$upgrade_backup_dir"
  chmod 700 "$(wiseeff_upgrade_default_backup_root)" "$upgrade_backup_dir"
  wiseeff_upgrade_state_write run_id "$upgrade_run_id"
  wiseeff_upgrade_state_write requested_ref "$upgrade_ref"
  wiseeff_upgrade_state_write env_fingerprint "$(wiseeff_upgrade_fingerprint "$upgrade_env_file")"
  wiseeff_upgrade_state_write backup_dir "$upgrade_backup_dir"
  wiseeff_upgrade_state_write protocol_version 1
  wiseeff_upgrade_state_write build_status not-started
  wiseeff_upgrade_state_write completed_with_insecure_build_transport false
  wiseeff_upgrade_state_write recovery_started false
  wiseeff_upgrade_state_write recovery_verified false
  wiseeff_upgrade_state_write recovery_proxy_stopped false
  wiseeff_upgrade_state_write recovery_queue_paused false
  wiseeff_upgrade_state_write started_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  wiseeff_upgrade_set_phase initialized running
  wiseeff_upgrade_write_status "$upgrade_run_id"
}

wiseeff_upgrade_store_plan() {
  wiseeff_upgrade_state_write previous_sha "$upgrade_previous_sha"
  wiseeff_upgrade_state_write target_sha "$upgrade_target_sha"
  wiseeff_upgrade_state_write migrations "$upgrade_migrations"
  wiseeff_upgrade_state_write runtime_network "$upgrade_runtime_network"
  wiseeff_upgrade_state_write compose_project "$upgrade_compose_project"
  wiseeff_upgrade_state_write queue_mode "log-analysis=$(wiseeff_upgrade_env_value LOG_ANALYSIS_QUEUE_MODE);notifications=$(wiseeff_upgrade_env_value NOTIFICATION_QUEUE_MODE)"
  wiseeff_upgrade_state_write env_fingerprint "$(wiseeff_upgrade_fingerprint "$upgrade_env_file")"
  wiseeff_upgrade_state_write base_image_ref "$upgrade_base_image_ref"
  wiseeff_upgrade_state_write base_image_id "$upgrade_base_image_id"
  wiseeff_upgrade_state_write base_image_config_id "$upgrade_base_image_config_id"
  wiseeff_upgrade_state_write base_image_platform "$upgrade_base_image_platform"
  wiseeff_upgrade_state_write base_image_status "$upgrade_base_image_status"
  wiseeff_upgrade_state_write build_proxy_status "${WISEEFF_BUILD_NETWORK_PROXY_STATUS:-not configured}"
  wiseeff_upgrade_state_write npm_registry_host "$(wiseeff_build_network_registry_host)"
  wiseeff_upgrade_state_write corporate_ca_status "$(wiseeff_build_network_ca_status)"
  wiseeff_upgrade_state_write build_tls_policy "$(wiseeff_build_network_tls_policy)"
  wiseeff_upgrade_state_write build_transport_fingerprint "${WISEEFF_BUILD_TRANSPORT_FINGERPRINT:-unknown}"
  wiseeff_upgrade_state_write runtime_proxy_status "${WISEEFF_RUNTIME_PROXY:-false}"
  if [ -n "$upgrade_migrations" ]; then
    wiseeff_upgrade_state_write migration_changed true
  else
    wiseeff_upgrade_state_write migration_changed false
  fi
  wiseeff_upgrade_write_status "$upgrade_run_id"
}

wiseeff_upgrade_confirm() {
  if [ "$upgrade_yes" = "true" ]; then
    return 0
  fi
  if [ "$upgrade_non_interactive" = "true" ]; then
    wiseeff_upgrade_die 2 "Non-interactive apply requires --yes."
    return $?
  fi
  if [ ! -r /dev/tty ]; then
    wiseeff_upgrade_die 2 "No TTY. Re-run with --non-interactive --yes."
    return $?
  fi
  printf 'This will stop traffic, backup data, run migrations, and recreate every service. Type upgrade to continue: ' >/dev/tty
  local answer
  IFS= read -r answer </dev/tty || true
  if [ "$answer" != "upgrade" ]; then
    wiseeff_upgrade_die 2 "Upgrade cancelled."
    return $?
  fi
}

wiseeff_upgrade_app_image_name() {
  local image="${WISEEFF_APP_IMAGE:-}"
  [ -n "$image" ] || image="$(wiseeff_upgrade_env_value WISEEFF_APP_IMAGE)"
  [ -n "$image" ] || image="wiseeff-app"
  printf '%s\n' "$image"
}

wiseeff_upgrade_tag_previous_images() {
  local image_repo tag image_id service
  image_repo="$(wiseeff_upgrade_app_image_name)"
  for service in api worker web; do
    tag="${image_repo}:wiseeff-previous-${service}-${upgrade_run_id}"
    image_id="$(wiseeff_upgrade_state_read "image_${service}")"
    [ -n "$image_id" ] || {
      wiseeff_upgrade_die 20 "Current ${service} image identity is unavailable."
      return $?
    }
    wiseeff_upgrade_docker tag "$image_id" "$tag" || return $?
    wiseeff_upgrade_state_write "previous_image_tag_${service}" "$tag" || return $?
    wiseeff_upgrade_state_write "previous_image_id_${service}" "$image_id" || return $?
    if [ "$service" = "api" ]; then
      upgrade_previous_image_tag="$tag"
      wiseeff_upgrade_state_write previous_image_tag "$tag" || return $?
    fi
  done
}

wiseeff_upgrade_build_candidate() {
  local target_tag build_status pipeline_status
  local -a build_pipeline_statuses

  target_tag="$(wiseeff_upgrade_app_image_name):${upgrade_target_sha}"
  upgrade_diagnostics_dir="${upgrade_run_dir}/diagnostics"
  upgrade_build_log="${upgrade_diagnostics_dir}/build.log"
  upgrade_build_summary="${upgrade_diagnostics_dir}/summary.txt"

  mkdir -p "$upgrade_diagnostics_dir" || return $?
  chmod 700 "$upgrade_diagnostics_dir" || return $?
  : > "$upgrade_build_log"
  chmod 600 "$upgrade_build_log" || return $?
  wiseeff_upgrade_state_write diagnostics_dir "$upgrade_diagnostics_dir" || return $?
  wiseeff_upgrade_state_write build_log "$upgrade_build_log" || return $?
  wiseeff_upgrade_state_write build_summary "$upgrade_build_summary" || return $?
  wiseeff_upgrade_state_write build_status running || return $?
  wiseeff_upgrade_event candidate-build-transport "tls-policy=$(wiseeff_build_network_tls_policy)" || return $?
  if [ -n "${upgrade_run_id:-}" ]; then
    wiseeff_upgrade_write_status "$upgrade_run_id" || return $?
  fi

  if wiseeff_upgrade_git checkout --detach "$upgrade_target_sha" >/dev/null; then
    :
  else
    build_status=$?
    wiseeff_upgrade_write_build_summary failed source-checkout \
      "The immutable target checkout could not be selected for the candidate build." \
      "Verify the fetched Git object and rerun apply." || return $?
    wiseeff_upgrade_state_write build_status failed || return $?
    return "$build_status"
  fi

  if wiseeff_upgrade_ensure_base_image 2>&1 \
    | wiseeff_upgrade_sanitize_diagnostic_stream \
    | tee -a "$upgrade_build_log"; then
    build_pipeline_statuses=("${PIPESTATUS[@]}")
  else
    build_pipeline_statuses=("${PIPESTATUS[@]}")
  fi
  build_status="${build_pipeline_statuses[0]:-1}"
  if [ "$build_status" -eq 0 ]; then
    for pipeline_status in "${build_pipeline_statuses[@]:1}"; do
      if [ "$pipeline_status" -ne 0 ]; then
        build_status="$pipeline_status"
        break
      fi
    done
  fi
  if [ "$build_status" -ne 0 ]; then
    wiseeff_upgrade_state_write base_image_status failed || return $?
    wiseeff_upgrade_write_build_summary failed base-image \
      "The pinned bundled Dockerfile base image could not be prepared safely." \
      "Verify the base-image summary, Docker server platform, and bundled archive, then rerun apply." || return $?
    wiseeff_upgrade_state_write build_status failed || return $?
    return "$build_status"
  fi

  if BUILDKIT_PROGRESS=plain WISEEFF_APP_TAG="$upgrade_target_sha" \
    wiseeff_upgrade_compose build api 2>&1 \
      | wiseeff_upgrade_sanitize_diagnostic_stream \
      | tee -a "$upgrade_build_log"; then
    build_pipeline_statuses=("${PIPESTATUS[@]}")
  else
    build_pipeline_statuses=("${PIPESTATUS[@]}")
  fi

  build_status="${build_pipeline_statuses[0]:-1}"
  if [ "$build_status" -eq 0 ]; then
    for pipeline_status in "${build_pipeline_statuses[@]:1}"; do
      if [ "$pipeline_status" -ne 0 ]; then
        build_status="$pipeline_status"
        break
      fi
    done
  fi
  chmod 600 "$upgrade_build_log" || return $?

  if [ "$build_status" -ne 0 ]; then
    wiseeff_upgrade_write_build_failure_summary "$build_status" || return $?
    wiseeff_upgrade_state_write build_status failed || return $?
    return "$build_status"
  fi

  if wiseeff_upgrade_docker image inspect "$target_tag" >/dev/null; then
    :
  else
    build_status=$?
    wiseeff_upgrade_write_build_summary failed image-inspection \
      "The build command completed, but the commit-addressed candidate image is unavailable." \
      "Inspect the build log and Docker image store, then rerun apply." || return $?
    wiseeff_upgrade_state_write build_status failed || return $?
    return "$build_status"
  fi

  upgrade_candidate_image_tag="$target_tag"
  wiseeff_upgrade_state_write candidate_image_tag "$target_tag" || return $?
  wiseeff_upgrade_write_build_summary passed none \
    "The commit-addressed candidate image built successfully." \
    "No build-diagnostic action is required." || return $?
  wiseeff_upgrade_state_write build_status passed || return $?
}

wiseeff_upgrade_sanitize_diagnostic_stream() {
  sed -E \
    -e 's|([A-Za-z][A-Za-z0-9.+-]*://)[^/?#@[:space:]]+@|\1[REDACTED]@|g' \
    -e 's#(([Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Pp][Rr][Oo][Xx][Yy]-[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]):[[:space:]]*)([Bb][Ee][Aa][Rr][Ee][Rr]|[Bb][Aa][Ss][Ii][Cc])[[:space:]]+[^,[:space:]]*#\1\3 [REDACTED]#g' \
    -e 's#(([Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Pp][Rr][Oo][Xx][Yy]-[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]):[[:space:]]+)[^,[:space:]]*#\1[REDACTED]#g' \
    -e 's#("[^"]*([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Cc][Cc][Ee][Ss][Ss][_ -]*[Kk][Ee][Yy]|[Aa][Pp][Ii][_ -]*[Kk][Ee][Yy])[^"]*"[[:space:]]*:[[:space:]]*")[^"]*#\1[REDACTED]#g' \
    -e 's#(([[:alnum:]_]*([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Cc][Cc][Ee][Ss][Ss][_ -]*[Kk][Ee][Yy]|[Aa][Pp][Ii][_ -]*[Kk][Ee][Yy])[[:alnum:]_]*[=:][[:space:]]*))[Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]+[^,;[:space:]]*#\1[REDACTED]#g' \
    -e 's#(([[:alnum:]_]*([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Cc][Cc][Ee][Ss][Ss][_ -]*[Kk][Ee][Yy]|[Aa][Pp][Ii][_ -]*[Kk][Ee][Yy])[[:alnum:]_]*[=:][[:space:]]*))[Bb][Aa][Ss][Ii][Cc][[:space:]]+[^,;[:space:]]*#\1[REDACTED]#g' \
    -e 's#(([[:alnum:]_]*([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Cc][Cc][Ee][Ss][Ss][_ -]*[Kk][Ee][Yy]|[Aa][Pp][Ii][_ -]*[Kk][Ee][Yy])[[:alnum:]_]*[=:][[:space:]]*))("[^"]*"|'"'"'[^'"'"']*'"'"'|[^,;[:space:]]+)#\1[REDACTED]#g' \
    -e 's#(--([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Cc][Cc][Ee][Ss][Ss][-_ ]*[Kk][Ee][Yy]|[Aa][Pp][Ii][-_ ]*[Kk][Ee][Yy])([=]|[[:space:]]+))("[^"]*"|'"'"'[^'"'"']*'"'"'|[^,[:space:]]+)#\1[REDACTED]#g'
}

wiseeff_upgrade_write_build_summary() {
  local status="$1"
  local category="$2"
  local message="$3"
  local next_step="$4"
  local temp_path="${upgrade_build_summary}.tmp.$$"

  {
    printf 'status=%s\n' "$status"
    printf 'category=%s\n' "$category"
    printf 'message=%s\n' "$message"
    printf 'next_step=%s\n' "$next_step"
    printf 'build_tls_policy=%s\n' "$(wiseeff_build_network_tls_policy)"
    printf 'build_log=%s\n' "$upgrade_build_log"
  } > "$temp_path" || return $?
  chmod 600 "$temp_path" || return $?
  mv -f "$temp_path" "$upgrade_build_summary" || return $?
}

wiseeff_upgrade_write_build_failure_summary() {
  local exit_code="$1"
  local category="unclassified"
  local message="The candidate image build failed before downtime."
  local next_step="Review the end of the build log, correct the reported build error, then rerun apply."

  if grep -Eqi 'EUSAGE|package-lock\.json.*(not in sync|out of date)|npm ci.*lock' "$upgrade_build_log"; then
    category="dependency-lock"
    message="npm ci rejected a package.json/package-lock.json mismatch."
    next_step="Regenerate and commit package-lock.json with the repository npm version, then rerun apply."
  elif grep -Eqi 'SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|self signed certificate|certificate verify failed' "$upgrade_build_log"; then
    category="corporate-ca"
    message="The image build could not validate the package registry certificate chain."
    if [ "$(wiseeff_build_network_tls_policy)" = "insecure" ]; then
      next_step="Insecure build TLS was already authorized; inspect the failing downloader and route that host through an approved internal mirror before rerunning apply."
    else
      next_step="Set WISEEFF_BUILD_CA_CERT_FILE in .build-network.env to the organization-approved PEM, or explicitly configure the documented build-only insecure policy, then rerun apply."
    fi
  elif grep -Eqi 'EAI_AGAIN|ENOTFOUND|temporary failure in name resolution|could not resolve host' "$upgrade_build_log"; then
    category="dns"
    message="The Docker build could not resolve a required package or image host."
    next_step="Run ./scripts/build-network.sh status and check the managed proxy/no_proxy values. If the failed line is image metadata or an image pull, configure Docker daemon DNS/proxy separately; then rerun apply."
  elif grep -Eqi 'ETIMEDOUT|ECONNRESET|ECONNREFUSED|connection timed out|failed to connect' "$upgrade_build_log"; then
    category="network"
    message="The Docker build could not reach a required package or image endpoint."
    next_step="Run ./scripts/build-network.sh status and correct .build-network.env proxy/registry settings. If the failed line is image metadata or an image pull, configure the Docker daemon proxy separately; then rerun apply."
  elif grep -Eqi 'EINTEGRITY|integrity checksum failed|integrity check failed' "$upgrade_build_log"; then
    category="registry-integrity"
    message="npm reported a package integrity mismatch."
    next_step="Check registry/cache consistency and the committed lockfile; do not bypass integrity verification."
  elif grep -Eqi 'ETARGET|404 Not Found|No matching version found' "$upgrade_build_log"; then
    category="registry-package"
    message="The configured registry does not provide a package version required by the lockfile."
    next_step="Check registry synchronization and the locked package version, then rerun apply."
  elif grep -Eqi 'ENOSPC|no space left on device|no space left' "$upgrade_build_log"; then
    category="host-capacity"
    message="The candidate build ran out of Docker storage space or inodes."
    next_step="Free verified-unused Docker build storage or expand capacity, then rerun apply."
  elif grep -Eqi 'exit code: 137|exited with code 137|(^|[^0-9])Killed([^a-z]|$)' "$upgrade_build_log"; then
    category="memory"
    message="The candidate build was probably terminated by the host OOM killer."
    next_step="Check host/kernel OOM evidence and increase available build memory before rerunning apply."
  fi

  wiseeff_upgrade_write_build_summary failed "$category" \
    "${message} (build exit ${exit_code})" "$next_step"
}

wiseeff_upgrade_queue_command_for_tag() {
  local command="$1"
  local app_tag="$2"
  WISEEFF_APP_TAG="$app_tag" wiseeff_upgrade_compose run --rm --no-deps api npm run selfhost:queue-maintenance -- "$command" --timeout-ms "${WISEEFF_UPGRADE_DRAIN_TIMEOUT_MS:-120000}"
}

wiseeff_upgrade_compose_for_image() {
  local image_ref="$1"
  shift
  case "$image_ref" in
    *:*) ;;
    *)
      wiseeff_upgrade_die 70 "Invalid recorded application image reference: ${image_ref:-missing}"
      return $?
      ;;
  esac
  WISEEFF_APP_IMAGE="${image_ref%:*}" WISEEFF_APP_TAG="${image_ref##*:}" wiseeff_upgrade_compose "$@"
}

wiseeff_upgrade_queue_command_for_image() {
  local command="$1"
  local image_ref="$2"
  shift 2
  wiseeff_upgrade_compose_for_image "$image_ref" run --rm --no-deps api npm run selfhost:queue-maintenance -- "$command" --timeout-ms "${WISEEFF_UPGRADE_DRAIN_TIMEOUT_MS:-120000}" "$@"
}

wiseeff_upgrade_queue_command() {
  wiseeff_upgrade_queue_command_for_tag "$1" "$upgrade_target_sha"
}

wiseeff_upgrade_restore_queue() {
  if [ -n "${upgrade_candidate_image_tag:-}" ]; then
    if ! wiseeff_upgrade_run_recovery_action queue-resume wiseeff_upgrade_queue_command_for_image resume "$upgrade_candidate_image_tag"; then
      wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" queue recovery-queue-resume "The candidate queue could not be resumed during recovery."
      return 1
    fi
  fi
}

wiseeff_upgrade_candidate_data_plane_up() {
  local services=("$@")
  if [ "${#services[@]}" -eq 0 ]; then
    services=(postgres redis minio minio-init)
  fi
  WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose up -d --force-recreate --no-build "${services[@]}"
}

wiseeff_upgrade_previous_data_plane_up() {
  local image_ref="$1"
  shift
  local services=("$@")
  if [ "${#services[@]}" -eq 0 ]; then
    services=(postgres redis minio minio-init)
  fi
  wiseeff_upgrade_compose_for_image "$image_ref" up -d --force-recreate --no-build "${services[@]}"
}

wiseeff_upgrade_data_plane_failure_service() {
  local service container state health exit_code
  for service in postgres redis minio minio-init; do
    container="$(wiseeff_upgrade_compose ps -aq "$service" 2>/dev/null || true)"
    [ -n "$container" ] || continue
    case "$service" in
      postgres|redis)
        health="$(wiseeff_upgrade_docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
        if [ -n "$health" ] && [ "$health" != "healthy" ]; then
          printf '%s\n' "$service"
          return 0
        fi
        ;;
      minio)
        state="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
        case "$state" in
          running) ;;
          "") ;;
          *) printf '%s\n' minio; return 0 ;;
        esac
        ;;
      minio-init)
        state="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
        case "$state" in
          ""|running) ;;
          exited)
            exit_code="$(wiseeff_upgrade_docker inspect -f '{{.State.ExitCode}}' "$container" 2>/dev/null || true)"
            if [ -n "$exit_code" ] && [ "$exit_code" != "0" ]; then
              printf '%s\n' minio-init
              return 0
            fi
            ;;
          *)
            printf '%s\n' minio-init
            return 0
            ;;
        esac
        ;;
    esac
  done
  printf '%s\n' data-plane
}

wiseeff_upgrade_start_data_plane_with() {
  local failed_phase="$1"
  local failure_code="$2"
  local action_prefix="$3"
  shift 3

  if wiseeff_upgrade_run_recovery_action "${action_prefix}-all" "$@"; then
    return 0
  fi

  local failure_service
  failure_service="$(wiseeff_upgrade_data_plane_failure_service)"
  if [ "$failure_service" = "data-plane" ]; then
    wiseeff_upgrade_record_failure "$failed_phase" data-plane "$failure_code" \
      "The data-plane startup command failed, but no individual service failure could be isolated."
  else
    wiseeff_upgrade_record_failure "$failed_phase" "$failure_service" "$failure_code" \
      "The ${failure_service} data service could not be started; inspect its bounded diagnostic summary."
  fi
  return 1
}

wiseeff_upgrade_start_candidate_data_plane() {
  wiseeff_upgrade_start_data_plane_with restarting-data data-plane-compose-up candidate-data-plane-up \
    wiseeff_upgrade_candidate_data_plane_up
}

wiseeff_upgrade_stop_old_stack() {
  if ! wiseeff_upgrade_run_recovery_action quiesce-proxy-stop wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy; then
    wiseeff_upgrade_record_failure quiescing proxy quiesce-proxy-stop "The proxy could not be stopped before the recovery point was created."
    return 1
  fi
  if ! wiseeff_upgrade_run_recovery_action quiesce-queue-pause wiseeff_upgrade_queue_command pause; then
    wiseeff_upgrade_record_failure quiescing queue quiesce-queue-pause "The durable queue could not be paused before the recovery point was created."
    return 1
  fi
  if ! wiseeff_upgrade_run_recovery_action quiesce-queue-drain wiseeff_upgrade_queue_command drain; then
    wiseeff_upgrade_record_failure quiescing queue quiesce-queue-drain "The durable queue could not be drained before the recovery point was created."
    return 1
  fi
  local service
  for service in api worker web; do
    if ! wiseeff_upgrade_run_recovery_action "quiesce-${service}-stop" wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" "$service"; then
      wiseeff_upgrade_record_failure quiescing "$service" "quiesce-${service}-stop" "The ${service} service could not be stopped before the recovery point was created."
      return 1
    fi
  done
}

wiseeff_upgrade_probe_api() {
  local path="$1"
  local attempt
  for attempt in $(seq 1 "${WISEEFF_UPGRADE_HEALTH_ATTEMPTS:-60}"); do
    if wiseeff_upgrade_compose exec -T api curl -fsS "http://127.0.0.1:8787${path}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS:-2}"
  done
  return 1
}

wiseeff_upgrade_probe_web() {
  local attempt
  for attempt in $(seq 1 "${WISEEFF_UPGRADE_HEALTH_ATTEMPTS:-60}"); do
    if wiseeff_upgrade_compose exec -T web curl -fsS "http://127.0.0.1:5173/" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS:-2}"
  done
  return 1
}

wiseeff_upgrade_wait_data_service_healthy() {
  local service="$1"
  local container health attempt attempts
  container="$(wiseeff_upgrade_compose ps -aq "$service" 2>/dev/null || true)"
  attempts="${WISEEFF_UPGRADE_HEALTH_ATTEMPTS:-60}"
  [ "$attempts" -gt 0 ] || attempts=1
  if [ -z "$container" ]; then
    wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" "$service" "${service}-container-missing" "The ${service} container could not be identified."
    return 1
  fi
  for attempt in $(seq 1 "$attempts"); do
    health="$(wiseeff_upgrade_docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [ "$health" = "healthy" ]; then
      return 0
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "${WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS:-2}"
    fi
  done
  wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" "$service" "${service}-not-healthy" "Docker health status did not become healthy."
  return 1
}

wiseeff_upgrade_wait_object_store_ready() {
  local minio_container init_container minio_status init_status exit_code attempt attempts
  minio_container="$(wiseeff_upgrade_compose ps -aq minio 2>/dev/null || true)"
  init_container="$(wiseeff_upgrade_compose ps -aq minio-init 2>/dev/null || true)"
  attempts="${WISEEFF_UPGRADE_HEALTH_ATTEMPTS:-60}"
  [ "$attempts" -gt 0 ] || attempts=1
  if [ -z "$minio_container" ]; then
    wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-container-missing "The MinIO container could not be identified."
    return 1
  fi
  if [ -z "$init_container" ]; then
    wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio-init minio-init-container-missing "The minio-init container could not be identified."
    return 1
  fi

  for attempt in $(seq 1 "$attempts"); do
    minio_status="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$minio_container" 2>/dev/null || true)"
    if [ -z "$minio_status" ]; then
      wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-inspect-failed "The MinIO container state could not be inspected."
      return 1
    fi
    case "$minio_status" in
      running)
        break
        ;;
      exited|dead|restarting)
        wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-exited "The MinIO process exited unexpectedly (status=${minio_status})."
        return 1
        ;;
    esac
    if [ "$attempt" -eq "$attempts" ]; then
      wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-not-running "The MinIO process did not reach running state."
      return 1
    fi
    sleep "${WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS:-2}"
  done

  for attempt in $(seq 1 "$attempts"); do
    # MinIO and its initializer form one readiness unit. Re-checking MinIO on
    # every initializer poll prevents a stale first running observation from
    # being mistaken for object-store readiness.
    minio_status="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$minio_container" 2>/dev/null || true)"
    if [ -z "$minio_status" ]; then
      wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-inspect-failed "The MinIO container state could not be inspected."
      return 1
    fi
    case "$minio_status" in
      exited|dead|restarting)
        wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-exited "The MinIO process exited unexpectedly (status=${minio_status})."
        return 1
        ;;
      running) ;;
      *)
        wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-not-running "The MinIO process stopped being ready (status=${minio_status})."
        return 1
        ;;
    esac

    init_status="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$init_container" 2>/dev/null || true)"
    if [ -z "$init_status" ]; then
      wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio-init minio-init-inspect-failed "The minio-init container state could not be inspected."
      return 1
    fi
    if [ "$init_status" = "exited" ]; then
      exit_code="$(wiseeff_upgrade_docker inspect -f '{{.State.ExitCode}}' "$init_container" 2>/dev/null || true)"
      if [ "$exit_code" = "0" ]; then
        # The initializer is authoritative, but MinIO must still be alive at
        # the exact moment the readiness gate returns success.
        minio_status="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$minio_container" 2>/dev/null || true)"
        case "$minio_status" in
          running) return 0 ;;
          exited|dead|restarting) wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-exited "The MinIO process exited unexpectedly during final readiness verification (status=${minio_status})." ;;
          "") wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-inspect-failed "The MinIO process could not be inspected during final readiness verification." ;;
          *) wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio minio-not-running "The MinIO process was not running during final readiness verification (status=${minio_status})." ;;
        esac
        return 1
      fi
      wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio-init minio-init-failed "The minio-init container exited with code ${exit_code:-unknown}."
      return 1
    fi
    if [ "$init_status" = "dead" ]; then
      wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio-init minio-init-failed "The minio-init container entered dead state."
      return 1
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "${WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS:-2}"
    fi
  done
  wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" minio-init minio-init-timeout "The minio-init container did not exit successfully before the readiness timeout."
  return 1
}

wiseeff_upgrade_wait_data_service() {
  local service="$1"
  case "$service" in
    postgres|redis)
      wiseeff_upgrade_wait_data_service_healthy "$service"
      ;;
    minio|minio-init)
      wiseeff_upgrade_wait_object_store_ready
      ;;
    *)
      wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" "$service" data-service-unsupported "Unsupported data service readiness check."
      return 1
      ;;
  esac
}

wiseeff_upgrade_wait_data_plane_ready() {
  wiseeff_upgrade_wait_data_service postgres || return 1
  wiseeff_upgrade_wait_data_service redis || return 1
  wiseeff_upgrade_wait_object_store_ready || return 1
  printf 'Data plane ready: postgres healthy, redis healthy, MinIO running, minio-init exited 0.\n'
}

wiseeff_upgrade_probe_worker() {
  local attempt attempts container health
  attempts="${WISEEFF_UPGRADE_HEALTH_ATTEMPTS:-60}"
  [ "$attempts" -gt 0 ] || attempts=1
  for attempt in $(seq 1 "$attempts"); do
    if wiseeff_upgrade_compose exec -T worker curl -fsS http://127.0.0.1:8788/health/live >/dev/null 2>&1; then
      container="$(wiseeff_upgrade_compose ps -q worker 2>/dev/null || true)"
      health="$(wiseeff_upgrade_docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
      if [ "$health" = "healthy" ]; then
        return 0
      fi
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      sleep "${WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS:-2}"
    fi
  done
  return 1
}

wiseeff_upgrade_verify_parameter_catalog() {
  if wiseeff_upgrade_compose exec -T api npm run parameter-definitions:check -- --catalog-only; then
    return 0
  fi
  wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" api candidate-parameter-catalog "The canonical driver parameter catalog verification gate is blocked."
  return 1
}

wiseeff_upgrade_verify_candidate_app_readiness() {
  if ! wiseeff_upgrade_probe_api /health/ready; then
    wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" api candidate-api-ready "The candidate API readiness probe failed."
    return 1
  fi
  if ! wiseeff_upgrade_verify_parameter_catalog; then
    return 1
  fi
  if ! wiseeff_upgrade_probe_worker; then
    wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" worker candidate-worker-health "The candidate worker liveness or Docker health probe failed."
    return 1
  fi
  if ! wiseeff_upgrade_probe_web; then
    wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" web candidate-web-direct "The candidate web direct probe failed."
    return 1
  fi
}

wiseeff_upgrade_snapshot_postgres() {
  local output_dir="${upgrade_backup_dir}/postgres"
  mkdir -p "$output_dir" || return $?
  local partial="${output_dir}/wiseeff.dump.part"
  local dump="${output_dir}/wiseeff.dump"
  wiseeff_upgrade_compose exec -T postgres pg_dump -U wiseeff -d wiseeff --format=custom > "$partial" || return $?
  wiseeff_upgrade_compose exec -T postgres pg_restore --list < "$partial" >/dev/null || return $?
  mv -f "$partial" "$dump" || return $?
  wiseeff_upgrade_state_write postgres_backup "$dump" || return $?
}

wiseeff_upgrade_snapshot_objects() {
  local output_dir="${upgrade_backup_dir}/object-store"
  local network
  mkdir -p "$output_dir" || return $?
  network="$(wiseeff_upgrade_state_read network)"
  local image="${WISEEFF_BACKUP_MC_IMAGE:-minio/mc:RELEASE.2024-11-21T17-21-54Z}"
  local endpoint bucket
  endpoint="$(wiseeff_upgrade_env_value OBJECT_STORAGE_ENDPOINT)"
  bucket="$(wiseeff_upgrade_env_value OBJECT_STORAGE_BUCKET)"
  [ -n "$endpoint" ] && [ -n "$bucket" ] || {
    wiseeff_upgrade_die 40 "Object-store backup requires endpoint and bucket."
    return $?
  }
  wiseeff_upgrade_docker run --rm --network "$network" --env-file "$upgrade_env_file" -v "${output_dir}:/backup" --entrypoint /bin/sh "$image" -lc \
    'mc alias set live "$OBJECT_STORAGE_ENDPOINT" "$OBJECT_STORAGE_ACCESS_KEY_ID" "$OBJECT_STORAGE_SECRET_ACCESS_KEY" >/dev/null && mc mirror --overwrite "live/$OBJECT_STORAGE_BUCKET" /backup/data >/dev/null' || return $?
  local manifest="${output_dir}/manifest.sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$output_dir" && find data -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$manifest" || return $?
  else
    (cd "$output_dir" && find data -type f -print0 | sort -z | xargs -0 -r shasum -a 256) > "$manifest" || return $?
  fi
  if [ ! -s "$manifest" ]; then
    printf '%s\n' "# empty object store" > "$manifest" || return $?
  fi
  wiseeff_upgrade_state_write object_backup "$output_dir" || return $?
}

wiseeff_upgrade_snapshot_redis() {
  if [ "$(wiseeff_upgrade_env_value LOG_ANALYSIS_QUEUE_MODE)" != "durable" ] && [ "$(wiseeff_upgrade_env_value NOTIFICATION_QUEUE_MODE)" != "durable" ]; then
    wiseeff_upgrade_state_write redis_backup skipped
    return 0
  fi
  local output_dir="${upgrade_backup_dir}/redis"
  local container
  mkdir -p "$output_dir" || return $?
  wiseeff_upgrade_compose exec -T redis redis-cli SAVE >/dev/null || return $?
  container="$(wiseeff_upgrade_state_read container_redis)"
  wiseeff_upgrade_docker cp "${container}:/data/." "${output_dir}/data.part" || return $?
  wiseeff_upgrade_docker cp "${container}:/data/dump.rdb" "${output_dir}/dump.rdb.part" || return $?
  wiseeff_upgrade_compose exec -T redis redis-check-rdb /data/dump.rdb >/dev/null || return $?
  mv -f "${output_dir}/dump.rdb.part" "${output_dir}/dump.rdb" || return $?
  mv -f "${output_dir}/data.part" "${output_dir}/data" || return $?
  wiseeff_upgrade_state_write redis_backup "${output_dir}" || return $?
}

wiseeff_upgrade_snapshot_manifest() {
  local manifest="${upgrade_backup_dir}/manifest.sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$upgrade_backup_dir" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 -r sha256sum) > "$manifest" || return $?
  else
    (cd "$upgrade_backup_dir" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 -r shasum -a 256) > "$manifest" || return $?
  fi
  chmod 600 "$manifest" || return $?
  wiseeff_upgrade_state_write recovery_point_verified true || return $?
}

wiseeff_upgrade_verify_backup_manifest() {
  local manifest="${upgrade_backup_dir}/manifest.sha256"
  [ -s "$manifest" ] || {
    wiseeff_upgrade_die 40 "Recovery-point manifest is missing: ${manifest}"
    return $?
  }
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$upgrade_backup_dir" && sha256sum -c manifest.sha256 >/dev/null)
  else
    (cd "$upgrade_backup_dir" && shasum -a 256 -c manifest.sha256 >/dev/null)
  fi
}

wiseeff_upgrade_previous_image_tag_for() {
  local service="$1"
  local tag
  tag="$(wiseeff_upgrade_state_read "previous_image_tag_${service}")"
  [ -n "$tag" ] || tag="$(wiseeff_upgrade_state_read previous_image_tag)"
  printf '%s\n' "$tag"
}

wiseeff_upgrade_previous_image_id_for() {
  local service="$1"
  local image_id
  image_id="$(wiseeff_upgrade_state_read "previous_image_id_${service}")"
  [ -n "$image_id" ] || image_id="$(wiseeff_upgrade_state_read "image_${service}")"
  printf '%s\n' "$image_id"
}

wiseeff_upgrade_recreate_previous_app_services() {
  local service tag
  for service in api worker web; do
    tag="$(wiseeff_upgrade_previous_image_tag_for "$service")"
    [ -n "$tag" ] || {
      wiseeff_upgrade_record_failure old-stack-restore "$service" "restore-${service}-image-missing" "The previous ${service} image identity is missing."
      return 1
    }
    if ! wiseeff_upgrade_compose_for_image "$tag" up -d --force-recreate --no-build --no-deps "$service"; then
      wiseeff_upgrade_record_failure old-stack-restore "$service" "restore-${service}-recreate" "The previous ${service} container could not be recreated."
      return 1
    fi
  done
}

wiseeff_upgrade_verify_previous_app_images() {
  local service container expected expected_id actual actual_id
  for service in api worker web; do
    expected="$(wiseeff_upgrade_previous_image_tag_for "$service")"
    expected_id="$(wiseeff_upgrade_previous_image_id_for "$service")"
    container="$(wiseeff_upgrade_compose ps -q "$service" 2>/dev/null || true)"
    if [ -z "$container" ]; then
      wiseeff_upgrade_record_failure old-stack-restore "$service" "restore-${service}-container-missing" "The restored ${service} container could not be identified."
      return 1
    fi
    if [ -z "$expected_id" ]; then
      wiseeff_upgrade_record_failure old-stack-restore "$service" "restore-${service}-image-id-missing" "The recorded previous ${service} image ID is missing."
      return 1
    fi
    actual="$(wiseeff_upgrade_docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)"
    actual_id="$(wiseeff_upgrade_docker inspect -f '{{.Image}}' "$container" 2>/dev/null || true)"
    if [ "$actual" != "$expected" ] || [ "$actual_id" != "$expected_id" ]; then
      wiseeff_upgrade_record_failure old-stack-restore "$service" "restore-${service}-image-mismatch" "The restored ${service} image identity did not match the recorded previous image."
      return 1
    fi
  done
}

wiseeff_upgrade_verify_restored_stack() {
  local previous_api_tag
  previous_api_tag="$(wiseeff_upgrade_previous_image_tag_for api)"
  if ! wiseeff_upgrade_wait_data_plane_ready; then
    return 1
  fi
  if ! wiseeff_upgrade_probe_api /health/live; then
    wiseeff_upgrade_record_failure old-stack-restore api restore-api-live "The restored API liveness probe failed."
    return 1
  fi
  if ! wiseeff_upgrade_probe_api /health/ready; then
    wiseeff_upgrade_record_failure old-stack-restore api restore-api-ready "The restored API readiness probe failed."
    return 1
  fi
  if ! wiseeff_upgrade_probe_worker; then
    wiseeff_upgrade_record_failure old-stack-restore worker restore-worker-health "The restored worker liveness or Docker health probe failed."
    return 1
  fi
  if ! wiseeff_upgrade_probe_web; then
    wiseeff_upgrade_record_failure old-stack-restore web restore-web-direct "The restored web direct probe failed."
    return 1
  fi
  if ! wiseeff_upgrade_verify_previous_app_images; then
    return 1
  fi
  if ! wiseeff_upgrade_run_recovery_action restore-queue-resume wiseeff_upgrade_queue_command_for_image resume "$previous_api_tag"; then
    wiseeff_upgrade_record_failure old-stack-restore queue restore-queue-resume "The durable queue could not be resumed after restoring the previous stack."
    return 1
  fi
  if ! wiseeff_upgrade_compose_for_image "$previous_api_tag" up -d --force-recreate --no-build --no-deps proxy; then
    wiseeff_upgrade_record_failure old-stack-restore proxy restore-proxy-recreate "The previous proxy could not be recreated."
    return 1
  fi
  if ! wiseeff_upgrade_public_probe; then
    wiseeff_upgrade_record_failure old-stack-restore proxy restore-proxy-public "The restored proxy/public health probe failed."
    return 1
  fi
}

wiseeff_upgrade_restore_old_stack_after_stop() {
  local previous_sha previous_api_tag
  wiseeff_upgrade_state_write recovery_started true
  wiseeff_upgrade_state_write recovery_verified false
  wiseeff_upgrade_set_phase old-stack-restore running || return 70
  previous_sha="$(wiseeff_upgrade_state_read previous_sha)"
  previous_api_tag="$(wiseeff_upgrade_previous_image_tag_for api)"
  [ -n "$previous_sha" ] && [ -n "$previous_api_tag" ] || {
    wiseeff_upgrade_record_failure old-stack-restore recovery restore-previous-image-missing "Previous checkout or application image identity is missing."
    wiseeff_upgrade_mark_recovery_required
    return 70
  }
  upgrade_recovery_queue_image_tag="$previous_api_tag"
  if ! wiseeff_upgrade_git checkout --detach "$previous_sha"; then
    wiseeff_upgrade_record_failure old-stack-restore checkout restore-checkout "The previous checkout could not be selected."
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_start_data_plane_with old-stack-restore restore-data-compose restore-data-plane-up \
    wiseeff_upgrade_previous_data_plane_up "$previous_api_tag"; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_wait_data_plane_ready; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_recreate_previous_app_services; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_verify_restored_stack; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_state_write recovery_verified true
  wiseeff_upgrade_set_phase old-stack-restored old-stack-restored || return $?
  wiseeff_upgrade_state_write next_action none || return $?
  wiseeff_upgrade_write_status "$upgrade_run_id" || return $?
}

wiseeff_upgrade_load_run() {
  wiseeff_upgrade_ensure_run_id
  local state_root
  state_root="$(wiseeff_upgrade_state_root)"
  upgrade_run_dir="${state_root}/${upgrade_run_id}"
  if [ ! -d "$upgrade_run_dir" ]; then
    wiseeff_upgrade_die 10 "Run not found: ${upgrade_run_id}"
    return $?
  fi
  upgrade_previous_sha="$(wiseeff_upgrade_state_read previous_sha)"
  upgrade_target_sha="$(wiseeff_upgrade_state_read target_sha)"
  upgrade_backup_dir="$(wiseeff_upgrade_state_read backup_dir)"
  upgrade_runtime_network="$(wiseeff_upgrade_state_read runtime_network)"
  upgrade_compose_project="$(wiseeff_upgrade_state_read compose_project)"
  upgrade_candidate_image_tag="$(wiseeff_upgrade_state_read candidate_image_tag)"
  upgrade_previous_image_tag="$(wiseeff_upgrade_state_read previous_image_tag)"
  [ -n "$upgrade_previous_sha" ] && [ -n "$upgrade_target_sha" ] || {
    wiseeff_upgrade_die 10 "Run ${upgrade_run_id} has incomplete upgrade metadata."
    return $?
  }
}

wiseeff_upgrade_record_build_transport_completion() {
  local policy
  policy="$(wiseeff_upgrade_state_read build_tls_policy)"
  [ -n "$policy" ] || policy="verify"
  if [ "$policy" = "insecure" ]; then
    wiseeff_upgrade_state_write completed_with_insecure_build_transport true
    wiseeff_upgrade_event completed-with-insecure-build-transport "runtime-tls=unchanged"
  else
    wiseeff_upgrade_state_write completed_with_insecure_build_transport false
  fi
}

wiseeff_upgrade_complete_candidate() {
  local previous_phase completion_action completion_outcome
  previous_phase="$(wiseeff_upgrade_state_read phase)"
  completion_action="${upgrade_action:-resume}"
  completion_outcome=running
  if [ "$completion_action" = "recover-candidate" ]; then
    completion_outcome=recovery-required
  fi
  wiseeff_upgrade_set_phase validating-public "$completion_outcome"
  if ! wiseeff_upgrade_public_probe; then
    wiseeff_upgrade_mark_recovery_required proxy candidate-proxy-public "The candidate proxy/public health probe failed."
    return 70
  fi
  if ! wiseeff_upgrade_verify_final_state; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if [ "$completion_action" = "recover-candidate" ]; then
    wiseeff_upgrade_state_write recovery_verified true
  fi
  wiseeff_upgrade_state_write outcome completed
  wiseeff_upgrade_record_build_transport_completion
  wiseeff_upgrade_state_write next_action none
  wiseeff_upgrade_set_phase completed completed
  wiseeff_upgrade_write_status "$upgrade_run_id"
  if [ "$upgrade_json" = "true" ]; then
    printf '{"action":"%s","status":"completed","runId":"%s","targetSha":"%s"}\n' "$completion_action" "$upgrade_run_id" "$upgrade_target_sha"
  elif [ "$completion_action" = "recover-candidate" ]; then
    printf 'Candidate recovery completed. run_id=%s target=%s (from %s)\n' "$upgrade_run_id" "$upgrade_target_sha" "$previous_phase"
  else
    printf 'Upgrade resumed and completed. run_id=%s target=%s (from %s)\n' "$upgrade_run_id" "$upgrade_target_sha" "$previous_phase"
  fi
}

wiseeff_upgrade_prepare_candidate_resume_traffic() {
  local phase
  phase="$(wiseeff_upgrade_state_read phase)"
  if ! wiseeff_upgrade_run_recovery_action candidate-proxy-isolation \
    wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy; then
    wiseeff_upgrade_record_failure "$phase" proxy candidate-proxy-isolation \
      "The candidate proxy could not be isolated before readiness verification."
    wiseeff_upgrade_mark_recovery_required
    return 1
  fi
  if ! wiseeff_upgrade_verify_candidate_app_readiness; then
    wiseeff_upgrade_mark_recovery_required
    return 1
  fi
}

wiseeff_upgrade_candidate_recovery_phase_supported() {
  case "${1:-}" in
    queue-resumed|starting-proxy|validating-public|candidate-recovery-isolating|candidate-recovery-verifying|candidate-recovery-starting-worker|candidate-recovery-validating-app|candidate-recovery-resuming-queue|candidate-recovery-starting-proxy)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

wiseeff_upgrade_candidate_recovery_inflight_phase_supported() {
  case "${1:-}" in
    candidate-recovery-isolating|candidate-recovery-verifying|candidate-recovery-starting-worker|candidate-recovery-validating-app|candidate-recovery-resuming-queue|candidate-recovery-starting-proxy)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

wiseeff_upgrade_run_recover_candidate() {
  wiseeff_upgrade_reject_root_runtime || return $?
  wiseeff_upgrade_load_run || return $?
  wiseeff_upgrade_acquire_lock
  trap wiseeff_upgrade_release_lock EXIT
  wiseeff_upgrade_validate_env || return 10

  local outcome phase migration_started failed_phase recovery_point_verified candidate_image expected_image
  local proxy_stop_status=0 queue_pause_status=0 worker_stop_status=0
  local isolation_service isolation_code isolation_summary
  outcome="$(wiseeff_upgrade_state_read outcome)"
  phase="$(wiseeff_upgrade_state_read phase)"
  migration_started="$(wiseeff_upgrade_state_read migration_started)"
  failed_phase="$(wiseeff_upgrade_state_read failed_phase)"
  recovery_point_verified="$(wiseeff_upgrade_state_read recovery_point_verified)"
  candidate_image="$upgrade_candidate_image_tag"

  if [ "$migration_started" != "true" ] ||
    ! { { [ "$outcome" = "recovery-required" ] && wiseeff_upgrade_candidate_recovery_phase_supported "$failed_phase"; } ||
      { [ "$outcome" = "running" ] && wiseeff_upgrade_candidate_recovery_inflight_phase_supported "$phase"; }; }; then
    wiseeff_upgrade_die 70 "Run ${upgrade_run_id} is not eligible for candidate recovery; keep traffic isolated and use the recorded next action."
    return $?
  fi
  if [ "$recovery_point_verified" != "true" ]; then
    wiseeff_upgrade_die 70 "Run ${upgrade_run_id} has no verified recovery point and is not eligible for candidate recovery."
    return $?
  fi
  if [ -z "$candidate_image" ]; then
    wiseeff_upgrade_die 70 "Run ${upgrade_run_id} has no recorded candidate image identity."
    return $?
  fi
  if [ "$upgrade_confirm" != "recover-candidate-${upgrade_run_id}" ]; then
    wiseeff_upgrade_die 2 "Candidate recovery requires --confirm recover-candidate-${upgrade_run_id}."
    return $?
  fi

  upgrade_recovery_queue_image_tag="$candidate_image"
  wiseeff_upgrade_state_write recovery_started true
  wiseeff_upgrade_state_write recovery_verified false
  wiseeff_upgrade_set_phase candidate-recovery-isolating recovery-required

  if wiseeff_upgrade_run_recovery_action candidate-recovery-proxy-stop \
    wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy; then
    :
  else
    proxy_stop_status=$?
  fi
  if wiseeff_upgrade_run_recovery_action candidate-recovery-queue-pause \
    wiseeff_upgrade_queue_command_for_image pause "$candidate_image"; then
    :
  else
    queue_pause_status=$?
  fi
  if wiseeff_upgrade_run_recovery_action candidate-recovery-worker-stop \
    wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" worker; then
    :
  else
    worker_stop_status=$?
  fi
  wiseeff_upgrade_state_write recovery_proxy_stopped "$([ "$proxy_stop_status" -eq 0 ] && printf true || printf false)"
  wiseeff_upgrade_state_write recovery_queue_paused "$([ "$queue_pause_status" -eq 0 ] && [ "$worker_stop_status" -eq 0 ] && printf true || printf false)"
  if [ "$proxy_stop_status" -ne 0 ] || [ "$queue_pause_status" -ne 0 ] || [ "$worker_stop_status" -ne 0 ]; then
    isolation_service=recovery
    isolation_code=candidate-recovery-isolation
    isolation_summary="Candidate recovery isolation did not complete; inspect recovery_failure_summary and isolate traffic before retrying."
    if [ "$proxy_stop_status" -ne 0 ]; then
      isolation_service=proxy
      isolation_code=candidate-recovery-proxy-stop
      isolation_summary="The proxy could not be stopped before candidate recovery."
    elif [ "$queue_pause_status" -ne 0 ]; then
      isolation_service=queue
      isolation_code=candidate-recovery-queue-pause
      isolation_summary="The durable queue could not be paused before candidate recovery."
    elif [ "$worker_stop_status" -ne 0 ]; then
      isolation_service=worker
      isolation_code=candidate-recovery-worker-stop
      isolation_summary="The worker could not be stopped before candidate recovery."
    fi
    wiseeff_upgrade_record_failure candidate-recovery-isolating "$isolation_service" "$isolation_code" "$isolation_summary"
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi

  wiseeff_upgrade_set_phase candidate-recovery-verifying recovery-required
  if ! wiseeff_upgrade_run_recovery_action candidate-recovery-manifest wiseeff_upgrade_verify_backup_manifest; then
    wiseeff_upgrade_record_failure candidate-recovery-verifying recovery-point candidate-recovery-manifest "The recorded recovery-point manifest could not be verified before candidate recovery."
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  expected_image="$(wiseeff_upgrade_docker image inspect --format '{{.Id}}' "$candidate_image" 2>/dev/null || true)"
  if [ -z "$expected_image" ]; then
    wiseeff_upgrade_record_failure candidate-recovery-verifying image candidate-image-unavailable "The recorded candidate application image is not available locally."
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_git checkout --detach "$upgrade_target_sha"; then
    wiseeff_upgrade_record_failure candidate-recovery-verifying checkout candidate-recovery-checkout "The recorded target checkout could not be selected for candidate recovery."
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi

  wiseeff_upgrade_set_phase candidate-recovery-starting-worker recovery-required
  if ! wiseeff_upgrade_compose_for_image "$candidate_image" up -d --force-recreate --no-build --no-deps worker; then
    wiseeff_upgrade_record_failure candidate-recovery-starting-worker worker candidate-worker-recreate "The candidate worker could not be recreated during candidate recovery."
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_set_phase candidate-recovery-validating-app recovery-required
  if ! wiseeff_upgrade_prepare_candidate_resume_traffic; then
    return 70
  fi

  wiseeff_upgrade_set_phase candidate-recovery-resuming-queue recovery-required
  if ! wiseeff_upgrade_run_recovery_action candidate-recovery-queue-resume \
    wiseeff_upgrade_queue_command_for_image resume "$candidate_image"; then
    wiseeff_upgrade_record_failure candidate-recovery-resuming-queue queue candidate-queue-resume "The candidate durable queue could not be resumed during candidate recovery."
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_set_phase queue-resumed recovery-required

  wiseeff_upgrade_set_phase candidate-recovery-starting-proxy recovery-required
  if ! wiseeff_upgrade_compose_for_image "$candidate_image" up -d --force-recreate --no-build --no-deps proxy; then
    wiseeff_upgrade_record_failure candidate-recovery-starting-proxy proxy candidate-proxy-recreate "The candidate proxy could not be recreated during candidate recovery."
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_complete_candidate
}

wiseeff_upgrade_run_resume() {
  wiseeff_upgrade_reject_root_runtime || return $?
  wiseeff_upgrade_load_run || return $?
  wiseeff_upgrade_acquire_lock
  trap wiseeff_upgrade_release_lock EXIT
  wiseeff_upgrade_validate_env || return 10

  local outcome phase migration_started candidate_image
  outcome="$(wiseeff_upgrade_state_read outcome)"
  phase="$(wiseeff_upgrade_state_read phase)"
  migration_started="$(wiseeff_upgrade_state_read migration_started)"
  if [ "$outcome" = "completed" ] || [ "$outcome" = "old-stack-restored" ] || [ "$outcome" = "rolled-back" ]; then
    wiseeff_upgrade_status "$upgrade_run_id"
    return 0
  fi
  if [ "$outcome" = "recovery-required" ] && [ "$migration_started" = "true" ]; then
    wiseeff_upgrade_status "$upgrade_run_id"
    return 70
  fi

  if [ "$migration_started" != "true" ]; then
    wiseeff_upgrade_restore_old_stack_after_stop
    return $?
  fi

  [ -n "$upgrade_candidate_image_tag" ] || {
    wiseeff_upgrade_die 70 "Candidate image identity is missing; manual recovery is required."
    return $?
  }
  wiseeff_upgrade_git checkout --detach "$upgrade_target_sha" >/dev/null
  candidate_image="$upgrade_candidate_image_tag"
  if [ "$phase" = "migrating" ]; then
    local api_container api_state
    api_container="$(wiseeff_upgrade_compose ps -q api 2>/dev/null || true)"
    api_state=""
    [ -n "$api_container" ] && api_state="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$api_container" 2>/dev/null || true)"
    if [ "$api_state" != "running" ]; then
      if ! wiseeff_upgrade_compose_for_image "$candidate_image" up -d --no-build api; then
        wiseeff_upgrade_mark_recovery_required api candidate-api-recreate "The candidate API container could not be recreated during resume."
        return 70
      fi
    fi
    if ! wiseeff_upgrade_probe_api /health/live; then
      wiseeff_upgrade_mark_recovery_required api candidate-api-live "The candidate API liveness probe failed during resume."
      return 70
    fi
    wiseeff_upgrade_set_phase api-ready complete
    phase="api-ready"
  fi
  if [ "$phase" = "api-ready" ]; then
    wiseeff_upgrade_set_phase starting-app-services running
    if ! wiseeff_upgrade_compose_for_image "$candidate_image" up -d --force-recreate --no-build --no-deps web worker; then
      wiseeff_upgrade_mark_recovery_required app-services candidate-app-services-recreate "The candidate web or worker containers could not be recreated during resume."
      return 70
    fi
    if ! wiseeff_upgrade_verify_candidate_app_readiness; then
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    wiseeff_upgrade_set_phase app-services-ready complete
    phase="app-services-ready"
  fi
  if [ "$phase" = "app-services-ready" ]; then
    if ! wiseeff_upgrade_verify_candidate_app_readiness; then
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    wiseeff_upgrade_set_phase resuming-queue running
    if ! wiseeff_upgrade_run_recovery_action candidate-queue-resume wiseeff_upgrade_queue_command_for_image resume "$candidate_image"; then
      wiseeff_upgrade_mark_recovery_required queue candidate-queue-resume "The candidate durable queue could not be resumed during resume."
      return 70
    fi
    wiseeff_upgrade_set_phase queue-resumed complete
    phase="queue-resumed"
  fi
  if [ "$phase" = "queue-resumed" ] || [ "$phase" = "starting-proxy" ] || [ "$phase" = "validating-public" ]; then
    if ! wiseeff_upgrade_prepare_candidate_resume_traffic; then
      return 70
    fi
    wiseeff_upgrade_set_phase starting-proxy running
    if ! wiseeff_upgrade_compose_for_image "$candidate_image" up -d --force-recreate --no-build --no-deps proxy; then
      wiseeff_upgrade_mark_recovery_required proxy candidate-proxy-recreate "The candidate proxy could not be recreated during resume."
      return 70
    fi
    wiseeff_upgrade_complete_candidate
    return $?
  fi

  wiseeff_upgrade_die 70 "Run ${upgrade_run_id} is at unsupported recovery phase ${phase}; use rollback with the printed token."
  return $?
}

wiseeff_upgrade_restore_postgres() {
  local dump
  dump="$(wiseeff_upgrade_state_read postgres_backup)"
  [ -f "$dump" ] || { wiseeff_upgrade_die 40 "PostgreSQL recovery point is missing: ${dump}"; return $?; }
  wiseeff_upgrade_compose exec -T postgres pg_restore --clean --if-exists --no-owner --exit-on-error -U wiseeff -d wiseeff < "$dump"
}

wiseeff_upgrade_restore_objects() {
  local object_dir network image
  object_dir="$(wiseeff_upgrade_state_read object_backup)"
  [ -d "${object_dir}/data" ] || { wiseeff_upgrade_die 40 "Object-store recovery point is missing: ${object_dir}"; return $?; }
  network="$(wiseeff_upgrade_state_read network)"
  image="${WISEEFF_BACKUP_MC_IMAGE:-minio/mc:RELEASE.2024-11-21T17-21-54Z}"
  wiseeff_upgrade_docker run --rm --network "$network" --env-file "$upgrade_env_file" -v "${object_dir}/data:/backup/data:ro" --entrypoint /bin/sh "$image" -lc \
    'mc alias set live "$OBJECT_STORAGE_ENDPOINT" "$OBJECT_STORAGE_ACCESS_KEY_ID" "$OBJECT_STORAGE_SECRET_ACCESS_KEY" >/dev/null && mc mirror --remove --overwrite /backup/data "live/$OBJECT_STORAGE_BUCKET" >/dev/null'
}

wiseeff_upgrade_restore_redis() {
  local redis_dir container
  redis_dir="$(wiseeff_upgrade_state_read redis_backup)"
  [ "$redis_dir" = "skipped" ] && return 0
  [ -d "${redis_dir}/data" ] || { wiseeff_upgrade_die 40 "Redis recovery point is missing: ${redis_dir}"; return $?; }
  container="$(wiseeff_upgrade_compose ps -aq redis)" || return $?
  [ -n "$container" ] || { wiseeff_upgrade_die 40 "Redis container is unavailable for recovery."; return $?; }
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" redis || return $?
  wiseeff_upgrade_docker start "$container" || return $?
  wiseeff_upgrade_docker exec "$container" sh -lc 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +' || return $?
  wiseeff_upgrade_docker cp "${redis_dir}/data/." "${container}:/data/" || return $?
  wiseeff_upgrade_compose exec -T redis redis-check-rdb /data/dump.rdb || return $?
}

wiseeff_upgrade_run_rollback() {
  wiseeff_upgrade_reject_root_runtime || return $?
  wiseeff_upgrade_load_run || return $?
  wiseeff_upgrade_acquire_lock
  trap wiseeff_upgrade_release_lock EXIT
  wiseeff_upgrade_validate_env || return 10

  local outcome migration_started previous_api_tag isolation_service isolation_code isolation_summary
  local proxy_stop_status=0 queue_pause_status=0 worker_stop_status=0 app_stop_status=0
  outcome="$(wiseeff_upgrade_state_read outcome)"
  migration_started="$(wiseeff_upgrade_state_read migration_started)"
  if [ "$outcome" = "rolled-back" ]; then
    wiseeff_upgrade_status "$upgrade_run_id"
    return 0
  fi
  if [ "$migration_started" = "true" ] && [ "$upgrade_restore_data" != "true" ]; then
    wiseeff_upgrade_die 2 "This run started migrations. Use --restore-data --confirm restore-${upgrade_run_id} to restore the recorded recovery point."
    return $?
  fi
  if [ "$upgrade_restore_data" = "true" ] && [ "$upgrade_confirm" != "restore-${upgrade_run_id}" ]; then
    wiseeff_upgrade_die 2 "Data restore requires --confirm restore-${upgrade_run_id}."
    return $?
  fi

  previous_api_tag="$(wiseeff_upgrade_previous_image_tag_for api)"
  [ -n "$previous_api_tag" ] || { wiseeff_upgrade_die 70 "Previous application image identity is missing."; return $?; }
  upgrade_recovery_queue_image_tag="$previous_api_tag"
  wiseeff_upgrade_state_write recovery_started true
  wiseeff_upgrade_state_write recovery_verified false
  wiseeff_upgrade_set_phase rollback-stopping running

  if wiseeff_upgrade_run_recovery_action proxy-stop wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy; then
    :
  else
    proxy_stop_status=$?
  fi
  if wiseeff_upgrade_run_recovery_action queue-pause wiseeff_upgrade_queue_command_for_image pause "$previous_api_tag"; then
    :
  else
    queue_pause_status=$?
  fi
  if wiseeff_upgrade_run_recovery_action worker-stop wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" worker; then
    :
  else
    worker_stop_status=$?
    if [ "$queue_pause_status" -eq 0 ]; then
      queue_pause_status="$worker_stop_status"
    fi
  fi
  if wiseeff_upgrade_run_recovery_action app-stop wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" api web; then
    :
  else
    app_stop_status=$?
  fi
  wiseeff_upgrade_state_write recovery_proxy_stopped "$([ "$proxy_stop_status" -eq 0 ] && printf true || printf false)"
  wiseeff_upgrade_state_write recovery_queue_paused "$([ "$queue_pause_status" -eq 0 ] && printf true || printf false)"
  if [ "$proxy_stop_status" -ne 0 ] || [ "$queue_pause_status" -ne 0 ] || [ "$app_stop_status" -ne 0 ]; then
    isolation_service=recovery
    isolation_code=rollback-isolation
    isolation_summary="Rollback isolation did not complete; inspect recovery_failure_summary and isolate traffic before retrying."
    if [ "$proxy_stop_status" -ne 0 ]; then
      isolation_service=proxy
      isolation_code=rollback-proxy-stop
      isolation_summary="The proxy could not be stopped before rollback data restoration."
    elif [ "$queue_pause_status" -ne 0 ]; then
      isolation_service=queue
      isolation_code=rollback-queue-pause
      isolation_summary="The queue or worker traffic could not be isolated before rollback data restoration."
    elif [ "$app_stop_status" -ne 0 ]; then
      isolation_service=app-services
      isolation_code=rollback-app-stop
      isolation_summary="The application services could not be stopped before rollback data restoration."
    fi
    wiseeff_upgrade_record_failure rollback-stopping "$isolation_service" "$isolation_code" "$isolation_summary"
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi

  wiseeff_upgrade_set_phase old-stack-restore running
  if ! wiseeff_upgrade_git checkout --detach "$upgrade_previous_sha"; then
    wiseeff_upgrade_record_failure old-stack-restore checkout restore-checkout "The previous checkout could not be selected for rollback."
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_start_data_plane_with old-stack-restore rollback-data-compose rollback-data-plane-up \
    wiseeff_upgrade_previous_data_plane_up "$previous_api_tag"; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_wait_data_plane_ready || {
    wiseeff_upgrade_mark_recovery_required
    return 70
  }
  if [ "$upgrade_restore_data" = "true" ]; then
    wiseeff_upgrade_set_phase restoring-data running
    if ! wiseeff_upgrade_run_recovery_action restore-recovery-point wiseeff_upgrade_verify_backup_manifest; then
      wiseeff_upgrade_record_failure restoring-data recovery-point rollback-backup-manifest "The recorded recovery-point manifest could not be verified."
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    if ! wiseeff_upgrade_run_recovery_action restore-postgres wiseeff_upgrade_restore_postgres; then
      wiseeff_upgrade_record_failure restoring-data postgres rollback-postgres-restore "The PostgreSQL recovery point could not be restored."
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    if ! wiseeff_upgrade_run_recovery_action restore-minio wiseeff_upgrade_restore_objects; then
      wiseeff_upgrade_record_failure restoring-data minio rollback-minio-restore "The object-store recovery point could not be restored."
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    if ! wiseeff_upgrade_run_recovery_action restore-redis wiseeff_upgrade_restore_redis; then
      wiseeff_upgrade_record_failure restoring-data redis rollback-redis-restore "The Redis recovery point could not be restored."
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    if ! wiseeff_upgrade_run_recovery_action snapshot-recovery-point wiseeff_upgrade_snapshot_manifest; then
      wiseeff_upgrade_record_failure restoring-data recovery-point rollback-manifest-write "The post-restore recovery manifest could not be written."
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    wiseeff_upgrade_set_phase old-stack-restore running
  fi
  if ! wiseeff_upgrade_recreate_previous_app_services; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_verify_restored_stack; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_state_write recovery_verified true
  wiseeff_upgrade_state_write outcome rolled-back
  wiseeff_upgrade_state_write next_action none
  wiseeff_upgrade_set_phase rolled-back rolled-back
  wiseeff_upgrade_write_status "$upgrade_run_id"
  if [ "$upgrade_json" = "true" ]; then
    printf '{"action":"rollback","status":"rolled-back","runId":"%s","restoreData":%s}\n' "$upgrade_run_id" "$upgrade_restore_data"
  else
    printf 'Rollback completed. run_id=%s restore_data=%s\n' "$upgrade_run_id" "$upgrade_restore_data"
  fi
}

wiseeff_upgrade_recovery_next_action() {
  local migration_started failed_phase proxy_stopped queue_paused action recovery_command
  migration_started="$(wiseeff_upgrade_state_read migration_started)"
  failed_phase="$(wiseeff_upgrade_state_read failed_phase)"
  proxy_stopped="$(wiseeff_upgrade_state_read recovery_proxy_stopped)"
  queue_paused="$(wiseeff_upgrade_state_read recovery_queue_paused)"
  action=""
  if [ "$proxy_stopped" != "true" ]; then
    action="Manually isolate proxy traffic"
  fi
  if [ "$queue_paused" != "true" ]; then
    if [ -n "$action" ]; then
      action="${action} and queue/worker traffic"
    else
      action="Manually isolate queue/worker traffic"
    fi
  fi
  if [ "$migration_started" = "true" ] && wiseeff_upgrade_candidate_recovery_phase_supported "$failed_phase"; then
    recovery_command="./scripts/upgrade.sh recover-candidate --run-id ${upgrade_run_id} --confirm recover-candidate-${upgrade_run_id}"
  elif [ "$migration_started" = "true" ]; then
    recovery_command="./scripts/upgrade.sh rollback --run-id ${upgrade_run_id} --restore-data --confirm restore-${upgrade_run_id}"
  else
    recovery_command="./scripts/upgrade.sh resume --run-id ${upgrade_run_id}"
  fi
  if [ -n "$action" ]; then
    printf '%s, then run: %s' "$action" "$recovery_command"
  else
    printf '%s' "$recovery_command"
  fi
}

wiseeff_upgrade_run_recovery_action() {
  local action="$1"
  shift
  local output_path="${upgrade_run_dir}/recovery-action-output.tmp.$$"
  local status diagnostic summary pipeline_status
  local -a pipeline_statuses
  : > "$output_path"
  chmod 600 "$output_path"
  if "$@" 2>&1 \
    | wiseeff_upgrade_sanitize_diagnostic_stream \
    | tr '\r\n\t' '   ' \
    | cut -c1-200 > "$output_path"; then
    pipeline_statuses=("${PIPESTATUS[@]}")
  else
    pipeline_statuses=("${PIPESTATUS[@]}")
  fi
  status="${pipeline_statuses[0]:-1}"
  if [ "$status" -eq 0 ]; then
    for pipeline_status in "${pipeline_statuses[@]:1}"; do
      if [ "$pipeline_status" -ne 0 ]; then
        status="$pipeline_status"
        break
      fi
    done
  fi
  if [ "$status" -eq 0 ]; then
    rm -f -- "$output_path"
    return 0
  fi
  diagnostic="$(cat "$output_path" 2>/dev/null || true)"
  summary="${diagnostic:-No diagnostic output was emitted.}"
  summary="${summary:0:200}"
  summary="action=${action} code=${status} summary=${summary}"
  summary="${summary:0:240}"
  wiseeff_upgrade_state_write recovery_failure_summary "$summary"
  wiseeff_upgrade_event recovery-action-failed "$summary"
  printf 'WiseEff recovery warning: %s\n' "$summary" >&2
  rm -f -- "$output_path"
  return "$status"
}

wiseeff_upgrade_mark_recovery_required() {
  local failure_service="${1:-recovery}"
  local failure_code="${2:-recovery-required}"
  local failure_summary="${3:-The upgrade requires operator recovery.}"
  local proxy_stop_status=0
  local queue_pause_status=0
  local worker_stop_status=0
  wiseeff_upgrade_state_write recovery_started true
  if [ -n "${1:-}" ] || [ -z "$(wiseeff_upgrade_state_read failure_code)" ]; then
    wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" "$failure_service" "$failure_code" "$failure_summary"
  fi
  if wiseeff_upgrade_run_recovery_action proxy-stop wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy; then
    :
  else
    proxy_stop_status=$?
  fi
  if [ -n "${upgrade_recovery_queue_image_tag:-}" ]; then
    if wiseeff_upgrade_run_recovery_action queue-pause wiseeff_upgrade_queue_command_for_image pause "$upgrade_recovery_queue_image_tag"; then
      :
    else
      queue_pause_status=$?
    fi
  elif [ -n "${upgrade_candidate_image_tag:-}" ]; then
    if wiseeff_upgrade_run_recovery_action queue-pause wiseeff_upgrade_queue_command_for_image pause "$upgrade_candidate_image_tag"; then
      :
    else
      queue_pause_status=$?
    fi
  else
    if wiseeff_upgrade_run_recovery_action queue-pause wiseeff_upgrade_queue_command pause; then
      :
    else
      queue_pause_status=$?
    fi
  fi
  if wiseeff_upgrade_run_recovery_action worker-stop wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" worker; then
    :
  else
    worker_stop_status=$?
    if [ "$queue_pause_status" -eq 0 ]; then
      queue_pause_status="$worker_stop_status"
    fi
  fi
  wiseeff_upgrade_state_write recovery_proxy_stopped "$([ "$proxy_stop_status" -eq 0 ] && printf true || printf false)"
  wiseeff_upgrade_state_write recovery_queue_paused "$([ "$queue_pause_status" -eq 0 ] && printf true || printf false)"
  wiseeff_upgrade_state_write outcome recovery-required
  wiseeff_upgrade_state_write next_action "$(wiseeff_upgrade_recovery_next_action)"
  wiseeff_upgrade_state_write restore_token "restore-${upgrade_run_id}"
  wiseeff_upgrade_state_write recovery_verified false
  wiseeff_upgrade_set_phase recovery-required recovery-required
  wiseeff_upgrade_write_status "$upgrade_run_id"
}

wiseeff_upgrade_canonicalize_volume_identity() {
  local identity="$1"
  printf '%s' "$identity" | awk -v RS=';' 'NF { print }' | LC_ALL=C sort | awk '{ printf "%s;", $0 }'
}

wiseeff_upgrade_verify_final_state() {
  local service before after expected_image candidate_image phase actual_image api_container
  local actual_project expected_project current_mounts recorded_mounts actual_env expected_env
  phase="$(wiseeff_upgrade_state_read phase)"
  candidate_image="$(wiseeff_upgrade_state_read candidate_image_tag)"
  expected_image="$(wiseeff_upgrade_docker image inspect --format '{{.Id}}' "$candidate_image" 2>/dev/null || true)"
  if [ -z "$expected_image" ]; then
    wiseeff_upgrade_record_failure "$phase" image candidate-image-unavailable "The candidate application image could not be resolved to a local Docker image identity."
    return 1
  fi
  for service in postgres redis minio api worker web proxy; do
    after="$(wiseeff_upgrade_compose ps -q "$service" 2>/dev/null || true)"
    if [ -z "$after" ]; then
      wiseeff_upgrade_record_failure "$phase" "$service" candidate-container-missing "The candidate service has no running Compose container during final verification."
      return 1
    fi
    before="$(wiseeff_upgrade_state_read "container_${service}")"
    if [ "$after" = "$before" ]; then
      wiseeff_upgrade_record_failure "$phase" "$service" candidate-container-not-recreated "The candidate service still uses its pre-upgrade container identity."
      return 1
    fi
    if [ "$service" = "api" ] || [ "$service" = "worker" ] || [ "$service" = "web" ]; then
      actual_image="$(wiseeff_upgrade_docker inspect -f '{{.Image}}' "$after" 2>/dev/null || true)"
      if [ "$actual_image" != "$expected_image" ]; then
        wiseeff_upgrade_record_failure "$phase" "$service" candidate-image-identity "The candidate service image identity does not match the built candidate application image."
        return 1
      fi
    fi
  done
  if ! wiseeff_upgrade_probe_worker; then
    wiseeff_upgrade_record_failure "$phase" worker candidate-worker-health "The candidate worker liveness or Docker health probe failed during final verification."
    return 1
  fi
  api_container="$(wiseeff_upgrade_compose ps -q api 2>/dev/null || true)"
  actual_project="$(wiseeff_upgrade_docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$api_container" 2>/dev/null || true)"
  expected_project="$(wiseeff_upgrade_state_read compose_project)"
  if [ "$actual_project" != "$expected_project" ]; then
    wiseeff_upgrade_record_failure "$phase" api candidate-compose-project "The candidate API container does not belong to the recorded Compose project."
    return 1
  fi
  for service in postgres redis minio proxy; do
    current_mounts="$(wiseeff_upgrade_docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}={{.Destination}};{{end}}{{end}}' "$(wiseeff_upgrade_compose ps -q "$service")" 2>/dev/null || true)"
    recorded_mounts="$(wiseeff_upgrade_state_read "volumes_${service}")"
    if [ "$(wiseeff_upgrade_canonicalize_volume_identity "$current_mounts")" != "$(wiseeff_upgrade_canonicalize_volume_identity "$recorded_mounts")" ]; then
      wiseeff_upgrade_record_failure "$phase" "$service" candidate-volume-identity "The candidate service named-volume identity does not match the recorded pre-upgrade mapping."
      return 1
    fi
  done
  actual_env="$(wiseeff_upgrade_fingerprint "$upgrade_env_file")"
  expected_env="$(wiseeff_upgrade_state_read env_fingerprint)"
  if [ "$actual_env" != "$expected_env" ]; then
    wiseeff_upgrade_record_failure "$phase" configuration candidate-env-fingerprint "The runtime environment file fingerprint changed during the upgrade."
    return 1
  fi
}

wiseeff_upgrade_public_probe() {
  local public_url scheme curl_flags
  public_url="$(wiseeff_upgrade_env_value WISEEFF_PUBLIC_URL)"
  [ -n "$public_url" ] || public_url="http://127.0.0.1"
  scheme="${public_url%%:*}"
  curl_flags=(-fsS --noproxy '*')
  [ "$scheme" = "https" ] && curl_flags+=(-k)
  curl "${curl_flags[@]}" "${public_url%/}/health/live" >/dev/null || return $?
  curl "${curl_flags[@]}" "${public_url%/}/health/ready" >/dev/null || return $?
}

wiseeff_upgrade_run_apply() {
  wiseeff_upgrade_acquire_lock
  trap wiseeff_upgrade_release_lock EXIT
  upgrade_run_dir=""

  if ! wiseeff_upgrade_preflight; then
    return 10
  fi
  if [ "$upgrade_previous_sha" = "$upgrade_target_sha" ] &&
    [ "$upgrade_restart" != "true" ] &&
    wiseeff_upgrade_target_app_image_is_running &&
    wiseeff_upgrade_public_probe; then
    if [ "$upgrade_json" = "true" ]; then
      printf '{"action":"apply","status":"noop","targetSha":"%s"}\n' "$upgrade_target_sha"
    else
      printf 'WiseEff is already running %s; use --restart to recreate the stack.\n' "$upgrade_target_sha"
    fi
    return 0
  fi

  wiseeff_upgrade_init_run
  # Persist the preflight runtime identities only after the run directory exists.
  wiseeff_upgrade_collect_runtime
  wiseeff_upgrade_collect_volumes
  wiseeff_upgrade_store_plan
  wiseeff_upgrade_print_plan
  wiseeff_upgrade_confirm

  wiseeff_upgrade_set_phase preflighted running
  if ! wiseeff_upgrade_tag_previous_images; then
    wiseeff_upgrade_git checkout --detach "$upgrade_previous_sha" >/dev/null 2>&1 || true
    wiseeff_upgrade_set_phase failed-safe failed
    wiseeff_upgrade_write_status "$upgrade_run_id"
    return 20
  fi
  wiseeff_upgrade_set_phase building running
  if ! wiseeff_upgrade_build_candidate; then
    local diagnostics_dir build_log build_summary
    diagnostics_dir="$(wiseeff_upgrade_state_read diagnostics_dir)"
    build_log="$(wiseeff_upgrade_state_read build_log)"
    build_summary="$(wiseeff_upgrade_state_read build_summary)"
    wiseeff_upgrade_git checkout --detach "$upgrade_previous_sha" >/dev/null 2>&1 || true
    wiseeff_upgrade_state_write next_action "Review ${build_summary:-the build diagnostics}, correct the build environment or dependency error, then rerun apply."
    wiseeff_upgrade_set_phase failed-safe failed
    wiseeff_upgrade_event candidate-build-failed "diagnostics=${diagnostics_dir:-unavailable}"
    wiseeff_upgrade_write_status "$upgrade_run_id"
    printf 'Candidate build failed before downtime; the existing services remain online.\n' >&2
    printf 'diagnostics: %s\n' "${diagnostics_dir:-unavailable}" >&2
    printf 'summary: %s\n' "${build_summary:-unavailable}" >&2
    printf 'build log: %s\n' "${build_log:-unavailable}" >&2
    return 20
  fi
  wiseeff_upgrade_set_phase built complete
  wiseeff_upgrade_write_status "$upgrade_run_id"

  wiseeff_upgrade_set_phase quiescing running
  if ! wiseeff_upgrade_stop_old_stack; then
    if ! wiseeff_upgrade_restore_old_stack_after_stop; then
      return 70
    fi
    return 30
  fi
  wiseeff_upgrade_set_phase quiesced complete

  wiseeff_upgrade_set_phase backing-up running
  if ! wiseeff_upgrade_snapshot_all; then
    if ! wiseeff_upgrade_restore_old_stack_after_stop; then
      return 70
    fi
    return 40
  fi
  wiseeff_upgrade_set_phase recovery-point-verified complete

  wiseeff_upgrade_set_phase restarting-data running
  if ! wiseeff_upgrade_start_candidate_data_plane; then
    if ! wiseeff_upgrade_restore_old_stack_after_stop; then
      return 70
    fi
    return 50
  fi
  if ! wiseeff_upgrade_wait_data_plane_ready; then
    if ! wiseeff_upgrade_restore_old_stack_after_stop; then
      return 70
    fi
    return 50
  fi

  wiseeff_upgrade_state_write migration_started true
  wiseeff_upgrade_set_phase migrating running
  if ! WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose up -d --force-recreate --no-build api; then
    wiseeff_upgrade_mark_recovery_required api candidate-api-recreate "The candidate API container could not be recreated."
    return 70
  fi
  if ! wiseeff_upgrade_probe_api /health/live; then
    wiseeff_upgrade_mark_recovery_required api candidate-api-live "The candidate API liveness probe failed."
    return 70
  fi
  wiseeff_upgrade_set_phase api-ready complete

  wiseeff_upgrade_set_phase starting-app-services running
  if ! WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose up -d --force-recreate --no-build --no-deps web worker; then
    wiseeff_upgrade_mark_recovery_required app-services candidate-app-services-recreate "The candidate web or worker containers could not be recreated."
    return 70
  fi
  if ! wiseeff_upgrade_verify_candidate_app_readiness; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_set_phase app-services-ready complete

  wiseeff_upgrade_set_phase resuming-queue running
  if ! wiseeff_upgrade_run_recovery_action candidate-queue-resume wiseeff_upgrade_queue_command resume; then
    wiseeff_upgrade_mark_recovery_required queue candidate-queue-resume "The candidate durable queue could not be resumed."
    return 70
  fi
  wiseeff_upgrade_set_phase queue-resumed complete

  wiseeff_upgrade_set_phase starting-proxy running
  if ! WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose up -d --force-recreate --no-build --no-deps proxy; then
    wiseeff_upgrade_mark_recovery_required proxy candidate-proxy-recreate "The candidate proxy could not be recreated."
    return 70
  fi
  wiseeff_upgrade_set_phase validating-public running
  if ! wiseeff_upgrade_public_probe; then
    wiseeff_upgrade_mark_recovery_required proxy candidate-proxy-public "The candidate proxy/public health probe failed."
    return 70
  fi
  if ! wiseeff_upgrade_verify_final_state; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi

  wiseeff_upgrade_state_write outcome completed
  wiseeff_upgrade_record_build_transport_completion
  wiseeff_upgrade_state_write next_action none
  wiseeff_upgrade_set_phase completed completed
  wiseeff_upgrade_write_status "$upgrade_run_id"
  if [ "$upgrade_json" = "true" ]; then
    printf '{"action":"apply","status":"completed","runId":"%s","targetSha":"%s","completedWithInsecureBuildTransport":%s}\n' \
      "$upgrade_run_id" "$upgrade_target_sha" "$(wiseeff_upgrade_state_read completed_with_insecure_build_transport)"
  else
    printf 'Upgrade completed. run_id=%s target=%s backup=%s insecure_build_transport=%s\n' \
      "$upgrade_run_id" "$upgrade_target_sha" "$upgrade_backup_dir" "$(wiseeff_upgrade_state_read completed_with_insecure_build_transport)"
  fi
}

wiseeff_upgrade_run_plan() {
  wiseeff_upgrade_acquire_lock
  trap wiseeff_upgrade_release_lock EXIT
  upgrade_run_dir=""
  if ! wiseeff_upgrade_preflight; then
    return 10
  fi
  wiseeff_upgrade_print_plan
}

wiseeff_upgrade_snapshot_all() {
  wiseeff_upgrade_snapshot_postgres || return $?
  wiseeff_upgrade_snapshot_objects || return $?
  wiseeff_upgrade_snapshot_redis || return $?
  wiseeff_upgrade_snapshot_manifest || return $?
}

wiseeff_upgrade_status() {
  local requested_run_id="$1"
  local state_root
  state_root="$(wiseeff_upgrade_state_root)"

  if [ -n "$requested_run_id" ]; then
    wiseeff_upgrade_validate_run_id_value "$requested_run_id" || return $?
    if [ ! -d "${state_root}/${requested_run_id}" ]; then
      wiseeff_upgrade_die 10 "Run not found: ${requested_run_id}"
      return $?
    fi
    if [ -f "${state_root}/${requested_run_id}/status" ]; then
      if [ "${upgrade_json}" = "true" ]; then
        local run_dir="${state_root}/${requested_run_id}"
        local completed_insecure_build runtime_proxy_status
        completed_insecure_build="$(cat "${run_dir}/completed_with_insecure_build_transport" 2>/dev/null || printf 'false')"
        case "$completed_insecure_build" in
          true|false) ;;
          *) completed_insecure_build=false ;;
        esac
        runtime_proxy_status="$(cat "${run_dir}/runtime_proxy_status" 2>/dev/null || printf 'false')"
        case "$runtime_proxy_status" in
          true|false) ;;
          *) runtime_proxy_status=false ;;
        esac
        printf '{"runId":"%s","phase":"%s","outcome":"%s","updatedAt":"%s","protocolVersion":"%s","previousSha":"%s","targetSha":"%s","backupDir":"%s","buildStatus":"%s","diagnosticsDir":"%s","buildLog":"%s","buildSummary":"%s","baseImageRef":"%s","baseImageId":"%s","baseImageConfigId":"%s","baseImagePlatform":"%s","baseImageSource":"%s","baseImageStatus":"%s","buildNetwork":{"proxy":"%s","npmRegistry":"%s","corporateCa":"%s","buildTlsPolicy":"%s","transportFingerprint":"%s","runtimeProxy":%s},"completedWithInsecureBuildTransport":%s,"failedPhase":"%s","failureService":"%s","failureCode":"%s","failureSummary":"%s","recoveryStarted":"%s","recoveryVerified":"%s","recoveryProxyStopped":"%s","recoveryQueuePaused":"%s","recoveryFailureSummary":"%s","nextAction":"%s"}\n' \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/run_id" 2>/dev/null || printf '%s' "$requested_run_id")")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/phase" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/outcome" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/updated_at" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/protocol_version" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/previous_sha" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/target_sha" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/backup_dir" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/build_status" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/diagnostics_dir" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/build_log" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/build_summary" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/base_image_ref" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/base_image_id" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/base_image_config_id" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/base_image_platform" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/base_image_source" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/base_image_status" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/build_proxy_status" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/npm_registry_host" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/corporate_ca_status" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/build_tls_policy" 2>/dev/null || printf 'verify')")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/build_transport_fingerprint" 2>/dev/null || true)")" \
          "$runtime_proxy_status" \
          "$completed_insecure_build" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/failed_phase" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/failure_service" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/failure_code" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/failure_summary" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/recovery_started" 2>/dev/null || printf 'false')")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/recovery_verified" 2>/dev/null || printf 'false')")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/recovery_proxy_stopped" 2>/dev/null || printf 'false')")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/recovery_queue_paused" 2>/dev/null || printf 'false')")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/recovery_failure_summary" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/next_action" 2>/dev/null || true)")"
      else
        cat "${state_root}/${requested_run_id}/status"
      fi
    else
      printf 'run_id=%s\nphase=unknown\n' "$requested_run_id"
    fi
    return 0
  fi

  if [ ! -d "$state_root" ]; then
    if [ "${upgrade_json}" = "true" ]; then
      printf '[]\n'
    else
      printf 'No upgrade runs under %s.\n' "$state_root"
    fi
    return 0
  fi

  local run_dir
  if [ "${upgrade_json}" = "true" ]; then
    printf '['
  fi
  local first="true"
  for run_dir in "$state_root"/*; do
    [ -d "$run_dir" ] || continue
    if [ "${upgrade_json}" = "true" ]; then
      [ "$first" = "true" ] || printf ','
      printf '"%s"' "$(wiseeff_upgrade_json_escape "$(basename "$run_dir")")"
      first="false"
    else
      printf '%s\n' "$(basename "$run_dir")"
    fi
  done
  if [ "${upgrade_json}" = "true" ]; then
    printf ']\n'
  fi
}

wiseeff_upgrade_main() {
  upgrade_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  upgrade_compose_dir="$(cd "${upgrade_script_dir}/.." && pwd)"
  upgrade_repo_root="$(cd "${upgrade_compose_dir}/../.." && pwd)"
  upgrade_env_file="${upgrade_compose_dir}/.env"
  upgrade_action="apply"
  upgrade_ref="${WISEEFF_UPGRADE_REF:-origin/main}"
  upgrade_git_proxy="${WISEEFF_UPGRADE_GIT_PROXY:-}"
  upgrade_build_network_file="${WISEEFF_BUILD_NETWORK_FILE:-${upgrade_compose_dir}/.build-network.env}"
  upgrade_state_dir=""
  upgrade_backup_root=""
  upgrade_run_id=""
  upgrade_operator=""
  upgrade_restart="false"
  upgrade_allow_insecure_build="false"
  upgrade_non_interactive="false"
  upgrade_yes="false"
  upgrade_restore_data="false"
  upgrade_confirm=""
  upgrade_json="false"
  action_set="false"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      apply|plan|prepare-host|lock-status|unlock|status|resume|recover-candidate|rollback)
        if [ "$action_set" = "true" ]; then
          wiseeff_upgrade_die 2 "Only one upgrade action may be supplied."
          return $?
        fi
        upgrade_action="$1"
        action_set="true"
        shift
        ;;
      --ref)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--ref requires a value."; return $?; }
        upgrade_ref="$2"
        shift 2
        ;;
      --git-proxy)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--git-proxy requires a value."; return $?; }
        upgrade_git_proxy="$2"
        shift 2
        ;;
      --build-network-file)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--build-network-file requires a value."; return $?; }
        upgrade_build_network_file="$2"
        shift 2
        ;;
      --env-file)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--env-file requires a value."; return $?; }
        upgrade_env_file="$2"
        shift 2
        ;;
      --state-dir)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--state-dir requires a value."; return $?; }
        upgrade_state_dir="$2"
        shift 2
        ;;
      --backup-root)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--backup-root requires a value."; return $?; }
        upgrade_backup_root="$2"
        shift 2
        ;;
      --run-id)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--run-id requires a value."; return $?; }
        upgrade_run_id="$2"
        shift 2
        ;;
      --operator)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--operator requires a value."; return $?; }
        upgrade_operator="$2"
        shift 2
        ;;
      --restart) upgrade_restart="true"; shift ;;
      --allow-insecure-build) upgrade_allow_insecure_build="true"; shift ;;
      --non-interactive) upgrade_non_interactive="true"; shift ;;
      --yes) upgrade_yes="true"; shift ;;
      --restore-data) upgrade_restore_data="true"; shift ;;
      --confirm)
        [ "$#" -ge 2 ] || { wiseeff_upgrade_die 2 "--confirm requires a value."; return $?; }
        upgrade_confirm="$2"
        shift 2
        ;;
      --json) upgrade_json="true"; shift ;;
      -h|--help)
        wiseeff_upgrade_usage
        return 0
        ;;
      --)
        shift
        [ "$#" -eq 0 ] || { wiseeff_upgrade_die 2 "Unexpected argument after --: $1"; return $?; }
        ;;
      *)
        wiseeff_upgrade_die 2 "Unknown action or option: $1"
        return $?
        ;;
    esac
  done

  if [ -n "$upgrade_state_dir" ]; then
    export WISEEFF_UPGRADE_STATE_DIR="$upgrade_state_dir"
  fi
  if [ -n "$upgrade_backup_root" ]; then
    export WISEEFF_UPGRADE_BACKUP_ROOT="$upgrade_backup_root"
  fi

  if [ -n "$upgrade_operator" ] && [ "$upgrade_action" != "prepare-host" ]; then
    wiseeff_upgrade_die 2 "--operator is only valid with prepare-host."
    return $?
  fi

  if [ "$upgrade_allow_insecure_build" = "true" ] && [ "$upgrade_action" != "apply" ]; then
    wiseeff_upgrade_die 2 "--allow-insecure-build is only valid with apply."
    return $?
  fi

  if [ "$upgrade_action" = "apply" ] && [ "$upgrade_non_interactive" = "true" ] && [ "$upgrade_yes" != "true" ]; then
    wiseeff_upgrade_die 2 "Non-interactive apply requires --yes."
    return $?
  fi
  if { [ "$upgrade_action" = "resume" ] || [ "$upgrade_action" = "recover-candidate" ] || [ "$upgrade_action" = "rollback" ]; } && [ -z "$upgrade_run_id" ]; then
    wiseeff_upgrade_die 2 "${upgrade_action} requires --run-id."
    return $?
  fi

  case "$upgrade_action" in
    prepare-host)
      wiseeff_upgrade_run_prepare_host
      ;;
    lock-status)
      wiseeff_upgrade_run_lock_status
      ;;
    unlock)
      wiseeff_upgrade_run_unlock
      ;;
    status)
      wiseeff_upgrade_status "$upgrade_run_id"
      ;;
    apply)
      wiseeff_upgrade_run_apply
      ;;
    plan)
      wiseeff_upgrade_run_plan
      ;;
    resume)
      wiseeff_upgrade_run_resume
      ;;
    recover-candidate)
      wiseeff_upgrade_run_recover_candidate
      ;;
    rollback)
      wiseeff_upgrade_run_rollback
      ;;
    *)
      wiseeff_upgrade_die 2 "Unknown upgrade action: ${upgrade_action}"
      return $?
      ;;
  esac
}
