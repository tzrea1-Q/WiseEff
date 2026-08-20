#!/usr/bin/env bash
# Internal implementation for the self-hosted upgrade module.
set -euo pipefail

# shellcheck source=operation-lock.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/operation-lock.sh"

wiseeff_upgrade_usage() {
  cat <<'EOF'
Usage: upgrade.sh [apply] [options]

Actions:
  apply                         Upgrade the stack (default).
  plan                          Resolve and inspect a target without downtime.
  status                        Show a persisted upgrade run.
  resume                        Continue a recoverable run.
  rollback                     Restore the previous application/recovery point.

Options:
  --ref REF                     Git ref; defaults to WISEEFF_UPGRADE_REF or origin/main.
  --git-proxy URL               HTTP(S)/SOCKS proxy for resolving the Git ref (or WISEEFF_UPGRADE_GIT_PROXY).
  --env-file PATH               Runtime env file; defaults to ops/self-hosted/.env.
  --state-dir PATH              Upgrade journal root.
  --backup-root PATH            Upgrade backup root.
  --run-id ID                   Existing run for status/resume/rollback.
  --restart                     Recreate even when the target SHA is already running.
  --non-interactive --yes       Required together for unattended apply.
  --restore-data                Restore all stores during rollback (confirmation required).
  --confirm TOKEN               Confirmation token printed for destructive restore.
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
  wiseeff_operation_lock_acquire "${WISEEFF_OPERATION_LOCK_DIR:-${upgrade_repo_root}/ops/self-hosted/.state}" \
    "Another WiseEff setup or upgrade operation holds the host lock." || return $?
  upgrade_lock_mode="$operation_lock_mode"
  upgrade_lock_dir="${operation_lock_dir:-}"
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
    wiseeff_upgrade_die 10 "Backup root parent is not writable by the current operator: ${backup_parent}"
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
  dirty="$(wiseeff_upgrade_git status --porcelain --untracked-files=all)"
  if [ -n "$dirty" ]; then
    wiseeff_upgrade_die 10 "Refusing upgrade from a dirty checkout. Commit or remove tracked/unignored changes first."
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
  upgrade_previous_sha="$(wiseeff_upgrade_git rev-parse HEAD)"
  wiseeff_upgrade_prepare_git_transport
  wiseeff_upgrade_git fetch origin --prune >/dev/null
  upgrade_target_sha="$(wiseeff_upgrade_git rev-parse "${upgrade_ref}^{commit}")"
  [ -n "$upgrade_target_sha" ] || {
    wiseeff_upgrade_die 10 "Could not resolve Git ref: ${upgrade_ref}"
    return $?
  }
  wiseeff_upgrade_validate_protocol "$upgrade_target_sha"
  upgrade_migrations="$(wiseeff_upgrade_git diff --name-only "$upgrade_previous_sha" "$upgrade_target_sha" -- server/migrations || true)"
}

wiseeff_upgrade_collect_runtime() {
  local service container image project app_image
  upgrade_runtime_services="postgres redis minio api worker web proxy"
  upgrade_compose_project=""
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
      if [ -z "$app_image" ]; then
        app_image="$image"
      elif [ "$app_image" != "$image" ]; then
        wiseeff_upgrade_die 10 "API, worker, and web do not share one application image identity."
        return $?
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
  wiseeff_upgrade_require_command git
  wiseeff_upgrade_require_command docker
  wiseeff_upgrade_require_command curl
  wiseeff_upgrade_validate_env
  wiseeff_upgrade_validate_backup_root
  wiseeff_upgrade_validate_worktree
  if ! wiseeff_upgrade_docker info >/dev/null; then
    wiseeff_upgrade_die 10 "Docker daemon is unavailable."
    return $?
  fi
  wiseeff_upgrade_compose_config
  wiseeff_upgrade_collect_runtime
  wiseeff_upgrade_collect_volumes
  wiseeff_upgrade_resolve_target
}

