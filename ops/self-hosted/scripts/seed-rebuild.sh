#!/usr/bin/env bash
# Thin self-hosted maintenance boundary for the reviewed Atlas/Aurora/Nebula
# rebuild. The Catalog/archive/materialization work belongs to seed-rebuild.ts;
# this file owns only host quiescence, recovery points, service identity and
# restoration of the state observed at entry.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=upgrade-lib.sh
source "${script_dir}/upgrade-lib.sh"

seed_usage() {
  cat <<'EOF'
Usage: seed-rebuild.sh <action> [options]

Actions:
  plan             Read-only core plan; records an immutable plan digest.
  begin            Quiesce the stack and create a verified whole-state backup.
  command          Run one allowlisted core command while maintenance is held.
  rebuild          Shorthand for command --core-command rebuild.
  catalog-prepare Run the allowlisted core Catalog preparation command.
  catalog-publish Temporarily unfreeze only the manager, publish, then refreeze.
  catalog-status  Read the allowlisted core Catalog status command.
  verify          Run the allowlisted core verification command.
  finish          Verify the core result and restore the original host state.
  recover         Restore all stores and the original stack from the recovery point.
  resume-maintenance  Retry a failed backup while the host remains isolated.
  abort           Restore the original host state when no verified backup exists.
  status           Print the secret-free wrapper state.

Options:
  --run-id ID                    Durable run id (letters, digits, _, -).
  --actor USER                   Plan actor/user id.
  --organization-id ORG          Plan organization id.
  --confirm-plan sha256:DIGEST   Exact digest returned by plan.
  --core-command COMMAND         plan/status/catalog-prepare/catalog-publish/catalog-status/rebuild/verify.
  --confirm restore-ID           Run-bound whole-state recovery token.
  --env-file PATH                Self-hosted runtime env file.
  --state-dir PATH               Durable wrapper state root.
  --backup-root PATH             Durable recovery-point root.
  --help                         Show this help.

The wrapper never deletes volumes, prints DSNs, or accepts arbitrary core args.
EOF
}

seed_die() {
  printf '%s\n' "$*" >&2
  return 2
}

seed_need_value() {
  if [ "$#" -lt 2 ] || [ -z "${2:-}" ] || [ "${2#--}" != "$2" ]; then
    seed_die "missing value for $1"
    return $?
  fi
}

seed_valid_run_id() {
  case "${1:-}" in
    ''|*[!A-Za-z0-9_-]*) seed_die "Invalid run id: ${1:-missing}"; return 2 ;;
  esac
}

seed_valid_digest() {
  [[ "${1:-}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    seed_die "Expected a sha256:<64 lowercase hexadecimal> digest"
    return 2
  }
}

seed_valid_stage() {
  case "${1:-}" in
    vendor|configuration-schema) return 0 ;;
    *) seed_die "Expected --stage vendor or configuration-schema"; return 2 ;;
  esac
}

seed_valid_actor() {
  case "${1:-}" in
    ''|*[!A-Za-z0-9._:@/-]*) seed_die "Invalid actor id"; return 2 ;;
  esac
}
seed_json_escape() {
  wiseeff_upgrade_json_escape "$1"
}

seed_bool() {
  [ "${1:-false}" = "true" ] && printf 'true' || printf 'false'
}

seed_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

seed_setup_paths() {
  local compose_candidate
  compose_dir="$(cd "${WISEEFF_SEED_REBUILD_COMPOSE_DIR:-${script_dir}/..}" && pwd)"
  repo_root="$(cd "${WISEEFF_SEED_REBUILD_REPO_ROOT:-${compose_dir}/../..}" && pwd)"
  env_file="${WISEEFF_SEED_REBUILD_ENV_FILE:-${compose_dir}/.env}"
  compose_candidate="${WISEEFF_SEED_REBUILD_COMPOSE:-${script_dir}/compose}"
  seed_compose="${compose_candidate}"
  state_root="${WISEEFF_SEED_REBUILD_STATE_DIR:-${compose_dir}/.state/seed-rebuild}"
  seed_backup_root="${WISEEFF_SEED_REBUILD_BACKUP_ROOT:-${WISEEFF_UPGRADE_BACKUP_ROOT:-/var/backups/wiseeff/seed-rebuild}}"
  lock_root="${WISEEFF_SEED_REBUILD_LOCK_DIR:-${WISEEFF_OPERATION_LOCK_DIR:-${compose_dir}/.state}}"

  upgrade_repo_root="$repo_root"
  upgrade_script_dir="$script_dir"
  upgrade_compose_dir="$compose_dir"
  upgrade_env_file="$env_file"
  upgrade_action="seed-rebuild"
  upgrade_run_id="${seed_run_id:-}"
  upgrade_run_dir="${seed_run_dir:-}"
  upgrade_backup_dir="${seed_backup_dir:-}"
  WISEEFF_UPGRADE_BACKUP_ROOT="$seed_backup_root"
  export WISEEFF_UPGRADE_BACKUP_ROOT
}

# The upgrade library is the storage and publication owner. These two small
# indirections keep tests and an operator's configured compose entrypoint from
# requiring changes to that existing controller.
wiseeff_upgrade_compose() {
  "${seed_compose:?compose entry is not configured}" --env-file "$upgrade_env_file" "$@"
}

wiseeff_upgrade_docker() {
  "${WISEEFF_SEED_REBUILD_DOCKER:-docker}" "$@"
}

seed_state_write() {
  local key="$1" value="${2:-}" temp
  [ -n "${seed_run_dir:-}" ] || return 10
  temp="${seed_run_dir}/${key}.tmp.$$"
  printf '%s\n' "$value" > "$temp"
  chmod 600 "$temp"
  mv -f "$temp" "${seed_run_dir}/${key}"
}

seed_state_read() {
  if [ -r "${seed_run_dir:-}/$1" ]; then
    cat "${seed_run_dir}/$1"
  fi
  return 0
}

seed_state_present() {
  [ -f "${seed_run_dir:-}/$1" ]
}

seed_phase() {
  local phase="$1" outcome="${2:-running}"
  seed_state_write phase "$phase"
  seed_state_write outcome "$outcome"
  seed_state_write phase_updated_at "$(seed_now)"
  seed_write_json
}

seed_sanitize_file() {
  local input="$1" output="$2"
  wiseeff_upgrade_sanitize_diagnostic_stream < "$input" \
    | tr '\r\n\t' '   ' \
    | cut -c1-4000 > "$output"
  chmod 600 "$output"
}

seed_core_value() {
  local key="$1" file="${seed_run_dir}/core-state.json"
  [ -r "$file" ] || return 0
  python3 - "$file" "$key" <<'PYCORE'
import json
import sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        state = json.load(fh)
except (OSError, ValueError):
    raise SystemExit(1)
value = state.get("plan", {}).get(sys.argv[2])
if isinstance(value, (str, int, float)):
    print(value)
PYCORE
}
seed_core_bool() {
  local key="$1" file="${seed_run_dir}/core-state.json"
  [ -r "$file" ] || return 1
  grep -Eq "\"${key}\"[[:space:]]*:[[:space:]]*true" "$file"
}

seed_core_command() {
  local command="$1" output="${seed_run_dir}/core-output.part.$$" safe="${seed_run_dir}/core-output"
  local bootstrap code
  local -a core_args
  case "$command" in
    plan|status|catalog-prepare|catalog-publish|catalog-status|rebuild|verify) ;;
    *) seed_die "Unsupported core command: ${command}"; return 2 ;;
  esac
  bootstrap="$(wiseeff_upgrade_env_value WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL)"
  [ -n "$bootstrap" ] || { seed_die "Catalog bootstrap database URL is missing from the private env file"; return 10; }

  # DSNs are exported and passed by variable name. They never become argv or
  # journal text, and all child output is sanitized before it is retained.
  export WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL="$bootstrap"
  export WISEEFF_API_PROCESS=0
  core_args=(--run-id "$seed_run_id" --run-dir /run/wiseeff-seed-rebuild)
  case "$command" in
    plan)
      core_args+=(--actor "$seed_actor" --organization-id "$seed_org" --candidate-sha "$(seed_state_read checkout_sha)")
      ;;
    status)
      ;;
    *)
      [ -n "${seed_candidate_sha:-}" ] && [ -n "${seed_plan_digest:-}" ] || {
        seed_die "Core command identity is not established"
        return 70
      }
      core_args+=(--candidate-sha "$seed_candidate_sha" --confirm-plan "$seed_plan_digest")
      case "$command" in
        catalog-prepare|catalog-status|catalog-publish)
          [ -n "${seed_stage:-}" ] || { seed_die "$command requires --stage"; return 2; }
          core_args+=(--stage "$seed_stage")
          ;;
      esac
      if [ "$command" = catalog-publish ]; then
        [ -n "${seed_confirm_artifact:-}" ] || { seed_die "catalog-publish requires --confirm-artifact"; return 2; }
        [ -n "${seed_publish_actor:-}" ] || { seed_die "catalog-publish requires --actor"; return 2; }
        core_args+=(--actor "$seed_publish_actor" --confirm-artifact "$seed_confirm_artifact")
      fi
      ;;
  esac
  set +e
  wiseeff_upgrade_compose run --rm --no-deps \
    -v "${seed_run_dir}:/run/wiseeff-seed-rebuild:rw" \
    -e WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL \
    -e WISEEFF_API_PROCESS \
    api npx tsx scripts/seed-rebuild.ts "$command" \
    "${core_args[@]}" > "$output" 2>&1
  code=$?
  set -e
  seed_sanitize_file "$output" "$safe"
  rm -f -- "$output"
  seed_state_write core_last_command "$command"
  seed_state_write core_last_output "${safe}"
  seed_write_json
  if [ "$code" -ne 0 ]; then
    printf 'Seed rebuild core command failed: %s (see %s)\n' "$command" "$safe" >&2
    return "$code"
  fi
}
seed_write_json() {
  [ -n "${seed_run_dir:-}" ] && [ -d "$seed_run_dir" ] || return 0
  local path="${seed_run_dir}/wrapper-state.json" temp="${seed_run_dir}/wrapper-state.json.tmp.$$"
  local first=true svc present status health image_ref image_id volumes
  {
    printf '{\n'
    printf '  "schemaVersion":1,\n'
    printf '  "runId":"%s",\n' "$(seed_json_escape "$(seed_state_read run_id)")"
    printf '  "phase":"%s",\n' "$(seed_json_escape "$(seed_state_read phase)")"
    printf '  "outcome":"%s",\n' "$(seed_json_escape "$(seed_state_read outcome)")"
    printf '  "planDigest":"%s",\n' "$(seed_json_escape "$(seed_state_read plan_digest)")"
    printf '  "confirmedPlanDigest":"%s",\n' "$(seed_json_escape "$(seed_state_read confirmed_plan_digest)")"
    printf '  "seedDigest":"%s",\n' "$(seed_json_escape "$(seed_state_read seed_digest)")"
    printf '  "candidateSha":"%s",\n' "$(seed_json_escape "$(seed_state_read candidate_sha)")"
    printf '  "actorUserId":"%s",\n' "$(seed_json_escape "$(seed_state_read actor_user_id)")"
    printf '  "organizationId":"%s",\n' "$(seed_json_escape "$(seed_state_read organization_id)")"
    printf '  "scope":"%s",\n' "$(seed_json_escape "$(seed_state_read scope)")"
    printf '  "checkoutSha":"%s",\n' "$(seed_json_escape "$(seed_state_read checkout_sha)")"
    printf '  "envFingerprint":"%s",\n' "$(seed_json_escape "$(seed_state_read env_fingerprint)")"
    printf '  "composeProject":"%s",\n' "$(seed_json_escape "$(seed_state_read compose_project)")"
    printf '  "applicationImageId":"%s",\n' "$(seed_json_escape "$(seed_state_read application_image_id)")"
    printf '  "services":{'
    for svc in postgres redis minio api worker web proxy publication-manager; do
      [ "$first" = true ] || printf ','
      first=false
      present="$(seed_state_read "service_${svc}_present")"
      status="$(seed_state_read "service_${svc}_status")"
      health="$(seed_state_read "service_${svc}_health")"
      image_ref="$(seed_state_read "service_${svc}_image_ref")"
      image_id="$(seed_state_read "service_${svc}_image_id")"
      volumes="$(seed_state_read "service_${svc}_volumes")"
      printf '\n    "%s":{"present":%s,"containerId":"%s","status":"%s","health":"%s","imageRef":"%s","imageId":"%s","volumes":"%s"}' \
        "$svc" "$(seed_bool "$present")" \
        "$(seed_json_escape "$(seed_state_read "container_${svc}")")" \
        "$(seed_json_escape "$status")" "$(seed_json_escape "$health")" \
        "$(seed_json_escape "$image_ref")" "$(seed_json_escape "$image_id")" "$(seed_json_escape "$volumes")"
    done
    printf '\n  },\n'
    printf '  "queue":{"mode":"%s","initialPaused":"%s","paused":"%s","drained":%s,"statusDigest":"%s"},\n' \
      "$(seed_json_escape "$(seed_state_read queue_mode)")" \
      "$(seed_json_escape "$(seed_state_read queue_initial_paused)")" \
      "$(seed_json_escape "$(seed_state_read queue_paused)")" \
      "$(seed_bool "$(seed_state_read queue_drained)")" \
      "$(seed_json_escape "$(seed_state_read queue_status_digest)")"
    printf '  "publication":{"initialFrozen":%s,"frozen":%s,"freezeOwned":%s,"managerPresent":%s,"managerInitialStatus":"%s","pending":%s,"catalogPublished":%s,"stage":"%s","confirmArtifact":"%s"},\n' \
      "$(seed_bool "$(seed_state_read publication_initial_frozen)")" \
      "$(seed_bool "$(seed_state_read publication_frozen)")" \
      "$(seed_bool "$(seed_state_read publication_freeze_owned)")" \
      "$(seed_bool "$(seed_state_read service_publication-manager_present)")" \
      "$(seed_json_escape "$(seed_state_read service_publication-manager_status)")" \
      "$(seed_bool "$(seed_state_read publication_pending)")" \
      "$(seed_bool "$(seed_state_read catalog_published)")" \
      "$(seed_json_escape "$(seed_state_read publication_stage)")" \
      "$(seed_json_escape "$(seed_state_read confirm_artifact)")"
    printf '  "recoveryPoint":{"backupDir":"%s","manifest":"%s","verified":%s,"manifestDigest":"%s"},\n' \
      "$(seed_json_escape "$(seed_state_read backup_dir)")" \
      "$(seed_json_escape "$(seed_state_read backup_dir)/manifest.sha256")" \
      "$(seed_bool "$(seed_state_read recovery_point_verified)")" \
      "$(seed_json_escape "$(seed_state_read recovery_manifest_digest)")"
    printf '  "isolation":{"proxyStopped":%s,"queuePaused":%s,"writersStopped":%s,"managerStopped":%s},\n' \
      "$(seed_bool "$(seed_state_read proxy_stopped)")" \
      "$(seed_bool "$(seed_state_read queue_paused_verified)")" \
      "$(seed_bool "$(seed_state_read writers_stopped)")" \
      "$(seed_bool "$(seed_state_read manager_stopped)")"
    printf '  "core":{"runDir":"/run/wiseeff-seed-rebuild","stateFile":"/run/wiseeff-seed-rebuild/core-state.json","lastCommand":"%s","lastOutputPath":"%s"}\n' \
      "$(seed_json_escape "$(seed_state_read core_last_command)")" \
      "$(seed_json_escape "$(seed_state_read core_last_output)")"
    printf '}\n'
  } > "$temp"
  chmod 600 "$temp"
  mv -f "$temp" "$path"
}