wiseeff_upgrade_print_plan() {
  local migrations_count=0
  local escaped_ref
  escaped_ref="$(wiseeff_upgrade_json_escape "$upgrade_ref")"
  if [ -n "$upgrade_migrations" ]; then
    migrations_count="$(printf '%s\n' "$upgrade_migrations" | sed '/^$/d' | wc -l | tr -d ' ')"
  fi
  if [ "$upgrade_json" = "true" ]; then
    printf '{"action":"plan","previousSha":"%s","targetSha":"%s","requestedRef":"%s","migrationCount":%s,"restart":%s}\n' \
      "$upgrade_previous_sha" "$upgrade_target_sha" "$escaped_ref" "$migrations_count" "$upgrade_restart"
    return 0
  fi
  printf 'WiseEff self-hosted upgrade plan\n'
  printf '  current:  %s\n' "$upgrade_previous_sha"
  printf '  target:   %s (%s)\n' "$upgrade_target_sha" "$upgrade_ref"
  printf '  migrations: %s\n' "$migrations_count"
  printf '  backup:   %s\n' "$(wiseeff_upgrade_default_backup_root)"
  printf '  restart:   %s\n' "$upgrade_restart"
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
  local image_repo tag image_id
  image_repo="$(wiseeff_upgrade_app_image_name)"
  tag="${image_repo}:wiseeff-previous-${upgrade_run_id}"
  image_id="$(wiseeff_upgrade_state_read image_api)"
  [ -n "$image_id" ] || {
    wiseeff_upgrade_die 20 "Current API image identity is unavailable."
    return $?
  }
  wiseeff_upgrade_docker tag "$image_id" "$tag"
  upgrade_previous_image_tag="$tag"
  wiseeff_upgrade_state_write previous_image_tag "$tag"
}

wiseeff_upgrade_build_candidate() {
  local target_tag
  target_tag="$(wiseeff_upgrade_app_image_name):${upgrade_target_sha}"
  wiseeff_upgrade_git checkout --detach "$upgrade_target_sha" >/dev/null
  WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose build api
  wiseeff_upgrade_docker image inspect "$target_tag" >/dev/null
  upgrade_candidate_image_tag="$target_tag"
  wiseeff_upgrade_state_write candidate_image_tag "$target_tag"
}

wiseeff_upgrade_queue_command_for_tag() {
  local command="$1"
  local app_tag="$2"
  WISEEFF_APP_TAG="$app_tag" wiseeff_upgrade_compose run --rm --no-deps api npm run selfhost:queue-maintenance -- "$command" --timeout-ms "${WISEEFF_UPGRADE_DRAIN_TIMEOUT_MS:-120000}"
}

wiseeff_upgrade_queue_command() {
  wiseeff_upgrade_queue_command_for_tag "$1" "$upgrade_target_sha"
}

wiseeff_upgrade_restore_queue() {
  if [ -n "${upgrade_candidate_image_tag:-}" ]; then
    wiseeff_upgrade_queue_command resume >/dev/null 2>&1 || true
  fi
}