seed_prepare_run() {
  seed_valid_run_id "$seed_run_id" || return $?
  seed_setup_paths
  seed_run_dir="${state_root}/${seed_run_id}"
  seed_backup_dir="${seed_backup_root}/${seed_run_id}"
  upgrade_run_id="$seed_run_id"
  upgrade_run_dir="$seed_run_dir"
  upgrade_backup_dir="$seed_backup_dir"
  mkdir -p "$seed_run_dir"
  chmod 700 "$seed_run_dir"
  seed_state_write run_id "$seed_run_id"
  seed_state_write backup_dir "$seed_backup_dir"
  seed_state_write scope atlas-aurora-nebula
  seed_state_write core_run_dir /run/wiseeff-seed-rebuild
}

seed_load_run() {
  seed_valid_run_id "$seed_run_id" || return $?
  seed_setup_paths
  seed_run_dir="${state_root}/${seed_run_id}"
  [ -d "$seed_run_dir" ] || { seed_die "Unknown seed rebuild run: ${seed_run_id}"; return 10; }
  seed_backup_dir="$(seed_state_read backup_dir)"
  [ -n "$seed_backup_dir" ] || seed_backup_dir="${seed_backup_root}/${seed_run_id}"
  upgrade_run_id="$seed_run_id"
  upgrade_run_dir="$seed_run_dir"
  upgrade_backup_dir="$seed_backup_dir"
  seed_actor="$(seed_state_read actor_user_id)"
  seed_org="$(seed_state_read organization_id)"
  seed_digest="$(seed_state_read seed_digest)"
  seed_candidate_sha="$(seed_state_read candidate_sha)"
  seed_plan_digest="$(seed_state_read plan_digest)"
  seed_api_image_ref="$(seed_state_read service_api_image_ref)"
  upgrade_candidate_image_tag="$seed_api_image_ref"
  seed_set_upgrade_restore_state
}

seed_bind_confirmed_plan() {
  local confirmed
  confirmed="$(seed_state_read confirmed_plan_digest)"
  seed_valid_digest "$confirmed" || return $?
  if [ -n "${seed_confirm_plan:-}" ] && [ "$seed_confirm_plan" != "$confirmed" ]; then
    seed_die "--confirm-plan does not match the plan confirmed at begin"
    return 70
  fi
  seed_confirm_plan="$confirmed"
}

seed_validate_runtime() {
  [ -f "$env_file" ] || { seed_die "Missing private self-hosted env file: ${env_file}"; return 10; }
  [ ! -L "$env_file" ] || { seed_die "Refusing a symlinked env file: ${env_file}"; return 10; }
  case "$(wiseeff_upgrade_stat_mode "$env_file")" in
    600|unknown) ;;
    *) seed_die "Refusing an env file with unsafe permissions"; return 10 ;;
  esac
  wiseeff_upgrade_validate_env || return $?
  wiseeff_upgrade_validate_backup_root || return $?
  [ -x "$seed_compose" ] || { seed_die "Self-hosted compose wrapper is missing or not executable: ${seed_compose}"; return 10; }
}

seed_current_sha() {
  git -C "$repo_root" rev-parse HEAD 2>/dev/null
}

seed_require_clean_checkout() {
  git -C "$repo_root" diff --quiet -- . || { seed_die "Tracked checkout changes are not allowed for an immutable seed plan"; return 10; }
  git -C "$repo_root" diff --cached --quiet -- . || { seed_die "Staged checkout changes are not allowed for an immutable seed plan"; return 10; }
}

seed_current_env_fingerprint() {
  wiseeff_upgrade_fingerprint "$env_file"
}

seed_require_pinned_images() {
  local service ref tag image_id shared=""
  local checkout_sha="$(seed_state_read checkout_sha)"
  for service in api worker web publication-manager; do
    [ "$(seed_state_read "service_${service}_present")" = true ] || continue
    ref="$(seed_state_read "service_${service}_image_ref")"
    tag="${ref##*:}"
    [ "$tag" = "$checkout_sha" ] || {
      seed_die "Service ${service} is not running the exact checkout image tag"
      return 10
    }
    image_id="$(seed_state_read "service_${service}_image_id")"
    if [ -z "$shared" ]; then
      shared="$image_id"
    elif [ "$shared" != "$image_id" ]; then
      seed_die "Application services do not share one image digest"
      return 10
    fi
  done
  [ -n "$shared" ] || { seed_die "No pinned application image was observed"; return 10; }
  seed_state_write application_image_id "$shared"
}

seed_capture_service() {
  local service="$1" container status health image_ref image_id project volumes
  container="$(wiseeff_upgrade_compose ps -aq "$service" 2>/dev/null || true)"
  if [ -z "$container" ]; then
    seed_state_write "service_${service}_present" false
    seed_state_write "service_${service}_status" absent
    seed_state_write "service_${service}_health" absent
    return 0
  fi
  status="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
  image_ref="$(wiseeff_upgrade_docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)"
  image_id="$(wiseeff_upgrade_docker inspect -f '{{.Image}}' "$container" 2>/dev/null || true)"
  health="$(wiseeff_upgrade_docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
  project="$(wiseeff_upgrade_docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$container" 2>/dev/null || true)"
  volumes="$(wiseeff_upgrade_docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}={{.Destination}};{{end}}{{end}}' "$container" 2>/dev/null || true)"
  [ -n "$status" ] && [ -n "$image_ref" ] && [ -n "$image_id" ] && [ -n "$project" ] || {
    seed_die "Could not capture complete identity for service: ${service}"
    return 10
  }
  case "$image_id" in
    sha256:*) ;;
    *) seed_die "Runtime image digest is missing for service: ${service}"; return 10 ;;
  esac
  case "$service" in
    postgres|redis|minio)
      [ -n "$volumes" ] || { seed_die "Named data volume identity is missing for service: ${service}"; return 10; }
      ;;
  esac
  seed_state_write "container_${service}" "$container"
  seed_state_write "service_${service}_present" true
  seed_state_write "service_${service}_status" "$status"
  seed_state_write "service_${service}_health" "$health"
  seed_state_write "service_${service}_image_ref" "$image_ref"
  seed_state_write "service_${service}_image_id" "$image_id"
  seed_state_write "service_${service}_project" "$project"
  seed_state_write "service_${service}_volumes" "$volumes"
  if [ "$service" = api ]; then
    seed_state_write compose_project "$project"
    seed_state_write network "$(wiseeff_upgrade_docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{printf "%s" $name}}{{end}}' "$container" 2>/dev/null || true)"
  fi
}

seed_capture_runtime() {
  local service
  for service in postgres redis minio api worker web proxy publication-manager; do
    seed_capture_service "$service" || return $?
  done
  seed_state_write checkout_sha "$(seed_current_sha)"
  seed_state_write env_fingerprint "$(seed_current_env_fingerprint)"
  seed_state_write initial_capture_at "$(seed_now)"
  seed_api_image_ref="$(seed_state_read service_api_image_ref)"
  [ -n "$seed_api_image_ref" ] || { seed_die "API image identity is missing"; return 10; }
  case "$seed_api_image_ref" in
    *:*) ;;
    *) seed_die "API image reference must be tag-addressable for queue/recovery helpers"; return 10 ;;
  esac
  upgrade_candidate_image_tag="$seed_api_image_ref"
  seed_set_upgrade_restore_state
  seed_write_json
}

seed_require_initial_running() {
  local service status
  for service in postgres redis minio api worker web proxy; do
    status="$(seed_state_read "service_${service}_status")"
    [ "$status" = running ] || {
      seed_die "Seed rebuild requires ${service} to be running at entry; observed ${status:-missing}"
      return 10
    }
  done
}

seed_queue_command() {
  local action="$1"
  wiseeff_upgrade_queue_command_for_image "$action" "$seed_api_image_ref"
}

seed_queue_probe() {
  local output="${seed_run_dir}/queue-probe.part.$$" safe="${seed_run_dir}/queue-probe"
  local code
  set +e
  wiseeff_upgrade_compose_for_image "$seed_api_image_ref" run --rm --no-deps api \
    node --input-type=module -e 'const { Queue } = await import("bullmq"); const specs = [["log-analysis", process.env.LOG_ANALYSIS_QUEUE_MODE === "durable", process.env.LOG_ANALYSIS_QUEUE_PREFIX || "wiseeff"], ["notifications", process.env.NOTIFICATION_DELIVERY_MODE === "async" && process.env.NOTIFICATION_QUEUE_MODE === "durable", process.env.NOTIFICATION_QUEUE_PREFIX || "wiseeff"]].filter(([, enabled]) => enabled); const queues = []; for (const [name, , prefix] of specs) { const queue = new Queue(name, { connection: { url: process.env.REDIS_URL }, prefix }); queues.push({ name, paused: await queue.isPaused() }); await queue.close(); } process.stdout.write(JSON.stringify({ mode: queues.length ? "durable" : "polling", queues }));' \
    > "$output" 2>&1
  code=$?
  set -e
  seed_sanitize_file "$output" "$safe"
  rm -f -- "$output"
  [ "$code" -eq 0 ] || return "$code"
  grep -Eq '"mode"[[:space:]]*:[[:space:]]*"(durable|polling)"' "$safe" || return 40
  printf '%s\n' "$safe"
}

seed_queue_capture_initial() {
  local status_file probe_file mode paused_values paused
  status_file="${seed_run_dir}/queue-status-initial.part.$$"
  set +e
  seed_queue_command status > "$status_file" 2>&1
  local status_code=$?
  set -e
  seed_sanitize_file "$status_file" "${seed_run_dir}/queue-status-initial"
  rm -f -- "$status_file"
  [ "$status_code" -eq 0 ] || { seed_die "Initial queue status could not be observed"; return 40; }
  probe_file="$(seed_queue_probe)" || { seed_die "Initial queue pause state could not be observed"; return 40; }
  mode="$(sed -nE 's/.*"mode"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$probe_file" | head -1)"
  paused_values="$(grep -Eo '"paused"[[:space:]]*:[[:space:]]*(true|false)' "$probe_file" | sed -E 's/.*:[[:space:]]*//' | sort -u | tr '\n' ' ')"
  if [ "$mode" = durable ]; then
    paused_values="${paused_values// /}"
    case "$paused_values" in
      true|false) paused="${paused_values% }" ;;
      *) seed_die "Durable queue pause state is ambiguous"; return 40 ;;
    esac
  else
    paused=not-applicable
  fi
  seed_state_write queue_mode "$mode"
  seed_state_write queue_initial_paused "$paused"
  seed_state_write queue_paused "$paused"
  seed_state_write queue_drained false
  seed_state_write queue_status_digest "$(wiseeff_upgrade_fingerprint "${seed_run_dir}/queue-status-initial")"
}

seed_queue_verify_paused() {
  local probe mode paused_values
  probe="$(seed_queue_probe)" || return 1
  mode="$(sed -nE 's/.*"mode"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$probe" | head -1)"
  [ "$mode" = "$(seed_state_read queue_mode)" ] || return 1
  if [ "$mode" = durable ]; then
    paused_values="$(grep -Eo '"paused"[[:space:]]*:[[:space:]]*(true|false)' "$probe" | sed -E 's/.*:[[:space:]]*//' | sort -u | tr '\n' ' ')"
    [ "${paused_values% }" = true ] || return 1
  fi
}

seed_queue_verify_resumed() {
  local probe paused_values
  [ "$(seed_state_read queue_mode)" != durable ] && return 0
  probe="$(seed_queue_probe)" || return 1
  paused_values="$(grep -Eo '"paused"[[:space:]]*:[[:space:]]*(true|false)' "$probe" | sed -E 's/.*:[[:space:]]*//' | sort -u | tr '\n' ' ')"
  [ "${paused_values% }" = false ]
}

seed_queue_drain() {
  local output="${seed_run_dir}/queue-drain.part.$$" safe="${seed_run_dir}/queue-drain" code
  set +e
  seed_queue_command drain > "$output" 2>&1
  code=$?
  set -e
  seed_sanitize_file "$output" "$safe"
  rm -f -- "$output"
  [ "$code" -eq 0 ] || return "$code"
  grep -Eq '"drained"[[:space:]]*:[[:space:]]*true' "$safe" || return 40
  seed_state_write queue_drained true
}

seed_publication_status() {
  local payload code
  set +e
  payload="$(wiseeff_upgrade_publication_ops status 2>/dev/null)"
  code=$?
  set -e
  [ "$code" -eq 0 ] || return 40
  if printf '%s' "$payload" | grep -q '"frozen":true'; then
    printf 'true\n'
  elif printf '%s' "$payload" | grep -q '"frozen":false'; then
    printf 'false\n'
  else
    return 40
  fi
}

seed_capture_publication() {
  wiseeff_upgrade_manager_is_configured || { seed_die "Dedicated publication-manager LOGIN is required for seed rebuild"; return 10; }
  [ "$(seed_state_read service_publication-manager_present)" = true ] || { seed_die "publication-manager must be present at maintenance entry"; return 10; }
  [ "$(seed_state_read service_publication-manager_status)" = running ] || { seed_die "publication-manager must be running at maintenance entry"; return 10; }
  case "$(seed_publication_status)" in
    true) seed_state_write publication_initial_frozen true ;;
    false) seed_state_write publication_initial_frozen false ;;
    *) seed_die "Publication freeze status could not be verified"; return 40 ;;
  esac
  seed_state_write publication_frozen "$(seed_state_read publication_initial_frozen)"
  seed_state_write publication_freeze_owned false
}

seed_verify_service_stopped() {
  local service container status
  for service in api worker web proxy; do
    container="$(seed_state_read "container_${service}")"
    status="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
    [ "$status" != running ] || return 1
  done
  if [ "$(seed_state_read service_publication-manager_present)" = true ]; then
    container="$(seed_state_read container_publication-manager)"
    status="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
    [ "$status" != running ] || return 1
  fi
}

seed_verify_maintenance() {
  local current_sha current_env
  current_sha="$(seed_current_sha)"
  [ "$current_sha" = "$(seed_state_read checkout_sha)" ] || { seed_die "Checkout identity changed after plan"; return 10; }
  current_env="$(seed_current_env_fingerprint)"
  [ "$current_env" = "$(seed_state_read env_fingerprint)" ] || { seed_die "Runtime env identity changed after plan"; return 10; }
  [ "$(seed_state_read phase)" = maintenance-begun ] || { seed_die "Run is not at maintenance-begun"; return 70; }
  [ "$(seed_state_read recovery_point_verified)" = true ] || { seed_die "Verified recovery point is missing"; return 70; }
  seed_verify_service_stopped || { seed_die "Writers or proxy are not isolated"; return 70; }
  [ "$(seed_state_read queue_paused_verified)" = true ] || { seed_die "Queue pause proof is missing"; return 70; }
  [ "$(seed_publication_status)" = true ] || { seed_die "Catalog publication is not frozen or status is unavailable"; return 70; }
  seed_state_write publication_frozen true
  seed_write_json
}

seed_verify_identity() {
  local service container status image_ref image_id project volumes
  [ "$(seed_current_sha)" = "$(seed_state_read checkout_sha)" ] || { seed_die "Checkout identity drifted"; return 70; }
  [ "$(seed_current_env_fingerprint)" = "$(seed_state_read env_fingerprint)" ] || { seed_die "Runtime env identity drifted"; return 70; }
  for service in postgres redis minio api worker web proxy publication-manager; do
    [ "$(seed_state_read "service_${service}_present")" = true ] || continue
    container="$(seed_state_read "container_${service}")"
    [ -n "$container" ] || return 70
    image_ref="$(wiseeff_upgrade_docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)"
    image_id="$(wiseeff_upgrade_docker inspect -f '{{.Image}}' "$container" 2>/dev/null || true)"
    project="$(wiseeff_upgrade_docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$container" 2>/dev/null || true)"
    volumes="$(wiseeff_upgrade_docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}={{.Destination}};{{end}}{{end}}' "$container" 2>/dev/null || true)"
    [ "$image_ref" = "$(seed_state_read "service_${service}_image_ref")" ] || { seed_die "Image reference drifted for ${service}"; return 70; }
    [ "$image_id" = "$(seed_state_read "service_${service}_image_id")" ] || { seed_die "Image identity drifted for ${service}"; return 70; }
    [ "$project" = "$(seed_state_read "service_${service}_project")" ] || { seed_die "Compose project identity drifted for ${service}"; return 70; }
    [ "$(wiseeff_upgrade_canonicalize_volume_identity "$volumes")" = "$(wiseeff_upgrade_canonicalize_volume_identity "$(seed_state_read "service_${service}_volumes")")" ] || {
      seed_die "Named volume identity drifted for ${service}"
      return 70
    }
  done
}