wiseeff_upgrade_stop_old_stack() {
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy >/dev/null
  wiseeff_upgrade_queue_command pause >/dev/null
  wiseeff_upgrade_queue_command drain >/dev/null
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" api worker web >/dev/null
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

wiseeff_upgrade_wait_data_service() {
  local service="$1"
  local container status attempt
  container="$(wiseeff_upgrade_compose ps -aq "$service")"
  for attempt in $(seq 1 "${WISEEFF_UPGRADE_HEALTH_ATTEMPTS:-60}"); do
    status="$(wiseeff_upgrade_docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [ "$status" = "healthy" ] || { [ "$service" = "minio-init" ] && [ "$status" = "exited" ] && [ "$(wiseeff_upgrade_docker inspect -f '{{.State.ExitCode}}' "$container" 2>/dev/null || true)" = "0" ]; }; then
      return 0
    fi
    sleep "${WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS:-2}"
  done
  return 1
}

wiseeff_upgrade_snapshot_postgres() {
  local output_dir="${upgrade_backup_dir}/postgres"
  mkdir -p "$output_dir"
  local partial="${output_dir}/wiseeff.dump.part"
  local dump="${output_dir}/wiseeff.dump"
  wiseeff_upgrade_compose exec -T postgres pg_dump -U wiseeff -d wiseeff --format=custom > "$partial"
  wiseeff_upgrade_compose exec -T postgres pg_restore --list < "$partial" >/dev/null
  mv -f "$partial" "$dump"
  wiseeff_upgrade_state_write postgres_backup "$dump"
}

wiseeff_upgrade_snapshot_objects() {
  local output_dir="${upgrade_backup_dir}/object-store"
  local network
  mkdir -p "$output_dir"
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
    'mc alias set live "$OBJECT_STORAGE_ENDPOINT" "$OBJECT_STORAGE_ACCESS_KEY_ID" "$OBJECT_STORAGE_SECRET_ACCESS_KEY" >/dev/null && mc mirror --overwrite "live/$OBJECT_STORAGE_BUCKET" /backup/data >/dev/null'
  local manifest="${output_dir}/manifest.sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$output_dir" && find data -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$manifest"
  else
    (cd "$output_dir" && find data -type f -print0 | sort -z | xargs -0 -r shasum -a 256) > "$manifest"
  fi
  [ -s "$manifest" ] || printf '%s\n' "# empty object store" > "$manifest"
  wiseeff_upgrade_state_write object_backup "$output_dir"
}

wiseeff_upgrade_snapshot_redis() {
  if [ "$(wiseeff_upgrade_env_value LOG_ANALYSIS_QUEUE_MODE)" != "durable" ] && [ "$(wiseeff_upgrade_env_value NOTIFICATION_QUEUE_MODE)" != "durable" ]; then
    wiseeff_upgrade_state_write redis_backup skipped
    return 0
  fi
  local output_dir="${upgrade_backup_dir}/redis"
  local container
  mkdir -p "$output_dir"
  wiseeff_upgrade_compose exec -T redis redis-cli SAVE >/dev/null
  container="$(wiseeff_upgrade_state_read container_redis)"
  wiseeff_upgrade_docker cp "${container}:/data/." "${output_dir}/data.part"
  wiseeff_upgrade_docker cp "${container}:/data/dump.rdb" "${output_dir}/dump.rdb.part"
  wiseeff_upgrade_compose exec -T redis redis-check-rdb /data/dump.rdb >/dev/null
  mv -f "${output_dir}/dump.rdb.part" "${output_dir}/dump.rdb"
  mv -f "${output_dir}/data.part" "${output_dir}/data"
  wiseeff_upgrade_state_write redis_backup "${output_dir}"
}

wiseeff_upgrade_snapshot_manifest() {
  local manifest="${upgrade_backup_dir}/manifest.sha256"
  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$upgrade_backup_dir" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 -r sha256sum) > "$manifest"
  else
    (cd "$upgrade_backup_dir" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 -r shasum -a 256) > "$manifest"
  fi
  chmod 600 "$manifest"
  wiseeff_upgrade_state_write recovery_point_verified true
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

wiseeff_upgrade_restart_old_stack() {
  local previous_sha previous_tag
  previous_sha="$(wiseeff_upgrade_state_read previous_sha)"
  previous_tag="$(wiseeff_upgrade_state_read previous_image_tag)"
  [ -n "$previous_sha" ] && [ -n "$previous_tag" ] || {
    wiseeff_upgrade_die 70 "Previous application image identity is missing; manual recovery is required."
    return $?
  }
  wiseeff_upgrade_git checkout --detach "$previous_sha" >/dev/null
  WISEEFF_APP_TAG="${previous_tag##*:}" wiseeff_upgrade_compose up -d --force-recreate --no-build postgres redis minio minio-init api worker web proxy
  wiseeff_upgrade_queue_command_for_tag resume "${previous_tag##*:}" >/dev/null 2>&1 || true
  wiseeff_upgrade_probe_api /health/live || true
  wiseeff_upgrade_state_write next_action none
}

wiseeff_upgrade_restore_old_stack_after_stop() {
  local previous_sha previous_tag
  previous_sha="$(wiseeff_upgrade_state_read previous_sha)"
  previous_tag="$(wiseeff_upgrade_state_read previous_image_tag)"
  [ -n "$previous_sha" ] && [ -n "$previous_tag" ] || {
    wiseeff_upgrade_die 70 "Previous application image identity is missing; manual recovery is required."
    return $?
  }
  wiseeff_upgrade_git checkout --detach "$previous_sha" >/dev/null
  WISEEFF_APP_TAG="${previous_tag##*:}" wiseeff_upgrade_compose up -d --force-recreate --no-build postgres redis minio minio-init api worker web proxy
  wiseeff_upgrade_queue_command_for_tag resume "${previous_tag##*:}" >/dev/null 2>&1 || true
  wiseeff_upgrade_state_write next_action none
  wiseeff_upgrade_set_phase old-stack-restored old-stack-restored
  wiseeff_upgrade_write_status "$upgrade_run_id"
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

wiseeff_upgrade_complete_candidate() {
  local previous_phase
  previous_phase="$(wiseeff_upgrade_state_read phase)"
  wiseeff_upgrade_set_phase validating-public running
  if ! wiseeff_upgrade_public_probe || ! wiseeff_upgrade_verify_final_state; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_state_write outcome completed
  wiseeff_upgrade_state_write next_action none
  wiseeff_upgrade_set_phase completed complete
  wiseeff_upgrade_write_status "$upgrade_run_id"
  if [ "$upgrade_json" = "true" ]; then
    printf '{"action":"resume","status":"completed","runId":"%s","targetSha":"%s"}\n' "$upgrade_run_id" "$upgrade_target_sha"
  else
    printf 'Upgrade resumed and completed. run_id=%s target=%s (from %s)\n' "$upgrade_run_id" "$upgrade_target_sha" "$previous_phase"
  fi
}

wiseeff_upgrade_run_resume() {
  wiseeff_upgrade_load_run || return $?
  wiseeff_upgrade_acquire_lock
  trap wiseeff_upgrade_release_lock EXIT
  wiseeff_upgrade_validate_env || return 10

  local outcome phase migration_started previous_tag
  outcome="$(wiseeff_upgrade_state_read outcome)"
  phase="$(wiseeff_upgrade_state_read phase)"
  migration_started="$(wiseeff_upgrade_state_read migration_started)"
  if [ "$outcome" = "completed" ] || [ "$outcome" = "old-stack-restored" ] || [ "$outcome" = "rolled-back" ]; then
    wiseeff_upgrade_status "$upgrade_run_id"
    return 0
  fi
  if [ "$outcome" = "recovery-required" ]; then
    wiseeff_upgrade_status "$upgrade_run_id"
    return 70
  fi

  if [ "$migration_started" != "true" ]; then
    wiseeff_upgrade_restore_old_stack_after_stop
    return 0
  fi

  [ -n "$upgrade_candidate_image_tag" ] || {
    wiseeff_upgrade_die 70 "Candidate image identity is missing; manual recovery is required."
    return $?
  }
  wiseeff_upgrade_git checkout --detach "$upgrade_target_sha" >/dev/null
  previous_tag="${upgrade_candidate_image_tag##*:}"
  if [ "$phase" = "migrating" ]; then
    local api_container api_state
    api_container="$(wiseeff_upgrade_compose ps -q api 2>/dev/null || true)"
    api_state=""
    [ -n "$api_container" ] && api_state="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$api_container" 2>/dev/null || true)"
    if [ "$api_state" != "running" ]; then
      if ! WISEEFF_APP_TAG="$previous_tag" wiseeff_upgrade_compose up -d --no-build api; then
        wiseeff_upgrade_mark_recovery_required
        return 70
      fi
    fi
    wiseeff_upgrade_probe_api /health/live || { wiseeff_upgrade_mark_recovery_required; return 70; }
    wiseeff_upgrade_set_phase api-ready complete
    phase="api-ready"
  fi
  if [ "$phase" = "api-ready" ]; then
    wiseeff_upgrade_set_phase starting-app-services running
    if ! WISEEFF_APP_TAG="$previous_tag" wiseeff_upgrade_compose up -d --force-recreate --no-build --no-deps web worker; then
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    if ! wiseeff_upgrade_probe_api /health/ready || ! wiseeff_upgrade_probe_web; then
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    wiseeff_upgrade_set_phase app-services-ready complete
    phase="app-services-ready"
  fi
  if [ "$phase" = "app-services-ready" ]; then
    wiseeff_upgrade_set_phase resuming-queue running
    if ! wiseeff_upgrade_queue_command_for_tag resume "$previous_tag"; then
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    wiseeff_upgrade_set_phase queue-resumed complete
    phase="queue-resumed"
  fi
  if [ "$phase" = "queue-resumed" ] || [ "$phase" = "starting-proxy" ] || [ "$phase" = "validating-public" ]; then
    wiseeff_upgrade_set_phase starting-proxy running
    if ! WISEEFF_APP_TAG="$previous_tag" wiseeff_upgrade_compose up -d --force-recreate --no-build --no-deps proxy; then
      wiseeff_upgrade_mark_recovery_required
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
  container="$(wiseeff_upgrade_compose ps -aq redis)"
  [ -n "$container" ] || { wiseeff_upgrade_die 40 "Redis container is unavailable for recovery."; return $?; }
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" redis >/dev/null
  wiseeff_upgrade_docker start "$container" >/dev/null
  wiseeff_upgrade_docker exec "$container" sh -lc 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
  wiseeff_upgrade_docker cp "${redis_dir}/data/." "${container}:/data/"
  wiseeff_upgrade_compose exec -T redis redis-check-rdb /data/dump.rdb >/dev/null
}

wiseeff_upgrade_run_rollback() {
  wiseeff_upgrade_load_run || return $?
  wiseeff_upgrade_acquire_lock
  trap wiseeff_upgrade_release_lock EXIT
  wiseeff_upgrade_validate_env || return 10

  local outcome migration_started previous_tag
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

  previous_tag="${upgrade_previous_image_tag##*:}"
  [ -n "$previous_tag" ] || { wiseeff_upgrade_die 70 "Previous application image identity is missing."; return $?; }
  wiseeff_upgrade_set_phase rollback-stopping running
  wiseeff_upgrade_queue_command_for_tag pause "$previous_tag" >/dev/null 2>&1 || true
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy api worker web >/dev/null 2>&1 || true
  wiseeff_upgrade_git checkout --detach "$upgrade_previous_sha" >/dev/null || {
    wiseeff_upgrade_die 70 "Could not restore the previous checkout; manual recovery is required."
    return $?
  }
  WISEEFF_APP_TAG="$previous_tag" wiseeff_upgrade_compose up -d --force-recreate --no-build postgres redis minio minio-init >/dev/null || {
    wiseeff_upgrade_die 70 "Could not restart data services for rollback."
    return $?
  }
  for service in postgres redis minio minio-init; do
    wiseeff_upgrade_wait_data_service "$service" || { wiseeff_upgrade_die 70 "Data service failed during rollback: ${service}"; return $?; }
  done
  if [ "$upgrade_restore_data" = "true" ]; then
    wiseeff_upgrade_set_phase restoring-data running
    if ! wiseeff_upgrade_verify_backup_manifest || ! wiseeff_upgrade_restore_postgres || ! wiseeff_upgrade_restore_objects || ! wiseeff_upgrade_restore_redis; then
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    wiseeff_upgrade_snapshot_manifest
  fi
  if ! WISEEFF_APP_TAG="$previous_tag" wiseeff_upgrade_compose up -d --force-recreate --no-build api worker web proxy; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_queue_command_for_tag resume "$previous_tag" >/dev/null; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_probe_api /health/ready || { wiseeff_upgrade_mark_recovery_required; return 70; }
  wiseeff_upgrade_public_probe || { wiseeff_upgrade_mark_recovery_required; return 70; }
  wiseeff_upgrade_state_write outcome rolled-back
  wiseeff_upgrade_state_write next_action none
  wiseeff_upgrade_set_phase rolled-back complete
  wiseeff_upgrade_write_status "$upgrade_run_id"
  if [ "$upgrade_json" = "true" ]; then
    printf '{"action":"rollback","status":"rolled-back","runId":"%s","restoreData":%s}\n' "$upgrade_run_id" "$upgrade_restore_data"
  else
    printf 'Rollback completed. run_id=%s restore_data=%s\n' "$upgrade_run_id" "$upgrade_restore_data"
  fi
}

wiseeff_upgrade_mark_recovery_required() {
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy >/dev/null 2>&1 || true
  wiseeff_upgrade_queue_command pause >/dev/null 2>&1 || true
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" worker >/dev/null 2>&1 || true
  wiseeff_upgrade_state_write outcome recovery-required
  wiseeff_upgrade_state_write next_action "resume or rollback --restore-data --confirm restore-${upgrade_run_id}"
  wiseeff_upgrade_state_write restore_token "restore-${upgrade_run_id}"
  wiseeff_upgrade_set_phase recovery-required recovery-required
  wiseeff_upgrade_write_status "$upgrade_run_id"
}

wiseeff_upgrade_verify_final_state() {
  local service before after expected_image
  expected_image="$(wiseeff_upgrade_docker image inspect "$(wiseeff_upgrade_state_read candidate_image_tag)" -q 2>/dev/null || true)"
  [ -n "$expected_image" ] || return 1
  for service in postgres redis minio api worker web proxy; do
    after="$(wiseeff_upgrade_compose ps -q "$service" 2>/dev/null || true)"
    [ -n "$after" ] || return 1
    before="$(wiseeff_upgrade_state_read "container_${service}")"
    [ "$after" != "$before" ] || return 1
    if [ "$service" = "api" ] || [ "$service" = "worker" ] || [ "$service" = "web" ]; then
      [ "$(wiseeff_upgrade_docker inspect -f '{{.Image}}' "$after" 2>/dev/null || true)" = "$expected_image" ] || return 1
    fi
  done
  [ "$(wiseeff_upgrade_docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$(wiseeff_upgrade_compose ps -q api)" 2>/dev/null || true)" = "$(wiseeff_upgrade_state_read compose_project)" ] || return 1
  for service in postgres redis minio proxy; do
    local current_mounts
    current_mounts="$(wiseeff_upgrade_docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}={{.Destination}};{{end}}{{end}}' "$(wiseeff_upgrade_compose ps -q "$service")" 2>/dev/null || true)"
    [ "$current_mounts" = "$(wiseeff_upgrade_state_read "volumes_${service}")" ] || return 1
  done
  [ "$(wiseeff_upgrade_fingerprint "$upgrade_env_file")" = "$(wiseeff_upgrade_state_read env_fingerprint)" ] || return 1
}

wiseeff_upgrade_public_probe() {
  local public_url scheme curl_flags
  public_url="$(wiseeff_upgrade_env_value WISEEFF_PUBLIC_URL)"
  [ -n "$public_url" ] || public_url="http://127.0.0.1"
  scheme="${public_url%%:*}"
  curl_flags=(-fsS)
  [ "$scheme" = "https" ] && curl_flags+=(-k)
  curl "${curl_flags[@]}" "${public_url%/}/health/live" >/dev/null
  curl "${curl_flags[@]}" "${public_url%/}/health/ready" >/dev/null
}

wiseeff_upgrade_run_apply() {
  wiseeff_upgrade_acquire_lock
  trap wiseeff_upgrade_release_lock EXIT
  upgrade_run_dir=""

  if ! wiseeff_upgrade_preflight; then
    return 10
  fi
  if [ "$upgrade_previous_sha" = "$upgrade_target_sha" ] && [ "$upgrade_restart" != "true" ]; then
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
    wiseeff_upgrade_git checkout --detach "$upgrade_previous_sha" >/dev/null 2>&1 || true
    wiseeff_upgrade_set_phase failed-safe failed
    wiseeff_upgrade_state_write next_action none
    wiseeff_upgrade_write_status "$upgrade_run_id"
    return 20
  fi
  wiseeff_upgrade_set_phase built complete

  wiseeff_upgrade_set_phase quiescing running
  if ! wiseeff_upgrade_stop_old_stack; then
    wiseeff_upgrade_restore_queue
    wiseeff_upgrade_compose start api worker web proxy >/dev/null 2>&1 || true
    wiseeff_upgrade_git checkout --detach "$upgrade_previous_sha" >/dev/null 2>&1 || true
    wiseeff_upgrade_set_phase old-stack-restored complete
    wiseeff_upgrade_state_write outcome old-stack-restored
    wiseeff_upgrade_state_write next_action none
    wiseeff_upgrade_write_status "$upgrade_run_id"
    return 30
  fi
  wiseeff_upgrade_set_phase quiesced complete

  wiseeff_upgrade_set_phase backing-up running
  if ! wiseeff_upgrade_snapshot_all; then
    if ! wiseeff_upgrade_restore_old_stack_after_stop >/dev/null 2>&1; then
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    return 40
  fi
  wiseeff_upgrade_set_phase recovery-point-verified complete

  wiseeff_upgrade_set_phase restarting-data running
  if ! WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose up -d --force-recreate --no-build postgres redis minio minio-init; then
    if ! wiseeff_upgrade_restore_old_stack_after_stop >/dev/null 2>&1; then
      wiseeff_upgrade_mark_recovery_required
      return 70
    fi
    return 50
  fi
  for service in postgres redis minio minio-init; do
    if ! wiseeff_upgrade_wait_data_service "$service"; then
      if ! wiseeff_upgrade_restore_old_stack_after_stop >/dev/null 2>&1; then
        wiseeff_upgrade_mark_recovery_required
        return 70
      fi
      return 50
    fi
  done

  wiseeff_upgrade_state_write migration_started true
  wiseeff_upgrade_set_phase migrating running
  if ! WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose up -d --force-recreate --no-build api; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_probe_api /health/live; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_set_phase api-ready complete

  wiseeff_upgrade_set_phase starting-app-services running
  if ! WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose up -d --force-recreate --no-build --no-deps web worker; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_probe_api /health/ready || ! wiseeff_upgrade_probe_web; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_set_phase app-services-ready complete

  wiseeff_upgrade_set_phase resuming-queue running
  if ! wiseeff_upgrade_queue_command resume; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_set_phase queue-resumed complete

  wiseeff_upgrade_set_phase starting-proxy running
  if ! WISEEFF_APP_TAG="$upgrade_target_sha" wiseeff_upgrade_compose up -d --force-recreate --no-build --no-deps proxy; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  wiseeff_upgrade_set_phase validating-public running
  if ! wiseeff_upgrade_public_probe; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi
  if ! wiseeff_upgrade_verify_final_state; then
    wiseeff_upgrade_mark_recovery_required
    return 70
  fi

  wiseeff_upgrade_state_write outcome completed
  wiseeff_upgrade_state_write next_action none
  wiseeff_upgrade_set_phase completed complete
  wiseeff_upgrade_write_status "$upgrade_run_id"
  if [ "$upgrade_json" = "true" ]; then
    printf '{"action":"apply","status":"completed","runId":"%s","targetSha":"%s"}\n' "$upgrade_run_id" "$upgrade_target_sha"
  else
    printf 'Upgrade completed. run_id=%s target=%s backup=%s\n' "$upgrade_run_id" "$upgrade_target_sha" "$upgrade_backup_dir"
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
  wiseeff_upgrade_snapshot_postgres
  wiseeff_upgrade_snapshot_objects
  wiseeff_upgrade_snapshot_redis
  wiseeff_upgrade_snapshot_manifest
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
        printf '{"runId":"%s","phase":"%s","outcome":"%s","updatedAt":"%s","protocolVersion":"%s","previousSha":"%s","targetSha":"%s","backupDir":"%s","nextAction":"%s"}\n' \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/run_id" 2>/dev/null || printf '%s' "$requested_run_id")")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/phase" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/outcome" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/updated_at" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/protocol_version" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/previous_sha" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/target_sha" 2>/dev/null || true)")" \
          "$(wiseeff_upgrade_json_escape "$(cat "${run_dir}/backup_dir" 2>/dev/null || true)")" \
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
  upgrade_state_dir=""
  upgrade_backup_root=""
  upgrade_run_id=""
  upgrade_restart="false"
  upgrade_non_interactive="false"
  upgrade_yes="false"
  upgrade_restore_data="false"
  upgrade_confirm=""
  upgrade_json="false"
  action_set="false"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      apply|plan|status|resume|rollback)
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
      --restart) upgrade_restart="true"; shift ;;
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

  if [ "$upgrade_action" = "apply" ] && [ "$upgrade_non_interactive" = "true" ] && [ "$upgrade_yes" != "true" ]; then
    wiseeff_upgrade_die 2 "Non-interactive apply requires --yes."
    return $?
  fi
  if { [ "$upgrade_action" = "resume" ] || [ "$upgrade_action" = "rollback" ]; } && [ -z "$upgrade_run_id" ]; then
    wiseeff_upgrade_die 2 "${upgrade_action} requires --run-id."
    return $?
  fi

  case "$upgrade_action" in
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
    rollback)
      wiseeff_upgrade_run_rollback
      ;;
    *)
      wiseeff_upgrade_die 2 "Unknown upgrade action: ${upgrade_action}"
      return $?
      ;;
  esac
}