seed_set_upgrade_restore_state() {
  local service
  [ -n "${seed_run_dir:-}" ] || return 0
  for service in postgres redis minio api worker web proxy publication-manager; do
    if [ -n "$(seed_state_read "container_${service}")" ]; then
      wiseeff_upgrade_state_write "previous_image_tag_${service}" "$(seed_state_read "service_${service}_image_ref")"
      wiseeff_upgrade_state_write "previous_image_id_${service}" "$(seed_state_read "service_${service}_image_id")"
      wiseeff_upgrade_state_write "image_${service}" "$(seed_state_read "service_${service}_image_id")"
    fi
  done
  wiseeff_upgrade_state_write previous_sha "$(seed_state_read checkout_sha)"
  wiseeff_upgrade_state_write network "$(seed_state_read network)"
  wiseeff_upgrade_state_write backup_dir "$(seed_state_read backup_dir)"
}

seed_verify_manifest_identity() {
  local manifest="${seed_backup_dir}/manifest.sha256"
  [ -s "$manifest" ] || { seed_die "Recovery-point manifest is missing"; return 40; }
  [ "sha256:$(wiseeff_upgrade_fingerprint "$manifest")" = "$(seed_state_read recovery_manifest_digest)" ] || {
    seed_die "Recovery-point manifest identity changed"
    return 70
  }
}

seed_begin() {
  seed_setup_paths
  seed_prepare_run
  seed_validate_runtime || return $?
  seed_require_clean_checkout || return $?
  wiseeff_operation_lock_acquire "$lock_root" "Another WiseEff operation holds the host lock." "seed-rebuild:begin" || return $?
  trap 'wiseeff_operation_lock_release' EXIT
  seed_state_write phase planning
  seed_state_write outcome running
  seed_state_write actor_user_id "$seed_actor"
  seed_state_write organization_id "$seed_org"
  seed_state_write checkout_sha "$(seed_current_sha)"
  seed_state_write candidate_sha "$(seed_current_sha)"
  seed_state_write env_fingerprint "$(seed_current_env_fingerprint)"
  seed_state_write plan_digest "$seed_plan_digest"
  seed_state_write confirmed_plan_digest "$seed_confirm_plan"
  seed_state_write seed_digest "$seed_digest"
  seed_state_write recovery_point_verified false
  seed_state_write proxy_stopped false
  seed_state_write queue_paused_verified false
  seed_state_write writers_stopped false
  seed_state_write manager_stopped false
  seed_state_write queue_drained false
  seed_state_write publication_frozen false
  seed_state_write publication_freeze_owned false
  seed_state_write run_started_at "$(seed_now)"
  seed_require_core_plan || return $?
  seed_capture_runtime || return $?
  seed_require_initial_running || return $?
  seed_require_pinned_images || return $?
  seed_capture_publication || return $?
  seed_queue_capture_initial || return $?

  seed_phase freezing-publication
  if ! wiseeff_upgrade_publication_freeze true; then
    seed_phase recovery-required failed
    seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
    seed_write_json
    return 70
  fi
  seed_state_write publication_frozen true
  seed_state_write publication_freeze_owned "$( [ "$(seed_state_read publication_initial_frozen)" = true ] && printf false || printf true )"

  seed_phase stopping-proxy
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy || { seed_phase recovery-required failed; return 70; }
  seed_state_write proxy_stopped true
  seed_phase pausing-queue
  if [ "$(seed_state_read queue_mode)" = durable ]; then
    seed_queue_command pause || { seed_phase recovery-required failed; return 70; }
    seed_queue_verify_paused || { seed_phase recovery-required failed; return 70; }
  fi
  seed_state_write queue_paused_verified true
  seed_state_write queue_paused true
  seed_phase draining-queue
  seed_queue_drain || { seed_phase recovery-required failed; return 70; }
  seed_phase stopping-writers
  local service
  for service in api worker web; do
    wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" "$service" || { seed_phase recovery-required failed; return 70; }
  done
  if [ "$(seed_state_read service_publication-manager_present)" = true ]; then
    wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" publication-manager || { seed_phase recovery-required failed; return 70; }
    seed_state_write manager_stopped true
  else
    seed_state_write manager_stopped true
  fi
  seed_state_write writers_stopped true
  seed_verify_service_stopped || { seed_phase recovery-required failed; return 70; }
  seed_phase backing-up
  mkdir -p "$seed_backup_dir"
  chmod 700 "$seed_backup_dir"
  if ! wiseeff_upgrade_snapshot_all || ! wiseeff_upgrade_verify_backup_manifest; then
    seed_phase recovery-required failed
    seed_state_write next_action "resume-maintenance --run-id ${seed_run_id} or abort --run-id ${seed_run_id}"
    seed_write_json
    return 70
  fi
  seed_state_write recovery_point_verified true
  seed_state_write recovery_manifest_digest "sha256:$(wiseeff_upgrade_fingerprint "${seed_backup_dir}/manifest.sha256")"
  seed_phase starting-data
  wiseeff_upgrade_compose up -d --no-build postgres redis minio minio-init || { seed_phase recovery-required failed; return 70; }
  wiseeff_upgrade_wait_data_plane_ready || { seed_phase recovery-required failed; return 70; }
  seed_verify_identity || return $?
  seed_state_write phase maintenance-begun
  seed_state_write outcome running
  seed_verify_maintenance || return $?
  seed_write_json
  printf 'Seed rebuild maintenance begun. run_id=%s plan=%s backup=%s\n' "$seed_run_id" "$(seed_state_read plan_digest)" "$seed_backup_dir"
}

seed_require_core_plan() {
  local digest candidate organization actor core_seed scope
  digest="$(seed_core_value digest)"
  [ -n "$digest" ] || digest="$(seed_core_value planDigest)"
  candidate="$(seed_core_value candidateSha)"
  organization="$(seed_core_value organizationId)"
  actor="$(seed_core_value actorUserId)"
  core_seed="$(seed_core_value seedDigest)"
  scope="$(seed_core_value scope)"
  seed_valid_digest "$digest" || return $?
  if [ -n "${seed_confirm_plan:-}" ] && [ "$digest" != "$seed_confirm_plan" ]; then
    seed_die "Core plan digest does not match --confirm-plan"
    return 70
  fi
  [ "$candidate" = "$(seed_state_read checkout_sha)" ] || { seed_die "Core plan candidate SHA does not match checkout"; return 70; }
  [ "$organization" = "$(seed_state_read organization_id)" ] || { seed_die "Core plan organization does not match requested organization"; return 70; }
  [ "$actor" = "$(seed_state_read actor_user_id)" ] || { seed_die "Core plan actor does not match requested actor"; return 70; }
  [ "$scope" = atlas-aurora-nebula ] || { seed_die "Core plan scope is not Atlas/Aurora/Nebula"; return 70; }
  [ -n "$core_seed" ] || { seed_die "Core plan did not persist a seed digest"; return 70; }
  seed_state_write plan_digest "$digest"
  seed_state_write candidate_sha "$candidate"
  seed_state_write seed_digest "$core_seed"
  seed_state_write scope "$scope"
  seed_write_json
}

seed_plan() {
  seed_setup_paths
  seed_valid_run_id "$seed_run_id" || return $?
  [ ! -e "${state_root}/${seed_run_id}" ] || { seed_die "Run already exists: ${seed_run_id}"; return 10; }
  seed_require_clean_checkout || return $?
  seed_prepare_run
  seed_validate_runtime || return $?
  wiseeff_operation_lock_acquire "$lock_root" "Another WiseEff operation holds the host lock." "seed-rebuild:plan" || return $?
  trap 'wiseeff_operation_lock_release' EXIT
  seed_state_write phase planning
  seed_state_write outcome running
  seed_state_write actor_user_id "$seed_actor"
  seed_state_write organization_id "$seed_org"
  seed_state_write checkout_sha "$(seed_current_sha)"
  seed_state_write candidate_sha "$(seed_current_sha)"
  seed_state_write env_fingerprint "$(seed_current_env_fingerprint)"
  seed_state_write scope atlas-aurora-nebula
  seed_state_write recovery_point_verified false
  seed_write_json
  seed_core_command plan || { seed_phase failed-safe failed; return 20; }
  seed_require_core_plan
  seed_phase planned complete
  printf 'Seed rebuild plan recorded. run_id=%s plan=%s seed=%s\n' "$seed_run_id" "$(seed_state_read plan_digest)" "$(seed_state_read seed_digest)"
}

seed_check_core_identity() {
  local candidate organization actor core_seed scope
  candidate="$(seed_core_value candidateSha)"
  organization="$(seed_core_value organizationId)"
  actor="$(seed_core_value actorUserId)"
  core_seed="$(seed_core_value seedDigest)"
  scope="$(seed_core_value scope)"
  [ "$candidate" = "$(seed_state_read candidate_sha)" ] || { seed_die "Core candidate identity drifted"; return 70; }
  [ "$organization" = "$(seed_state_read organization_id)" ] || { seed_die "Core organization identity drifted"; return 70; }
  [ "$actor" = "$(seed_state_read actor_user_id)" ] || { seed_die "Core actor identity drifted"; return 70; }
  [ "$core_seed" = "$(seed_state_read seed_digest)" ] || { seed_die "Core seed digest drifted"; return 70; }
  [ "$scope" = atlas-aurora-nebula ] || { seed_die "Core scope drifted"; return 70; }
}

seed_command() {
  seed_load_run
  seed_bind_confirmed_plan || return $?
  case "$seed_core_requested" in
    status) ;;
    *)
      seed_valid_digest "$seed_confirm_plan" || return $?
      [ "$seed_confirm_plan" = "$(seed_state_read plan_digest)" ] || { seed_die "--confirm-plan does not match the persisted plan"; return 70; }
      ;;
  esac
  case "$seed_core_requested" in
    catalog-prepare|catalog-status) seed_valid_stage "$seed_stage" || return $? ;;
  esac
  seed_validate_runtime || return $?
  wiseeff_operation_lock_acquire "$lock_root" "Another WiseEff operation holds the host lock." "seed-rebuild:command" || return $?
  trap 'wiseeff_operation_lock_release' EXIT
  seed_verify_identity || return $?
  seed_verify_maintenance || return $?
  seed_check_core_identity || return $?
  case "$seed_core_requested" in
    status|catalog-status|catalog-prepare|catalog-publish|rebuild|verify)
      # The core checks the durable maintenance proof before every command.
      # Keep the canonical phase at maintenance-begun until verify succeeds.
      if ! seed_core_command "$seed_core_requested"; then
        seed_phase recovery-required failed
        seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
        return 70
      fi
      ;;
    *) seed_die "Unsupported core command: ${seed_core_requested}"; return 2 ;;
  esac
  printf 'Seed rebuild core command completed. run_id=%s command=%s\n' "$seed_run_id" "$seed_core_requested"
}

seed_stop_publication_manager_for_publish() {
  if [ "${seed_publication_manager_started:-false}" = true ]; then
    if ! wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" publication-manager; then
      seed_state_write publication_manager_stopped false
      return 70
    fi
    seed_publication_manager_started=false
    seed_state_write manager_stopped true
    seed_state_write publication_manager_stopped true
  fi
}

seed_publication_refreeze() {
  if ! seed_stop_publication_manager_for_publish; then
    seed_state_write publication_refrozen false
    seed_state_write phase recovery-required
    seed_state_write outcome failed
    seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
    seed_write_json
    return 70
  fi
  if [ "${seed_publication_unfrozen:-false}" = true ]; then
    seed_publication_unfrozen=false
    if wiseeff_upgrade_publication_freeze true && [ "$(seed_publication_status)" = true ]; then
      seed_state_write publication_frozen true
      seed_state_write publication_refrozen true
      seed_write_json
      return 0
    fi
    seed_state_write publication_refrozen false
    seed_state_write phase recovery-required
    seed_state_write outcome failed
    seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
    seed_write_json
    return 70
  fi
}

seed_poll_catalog_success() {
  local attempt output="${seed_run_dir}/catalog-status.part.$$" safe="${seed_run_dir}/catalog-status" code
  local attempts="${WISEEFF_SEED_REBUILD_CATALOG_STATUS_ATTEMPTS:-30}" interval="${WISEEFF_SEED_REBUILD_CATALOG_STATUS_INTERVAL_SECONDS:-2}"
  case "$attempts" in ''|*[!0-9]*) attempts=30 ;; esac
  case "$interval" in ''|*[!0-9]*) interval=2 ;; esac
  for attempt in $(seq 1 "$attempts"); do
    set +e
    seed_core_command catalog-status > /dev/null 2>&1
    code=$?
    set -e
    [ "$code" -eq 0 ] || return "$code"
    cp "${seed_run_dir}/core-output" "$safe"
    if grep -Eq '"status"[[:space:]]*:[[:space:]]*"succeeded"' "$safe" &&
      grep -Eq '"receipt"[[:space:]]*:[[:space:]]*\{' "$safe" &&
      grep -Eq '"id"[[:space:]]*:[[:space:]]*"[^"]+"' "$safe" &&
      grep -Eq '"releaseId"[[:space:]]*:[[:space:]]*"[^"]+"' "$safe" &&
      grep -Eq '"releaseDigest"[[:space:]]*:[[:space:]]*"[^"]+"' "$safe"; then
      seed_state_write catalog_receipt_verified true
      return 0
    fi
    [ "$attempt" -lt "$attempts" ] && sleep "$interval"
  done
  seed_state_write catalog_receipt_verified false
  return 70
}

seed_catalog_publish() {
  seed_load_run
  seed_bind_confirmed_plan || return $?
  [ "$seed_confirm_plan" = "$(seed_state_read plan_digest)" ] || { seed_die "Confirmed plan does not match the persisted plan"; return 70; }
  seed_valid_stage "$seed_stage" || return $?
  seed_valid_actor "$seed_publish_actor" || return $?
  seed_valid_digest "$seed_confirm_artifact" || return $?
  seed_state_write publication_stage "$seed_stage"
  seed_state_write confirm_artifact "$seed_confirm_artifact"
  seed_validate_runtime || return $?
  wiseeff_operation_lock_acquire "$lock_root" "Another WiseEff operation holds the host lock." "seed-rebuild:catalog-publish" || return $?
  trap 'wiseeff_operation_lock_release' EXIT
  seed_verify_identity || return $?
  seed_verify_maintenance || return $?
  seed_check_core_identity || return $?
  [ "$(seed_publication_status)" = true ] || { seed_die "Catalog must be frozen before controlled publish"; return 70; }
  seed_publication_unfrozen=false
  trap 'seed_publication_refreeze; wiseeff_operation_lock_release' EXIT
  trap 'seed_publication_refreeze; exit 70' INT TERM HUP
  if ! wiseeff_upgrade_publication_freeze false; then
    seed_phase recovery-required failed
    seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
    return 70
  fi
  seed_publication_unfrozen=true
  seed_state_write publication_frozen false
  seed_state_write publication_pending true
  seed_write_json
  seed_verify_service_stopped || { seed_publication_refreeze; return 70; }
  if ! seed_core_command catalog-publish; then
    seed_publication_refreeze || true
    seed_phase recovery-required failed
    seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
    return 70
  fi
  if ! wiseeff_upgrade_compose up -d --no-build --no-deps publication-manager; then
    seed_publication_refreeze || true
    seed_phase recovery-required failed
    seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
    return 70
  fi
  seed_publication_manager_started=true
  seed_state_write manager_stopped false
  seed_write_json
  if ! seed_poll_catalog_success; then
    seed_publication_refreeze || true
    seed_phase recovery-required failed
    seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
    return 70
  fi
  seed_publication_refreeze || return 70
  seed_state_write publication_pending false
  seed_state_write catalog_published true
  seed_write_json
  printf 'Catalog publication completed and was refrozen. run_id=%s\n' "$seed_run_id"
}

seed_start_original_services() {
  local service status
  for service in api worker web; do
    status="$(seed_state_read "service_${service}_status")"
    if [ "$status" = running ]; then
      wiseeff_upgrade_compose up -d --no-build --no-deps "$service" || return 1
    else
      wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" "$service" || return 1
    fi
  done
  if [ "$(seed_state_read service_publication-manager_present)" = true ]; then
    if [ "$(seed_state_read service_publication-manager_status)" = running ]; then
      wiseeff_upgrade_compose up -d --no-build --no-deps publication-manager || return 1
    else
      wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" publication-manager || return 1
    fi
  fi
}

seed_restore_queue_state() {
  case "$(seed_state_read queue_initial_paused)" in
    true)
      seed_queue_command pause || return 1
      seed_queue_verify_paused || return 1
      ;;
    false)
      seed_queue_command resume || return 1
      seed_queue_verify_resumed || return 1
      ;;
    not-applicable) ;;
    *) return 1 ;;
  esac
}

seed_restore_proxy_state() {
  if [ "$(seed_state_read service_proxy_status)" = running ]; then
    wiseeff_upgrade_compose up -d --no-build --no-deps proxy || return 1
    wiseeff_upgrade_wait_public_probe || return 1
  else
    wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy || return 1
  fi
}

seed_restore_publication_state() {
  if [ "$(seed_state_read publication_initial_frozen)" = true ]; then
    wiseeff_upgrade_publication_freeze true || return 1
  else
    wiseeff_upgrade_publication_freeze false || return 1
  fi
  if [ "$(seed_state_read publication_initial_frozen)" = true ]; then
    [ "$(seed_publication_status)" = true ]
  else
    [ "$(seed_publication_status)" = false ]
  fi
}

seed_verify_original_state() {
  local service container status expected
  for service in postgres redis minio api worker web proxy publication-manager; do
    [ "$(seed_state_read "service_${service}_present")" = true ] || continue
    container="$(seed_state_read "container_${service}")"
    status="$(wiseeff_upgrade_docker inspect -f '{{.State.Status}}' "$container" 2>/dev/null || true)"
    expected="$(seed_state_read "service_${service}_status")"
    [ "$status" = "$expected" ] || {
      seed_die "Service ${service} did not return to its observed state"
      return 70
    }
  done
  seed_restore_queue_state || { seed_die "Queue state did not return to its observed state"; return 70; }
  seed_restore_publication_state || { seed_die "Publication state did not return to its observed state"; return 70; }
}

seed_restore_initial_state() {
  seed_phase restoring-state running
  wiseeff_upgrade_compose up -d --no-build --no-deps postgres redis minio minio-init || return 1
  wiseeff_upgrade_wait_data_plane_ready || return 1
  seed_start_original_services || return 1
  seed_restore_queue_state || return 1
  seed_restore_proxy_state || return 1
  seed_restore_publication_state || return 1
  seed_verify_identity || return 1
  seed_verify_original_state || return 1
  seed_state_write proxy_stopped false
  seed_state_write queue_paused_verified false
  seed_state_write writers_stopped false
  seed_state_write manager_stopped false
  seed_state_write publication_frozen "$(seed_state_read publication_initial_frozen)"
  seed_write_json
}

seed_fail_closed() {
  seed_state_write phase recovery-required
  seed_state_write outcome failed
  seed_state_write next_action "recover --run-id ${seed_run_id} --confirm restore-${seed_run_id}"
  seed_state_write recovery_point_verified "$(seed_state_read recovery_point_verified)"
  seed_write_json
}

seed_finish() {
  seed_load_run
  seed_bind_confirmed_plan || return $?
  [ "$seed_confirm_plan" = "$(seed_state_read plan_digest)" ] || { seed_die "Confirmed plan does not match the persisted plan"; return 70; }
  seed_validate_runtime || return $?
  wiseeff_operation_lock_acquire "$lock_root" "Another WiseEff operation holds the host lock." "seed-rebuild:finish" || return $?
  trap 'wiseeff_operation_lock_release' EXIT
  seed_verify_identity || return $?
  seed_verify_maintenance || return $?
  seed_check_core_identity || return $?
  # Keep phase=maintenance-begun while core verify runs; the core refuses any
  # proof that is not the durable maintenance phase.
  if ! seed_core_command verify || ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$(seed_state_read core_last_output)" || ! grep -Eq '"status"[[:space:]]*:[[:space:]]*"verified"' "$(seed_state_read core_last_output)" || ! grep -Eq '"backendVerified"[[:space:]]*:[[:space:]]*true' "$(seed_state_read core_last_output)"; then
    seed_fail_closed
    return 70
  fi
  seed_state_write backend_verified true
  if ! seed_restore_initial_state; then
    seed_fail_closed
    return 70
  fi
  seed_phase completed complete
  seed_state_write outcome completed
  seed_state_write next_action none
  seed_write_json
  printf 'Seed rebuild completed. run_id=%s\n' "$seed_run_id"
}

seed_resume_maintenance() {
  seed_load_run
  seed_validate_runtime || return $?
  [ "$(seed_state_read recovery_point_verified)" != true ] || { seed_die "A verified recovery point already exists; use command/finish or recover"; return 70; }
  case "$(seed_state_read phase)" in recovery-required|backing-up|starting-data) ;; *) seed_die "Run is not waiting on an unverified backup"; return 70 ;; esac
  wiseeff_operation_lock_acquire "$lock_root" "Another WiseEff operation holds the host lock." "seed-rebuild:resume-maintenance" || return $?
  trap 'wiseeff_operation_lock_release' EXIT
  seed_verify_identity || return $?
  seed_verify_service_stopped || { seed_die "Cannot resume backup without the original isolation proof"; return 70; }
  [ "$(seed_state_read queue_paused_verified)" = true ] || { seed_die "Cannot resume backup without queue pause proof"; return 70; }
  wiseeff_upgrade_publication_is_frozen || { seed_die "Cannot resume backup without publication freeze proof"; return 70; }
  seed_phase backing-up running
  mkdir -p "$seed_backup_dir"
  chmod 700 "$seed_backup_dir"
  if ! wiseeff_upgrade_snapshot_all || ! wiseeff_upgrade_verify_backup_manifest; then
    seed_phase recovery-required failed
    seed_state_write next_action "resume-maintenance --run-id ${seed_run_id} or abort --run-id ${seed_run_id}"
    return 70
  fi
  seed_state_write recovery_point_verified true
  seed_state_write recovery_manifest_digest "sha256:$(wiseeff_upgrade_fingerprint "${seed_backup_dir}/manifest.sha256")"
  wiseeff_upgrade_compose up -d --no-build postgres redis minio minio-init || { seed_phase recovery-required failed; return 70; }
  wiseeff_upgrade_wait_data_plane_ready || { seed_phase recovery-required failed; return 70; }
  seed_verify_identity || return $?
  seed_state_write phase maintenance-begun
  seed_state_write outcome running
  seed_verify_maintenance || return $?
  printf 'Seed rebuild maintenance begun after backup retry. run_id=%s backup=%s
' "$seed_run_id" "$seed_backup_dir"
}

seed_abort() {
  seed_load_run
  seed_validate_runtime || return $?
  [ "$(seed_state_read recovery_point_verified)" != true ] || { seed_die "Verified recovery point exists; use recover to restore stores"; return 70; }
  case "$(seed_state_read phase)" in recovery-required|backing-up|starting-data|stopping-proxy|pausing-queue|draining-queue|stopping-writers|freezing-publication) ;; *) seed_die "Run is not eligible for unverified-backup abort"; return 70 ;; esac
  wiseeff_operation_lock_acquire "$lock_root" "Another WiseEff operation holds the host lock." "seed-rebuild:abort" || return $?
  trap 'wiseeff_operation_lock_release' EXIT
  seed_verify_identity || return $?
  if ! seed_restore_initial_state; then
    seed_fail_closed
    return 70
  fi
  seed_state_write phase aborted
  seed_state_write outcome aborted
  seed_state_write next_action none
  seed_write_json
  printf 'Seed rebuild aborted and original host state restored. run_id=%s
' "$seed_run_id"
}

seed_recover_whole_state() {
  seed_set_upgrade_restore_state
  wiseeff_upgrade_verify_backup_manifest || return 1
  seed_verify_manifest_identity || return 1
  wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" proxy || return 1
  if [ "$(seed_state_read queue_mode)" = durable ]; then
    seed_queue_command pause || return 1
  fi
  for service in api worker web publication-manager; do
    if [ "$(seed_state_read "service_${service}_present")" = true ]; then
      wiseeff_upgrade_compose stop -t "${WISEEFF_UPGRADE_STOP_TIMEOUT_SECONDS:-60}" "$service" || return 1
    fi
  done
  wiseeff_upgrade_compose up -d --no-build postgres redis minio minio-init || return 1
  wiseeff_upgrade_wait_data_plane_ready || return 1
  wiseeff_upgrade_restore_postgres || return 1
  wiseeff_upgrade_restore_objects || return 1
  wiseeff_upgrade_restore_redis || return 1
  wiseeff_upgrade_wait_data_plane_ready || return 1
  seed_start_original_services || return 1
  seed_restore_queue_state || return 1
  seed_restore_proxy_state || return 1
  seed_restore_publication_state || return 1
  seed_verify_identity || return 1
  seed_verify_original_state || return 1
}

seed_recover() {
  seed_load_run
  seed_validate_runtime || return $?
  [ "$(seed_state_read recovery_point_verified)" = true ] || { seed_die "Whole-state recovery refuses an unverified recovery point; use resume-maintenance or abort"; return 70; }
  [ "$seed_confirm" = "restore-${seed_run_id}" ] || { seed_die "Recovery requires --confirm restore-${seed_run_id}"; return 2; }
  case "$(seed_state_read phase)" in
    recovery-required|core-rebuild|core-catalog-prepare|catalog-publishing|verified|maintenance-begun|backing-up|starting-data|recovering|restoring-state) ;;
    *) seed_die "Run is not eligible for whole-state recovery"; return 70 ;;
  esac
  wiseeff_operation_lock_acquire "$lock_root" "Another WiseEff operation holds the host lock." "seed-rebuild:recover" || return $?
  trap 'wiseeff_operation_lock_release' EXIT
  seed_verify_identity || return $?
  seed_phase recovering running
  if ! seed_recover_whole_state; then
    seed_fail_closed
    return 70
  fi
  seed_state_write phase recovered
  seed_state_write outcome recovered
  seed_state_write next_action none
  seed_write_json
  printf 'Seed rebuild recovery completed. run_id=%s\n' "$seed_run_id"
}

seed_status() {
  seed_setup_paths
  seed_valid_run_id "$seed_run_id" || return $?
  seed_run_dir="${state_root}/${seed_run_id}"
  [ -r "${seed_run_dir}/wrapper-state.json" ] || { seed_die "Unknown seed rebuild run: ${seed_run_id}"; return 10; }
  cat "${seed_run_dir}/wrapper-state.json"
}

seed_rebuild_main() {
  local action="${1:-}"; shift || true
  seed_run_id=""
  seed_actor=""
  seed_publish_actor=""
  seed_org=""
  seed_confirm_plan=""
  seed_confirm_artifact=""
  seed_confirm=""
  seed_stage=""
  seed_core_requested=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run-id) seed_need_value "$@" || return $?; seed_run_id="$2"; shift 2 ;;
      --actor) seed_need_value "$@" || return $?; seed_actor="$2"; seed_publish_actor="$2"; shift 2 ;;
      --organization-id) seed_need_value "$@" || return $?; seed_org="$2"; shift 2 ;;
      --confirm-plan) seed_need_value "$@" || return $?; seed_confirm_plan="$2"; shift 2 ;;
      --confirm-artifact) seed_need_value "$@" || return $?; seed_confirm_artifact="$2"; shift 2 ;;
      --stage) seed_need_value "$@" || return $?; seed_stage="$2"; shift 2 ;;
      --confirm) seed_need_value "$@" || return $?; seed_confirm="$2"; shift 2 ;;
      --core-command) seed_need_value "$@" || return $?; seed_core_requested="$2"; shift 2 ;;
      --help|-h) seed_usage; return 0 ;;
      --env-file) seed_need_value "$@" || return $?; WISEEFF_SEED_REBUILD_ENV_FILE="$2"; shift 2 ;;
      --state-dir) seed_need_value "$@" || return $?; WISEEFF_SEED_REBUILD_STATE_DIR="$2"; shift 2 ;;
      --backup-root) seed_need_value "$@" || return $?; WISEEFF_SEED_REBUILD_BACKUP_ROOT="$2"; shift 2 ;;
      *) seed_die "Unknown option: $1"; seed_usage >&2; return 2 ;;
    esac
  done
  case "$action" in
    --help|-h|'') seed_usage; return 0 ;;
    plan)
      [ -n "$seed_run_id" ] && [ -n "$seed_actor" ] && [ -n "$seed_org" ] || { seed_die "plan requires --run-id, --actor and --organization-id"; return 2; }
      seed_plan
      ;;
    begin)
      [ -n "$seed_run_id" ] && [ -n "$seed_confirm_plan" ] || { seed_die "begin requires --run-id and --confirm-plan"; return 2; }
      seed_valid_digest "$seed_confirm_plan" || return $?
      seed_load_run
      [ "$seed_confirm_plan" = "$(seed_state_read plan_digest)" ] || { seed_die "--confirm-plan does not match the persisted plan"; return 70; }
      [ "$(seed_state_read phase)" = planned ] || { seed_die "begin requires a planned run"; return 70; }
      seed_begin
      ;;
    command)
      [ -n "$seed_run_id" ] && [ -n "$seed_core_requested" ] || { seed_die "command requires --run-id and --core-command"; return 2; }
      case "$seed_core_requested" in
        catalog-prepare|catalog-status) seed_valid_stage "$seed_stage" || return $? ;;
        catalog-publish) seed_valid_stage "$seed_stage" || return $?; seed_valid_digest "$seed_confirm_artifact" || return $?; seed_valid_actor "$seed_publish_actor" || return $? ;;
        plan) seed_die "plan is only available before begin"; return 2 ;;
        status) ;;
        rebuild|verify) ;;
        *) seed_die "Unsupported core command: $seed_core_requested"; return 2 ;;
      esac
      if [ "$seed_core_requested" = catalog-publish ]; then
        seed_catalog_publish
        return $?
      fi
      seed_command
      ;;
    rebuild|catalog-prepare|catalog-status|verify)
      seed_core_requested="$action"
      [ -n "$seed_run_id" ] || { seed_die "${action} requires --run-id"; return 2; }
      case "$action" in catalog-prepare|catalog-status) seed_valid_stage "$seed_stage" || return $? ;; esac
      seed_command
      ;;
    catalog-publish)
      [ -n "$seed_run_id" ] || { seed_die "catalog-publish requires --run-id"; return 2; }
      seed_valid_stage "$seed_stage" || return $?
      seed_valid_digest "$seed_confirm_artifact" || return $?
      seed_valid_actor "$seed_publish_actor" || return $?
      seed_catalog_publish
      ;;
    finish)
      [ -n "$seed_run_id" ] || { seed_die "finish requires --run-id"; return 2; }
      seed_finish
      ;;
    recover)
      [ -n "$seed_run_id" ] && [ -n "$seed_confirm" ] || { seed_die "recover requires --run-id and --confirm"; return 2; }
      seed_recover
      ;;
    resume-maintenance)
      [ -n "$seed_run_id" ] || { seed_die "resume-maintenance requires --run-id"; return 2; }
      seed_resume_maintenance
      ;;
    abort)
      [ -n "$seed_run_id" ] || { seed_die "abort requires --run-id"; return 2; }
      seed_abort
      ;;
    status)
      [ -n "$seed_run_id" ] || { seed_die "status requires --run-id"; return 2; }
      seed_status
      ;;
    *) seed_die "Unknown action: ${action}"; seed_usage >&2; return 2 ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  seed_rebuild_main "$@"
fi
