import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "ops/self-hosted/scripts/upgrade.sh";

function runUpgrade(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function runLibrary(command: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  return spawnSync("bash", ["-c", `source ops/self-hosted/scripts/upgrade-lib.sh\n${command}`, "test", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

function runDataPlaneLibrary(prefix: string, command: string, env: NodeJS.ProcessEnv = {}) {
  const runDir = mkdtempSync(join(tmpdir(), prefix));
  const result = runLibrary(command, [runDir], {
    WISEEFF_UPGRADE_HEALTH_ATTEMPTS: "1",
    WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS: "0",
    ...env
  });
  return { result, runDir };
}

function runDataPlaneFixture(
  statuses: {
    postgresHealth?: string;
    redisHealth?: string;
    minioState?: string;
    minioInitState?: string;
    minioInitExitCode?: string;
  },
  attempts = 1
) {
  const script = `
    upgrade_run_dir="$1"
    upgrade_run_id=data-plane-test
    wiseeff_upgrade_state_write phase restarting-data
    wiseeff_upgrade_compose() {
      if [ "$1" = "ps" ]; then printf '%s-container\\n' "$3"; fi
    }
    wiseeff_upgrade_docker() {
      [ "$1" = "inspect" ] || return 1
      template="$3"
      container="$4"
      case "$container:$template" in
        postgres-container:*Health*) printf '%s\\n' '${statuses.postgresHealth ?? "healthy"}' ;;
        redis-container:*Health*) printf '%s\\n' '${statuses.redisHealth ?? "healthy"}' ;;
        minio-container:*State.Status*) printf 'call\\n' >> "$upgrade_run_dir/minio-status-calls"; printf '%s\\n' '${statuses.minioState ?? "running"}' ;;
        minio-init-container:*State.Status*) printf '%s\\n' '${statuses.minioInitState ?? "exited"}' ;;
        minio-init-container:*ExitCode*) printf '%s\\n' '${statuses.minioInitExitCode ?? "0"}' ;;
        *) return 1 ;;
      esac
    }
    if wiseeff_upgrade_wait_data_plane_ready; then
      exit 0
    else
      result=$?
      printf 'minio-status-calls=%s\\n' "$(wc -l < "$upgrade_run_dir/minio-status-calls" 2>/dev/null | tr -d ' ' || printf '0')"
      exit "$result"
    fi
  `;
  return runDataPlaneLibrary("wiseeff-upgrade-data-plane-", script, {
    WISEEFF_UPGRADE_HEALTH_ATTEMPTS: String(attempts)
  });
}

function runDataPlaneSequenceFixture(
  sequences: {
    minioStates: string[];
    minioInitStates: string[];
    minioInitExitCodes?: string[];
  },
  attempts = 3
) {
  return runDataPlaneLibrary("wiseeff-upgrade-data-plane-sequence-", `
    upgrade_run_dir="$1"
    upgrade_run_id=data-plane-sequence-test
    minio_states=(${sequences.minioStates.join(" ")})
    minio_init_states=(${sequences.minioInitStates.join(" ")})
    minio_init_exit_codes=(${(sequences.minioInitExitCodes ?? ["0"]).join(" ")})
    minio_inspection_file="$upgrade_run_dir/minio-inspections"
    minio_init_inspection_file="$upgrade_run_dir/minio-init-inspections"
    printf '0\\n' > "$minio_inspection_file"
    printf '0\\n' > "$minio_init_inspection_file"
    wiseeff_upgrade_state_write phase restarting-data
    sequence_value() {
      local sequence_name="$1"
      local index="$2"
      local last
      if [ "$sequence_name" = "minio" ]; then
        last=$((\${#minio_states[@]} - 1))
        [ "$index" -le "$last" ] || index="$last"
        printf '%s\\n' "\${minio_states[$index]}"
      else
        last=$((\${#minio_init_states[@]} - 1))
        [ "$index" -le "$last" ] || index="$last"
        printf '%s\\n' "\${minio_init_states[$index]}"
      fi
    }
    wiseeff_upgrade_compose() {
      if [ "$1" = "ps" ]; then printf '%s-container\\n' "$3"; fi
    }
    wiseeff_upgrade_docker() {
      [ "$1" = "inspect" ] || return 1
      template="$3"
      container="$4"
      case "$container:$template" in
        minio-container:*State.Status*)
          index="$(cat "$minio_inspection_file")"
          printf '%s\\n' "$((index + 1))" > "$minio_inspection_file"
          sequence_value minio "$index"
          ;;
        minio-init-container:*State.Status*)
          index="$(cat "$minio_init_inspection_file")"
          printf '%s\\n' "$((index + 1))" > "$minio_init_inspection_file"
          sequence_value minio-init "$index"
          ;;
        minio-init-container:*ExitCode*)
          index=$(( $(cat "$minio_init_inspection_file") - 1 ))
          last=$((\${#minio_init_exit_codes[@]} - 1))
          [ "$index" -le "$last" ] || index="$last"
          printf '%s\\n' "\${minio_init_exit_codes[$index]}"
          ;;
        postgres-container:*Health*|redis-container:*Health*) printf 'healthy\\n' ;;
        *) return 1 ;;
      esac
    }
    if wiseeff_upgrade_wait_data_plane_ready; then
      printf 'minio-inspections=%s\\n' "$(cat "$minio_inspection_file")"
      exit 0
    else
      result=$?
      printf 'minio-inspections=%s\\n' "$(cat "$minio_inspection_file")"
      printf 'minio-init-inspections=%s\\n' "$(cat "$minio_init_inspection_file")"
      exit "$result"
    fi
  `, {
    WISEEFF_UPGRADE_HEALTH_ATTEMPTS: String(attempts)
  });
}

function runCandidateWorkerFixture(action: "apply" | "resume", workerHealthy: boolean, resumePhase = "api-ready", queueFailure = false) {
  const runDir = mkdtempSync(join(tmpdir(), `wiseeff-upgrade-candidate-${action}-`));
  writeFileSync(join(runDir, "trace.log"), "");
  if (action === "resume") {
    writeFileSync(join(runDir, "outcome"), "running\n");
    writeFileSync(join(runDir, "phase"), `${resumePhase}\n`);
    writeFileSync(join(runDir, "migration_started"), "true\n");
    writeFileSync(join(runDir, "candidate_image_tag"), "wiseeff-app:candidate\n");
  }
  const result = runLibrary(`
    run_dir="$1"
    trace="$run_dir/trace.log"
    worker_healthy="$2"
    queue_failure="$4"
    upgrade_run_dir="$run_dir"
    upgrade_backup_dir="$run_dir/backup"
    upgrade_run_id=candidate-${action}
    upgrade_target_sha=target-sha
    upgrade_previous_sha=previous-sha
    upgrade_env_file="$run_dir/env"
    : > "$upgrade_env_file"
    upgrade_json=false
    upgrade_restart=false
    upgrade_yes=true
    upgrade_non_interactive=true
    upgrade_candidate_image_tag=wiseeff-app:candidate
    if [ "$3" = "apply" ]; then wiseeff_upgrade_state_write phase initialized; fi
    wiseeff_upgrade_acquire_lock() { return 0; }
    wiseeff_upgrade_release_lock() { :; }
    wiseeff_upgrade_validate_env() { return 0; }
    wiseeff_upgrade_write_status() { :; }
    wiseeff_upgrade_preflight() {
      upgrade_previous_sha=previous-sha
      upgrade_target_sha=target-sha
      return 0
    }
    wiseeff_upgrade_init_run() {
      upgrade_run_dir="$run_dir"
      wiseeff_upgrade_state_write phase initialized
    }
    wiseeff_upgrade_collect_runtime() { :; }
    wiseeff_upgrade_collect_volumes() { :; }
    wiseeff_upgrade_store_plan() { :; }
    wiseeff_upgrade_print_plan() { :; }
    wiseeff_upgrade_confirm() { :; }
    wiseeff_upgrade_tag_previous_images() { :; }
    wiseeff_upgrade_build_candidate() { :; }
    wiseeff_upgrade_stop_old_stack() { :; }
    wiseeff_upgrade_snapshot_all() { :; }
    wiseeff_upgrade_wait_data_plane_ready() { :; }
    wiseeff_upgrade_git() { :; }
    wiseeff_upgrade_compose() {
      printf 'compose %s\\n' "$*" >> "$trace"
      return 0
    }
    wiseeff_upgrade_compose_for_image() {
      printf 'compose-image %s\\n' "$*" >> "$trace"
      return 0
    }
    wiseeff_upgrade_probe_api() { :; }
    wiseeff_upgrade_probe_web() {
      printf 'web-probe\\n' >> "$trace"
      return 0
    }
    wiseeff_upgrade_probe_worker() {
      printf 'worker-probe\\n' >> "$trace"
      [ "$worker_healthy" = "true" ]
    }
    wiseeff_upgrade_queue_command() {
      printf 'queue %s\\n' "$*" >> "$trace"
      if [ "$queue_failure" = "true" ]; then
        printf 'queue resume failed M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer raw-queue-secret\\n'
        return 97
      fi
      return 0
    }
    wiseeff_upgrade_queue_command_for_image() {
      printf 'queue-image %s\\n' "$*" >> "$trace"
      if [ "$queue_failure" = "true" ]; then
        printf 'queue resume failed M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer raw-queue-secret\\n'
        return 97
      fi
      return 0
    }
    wiseeff_upgrade_public_probe() {
      printf 'public-probe\\n' >> "$trace"
      return 0
    }
    wiseeff_upgrade_verify_final_state() { return 0; }
    wiseeff_upgrade_status() { :; }
    wiseeff_upgrade_load_run() {
      upgrade_run_dir="$run_dir"
      upgrade_previous_sha=previous-sha
      upgrade_target_sha=target-sha
      upgrade_candidate_image_tag=wiseeff-app:candidate
    }
    if [ "$3" = "apply" ]; then
      wiseeff_upgrade_run_apply
    else
      wiseeff_upgrade_run_resume
    fi
    status=$?
    cat "$trace" 2>/dev/null || true
    exit "$status"
  `, [runDir, String(workerHealthy), action, String(queueFailure)]);
  return { result, runDir };
}

type AdvancedResumePhase = "queue-resumed" | "starting-proxy" | "validating-public";

function runAdvancedResumeFixture(
  phase: AdvancedResumePhase,
  options: {
    workerHealthy?: boolean;
    proxyStopSucceeds?: boolean;
    apiReady?: boolean;
    webReady?: boolean;
    finalWorkerHealthy?: boolean;
  } = {}
) {
  const runDir = mkdtempSync(join(tmpdir(), `wiseeff-upgrade-advanced-resume-${phase}-`));
  writeFileSync(join(runDir, "outcome"), "running\n");
  writeFileSync(join(runDir, "phase"), `${phase}\n`);
  writeFileSync(join(runDir, "migration_started"), "true\n");
  writeFileSync(join(runDir, "candidate_image_tag"), "wiseeff-app:candidate\n");
  writeFileSync(join(runDir, "trace.log"), "");

  const result = runLibrary(`
    run_dir="$1"
    phase="$2"
    worker_healthy="$3"
    proxy_stop_succeeds="$4"
    api_ready="$5"
    web_ready="$6"
    final_worker_healthy="$7"
    upgrade_run_dir="$run_dir"
    upgrade_backup_dir="$run_dir/backup"
    upgrade_run_id=advanced-resume
    upgrade_target_sha=target-sha
    upgrade_previous_sha=previous-sha
    upgrade_env_file="$run_dir/env"
    : > "$upgrade_env_file"
    upgrade_json=false
    upgrade_candidate_image_tag=wiseeff-app:candidate
    wiseeff_upgrade_state_write phase "$phase"
    wiseeff_upgrade_state_write outcome running
    wiseeff_upgrade_state_write migration_started true

    wiseeff_upgrade_reject_root_runtime() { return 0; }
    wiseeff_upgrade_acquire_lock() { return 0; }
    wiseeff_upgrade_release_lock() { :; }
    wiseeff_upgrade_validate_env() { return 0; }
    wiseeff_upgrade_write_status() { :; }
    wiseeff_upgrade_status() { :; }
    wiseeff_upgrade_load_run() {
      upgrade_run_dir="$run_dir"
      upgrade_previous_sha=previous-sha
      upgrade_target_sha=target-sha
      upgrade_candidate_image_tag=wiseeff-app:candidate
    }
    wiseeff_upgrade_git() { :; }
    wiseeff_upgrade_compose() {
      case "$1" in
        stop)
          service="\${!#}"
          printf '%s\n' "\${service}-stop" >> "$run_dir/trace.log"
          [ "$service" != "proxy" ] || [ "$proxy_stop_succeeds" = "true" ]
          ;;
        *)
          printf 'compose %s\n' "$*" >> "$run_dir/trace.log"
          ;;
      esac
    }
    wiseeff_upgrade_compose_for_image() {
      printf '%s\n' "proxy-up" >> "$run_dir/trace.log"
      return 0
    }
    wiseeff_upgrade_probe_api() {
      printf 'api-probe %s\n' "$1" >> "$run_dir/trace.log"
      [ "$1" != "/health/ready" ] || [ "$api_ready" = "true" ]
    }
    wiseeff_upgrade_probe_worker() {
      printf 'worker-probe\n' >> "$run_dir/trace.log"
      [ "$worker_healthy" = "true" ]
    }
    wiseeff_upgrade_probe_web() {
      printf 'web-probe\n' >> "$run_dir/trace.log"
      [ "$web_ready" = "true" ]
    }
    wiseeff_upgrade_public_probe() {
      printf 'public-probe\n' >> "$run_dir/trace.log"
      return 0
    }
    wiseeff_upgrade_verify_final_state() {
      printf 'final-verification\n' >> "$run_dir/trace.log"
      if [ "$final_worker_healthy" = "true" ]; then
        return 0
      fi
      wiseeff_upgrade_record_failure validating-public worker candidate-worker-health \\
        'The candidate worker liveness or Docker health probe failed during final verification.'
      return 1
    }
    wiseeff_upgrade_queue_command_for_image() {
      printf 'queue-image %s\n' "$*" >> "$run_dir/trace.log"
      return 0
    }
    if wiseeff_upgrade_run_resume; then
      status=0
    else
      status=$?
    fi
    cat "$run_dir/trace.log"
    exit "$status"
  `, [
    runDir,
    phase,
    String(options.workerHealthy ?? true),
    String(options.proxyStopSucceeds ?? true),
    String(options.apiReady ?? true),
    String(options.webReady ?? true),
    String(options.finalWorkerHealthy ?? true)
  ]);
  return { result, runDir };
}

function runCandidateRecoveryFixture(options: {
  candidateImageAvailable?: boolean;
  confirm?: string;
  failedPhase?: string;
  manifestValid?: boolean;
  outcome?: string;
  phase?: string;
  workerHealthy?: boolean;
  workerStopSucceeds?: boolean;
} = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-candidate-recovery-"));
  writeFileSync(join(runDir, "outcome"), (options.outcome ?? "recovery-required") + "\n");
  writeFileSync(join(runDir, "phase"), (options.phase ?? "recovery-required") + "\n");
  writeFileSync(join(runDir, "failed_phase"), (options.failedPhase ?? "validating-public") + "\n");
  writeFileSync(join(runDir, "migration_started"), "true\n");
  writeFileSync(join(runDir, "recovery_point_verified"), "true\n");
  writeFileSync(join(runDir, "candidate_image_tag"), "wiseeff-app:candidate\n");
  writeFileSync(join(runDir, "trace.log"), "");

  const result = runLibrary(`
    run_dir="$1"
    candidate_image_available="$2"
    manifest_valid="$3"
    worker_healthy="$4"
    worker_stop_succeeds="$6"
    upgrade_run_dir="$run_dir"
    upgrade_backup_dir="$run_dir/backup"
    upgrade_run_id=candidate-recovery
    upgrade_target_sha=target-sha
    upgrade_previous_sha=previous-sha
    upgrade_candidate_image_tag=wiseeff-app:candidate
    upgrade_env_file="$run_dir/env"
    upgrade_confirm="$5"
    upgrade_json=false
    upgrade_action=recover-candidate
    : > "$upgrade_env_file"

    trace() { printf '%s\n' "$*" >> "$run_dir/trace.log"; }
    wiseeff_upgrade_reject_root_runtime() { return 0; }
    wiseeff_upgrade_load_run() {
      upgrade_run_dir="$run_dir"
      upgrade_backup_dir="$run_dir/backup"
      upgrade_previous_sha=previous-sha
      upgrade_target_sha=target-sha
      upgrade_candidate_image_tag=wiseeff-app:candidate
    }
    wiseeff_upgrade_acquire_lock() { return 0; }
    wiseeff_upgrade_release_lock() { :; }
    wiseeff_upgrade_validate_env() { return 0; }
    wiseeff_upgrade_write_status() { :; }
    wiseeff_upgrade_git() { trace "git $*"; return 0; }
    wiseeff_upgrade_verify_backup_manifest() {
      trace manifest-verify
      [ "$manifest_valid" = "true" ]
    }
    wiseeff_upgrade_docker() {
      trace "docker $*"
      if [ "$candidate_image_available" = "true" ] &&
        [ "$1" = "image" ] && [ "$2" = "inspect" ] &&
        [ "$3" = "--format" ] && [ "$4" = "{{.Id}}" ]; then
        printf 'sha256:candidate\n'
        return 0
      fi
      return 1
    }
    wiseeff_upgrade_compose() {
      if [ "$1" = "stop" ]; then
        service="\${!#}"
        trace "\${service}-stop"
        if [ "\${service}" = "worker" ] && [ "$worker_stop_succeeds" != "true" ]; then return 93; fi
      else
        trace "compose $*"
      fi
      return 0
    }
    wiseeff_upgrade_compose_for_image() {
      image="$1"
      shift
      service="\${!#}"
      trace "\${service}-up image=\${image}"
      return 0
    }
    wiseeff_upgrade_queue_command_for_image() {
      trace "queue-$1 image=$2"
      return 0
    }
    wiseeff_upgrade_probe_api() { trace "api-probe $1"; return 0; }
    wiseeff_upgrade_probe_worker() {
      trace worker-probe
      [ "$worker_healthy" = "true" ]
    }
    wiseeff_upgrade_probe_web() { trace web-probe; return 0; }
    wiseeff_upgrade_public_probe() { trace public-probe; return 0; }
    wiseeff_upgrade_verify_final_state() {
      trace "final-verification recovery-verified=$(wiseeff_upgrade_state_read recovery_verified) outcome=$(wiseeff_upgrade_state_read outcome)"
      return 0
    }
    wiseeff_upgrade_restore_postgres() { trace restore-postgres-must-not-run; return 1; }
    wiseeff_upgrade_restore_objects() { trace restore-minio-must-not-run; return 1; }
    wiseeff_upgrade_restore_redis() { trace restore-redis-must-not-run; return 1; }

    if wiseeff_upgrade_run_recover_candidate; then status=0; else status=$?; fi
    cat "$run_dir/trace.log"
    exit "$status"
  `, [
    runDir,
    String(options.candidateImageAvailable ?? true),
    String(options.manifestValid ?? true),
    String(options.workerHealthy ?? true),
    options.confirm ?? "recover-candidate-candidate-recovery",
    String(options.workerStopSucceeds ?? true),
  ]);
  return { result, runDir };
}

function runFinalVerificationFixture(options: {
  candidateImageAvailable?: boolean;
  envChanged?: boolean;
  missingService?: string;
  reverseProxyMountOrder?: boolean;
  unchangedService?: string;
  workerHealthy?: boolean;
  wrongComposeProject?: boolean;
  wrongImageService?: string;
  wrongVolumeService?: string;
} = {}) {
  const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-final-verification-"));
  const envFile = join(runDir, "env");
  writeFileSync(envFile, "");
  writeFileSync(join(runDir, "phase"), "validating-public\n");
  writeFileSync(join(runDir, "candidate_image_tag"), "wiseeff-app:candidate\n");
  writeFileSync(join(runDir, "compose_project"), "self-hosted\n");
  writeFileSync(join(runDir, "env_fingerprint"), `${createHash("sha256").update("").digest("hex")}\n`);
  writeFileSync(join(runDir, "trace.log"), "");
  for (const service of ["postgres", "redis", "minio", "api", "worker", "web", "proxy"]) {
    writeFileSync(join(runDir, `container_${service}`), `previous-${service}\n`);
  }
  writeFileSync(join(runDir, "volumes_postgres"), "postgres-data=/var/lib/postgresql/data;\n");
  writeFileSync(join(runDir, "volumes_redis"), "redis-data=/data;\n");
  writeFileSync(join(runDir, "volumes_minio"), "minio-data=/data;\n");
  writeFileSync(join(runDir, "volumes_proxy"), "caddy-config=/config;caddy-data=/data;\n");
  if (options.envChanged) writeFileSync(envFile, "changed=true\n");

  const result = runLibrary(`
    upgrade_run_dir="$1"
    upgrade_run_id=final-verification
    upgrade_env_file="$1/env"
    reverse_proxy_mount_order="$2"
    candidate_image_available="$3"
    missing_service="$4"
    unchanged_service="$5"
    wrong_image_service="$6"
    wrong_compose_project="$7"
    wrong_volume_service="$8"
    worker_healthy="$9"
    wiseeff_upgrade_probe_worker() { [ "$worker_healthy" = "true" ]; }
    wiseeff_upgrade_compose() {
      if [ "$1" = "ps" ] && [ "$2" = "-q" ]; then
        if [ "$3" = "$missing_service" ]; then return 0; fi
        if [ "$3" = "$unchanged_service" ]; then
          printf 'previous-%s\\n' "$3"
          return 0
        fi
        printf 'current-%s\\n' "$3"
        return 0
      fi
      return 1
    }
    wiseeff_upgrade_docker() {
      printf 'docker %s\\n' "$*" >> "$upgrade_run_dir/trace.log"
      if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
        if [ "$candidate_image_available" = "true" ] && [ "$3" = "--format" ] && [ "$4" = "{{.Id}}" ] && [ "$5" = "wiseeff-app:candidate" ]; then
          printf 'sha256:candidate\\n'
          return 0
        fi
        return 64
      fi
      if [ "$1" != "inspect" ]; then return 1; fi
      template="$3"
      container="$4"
      service="\${container#current-}"
      case "$template:$container" in
        *'.Image'*:current-api|*'.Image'*:current-worker|*'.Image'*:current-web)
          if [ "$service" = "$wrong_image_service" ]; then printf 'sha256:wrong\\n'; else printf 'sha256:candidate\\n'; fi
          ;;
        *'com.docker.compose.project'*:current-api)
          if [ "$wrong_compose_project" = "true" ]; then printf 'wrong-project\\n'; else printf 'self-hosted\\n'; fi
          ;;
        *'.Mounts'*:current-postgres)
          if [ "$wrong_volume_service" = "postgres" ]; then printf 'unexpected=/wrong;\\n'; else printf 'postgres-data=/var/lib/postgresql/data;\\n'; fi
          ;;
        *'.Mounts'*:current-redis)
          if [ "$wrong_volume_service" = "redis" ]; then printf 'unexpected=/wrong;\\n'; else printf 'redis-data=/data;\\n'; fi
          ;;
        *'.Mounts'*:current-minio)
          if [ "$wrong_volume_service" = "minio" ]; then printf 'unexpected=/wrong;\\n'; else printf 'minio-data=/data;\\n'; fi
          ;;
        *'.Mounts'*:current-proxy)
          if [ "$wrong_volume_service" = "proxy" ]; then
            printf 'unexpected=/wrong;\\n'
          elif [ "$reverse_proxy_mount_order" = "true" ]; then
            printf 'caddy-data=/data;caddy-config=/config;\\n'
          else
            printf 'caddy-config=/config;caddy-data=/data;\\n'
          fi
          ;;
        *) return 1 ;;
      esac
    }
    if wiseeff_upgrade_verify_final_state; then
      status=0
    else
      status=$?
    fi
    cat "$upgrade_run_dir/trace.log"
    exit "$status"
  `, [
    runDir,
    String(options.reverseProxyMountOrder ?? false),
    String(options.candidateImageAvailable ?? true),
    options.missingService ?? "",
    options.unchangedService ?? "",
    options.wrongImageService ?? "",
    String(options.wrongComposeProject ?? false),
    options.wrongVolumeService ?? "",
    String(options.workerHealthy ?? true),
  ]);

  return { result, runDir };
}

const diagnosticCanaries: Array<{ label: string; text: string; secret: string; context: string; preserved?: string }> = [
  { label: "http URL credentials", text: "GET http://http-user:http-password@example.test:8080/path context=http-url-01", secret: "http-password", context: "context=http-url-01" },
  { label: "https URL credentials", text: "GET https://url-user:url-password@example.test/path context=https-url-02", secret: "url-password", context: "context=https-url-02" },
  { label: "socks URL credentials", text: "ALL_PROXY=socks://socks-user:socks-password@proxy.example.test:1080/path context=socks-url-03", secret: "socks-password", context: "context=socks-url-03" },
  { label: "socks4 URL credentials", text: "ALL_PROXY=socks4://socks4-user:socks4-password@proxy.example.test:1080/path context=socks4-url-04", secret: "socks4-password", context: "context=socks4-url-04" },
  { label: "socks4a URL credentials", text: "ALL_PROXY=socks4a://socks4a-user:socks4a-password@proxy.example.test:1080/path context=socks4a-url-05", secret: "socks4a-password", context: "context=socks4a-url-05" },
  { label: "socks5 URL credentials", text: "ALL_PROXY=socks5://socks5-user:socks5-password@proxy.example.test:1080/path context=socks5-url-06", secret: "socks5-password", context: "context=socks5-url-06" },
  { label: "socks5h URL credentials", text: "ALL_PROXY=socks5h://review-user:review-secret@proxy.example.test:1080/path context=socks5h-url-07", secret: "review-secret", context: "context=socks5h-url-07" },
  { label: "extension scheme URL credentials", text: "PROXY=x+proxy.v1-socks://extension-user:extension-secret@proxy.example.test:9443/path context=extension-url-08", secret: "extension-secret", context: "context=extension-url-08" },
  { label: "URL without userinfo", text: "ALL_PROXY=socks5h://proxy.example.test:1080/path context=url-without-userinfo-09", secret: "not-present-url-secret", context: "context=url-without-userinfo-09", preserved: "ALL_PROXY=socks5h://proxy.example.test:1080/path" },
  { label: "ordinary email", text: "contact=review-user@example.test context=ordinary-email-10", secret: "not-present-email-secret", context: "context=ordinary-email-10", preserved: "contact=review-user@example.test" },
  { label: "authorization bearer", text: "Authorization: Bearer bearer-secret context=authorization-bearer-11", secret: "bearer-secret", context: "context=authorization-bearer-11" },
  { label: "authorization basic", text: "Authorization: Basic basic-secret context=authorization-basic-12", secret: "basic-secret", context: "context=authorization-basic-12" },
  { label: "proxy authorization bearer", text: "Proxy-Authorization: Bearer proxy-bearer-secret context=proxy-bearer-13", secret: "proxy-bearer-secret", context: "context=proxy-bearer-13" },
  { label: "proxy authorization basic", text: "Proxy-Authorization: Basic proxy-auth-secret context=proxy-basic-14", secret: "proxy-auth-secret", context: "context=proxy-basic-14" },
  { label: "mixed-case authorization bearer", text: "aUtHoRiZaTiOn: bEaReR mixed-bearer-secret context=mixed-header-15", secret: "mixed-bearer-secret", context: "context=mixed-header-15" },
  { label: "mixed-case proxy authorization basic", text: "pRoXy-AuThOrIzAtIoN: BaSiC mixed-proxy-secret context=mixed-proxy-header-16", secret: "mixed-proxy-secret", context: "context=mixed-proxy-header-16" },
  { label: "json password", text: '{"PaSsWoRd":"json-password-secret"} context=json-password-17', secret: "json-password-secret", context: "context=json-password-17" },
  { label: "json pass", text: '{"PASS":"json-pass-secret"} context=json-pass-18', secret: "json-pass-secret", context: "context=json-pass-18" },
  { label: "json secret", text: '{"secret":"json-secret-secret"} context=json-secret-19', secret: "json-secret-secret", context: "context=json-secret-19" },
  { label: "json token", text: '{"ToKeN":"json-token-secret"} context=json-token-20', secret: "json-token-secret", context: "context=json-token-20" },
  { label: "json authorization", text: '{"AUTHORIZATION":"json-authorization-secret"} context=json-authorization-21', secret: "json-authorization-secret", context: "context=json-authorization-21" },
  { label: "json credential", text: '{"credential":"json-credential-secret"} context=json-credential-22', secret: "json-credential-secret", context: "context=json-credential-22" },
  { label: "json access key", text: '{"access-key":"json-access-key-secret"} context=json-access-key-23', secret: "json-access-key-secret", context: "context=json-access-key-23" },
  { label: "json api key", text: '{"api_key":"json-api-key-secret"} context=json-api-key-24', secret: "json-api-key-secret", context: "context=json-api-key-24" },
  { label: "plain assignment", text: "WISEEFF_BUILD_PROXY_PASSWORD=plain-password-secret context=assignment-plain-25", secret: "plain-password-secret", context: "context=assignment-plain-25" },
  { label: "double quoted assignment", text: 'WISEEFF_BUILD_PROXY_PASSWORD="double-password-secret" context=assignment-double-26', secret: "double-password-secret", context: "context=assignment-double-26" },
  { label: "single quoted assignment", text: "WISEEFF_BUILD_PROXY_PASSWORD='single-password-secret' context=assignment-single-27", secret: "single-password-secret", context: "context=assignment-single-27" },
  { label: "bearer assignment", text: "M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer assignment-bearer-secret context=assignment-bearer-28", secret: "assignment-bearer-secret", context: "context=assignment-bearer-28" },
  { label: "basic assignment", text: "OBJECT_STORAGE_ACCESS_KEY_ID=Basic assignment-basic-secret context=assignment-basic-29", secret: "assignment-basic-secret", context: "context=assignment-basic-29" },
  { label: "password equals flag", text: "--password=flag-equals-secret context=flag-equals-30", secret: "flag-equals-secret", context: "context=flag-equals-30" },
  { label: "password spaced flag", text: "--password flag-spaced-secret context=flag-spaced-31", secret: "flag-spaced-secret", context: "context=flag-spaced-31" },
  { label: "npm token", text: "NPM_TOKEN=npm-token-secret context=npm-token-32", secret: "npm-token-secret", context: "context=npm-token-32" },
  { label: "node auth token", text: "NODE_AUTH_TOKEN=node-auth-token-secret context=node-auth-token-33", secret: "node-auth-token-secret", context: "context=node-auth-token-33" },
  { label: "npm auth token", text: "_authToken=npm-auth-token-secret context=npm-auth-token-34", secret: "npm-auth-token-secret", context: "context=npm-auth-token-34" },
  { label: "known object secret", text: "OBJECT_STORAGE_SECRET_ACCESS_KEY=object-secret-canary context=object-store-secret-35", secret: "object-secret-canary", context: "context=object-store-secret-35" },
  { label: "known postgres secret", text: "POSTGRES_PASSWORD=postgres-secret-canary context=postgres-secret-36", secret: "postgres-secret-canary", context: "context=postgres-secret-36" },
  { label: "known smoke auth secret", text: "M6_SELFHOSTED_SMOKE_AUTHORIZATION=smoke-auth-canary context=smoke-auth-secret-37", secret: "smoke-auth-canary", context: "context=smoke-auth-secret-37" }
];

describe("upgrade.sh public interface", () => {
  it("fails candidate readiness when the canonical driver catalog gate is blocked", () => {
    const runDir = mkdtempSync(
      join(tmpdir(), "wiseeff-upgrade-parameter-catalog-gate-"),
    );
    const result = runLibrary(
      `
      upgrade_run_dir="$1"
      upgrade_run_id=parameter-catalog-gate
      wiseeff_upgrade_state_write phase starting-app-services
      wiseeff_upgrade_probe_api() { return 0; }
      wiseeff_upgrade_probe_worker() { return 0; }
      wiseeff_upgrade_probe_web() { return 0; }
      wiseeff_upgrade_compose() {
        printf '%s\n' "$*" >> "$upgrade_run_dir/compose.log"
        return 2
      }
      if wiseeff_upgrade_verify_candidate_app_readiness; then
        exit 0
      else
        exit $?
      fi
      `,
      [runDir],
    );

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "compose.log"), "utf8")).toContain(
      "exec -T api npm run parameter-definitions:check -- --catalog-only",
    );
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe(
      "candidate-parameter-catalog\n",
    );
  });

  it("documents the small operator interface without touching the runtime", () => {
    const result = runUpgrade(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("apply");
    expect(result.stdout).toContain("plan");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("resume");
    expect(result.stdout).toContain("rollback");
    expect(result.stdout).toContain("prepare-host");
    expect(result.stdout).toContain("lock-status");
    expect(result.stdout).toContain("unlock");
    expect(result.stdout).toContain("--git-proxy");
    expect(result.stdout).toContain("--build-network-file");
    expect(result.stdout).toContain("--allow-insecure-build");
  });

  it("refuses an insecure upgrade build without explicit per-command authorization", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-insecure-build-"));
    const config = join(directory, "build-network.env");
    writeFileSync(config, "WISEEFF_BUILD_TLS_POLICY=insecure\n", { mode: 0o600 });
    chmodSync(config, 0o600);

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_action=apply
      upgrade_allow_insecure_build=false
      upgrade_compose_dir="$PWD/ops/self-hosted"
      upgrade_build_network_file="$WISEEFF_TEST_BUILD_NETWORK_CONFIG"
      wiseeff_upgrade_reject_root_runtime() { return 0; }
      wiseeff_upgrade_require_command() { return 0; }
      wiseeff_upgrade_validate_env() { return 0; }
      wiseeff_upgrade_validate_backup_root() { return 0; }
      wiseeff_upgrade_validate_worktree() { return 0; }
      wiseeff_upgrade_docker() { printf 'docker-must-not-run\n'; return 0; }
      if wiseeff_upgrade_preflight; then exit 0; else exit $?; fi
    `], {
      encoding: "utf8",
      env: {
        ...process.env,
        WISEEFF_TEST_BUILD_NETWORK_CONFIG: config,
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        NO_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
        no_proxy: ""
      }
    });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("--allow-insecure-build");
    expect(result.stdout).not.toContain("docker-must-not-run");
  });

  it("normalizes upper-case proxy variables for the non-interactive Git fetch", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$PWD"
      upgrade_git_proxy=""
      unset http_proxy https_proxy all_proxy no_proxy
      export HTTP_PROXY=http://127.0.0.1:7890
      export HTTPS_PROXY=http://127.0.0.1:7890
      export ALL_PROXY=socks5h://127.0.0.1:7891
      export NO_PROXY=127.0.0.1,localhost
      wiseeff_upgrade_prepare_git_transport
      printf '%s\\n' "$http_proxy|$https_proxy|$all_proxy|$no_proxy"
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(
      "http://127.0.0.1:7890|http://127.0.0.1:7890|socks5h://127.0.0.1:7891|127.0.0.1,localhost"
    );
  });

  it("applies the explicit Git proxy only to Git invocations", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$PWD"
      upgrade_git_proxy=http://127.0.0.1:7890
      git() { printf '%s\\n' "$*"; }
      wiseeff_upgrade_git fetch origin --prune
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toContain("-c http.proxy=http://127.0.0.1:7890 fetch origin --prune");
  });

  it("stops preflight at the first failed gate", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      wiseeff_upgrade_reject_root_runtime() { return 0; }
      wiseeff_upgrade_require_command() { return 0; }
      wiseeff_upgrade_validate_env() { printf 'env-failed\\n'; return 10; }
      wiseeff_upgrade_validate_backup_root() { printf 'should-not-run\\n'; return 0; }
      if wiseeff_upgrade_preflight; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(10);
    expect(result.stdout).toContain("env-failed");
    expect(result.stdout).not.toContain("should-not-run");
  });

  it("loads the private build-network contract before Compose preflight", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-build-network-"));
    const config = join(directory, "build-network.env");
    writeFileSync(config, "HTTPS_PROXY=http://operator:secret@proxy.example.com:8080\n", { mode: 0o644 });
    chmodSync(config, 0o644);

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_compose_dir="$PWD/ops/self-hosted"
      upgrade_build_network_file="$WISEEFF_TEST_BUILD_NETWORK_CONFIG"
      wiseeff_upgrade_reject_root_runtime() { return 0; }
      wiseeff_upgrade_require_command() { return 0; }
      wiseeff_upgrade_validate_env() { return 0; }
      wiseeff_upgrade_validate_backup_root() { return 0; }
      wiseeff_upgrade_validate_worktree() { return 0; }
      wiseeff_upgrade_docker() { return 0; }
      wiseeff_upgrade_compose_config() { printf 'compose-must-not-run\n'; return 0; }
      if wiseeff_upgrade_preflight; then exit 0; else exit $?; fi
    `], {
      encoding: "utf8",
      env: {
        ...process.env,
        WISEEFF_TEST_BUILD_NETWORK_CONFIG: config,
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        NO_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
        no_proxy: ""
      }
    });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("mode 644");
    expect(result.stdout).not.toContain("compose-must-not-run");
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("operator:secret");
  });

  it("does not resolve a stale target after Git fetch fails", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_ref=origin/main
      upgrade_git_proxy=""
      wiseeff_upgrade_git() {
        if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then printf 'previous-sha\\n'; return 0; fi
        if [ "$1" = "fetch" ]; then return 1; fi
        printf 'stale-target\\n'
      }
      if wiseeff_upgrade_resolve_target; then exit 0; else
        result=$?
        exit "$result"
      fi
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("Git fetch failed for origin");
    expect(result.stdout).not.toContain("stale-target");
  });

  it("does not no-op when the checkout is current but application containers still use an older image", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_restart=false
      upgrade_json=false
      wiseeff_upgrade_acquire_lock() { return 0; }
      wiseeff_upgrade_release_lock() { return 0; }
      wiseeff_upgrade_preflight() {
        upgrade_previous_sha=target-sha
        upgrade_target_sha=target-sha
        upgrade_runtime_image_ref_api=wiseeff-app:old-sha
        upgrade_runtime_image_ref_worker=wiseeff-app:old-sha
        upgrade_runtime_image_ref_web=wiseeff-app:old-sha
        upgrade_mixed_app_images=false
        return 0
      }
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_init_run() { printf 'entered-full-upgrade\\n'; exit 73; }
      wiseeff_upgrade_run_apply
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(73);
    expect(result.stdout).toContain("entered-full-upgrade");
    expect(result.stdout).not.toContain("already running");
  });

  it("probes public health before declaring the target application image a no-op", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_restart=false
      upgrade_json=false
      wiseeff_upgrade_acquire_lock() { return 0; }
      wiseeff_upgrade_release_lock() { return 0; }
      wiseeff_upgrade_preflight() {
        upgrade_previous_sha=target-sha
        upgrade_target_sha=target-sha
        upgrade_runtime_image_ref_api=wiseeff-app:target-sha
        upgrade_runtime_image_ref_worker=wiseeff-app:target-sha
        upgrade_runtime_image_ref_web=wiseeff-app:target-sha
        upgrade_mixed_app_images=false
        return 0
      }
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_public_probe() { printf 'public-health-passed\\n'; return 0; }
      wiseeff_upgrade_init_run() { printf 'must-not-upgrade\\n'; exit 74; }
      wiseeff_upgrade_run_apply
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/public-health-passed[\s\S]*already running/);
    expect(result.stdout).not.toContain("must-not-upgrade");
  });

  it("does not treat a running MinIO process as complete data-plane readiness", () => {
    const { result, runDir } = runDataPlaneFixture({ minioState: "running", minioInitState: "running" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("minio-init");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio-init\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-init-timeout\n");
  });

  it("accepts a running MinIO process only after minio-init exits successfully", () => {
    const { result } = runDataPlaneFixture({ minioState: "running", minioInitState: "exited", minioInitExitCode: "0" });

    expect(result.status).toBe(0);
  });

  it("reports a non-zero minio-init exit as the failing service", () => {
    const { result, runDir } = runDataPlaneFixture({ minioState: "running", minioInitState: "exited", minioInitExitCode: "17" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("minio-init");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-init-failed\n");
  });

  it("times out when minio-init stays running", () => {
    const { result, runDir } = runDataPlaneFixture({ minioState: "running", minioInitState: "running" }, 2);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-init-timeout\n");
  });

  it.each([
    ["postgres", { postgresHealth: "starting" }],
    ["redis", { redisHealth: "starting" }]
  ] as const)("requires Docker healthy for %s, not merely running", (_service, statuses) => {
    const { result, runDir } = runDataPlaneFixture(statuses);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe(`${_service}\n`);
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe(`${_service}-not-healthy\n`);
  });

  it("fails MinIO immediately when its process exits unexpectedly", () => {
    const { result, runDir } = runDataPlaneFixture({ minioState: "exited", minioInitState: "running" }, 5);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("minio");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-exited\n");
    expect(result.stdout).toContain("minio-status-calls=1");
  });

  it("fails MinIO immediately when it is restarting after a process crash", () => {
    const { result, runDir } = runDataPlaneFixture({ minioState: "restarting", minioInitState: "running" }, 5);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-exited\n");
    expect(result.stdout).toContain("minio-status-calls=1");
  });

  it("rechecks MinIO during initializer polling and reports a later MinIO exit immediately", () => {
    const { result, runDir } = runDataPlaneSequenceFixture({
      minioStates: ["running", "running", "exited"],
      minioInitStates: ["running", "running", "running"]
    }, 5);

    expect(result.status).toBe(1);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-exited\n");
    expect(result.stdout).toContain("minio-inspections=3");
    expect(result.stdout).not.toContain("minio-init-timeout");
  });

  it("performs a final MinIO check after minio-init exits successfully", () => {
    const { result, runDir } = runDataPlaneSequenceFixture({
      minioStates: ["running", "running", "exited"],
      minioInitStates: ["exited"],
      minioInitExitCodes: ["0"]
    }, 1);

    expect(result.status).toBe(1);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-exited\n");
    expect(result.stdout).toContain("minio-inspections=3");
  });

  it("classifies a non-running MinIO state after successful minio-init", () => {
    const { result, runDir } = runDataPlaneSequenceFixture({
      minioStates: ["running", "running", "created"],
      minioInitStates: ["exited"],
      minioInitExitCodes: ["0"]
    }, 1);

    expect(result.status).toBe(1);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-not-running\n");
  });

  it("accepts MinIO only when it stays running through successful minio-init", () => {
    const { result } = runDataPlaneSequenceFixture({
      minioStates: ["running"],
      minioInitStates: ["exited"],
      minioInitExitCodes: ["0"]
    }, 1);

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stdout).toContain("minio-inspections=3");
  });

  it("keeps initializer failure and timeout classifications when MinIO stays running", () => {
    const failed = runDataPlaneSequenceFixture({
      minioStates: ["running"],
      minioInitStates: ["exited"],
      minioInitExitCodes: ["17"]
    }, 1);
    const timedOut = runDataPlaneSequenceFixture({
      minioStates: ["running"],
      minioInitStates: ["running"]
    }, 2);

    expect(failed.result.status).toBe(1);
    expect(readFileSync(join(failed.runDir, "failure_service"), "utf8")).toBe("minio-init\n");
    expect(readFileSync(join(failed.runDir, "failure_code"), "utf8")).toBe("minio-init-failed\n");
    expect(timedOut.result.status).toBe(1);
    expect(readFileSync(join(timedOut.runDir, "failure_service"), "utf8")).toBe("minio-init\n");
    expect(readFileSync(join(timedOut.runDir, "failure_code"), "utf8")).toBe("minio-init-timeout\n");
  });

  it("uses a stable failure code when the MinIO container is missing", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-minio-missing-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=minio-missing
      WISEEFF_UPGRADE_HEALTH_ATTEMPTS=1
      WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS=0
      wiseeff_upgrade_state_write phase restarting-data
      wiseeff_upgrade_compose() {
        if [ "$1" = "ps" ] && [ "$3" != "minio" ]; then printf '%s-container\\n' "$3"; fi
      }
      wiseeff_upgrade_docker() {
        case "$4:$3" in
          postgres-container:*Health*|redis-container:*Health*) printf 'healthy\\n' ;;
          *) printf 'docker-must-not-inspect\\n'; return 1 ;;
        esac
      }
      if wiseeff_upgrade_wait_data_plane_ready; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).toBe(1);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-container-missing\n");
    expect(result.stdout).not.toContain("docker-must-not-inspect");
  });

  it("reports a stable MinIO inspect failure when the container exists", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-minio-inspect-failure-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=minio-inspect-failure
      WISEEFF_UPGRADE_HEALTH_ATTEMPTS=1
      WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS=0
      wiseeff_upgrade_state_write phase restarting-data
      wiseeff_upgrade_compose() { printf '%s-container\\n' "$3"; }
      wiseeff_upgrade_docker() {
        case "$4:$3" in
          postgres-container:*Health*|redis-container:*Health*) printf 'healthy\\n' ;;
          minio-container:*) return 1 ;;
          *) return 1 ;;
        esac
      }
      if wiseeff_upgrade_wait_data_plane_ready; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).toBe(1);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-inspect-failed\n");
  });

  it("records a bounded, stable data-plane failure diagnostic", () => {
    const { result, runDir } = runDataPlaneFixture({ postgresHealth: "starting" });

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failed_phase"), "utf8")).toBe("restarting-data\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("postgres\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("postgres-not-healthy\n");
    expect(readFileSync(join(runDir, "failure_summary"), "utf8").trim().length).toBeLessThanOrEqual(240);
  });

  it("keeps an aggregate service when a group startup failure has no service evidence", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-data-compose-failure-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_target_sha=target-sha
      wiseeff_upgrade_compose() {
        [ "$1" = "ps" ] && return 1
        printf 'compose data services failed M6_SELFHOSTED_SMOKE_AUTHORIZATION=auth-secret\\n'
        return 91
      }
      if wiseeff_upgrade_start_candidate_data_plane; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failed_phase"), "utf8")).toBe("restarting-data\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("data-plane\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("data-plane-compose-up\n");
    expect(result.stderr).not.toContain("auth-secret");
  });

  it("attributes a group startup failure to MinIO when its stopped container proves the cause", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-data-compose-minio-failure-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_target_sha=target-sha
      wiseeff_upgrade_compose() {
        if [ "$1" = "ps" ]; then printf '%s-container\\n' "$3"; return 0; fi
        return 91
      }
      wiseeff_upgrade_docker() {
        case "$4:$3" in
          postgres-container:*Health*|redis-container:*Health*) printf 'healthy\\n' ;;
          minio-container:*State.Status*) printf 'exited\\n' ;;
          *) return 1 ;;
        esac
      }
      if wiseeff_upgrade_start_candidate_data_plane; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("data-plane-compose-up\n");
  });

  it("keeps an aggregate service when Docker inspection provides no state evidence", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-data-compose-no-evidence-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_target_sha=target-sha
      wiseeff_upgrade_compose() {
        if [ "$1" = "ps" ]; then printf '%s-container\\n' "$3"; return 0; fi
        return 91
      }
      wiseeff_upgrade_docker() { return 1; }
      if wiseeff_upgrade_start_candidate_data_plane; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("data-plane\n");
  });

  it("reports an actual MinIO failure during restored data-plane verification", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-restore-minio-readiness-"));
    writeFileSync(join(runDir, "previous_image_tag_api"), "wiseeff-app:previous-api\n");
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=restore-minio-readiness
      WISEEFF_UPGRADE_HEALTH_ATTEMPTS=1
      WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS=0
      wiseeff_upgrade_state_write phase old-stack-restore
      wiseeff_upgrade_compose() {
        if [ "$1" = "ps" ]; then printf '%s-container\\n' "$3"; fi
      }
      wiseeff_upgrade_docker() {
        case "$4:$3" in
          postgres-container:*Health*|redis-container:*Health*) printf 'healthy\\n' ;;
          minio-container:*State.Status*) printf 'exited\\n' ;;
          *) return 1 ;;
        esac
      }
      if wiseeff_upgrade_verify_restored_stack; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).toBe(1);
    expect(readFileSync(join(runDir, "failed_phase"), "utf8")).toBe("old-stack-restore\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-exited\n");
  });

  it("marks old-stack-restored only after every restore verification gate passes", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-restore-success-"));
    writeFileSync(join(runDir, "previous_sha"), "previous-sha\n");
    for (const service of ["api", "worker", "web"]) {
      writeFileSync(join(runDir, `previous_image_tag_${service}`), `wiseeff-app:previous-${service}\n`);
    }

    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=restore-success
      trace="$2"
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_compose() { return 0; }
      wiseeff_upgrade_compose_for_image() {
        case "$*" in
          *" proxy") printf 'proxy\n' >> "$trace" ;;
        esac
        return 0
      }
      wiseeff_upgrade_recreate_previous_app_services() { printf 'apps\n' >> "$trace"; return 0; }
      wiseeff_upgrade_wait_data_plane_ready() { printf 'data-ready\n' >> "$trace"; return 0; }
      wiseeff_upgrade_queue_command_for_image() { printf 'queue\n' >> "$trace"; return 0; }
      wiseeff_upgrade_probe_api() { printf 'api\n' >> "$trace"; return 0; }
      wiseeff_upgrade_probe_worker() { printf 'worker\n' >> "$trace"; return 0; }
      wiseeff_upgrade_probe_web() { printf 'web\n' >> "$trace"; return 0; }
      wiseeff_upgrade_verify_previous_app_images() { printf 'images\n' >> "$trace"; return 0; }
      wiseeff_upgrade_public_probe() { printf 'public\n' >> "$trace"; return 0; }
      wiseeff_upgrade_restore_old_stack_after_stop
    `, [runDir, join(runDir, "trace.log")]);

    expect(result.status).toBe(0);
    expect(readFileSync(join(runDir, "phase"), "utf8")).toBe("old-stack-restored\n");
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("old-stack-restored\n");
    expect(readFileSync(join(runDir, "next_action"), "utf8")).toBe("none\n");
    expect(readFileSync(join(runDir, "recovery_started"), "utf8")).toBe("true\n");
    expect(readFileSync(join(runDir, "recovery_verified"), "utf8")).toBe("true\n");
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");
    expect(trace.indexOf("data-ready")).toBeLessThan(trace.indexOf("apps"));
    expect(trace.indexOf("worker")).toBeLessThan(trace.indexOf("queue"));
    expect(trace.indexOf("queue")).toBeLessThan(trace.indexOf("proxy"));
    expect(trace.indexOf("proxy")).toBeLessThan(trace.indexOf("public"));
  });

  it.each(["api", "worker", "web", "proxy", "queue"])(
    "records recovery-required when restored %s verification fails",
    (failureService) => {
      const runDir = mkdtempSync(join(tmpdir(), `wiseeff-upgrade-restore-${failureService}-`));
      writeFileSync(join(runDir, "previous_sha"), "previous-sha\n");
      for (const service of ["api", "worker", "web"]) {
        writeFileSync(join(runDir, `previous_image_tag_${service}`), `wiseeff-app:previous-${service}\n`);
      }

      const result = runLibrary(`
        upgrade_run_dir="$1"
        upgrade_run_id=restore-failure
        upgrade_target_sha=target-sha
        failure_service="$2"
        wiseeff_upgrade_git() { return 0; }
        wiseeff_upgrade_compose() { return 0; }
        wiseeff_upgrade_compose_for_image() {
          if [ "$failure_service" = "proxy" ] && [ "\${!#}" = "proxy" ]; then return 91; fi
          return 0
        }
        wiseeff_upgrade_recreate_previous_app_services() { return 0; }
        wiseeff_upgrade_wait_data_plane_ready() { return 0; }
        wiseeff_upgrade_queue_command_for_image() {
          if [ "$failure_service" = "queue" ] && [ "$1" = "resume" ]; then
            printf 'queue resume failed M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer raw-restore-queue-secret\\n'
            return 92
          fi
          return 0
        }
        wiseeff_upgrade_probe_api() {
          [ "$failure_service" != "api" ]
        }
        wiseeff_upgrade_probe_worker() {
          [ "$failure_service" != "worker" ]
        }
        wiseeff_upgrade_probe_web() {
          [ "$failure_service" != "web" ]
        }
        wiseeff_upgrade_verify_previous_app_images() { return 0; }
        wiseeff_upgrade_public_probe() { return 0; }
        if wiseeff_upgrade_restore_old_stack_after_stop; then exit 0; else exit $?; fi
      `, [runDir, failureService]);

      expect(result.status).toBe(70);
      expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
      expect(readFileSync(join(runDir, "next_action"), "utf8")).not.toBe("none\n");
      expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe(`${failureService}\n`);
      expect(result.stderr).not.toContain("raw-restore-queue-secret");
      expect(result.stderr).toContain(failureService);
    }
  );

  it("requires the recorded Docker image ID in addition to the previous image tag", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-image-identity-"));
    for (const service of ["api", "worker", "web"]) {
      writeFileSync(join(runDir, `previous_image_tag_${service}`), `wiseeff-app:previous-${service}\n`);
      writeFileSync(join(runDir, `previous_image_id_${service}`), `sha256:previous-${service}\n`);
    }

    const result = runLibrary(`
      upgrade_run_dir="$1"
      wiseeff_upgrade_compose() {
        if [ "$1" = "ps" ]; then printf '%s-container\\n' "$3"; fi
      }
      wiseeff_upgrade_docker() {
        case "$3" in
          *Config.Image*) printf 'wiseeff-app:previous-%s\\n' "\${4%-container}" ;;
          *Image*)
            if [ "$4" = "api-container" ]; then printf 'sha256:retagged\\n'; else printf 'sha256:previous-%s\\n' "\${4%-container}"; fi
            ;;
          *) return 1 ;;
        esac
      }
      if wiseeff_upgrade_verify_previous_app_images; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("api\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("restore-api-image-mismatch\n");
  });

  it("uses the worker liveness endpoint during restore verification", () => {
    const trace = join(mkdtempSync(join(tmpdir(), "wiseeff-upgrade-worker-probe-")), "trace.log");
    const result = runLibrary(`
      trace="$1"
      WISEEFF_UPGRADE_HEALTH_ATTEMPTS=1
      WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS=0
      wiseeff_upgrade_compose() {
        printf '%s\\n' "$*" >> "$trace"
        if [ "$1" = "ps" ]; then printf 'worker-container\\n'; fi
      }
      wiseeff_upgrade_docker() {
        case "$3" in
          *State.Health*) printf 'healthy\\n' ;;
          *) return 1 ;;
        esac
      }
      wiseeff_upgrade_probe_worker
      cat "$trace"
    `, [trace]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("8788");
    expect(result.stdout).toContain("health/live");
  });

  it("requires both worker liveness and Docker health before candidate queue resume", () => {
    const result = runLibrary(`
      WISEEFF_UPGRADE_HEALTH_ATTEMPTS=1
      WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS=0
      wiseeff_upgrade_compose() {
        if [ "$1" = "exec" ]; then return 0; fi
        if [ "$1" = "ps" ]; then printf 'worker-container\\n'; fi
      }
      wiseeff_upgrade_docker() {
        case "$3" in
          *State.Health*) printf 'unhealthy\\n' ;;
          *) return 1 ;;
        esac
      }
      if wiseeff_upgrade_probe_worker; then exit 0; else exit $?; fi
    `);

    expect(result.status).not.toBe(0);
  });

  it.each(["apply", "resume"] as const)("blocks %s before queue resume and proxy recreation when worker is unhealthy", (action) => {
    const { result, runDir } = runCandidateWorkerFixture(action, false);
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");

    expect(result.status, `${result.stderr}\n${result.stdout}\n${trace}`).toBe(70);
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
    expect(readFileSync(join(runDir, "recovery_started"), "utf8")).toBe("true\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("worker\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("candidate-worker-health\n");
    expect(trace).toContain("worker-probe");
    expect(trace).not.toMatch(/queue(?:-image)? resume/);
    expect(trace).not.toMatch(/compose(?:-image)? .* up .* proxy/);
    expect(trace).not.toContain("public-probe");
    expect(trace).not.toContain("web-probe");
  });

  it("rechecks worker readiness before queue resume when resume starts at app-services-ready", () => {
    const { result, runDir } = runCandidateWorkerFixture("resume", false, "app-services-ready");
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");

    expect(result.status, `${result.stderr}\n${result.stdout}\n${trace}`).toBe(70);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("worker\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("candidate-worker-health\n");
    expect(trace).not.toMatch(/queue(?:-image)? resume/);
  });

  it.each(["apply", "resume"] as const)("resumes the candidate queue only after a healthy worker on %s", (action) => {
    const { result, runDir } = runCandidateWorkerFixture(action, true);
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");
    const workerIndex = trace.indexOf("worker-probe");
    const queueIndex = trace.search(/queue(?:-image)? resume/);

    expect(result.status, `${result.stderr}\n${result.stdout}\n${trace}`).toBe(0);
    expect(workerIndex).toBeGreaterThanOrEqual(0);
    expect(queueIndex).toBeGreaterThan(workerIndex);
  });

  it.each(["apply", "resume"] as const)("sanitizes candidate queue resume diagnostics on %s", (action) => {
    const { result, runDir } = runCandidateWorkerFixture(action, true, "api-ready", true);

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(70);
    expect(result.stderr).not.toContain("raw-queue-secret");
    expect(readFileSync(join(runDir, "recovery_failure_summary"), "utf8")).not.toContain("raw-queue-secret");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("queue\n");
  });

  it.each(["queue-resumed", "starting-proxy", "validating-public"] as const)(
    "keeps %s resume isolated when the worker is unhealthy",
    (phase) => {
      const { result, runDir } = runAdvancedResumeFixture(phase, { workerHealthy: false });
      const trace = readFileSync(join(runDir, "trace.log"), "utf8");

      expect(result.status, `${result.stderr}\n${result.stdout}\n${trace}`).toBe(70);
      expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
      expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("worker\n");
      expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("candidate-worker-health\n");
      expect(trace.indexOf("proxy-stop")).toBeGreaterThanOrEqual(0);
      expect(trace.indexOf("worker-probe")).toBeGreaterThan(trace.indexOf("proxy-stop"));
      expect(trace).toContain("queue-image pause");
      expect(trace).toContain("worker-stop");
      expect(trace).not.toContain("proxy-up");
      expect(trace).not.toContain("public-probe");
      expect(readFileSync(join(runDir, "next_action"), "utf8")).not.toBe("none\n");
    }
  );

  it.each(["queue-resumed", "starting-proxy", "validating-public"] as const)(
    "rechecks candidate readiness before restoring traffic from %s",
    (phase) => {
      const { result, runDir } = runAdvancedResumeFixture(phase);
      const trace = readFileSync(join(runDir, "trace.log"), "utf8");
      const events = ["proxy-stop", "api-probe /health/ready", "worker-probe", "web-probe", "proxy-up", "public-probe", "final-verification"];
      const positions = events.map((event) => trace.indexOf(event));

      expect(result.status, `${result.stderr}\n${result.stdout}\n${trace}`).toBe(0);
      expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("completed\n");
      expect(readFileSync(join(runDir, "phase"), "utf8")).toBe("completed\n");
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    }
  );

  it.each(["starting-proxy", "validating-public"] as const)(
    "isolates a possibly-running proxy before resuming %s",
    (phase) => {
      const { result, runDir } = runAdvancedResumeFixture(phase);
      const trace = readFileSync(join(runDir, "trace.log"), "utf8").trim().split("\n");

      expect(result.status, `${result.stderr}\n${result.stdout}\n${trace.join("\n")}`).toBe(0);
      expect(trace[0]).toBe("proxy-stop");
    }
  );

  it("blocks advanced resume when proxy isolation fails", () => {
    const { result, runDir } = runAdvancedResumeFixture("starting-proxy", { proxyStopSucceeds: false });
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");

    expect(result.status, `${result.stderr}\n${result.stdout}\n${trace}`).toBe(70);
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("proxy\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("candidate-proxy-isolation\n");
    expect(readFileSync(join(runDir, "recovery_proxy_stopped"), "utf8")).toBe("false\n");
    expect(readFileSync(join(runDir, "next_action"), "utf8")).toMatch(/^Manually isolate proxy traffic/);
    expect(trace).not.toContain("api-probe");
    expect(trace).not.toContain("worker-probe");
    expect(trace).not.toContain("proxy-up");
    expect(trace).not.toContain("public-probe");
  });

  it.each(["queue-resumed", "starting-proxy", "validating-public"] as const)(
    "blocks %s resume when API or web readiness fails before proxy/public",
    (phase) => {
      for (const failure of ["api", "web"] as const) {
        const { result, runDir } = runAdvancedResumeFixture(phase, {
        apiReady: failure !== "api",
        webReady: failure !== "web"
        });
        const trace = readFileSync(join(runDir, "trace.log"), "utf8");

        expect(result.status, `${phase}/${failure}: ${result.stderr}\n${result.stdout}\n${trace}`).toBe(70);
        expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe(`${failure}\n`);
        expect(trace).not.toContain("proxy-up");
        expect(trace).not.toContain("public-probe");
      }
    }
  );

  it("keeps the final worker drift gate after advanced resume restores public traffic", () => {
    const { result, runDir } = runAdvancedResumeFixture("validating-public", { finalWorkerHealthy: false });
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");

    expect(result.status, `${result.stderr}\n${result.stdout}\n${trace}`).toBe(70);
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("worker\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("candidate-worker-health\n");
    expect(trace).toContain("proxy-up");
    expect(trace).toContain("public-probe");
    expect(trace).toContain("final-verification");
    expect(trace).not.toContain("completed");
  });

  it("resolves the candidate image through the supported Docker image-inspect interface", () => {
    const { result } = runFinalVerificationFixture();

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stdout).toContain("docker image inspect --format {{.Id}} wiseeff-app:candidate");
    expect(result.stdout).not.toContain("docker image inspect wiseeff-app:candidate -q");
  });

  it("treats recorded named-volume identities as unordered sets", () => {
    const { result } = runFinalVerificationFixture({ reverseProxyMountOrder: true });

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  });

  it.each([
    { label: "candidate image lookup", options: { candidateImageAvailable: false }, service: "image", code: "candidate-image-unavailable" },
    { label: "missing container", options: { missingService: "proxy" }, service: "proxy", code: "candidate-container-missing" },
    { label: "missing worker container", options: { missingService: "worker", workerHealthy: false }, service: "worker", code: "candidate-container-missing" },
    { label: "container recreation", options: { unchangedService: "api" }, service: "api", code: "candidate-container-not-recreated" },
    { label: "application image identity", options: { wrongImageService: "web" }, service: "web", code: "candidate-image-identity" },
    { label: "Compose project identity", options: { wrongComposeProject: true }, service: "api", code: "candidate-compose-project" },
    { label: "named-volume identity", options: { wrongVolumeService: "minio" }, service: "minio", code: "candidate-volume-identity" },
    { label: "environment fingerprint", options: { envChanged: true }, service: "configuration", code: "candidate-env-fingerprint" },
  ])("records a stable failure for $label mismatch", ({ options, service, code }) => {
    const { result, runDir } = runFinalVerificationFixture(options);

    expect(result.status, result.stderr + "\n" + result.stdout).toBe(1);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe(service + "\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe(code + "\n");
  });

  it.each(diagnosticCanaries)("redacts $label from recovery diagnostics", ({ text, secret, context, preserved }) => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-redaction-corpus-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=redaction-corpus
      WISEEFF_TEST_DIAGNOSTIC="$WISEEFF_TEST_DIAGNOSTIC"
      wiseeff_upgrade_record_failure restarting-data minio-init minio-init-failed "$WISEEFF_TEST_DIAGNOSTIC"
      recovery_action() {
        printf '%s\\n' "$WISEEFF_TEST_DIAGNOSTIC"
        return 91
      }
      wiseeff_upgrade_run_recovery_action recovery-corpus recovery_action || true
      cat "$upgrade_run_dir/failure_summary"
      cat "$upgrade_run_dir/recovery_failure_summary"
      cat "$upgrade_run_dir/events.log"
    `, [runDir], { WISEEFF_TEST_DIAGNOSTIC: text });

    const failureSummary = readFileSync(join(runDir, "failure_summary"), "utf8");
    const recoveryFailureSummary = readFileSync(join(runDir, "recovery_failure_summary"), "utf8");
    const events = readFileSync(join(runDir, "events.log"), "utf8");

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
    expect(failureSummary).not.toContain(secret);
    expect(recoveryFailureSummary).not.toContain(secret);
    expect(events).not.toContain(secret);
    expect(result.stdout).toContain("minio-init-failed");
    expect(result.stdout).toContain(context);
    expect(result.stderr).toContain(context);
    expect(failureSummary).toContain(context);
    expect(recoveryFailureSummary).toContain(context);
    expect(events).toContain(context);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio-init\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-init-failed\n");
    if (preserved) {
      expect(result.stdout).toContain(preserved);
    }
  });

  it("redacts generic URL userinfo while preserving URL structure and error context", () => {
    const result = runLibrary(`
      printf '%s\\n' 'ERROR ALL_PROXY=socks5h://review-user:review-secret@proxy.example.test:1080/path?q=1 context=socks5h-direct-38 connect timed out' | wiseeff_upgrade_sanitize_diagnostic_stream
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ALL_PROXY=socks5h://[REDACTED]@proxy.example.test:1080/path?q=1");
    expect(result.stdout).toContain("context=socks5h-direct-38");
    expect(result.stdout).toContain("connect timed out");
    expect(result.stdout).not.toContain("review-user");
    expect(result.stdout).not.toContain("review-secret");
  });

  it.each([
    "GET https://example.test?contact=review-user@example.net context=query-email",
    "GET https://example.test#contact=review-user@example.net context=fragment-email"
  ])("does not mistake an email after an authority delimiter for URI userinfo: %s", (diagnostic) => {
    const result = runLibrary(`
      printf '%s\\n' "$WISEEFF_TEST_DIAGNOSTIC" | wiseeff_upgrade_sanitize_diagnostic_stream
    `, [], { WISEEFF_TEST_DIAGNOSTIC: diagnostic });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(diagnostic);
  });

  it("does not treat a Unicode pseudo-scheme as a valid URI scheme in a UTF-8 locale", () => {
    const diagnostic = "é://review-user@example.test context=unicode-pseudo-scheme";
    const result = runLibrary(`
      printf '%s\\n' "$WISEEFF_TEST_DIAGNOSTIC" | wiseeff_upgrade_sanitize_diagnostic_stream
    `, [], {
      WISEEFF_TEST_DIAGNOSTIC: diagnostic,
      LC_ALL: "C.UTF-8",
      LANG: "C.UTF-8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(diagnostic);
  });

  it("keeps SOCKS5H credentials out of persisted failure and event outputs", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-socks5h-persistence-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=socks5h-persistence
      recovery_input='ALL_PROXY=socks5h://user:persisted-socks-secret@proxy.example.test:1080 context=socks5h-persist-39'
      wiseeff_upgrade_record_failure restarting-data minio-init minio-init-failed "$recovery_input"
      recovery_action() {
        printf '%s\\n' "$recovery_input"
        return 91
      }
      wiseeff_upgrade_run_recovery_action socks5h-persistence recovery_action || true
      cat "$upgrade_run_dir/failure_summary"
      cat "$upgrade_run_dir/recovery_failure_summary"
      cat "$upgrade_run_dir/events.log"
    `, [runDir]);

    const failureSummary = readFileSync(join(runDir, "failure_summary"), "utf8");
    const recoveryFailureSummary = readFileSync(join(runDir, "recovery_failure_summary"), "utf8");
    const events = readFileSync(join(runDir, "events.log"), "utf8");

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("persisted-socks-secret");
    expect(result.stderr).not.toContain("persisted-socks-secret");
    expect(failureSummary).not.toContain("persisted-socks-secret");
    expect(recoveryFailureSummary).not.toContain("persisted-socks-secret");
    expect(events).not.toContain("persisted-socks-secret");
    expect(result.stdout).toContain("context=socks5h-persist-39");
    expect(failureSummary).toContain("context=socks5h-persist-39");
    expect(recoveryFailureSummary).toContain("context=socks5h-persist-39");
    expect(events).toContain("context=socks5h-persist-39");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("minio-init\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("minio-init-failed\n");
  });

  it("bypasses the host proxy for public restore probes", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-public-probe-"));
    const envFile = join(directory, "env");
    const curlLog = join(directory, "curl.log");
    const result = runLibrary(`
      upgrade_env_file="$1"
      printf 'WISEEFF_PUBLIC_URL=http://127.0.0.1\\n' > "$upgrade_env_file"
      WISEEFF_TEST_CURL_LOG="$2"
      curl() { printf '%s\\n' "$*" >> "$WISEEFF_TEST_CURL_LOG"; }
      wiseeff_upgrade_public_probe
    `, [envFile, curlLog]);

    expect(result.status).toBe(0);
    expect(readFileSync(curlLog, "utf8")).toContain("--noproxy *");
  });

  it("redacts credentials from failure summaries and events", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-redaction-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_upgrade_phase=restarting-data
      wiseeff_upgrade_record_failure restarting-data minio-init minio-init-failed \
        'minio-init failed password=mock-password HTTPS_PROXY=http://operator:proxy-password@proxy.example.test:8080'
      cat "$upgrade_run_dir/failure_summary"
      cat "$upgrade_run_dir/events.log"
    `, [runDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("mock-password");
    expect(result.stdout).not.toContain("proxy-password");
  });

  it("records when recovery cannot prove that the queue was paused", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-recovery-isolation-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=recovery-isolation
      upgrade_candidate_image_tag=wiseeff-app:candidate
      upgrade_target_sha=target-sha
      wiseeff_upgrade_state_write phase starting-app-services
      wiseeff_upgrade_compose() { return 0; }
      wiseeff_upgrade_queue_command_for_image() {
        printf 'queue pause failed password=mock-password OBJECT_STORAGE_SECRET_ACCESS_KEY=object-secret POSTGRES_PASSWORD=postgres-secret DB_PASS=pass-secret M6_SELFHOSTED_SMOKE_AUTHORIZATION=auth-secret Authorization: Bearer header-secret {"authorization":"json-auth","access_token":"json-token","client_secret":"json-client"} HTTPS_PROXY=http://operator:proxy-password@proxy.example.test:8080\\n'
        return 97
      }
      wiseeff_upgrade_mark_recovery_required api candidate-api-live 'The candidate API liveness probe failed.'
      printf '%s\\n' "$(cat "$upgrade_run_dir/recovery_queue_paused")"
    `, [runDir]);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("action=queue-pause");
    expect(result.stderr).toContain("[REDACTED]");
    expect(result.stderr).not.toContain("mock-password");
    expect(result.stderr).not.toContain("object-secret");
    expect(result.stderr).not.toContain("postgres-secret");
    expect(result.stderr).not.toContain("pass-secret");
    expect(result.stderr).not.toContain("auth-secret");
    expect(result.stderr).not.toContain("header-secret");
    expect(result.stderr).not.toContain("json-auth");
    expect(result.stderr).not.toContain("json-token");
    expect(result.stderr).not.toContain("json-client");
    expect(result.stderr).not.toContain("proxy-password");
    expect(result.stdout).toContain("false");
    expect(readFileSync(join(runDir, "recovery_failure_summary"), "utf8")).toContain("action=queue-pause");
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
    expect(readFileSync(join(runDir, "recovery_started"), "utf8")).toBe("true\n");
    expect(readFileSync(join(runDir, "next_action"), "utf8")).not.toBe("none\n");
  });

  it("redacts authorization headers and credential-bearing JSON fields", () => {
    const result = runLibrary(`
      printf '%s\\n' 'Authorization: Bearer header-secret Authorization: Basic basic-secret Proxy-Authorization: Basic proxy-secret M6_SELFHOSTED_SMOKE_AUTHORIZATION=Bearer env-auth-secret CREDENTIALS=Bearer credential-secret API_KEY=Bearer api-secret ACCESS_KEY=Basic access-secret POSTGRES_PASSWORD="quoted password" {"authorization":"json-auth","access_token":"json-token","client_secret":"json-client","M6_SELFHOSTED_SMOKE_AUTHORIZATION":"json-prefixed-auth","PROXY_AUTHORIZATION":"json-proxy","POSTGRES_PASSWORD":"json-password","OBJECT_STORAGE_SECRET_ACCESS_KEY":"json-object-secret","DB_PASS":"json-pass"} --password cli-password --token cli-token' | wiseeff_upgrade_sanitize_diagnostic_stream
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[REDACTED]");
    expect(result.stdout).not.toContain("header-secret");
    expect(result.stdout).not.toContain("basic-secret");
    expect(result.stdout).not.toContain("proxy-secret");
    expect(result.stdout).not.toContain("env-auth-secret");
    expect(result.stdout).not.toContain("credential-secret");
    expect(result.stdout).not.toContain("api-secret");
    expect(result.stdout).not.toContain("access-secret");
    expect(result.stdout).not.toContain("quoted password");
    expect(result.stdout).not.toContain("json-prefixed-auth");
    expect(result.stdout).not.toContain("json-proxy");
    expect(result.stdout).not.toContain("json-auth");
    expect(result.stdout).not.toContain("json-token");
    expect(result.stdout).not.toContain("json-client");
    expect(result.stdout).not.toContain("json-password");
    expect(result.stdout).not.toContain("json-object-secret");
    expect(result.stdout).not.toContain("json-pass");
    expect(result.stdout).not.toContain("cli-password");
    expect(result.stdout).not.toContain("cli-token");
  });

  it("preserves non-secret diagnostic text after redacting a spaced credential", () => {
    const result = runLibrary(`
      printf '%s\\n' 'CREDENTIALS=Bearer credential-secret actual-failure=91' | wiseeff_upgrade_sanitize_diagnostic_stream
    `);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("credential-secret");
    expect(result.stdout).toContain("actual-failure=91");
  });

  it("records the exact quiescence service and redacted diagnostic when stopping proxy fails", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-quiescence-failure-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=quiescence-failure
      wiseeff_upgrade_state_write phase quiescing
      wiseeff_upgrade_compose() {
        printf 'proxy stop failed M6_SELFHOSTED_SMOKE_AUTHORIZATION=auth-secret\\n'
        return 91
      }
      wiseeff_upgrade_queue_command() { printf 'must-not-pause\\n'; return 0; }
      if wiseeff_upgrade_stop_old_stack; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).not.toBe(0);
    expect(readFileSync(join(runDir, "failed_phase"), "utf8")).toBe("quiescing\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("proxy\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("quiesce-proxy-stop\n");
    expect(readFileSync(join(runDir, "recovery_failure_summary"), "utf8")).toContain("action=quiesce-proxy-stop");
    expect(result.stderr).not.toContain("auth-secret");
    expect(result.stdout).not.toContain("must-not-pause");
  });

  it("allows pre-migration recovery-required resume to retry old-stack restoration", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-resume-pre-migration-"));
    writeFileSync(join(runDir, "outcome"), "recovery-required\n");
    writeFileSync(join(runDir, "phase"), "recovery-required\n");
    writeFileSync(join(runDir, "migration_started"), "false\n");

    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=resume-pre-migration
      wiseeff_upgrade_reject_root_runtime() { return 0; }
      wiseeff_upgrade_load_run() { :; }
      wiseeff_upgrade_acquire_lock() { return 0; }
      wiseeff_upgrade_release_lock() { :; }
      wiseeff_upgrade_validate_env() { return 0; }
      wiseeff_upgrade_restore_old_stack_after_stop() {
        printf 'old-stack-restore-retried\\n'
        return 0
      }
      wiseeff_upgrade_restore_postgres() { printf 'rollback-must-not-run\\n'; return 1; }
      wiseeff_upgrade_status() { :; }
      wiseeff_upgrade_run_resume
    `, [runDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("old-stack-restore-retried");
    expect(result.stdout).not.toContain("rollback-must-not-run");
  });

  it("keeps post-migration recovery-required resume behind the token-gated rollback action", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-resume-post-migration-"));
    writeFileSync(join(runDir, "migration_started"), "true\n");
    writeFileSync(join(runDir, "phase"), "starting-app-services\n");
    writeFileSync(join(runDir, "outcome"), "running\n");
    writeFileSync(join(runDir, "previous_sha"), "previous-sha\n");
    writeFileSync(join(runDir, "target_sha"), "target-sha\n");
    writeFileSync(join(runDir, "candidate_image_tag"), "wiseeff-app:candidate\n");

    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=post-migration
      upgrade_candidate_image_tag=wiseeff-app:candidate
      wiseeff_upgrade_state_write phase starting-app-services
      wiseeff_upgrade_compose() { return 0; }
      wiseeff_upgrade_queue_command_for_image() { return 0; }
      wiseeff_upgrade_mark_recovery_required api candidate-api-live 'The candidate API liveness probe failed.'
      cat "$upgrade_run_dir/next_action"
    `, [runDir]);

    expect(result.status).toBe(0);
    const nextAction = readFileSync(join(runDir, "next_action"), "utf8");
    expect(nextAction).toContain("rollback");
    expect(nextAction).toContain("--restore-data");
    expect(nextAction).toContain("--confirm restore-post-migration");
    expect(nextAction).not.toMatch(/\\bresume\\b/);
  });

  it("recommends the run-bound candidate recovery action for eligible completion failures", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-candidate-recovery-next-action-"));
    writeFileSync(join(runDir, "migration_started"), "true\n");
    writeFileSync(join(runDir, "failed_phase"), "validating-public\n");
    writeFileSync(join(runDir, "recovery_proxy_stopped"), "true\n");
    writeFileSync(join(runDir, "recovery_queue_paused"), "true\n");

    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=eligible-candidate-recovery
      wiseeff_upgrade_recovery_next_action
    `, [runDir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("recover-candidate --run-id eligible-candidate-recovery");
    expect(result.stdout).toContain("--confirm recover-candidate-eligible-candidate-recovery");
    expect(result.stdout).not.toContain("--restore-data");
  });

  it("recovers an eligible post-migration candidate only after isolation and verification", () => {
    const { result, runDir } = runCandidateRecoveryFixture();
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");

    expect(result.status, result.stderr + "\n" + result.stdout).toBe(0);
    expect(trace.indexOf("proxy-stop")).toBeLessThan(trace.indexOf("manifest-verify"));
    expect(trace.indexOf("queue-pause")).toBeLessThan(trace.indexOf("manifest-verify"));
    expect(trace.indexOf("worker-stop")).toBeLessThan(trace.indexOf("manifest-verify"));
    expect(trace.indexOf("manifest-verify")).toBeLessThan(trace.indexOf("worker-up"));
    expect(trace.indexOf("worker-up")).toBeLessThan(trace.indexOf("queue-resume"));
    expect(trace.indexOf("queue-resume")).toBeLessThan(trace.indexOf("proxy-up"));
    expect(trace.indexOf("proxy-up")).toBeLessThan(trace.indexOf("public-probe"));
    expect(trace).toContain("final-verification recovery-verified=false outcome=recovery-required");
    expect(trace).not.toContain("restore-postgres-must-not-run");
    expect(trace).not.toContain("restore-minio-must-not-run");
    expect(trace).not.toContain("restore-redis-must-not-run");
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("completed\n");
    expect(readFileSync(join(runDir, "phase"), "utf8")).toBe("completed\n");
    expect(readFileSync(join(runDir, "recovery_verified"), "utf8")).toBe("true\n");
    expect(readFileSync(join(runDir, "next_action"), "utf8")).toBe("none\n");
  });

  it("rejects candidate recovery without the run-bound confirmation token before isolation", () => {
    const { result, runDir } = runCandidateRecoveryFixture({ confirm: "recover-candidate-wrong-run" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--confirm recover-candidate-candidate-recovery");
    expect(readFileSync(join(runDir, "trace.log"), "utf8")).toBe("");
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
  });

  it("rejects candidate recovery outside the bounded post-migration completion phases", () => {
    const { result, runDir } = runCandidateRecoveryFixture({ failedPhase: "migrating" });

    expect(result.status).toBe(70);
    expect(result.stderr).toContain("not eligible for candidate recovery");
    expect(readFileSync(join(runDir, "trace.log"), "utf8")).toBe("");
  });

  it("rejects candidate recovery for an already completed run", () => {
    const { result, runDir } = runCandidateRecoveryFixture({ outcome: "completed", phase: "completed" });

    expect(result.status).toBe(70);
    expect(result.stderr).toContain("not eligible for candidate recovery");
    expect(readFileSync(join(runDir, "trace.log"), "utf8")).toBe("");
  });

  it("restarts isolation when an earlier candidate recovery was interrupted", () => {
    const { result, runDir } = runCandidateRecoveryFixture({
      outcome: "running",
      phase: "candidate-recovery-resuming-queue",
    });
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");

    expect(result.status, result.stderr + "\n" + result.stdout).toBe(0);
    expect(trace.indexOf("proxy-stop")).toBeLessThan(trace.indexOf("manifest-verify"));
    expect(trace.indexOf("queue-pause")).toBeLessThan(trace.indexOf("manifest-verify"));
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("completed\n");
  });

  it("records worker isolation failure separately from a successful queue pause", () => {
    const { result, runDir } = runCandidateRecoveryFixture({ workerStopSucceeds: false });

    expect(result.status).toBe(70);
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("worker\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("candidate-recovery-worker-stop\n");
    expect(readFileSync(join(runDir, "recovery_queue_paused"), "utf8")).toBe("false\n");
  });

  it.each([
    { label: "recovery-point manifest", options: { manifestValid: false }, service: "recovery-point", code: "candidate-recovery-manifest" },
    { label: "candidate image", options: { candidateImageAvailable: false }, service: "image", code: "candidate-image-unavailable" },
    { label: "candidate worker readiness", options: { workerHealthy: false }, service: "worker", code: "candidate-worker-health" },
  ])("keeps traffic isolated when $label verification fails", ({ options, service, code }) => {
    const { result, runDir } = runCandidateRecoveryFixture(options);
    const trace = readFileSync(join(runDir, "trace.log"), "utf8");

    expect(result.status, result.stderr + "\n" + result.stdout).toBe(70);
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe(service + "\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe(code + "\n");
    expect(trace).not.toContain("queue-resume");
    expect(trace).not.toContain("proxy-up");
    expect(trace).not.toContain("restore-postgres-must-not-run");
  });

  it.each([
    ["proxy", "Manually isolate proxy traffic"],
    ["queue", "Manually isolate queue/worker traffic"]
  ] as const)("puts manual %s isolation first when recovery isolation fails", (failedIsolation, expectedAction) => {
    const runDir = mkdtempSync(join(tmpdir(), `wiseeff-upgrade-next-action-${failedIsolation}-`));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=isolation-${failedIsolation}
      upgrade_candidate_image_tag=wiseeff-app:candidate
      upgrade_target_sha=target-sha
      migration_started=true
      wiseeff_upgrade_state_write phase starting-app-services
      wiseeff_upgrade_compose() {
        if [ "$1" = "stop" ] && [ "$4" = "proxy" ] && [ "$2" = "-t" ]; then
          [ "$2" != "-t" ]
        fi
        return 0
      }
      wiseeff_upgrade_queue_command_for_image() {
        if [ "$1" = "pause" ]; then
          [ "$2" != "wiseeff-app:candidate" ]
        fi
        return 0
      }
      if [ "$2" = "proxy" ]; then
        wiseeff_upgrade_compose() {
          if [ "$1" = "stop" ] && [ "$4" = "proxy" ]; then return 91; fi
          return 0
        }
        wiseeff_upgrade_queue_command_for_image() { return 0; }
      else
        wiseeff_upgrade_compose() { return 0; }
        wiseeff_upgrade_queue_command_for_image() {
          if [ "$1" = "pause" ]; then return 92; fi
          return 0
        }
      fi
      wiseeff_upgrade_mark_recovery_required api candidate-api-live 'The candidate API liveness probe failed.'
      cat "$upgrade_run_dir/next_action"
    `, [runDir, failedIsolation]);

    expect(result.status).toBe(0);
    expect(readFileSync(join(runDir, "next_action"), "utf8")).toContain(expectedAction);
  });

  it("does not add manual isolation instructions when both recovery gates succeed", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-next-action-clean-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=isolation-clean
      upgrade_candidate_image_tag=wiseeff-app:candidate
      upgrade_target_sha=target-sha
      wiseeff_upgrade_state_write phase starting-app-services
      wiseeff_upgrade_state_write migration_started true
      wiseeff_upgrade_compose() { return 0; }
      wiseeff_upgrade_queue_command_for_image() { return 0; }
      wiseeff_upgrade_mark_recovery_required api candidate-api-live 'The candidate API liveness probe failed.'
      cat "$upgrade_run_dir/next_action"
    `, [runDir]);

    expect(result.status).toBe(0);
    const nextAction = readFileSync(join(runDir, "next_action"), "utf8");
    expect(nextAction).toContain("rollback");
    expect(nextAction).not.toContain("Manually isolate");
    expect(readFileSync(join(runDir, "recovery_proxy_stopped"), "utf8")).toBe("true\n");
    expect(readFileSync(join(runDir, "recovery_queue_paused"), "utf8")).toBe("true\n");
  });

  it("requires manual queue/worker isolation when stopping the worker fails", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-next-action-worker-stop-"));
    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=isolation-worker-stop
      upgrade_candidate_image_tag=wiseeff-app:candidate
      migration_started=true
      wiseeff_upgrade_compose() {
        if [ "$1" = "stop" ] && [ "$4" = "worker" ]; then return 93; fi
        return 0
      }
      wiseeff_upgrade_queue_command_for_image() { return 0; }
      wiseeff_upgrade_mark_recovery_required api candidate-api-live 'The candidate API liveness probe failed.'
      cat "$upgrade_run_dir/next_action"
    `, [runDir]);

    expect(result.status).toBe(0);
    expect(readFileSync(join(runDir, "recovery_queue_paused"), "utf8")).toBe("false\n");
    expect(readFileSync(join(runDir, "next_action"), "utf8")).toContain("Manually isolate queue/worker traffic");
  });

  it("blocks rollback before data restoration when isolation cannot be verified", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-rollback-isolation-"));
    writeFileSync(join(runDir, "migration_started"), "true\n");
    writeFileSync(join(runDir, "outcome"), "recovery-required\n");
    writeFileSync(join(runDir, "phase"), "recovery-required\n");
    writeFileSync(join(runDir, "previous_image_tag_api"), "wiseeff-app:previous-api\n");

    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=rollback-isolation
      upgrade_previous_sha=previous-sha
      upgrade_restore_data=true
      upgrade_confirm=restore-rollback-isolation
      upgrade_json=false
      wiseeff_upgrade_reject_root_runtime() { return 0; }
      wiseeff_upgrade_load_run() { :; }
      wiseeff_upgrade_acquire_lock() { return 0; }
      wiseeff_upgrade_release_lock() { :; }
      wiseeff_upgrade_validate_env() { return 0; }
      wiseeff_upgrade_compose() {
        if [ "$1" = "stop" ] && [ "$4" = "proxy" ]; then
          printf 'proxy stop failed password=mock-password HTTPS_PROXY=http://operator:proxy-password@proxy.example.test:8080\\n'
          return 91
        fi
        return 0
      }
      wiseeff_upgrade_queue_command_for_image() { return 0; }
      wiseeff_upgrade_git() { printf 'git-must-not-run\\n'; return 0; }
      wiseeff_upgrade_compose_for_image() { printf 'restore-must-not-run\\n'; return 0; }
      wiseeff_upgrade_restore_postgres() { printf 'restore-data-must-not-run\\n'; return 1; }
      wiseeff_upgrade_run_rollback
    `, [runDir]);

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(70);
    expect(result.stderr).toContain("action=proxy-stop");
    expect(result.stderr).not.toContain("mock-password");
    expect(result.stderr).not.toContain("proxy-password");
    expect(result.stdout).not.toContain("restore-must-not-run");
    expect(result.stdout).not.toContain("restore-data-must-not-run");
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("proxy\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("rollback-proxy-stop\n");
    expect(readFileSync(join(runDir, "next_action"), "utf8")).toContain("Manually isolate proxy traffic");
  });

  it("uses full restore verification before marking rollback complete", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-rollback-verification-"));
    writeFileSync(join(runDir, "migration_started"), "true\n");
    writeFileSync(join(runDir, "outcome"), "recovery-required\n");
    writeFileSync(join(runDir, "phase"), "recovery-required\n");
    writeFileSync(join(runDir, "previous_image_tag_api"), "wiseeff-app:previous-api\n");
    writeFileSync(join(runDir, "previous_image_tag_worker"), "wiseeff-app:previous-worker\n");
    writeFileSync(join(runDir, "previous_image_tag_web"), "wiseeff-app:previous-web\n");

    const result = runLibrary(`
      upgrade_run_dir="$1"
      trace="$1/trace.log"
      upgrade_run_id=rollback-verification
      upgrade_previous_sha=previous-sha
      upgrade_restore_data=true
      upgrade_confirm=restore-rollback-verification
      upgrade_json=false
      : > "$trace"
      wiseeff_upgrade_reject_root_runtime() { return 0; }
      wiseeff_upgrade_load_run() { :; }
      wiseeff_upgrade_acquire_lock() { return 0; }
      wiseeff_upgrade_release_lock() { :; }
      wiseeff_upgrade_validate_env() { return 0; }
      wiseeff_upgrade_compose() {
        printf 'compose %s\\n' "$*" >> "$trace"
        return 0
      }
      wiseeff_upgrade_queue_command_for_image() {
        printf 'queue-%s\\n' "$1" >> "$trace"
        return 0
      }
      wiseeff_upgrade_git() { printf 'checkout\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_compose_for_image() {
        case "$*" in
          *" postgres redis minio minio-init") printf 'data\\n' >> "$trace" ;;
          *" proxy") printf 'proxy\\n' >> "$trace" ;;
        esac
        return 0
      }
      wiseeff_upgrade_verify_backup_manifest() { printf 'manifest\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_restore_postgres() { printf 'postgres-restore\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_restore_objects() { printf 'object-restore\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_restore_redis() { printf 'redis-restore\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_snapshot_manifest() { printf 'manifest-snapshot\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_recreate_previous_app_services() { printf 'apps\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_wait_data_plane_ready() { printf 'data-ready\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_probe_api() { printf 'api-%s\\n' "$1" >> "$trace"; return 0; }
      wiseeff_upgrade_probe_worker() { printf 'worker\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_probe_web() { printf 'web\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_verify_previous_app_images() { printf 'images\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_public_probe() { printf 'public\\n' >> "$trace"; return 0; }
      wiseeff_upgrade_mark_recovery_required() { printf 'recovery-required\\n' >> "$trace"; return 70; }
      wiseeff_upgrade_run_rollback
    `, [runDir]);

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("rolled-back\n");
    expect(readFileSync(join(runDir, "phase"), "utf8")).toBe("rolled-back\n");
    expect(readFileSync(join(runDir, "recovery_verified"), "utf8")).toBe("true\n");
    expect(readFileSync(join(runDir, "next_action"), "utf8")).toBe("none\n");
    const events = readFileSync(join(runDir, "trace.log"), "utf8").trim().split("\n");
    expect(events.indexOf("images")).toBeGreaterThan(events.indexOf("apps"));
    expect(events.indexOf("queue-resume")).toBeGreaterThan(events.indexOf("images"));
    expect(events.indexOf("proxy")).toBeGreaterThan(events.indexOf("queue-resume"));
    expect(events.indexOf("public")).toBeGreaterThan(events.indexOf("proxy"));
  });

  it.each([
    ["manifest", "recovery-point", "rollback-backup-manifest"],
    ["postgres", "postgres", "rollback-postgres-restore"],
    ["minio", "minio", "rollback-minio-restore"],
    ["redis", "redis", "rollback-redis-restore"]
  ] as const)("records the restoring-data failure for rollback %s", (failureTarget, expectedService, expectedCode) => {
    const runDir = mkdtempSync(join(tmpdir(), `wiseeff-upgrade-rollback-data-${failureTarget}-`));
    writeFileSync(join(runDir, "migration_started"), "true\n");
    writeFileSync(join(runDir, "outcome"), "recovery-required\n");
    writeFileSync(join(runDir, "phase"), "recovery-required\n");
    writeFileSync(join(runDir, "previous_image_tag_api"), "wiseeff-app:previous-api\n");

    const result = runLibrary(`
      upgrade_run_dir="$1"
      failure_target="$2"
      upgrade_run_id=rollback-data-failure
      upgrade_previous_sha=previous-sha
      upgrade_backup_dir="$upgrade_run_dir/backup"
      upgrade_restore_data=true
      upgrade_confirm=restore-rollback-data-failure
      upgrade_json=false
      wiseeff_upgrade_reject_root_runtime() { return 0; }
      wiseeff_upgrade_load_run() { :; }
      wiseeff_upgrade_acquire_lock() { return 0; }
      wiseeff_upgrade_release_lock() { :; }
      wiseeff_upgrade_validate_env() { return 0; }
      wiseeff_upgrade_run_recovery_action() { shift; "$@"; }
      wiseeff_upgrade_compose() { return 0; }
      wiseeff_upgrade_compose_for_image() { return 0; }
      wiseeff_upgrade_queue_command_for_image() { return 0; }
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_wait_data_plane_ready() { return 0; }
      wiseeff_upgrade_verify_backup_manifest() { [ "$failure_target" != "manifest" ]; }
      wiseeff_upgrade_restore_postgres() { [ "$failure_target" != "postgres" ]; }
      wiseeff_upgrade_restore_objects() { [ "$failure_target" != "minio" ]; }
      wiseeff_upgrade_restore_redis() { [ "$failure_target" != "redis" ]; }
      wiseeff_upgrade_snapshot_manifest() { return 0; }
      wiseeff_upgrade_recreate_previous_app_services() { return 0; }
      wiseeff_upgrade_verify_restored_stack() { return 0; }
      wiseeff_upgrade_mark_recovery_required() { :; }
      wiseeff_upgrade_run_rollback
    `, [runDir, failureTarget]);

    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(70);
    expect(readFileSync(join(runDir, "failed_phase"), "utf8"), `${result.stderr}\n${result.stdout}`).toBe("restoring-data\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe(`${expectedService}\n`);
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe(`${expectedCode}\n`);
  });

  it.each(["postgres", "redis", "minio", "minio-init"] as const)(
    "records %s readiness failure under old-stack-restore and preserves candidate evidence on success",
    (failureService) => {
      const runDir = mkdtempSync(join(tmpdir(), `wiseeff-upgrade-restore-phase-${failureService}-`));
      writeFileSync(join(runDir, "previous_sha"), "previous-sha\n");
      for (const service of ["api", "worker", "web"]) {
        writeFileSync(join(runDir, `previous_image_tag_${service}`), `wiseeff-app:previous-${service}\n`);
      }

      const result = runLibrary(`
        upgrade_run_dir="$1"
        upgrade_run_id=restore-phase-${failureService}
        upgrade_target_sha=target-sha
        wiseeff_upgrade_state_write phase restarting-data
        wiseeff_upgrade_state_write failed_phase restarting-data
        wiseeff_upgrade_state_write failure_service api
        wiseeff_upgrade_state_write failure_code candidate-api-live
        wiseeff_upgrade_state_write failure_summary 'The candidate API liveness probe failed.'
        wiseeff_upgrade_git() { return 0; }
        wiseeff_upgrade_compose() { return 0; }
        wiseeff_upgrade_compose_for_image() { return 0; }
        wiseeff_upgrade_recreate_previous_app_services() { return 0; }
        wiseeff_upgrade_wait_data_plane_ready() {
          wiseeff_upgrade_record_failure "$(wiseeff_upgrade_state_read phase)" "${failureService}" "restore-${failureService}-not-ready" "The restored ${failureService} readiness probe failed."
          return 1
        }
        wiseeff_upgrade_verify_restored_stack() { wiseeff_upgrade_wait_data_plane_ready; }
        wiseeff_upgrade_queue_command_for_image() { return 0; }
        wiseeff_upgrade_mark_recovery_required() {
          wiseeff_upgrade_state_write outcome recovery-required
          wiseeff_upgrade_state_write next_action 'rollback --restore-data --confirm restore-token'
          return 0
        }
        if wiseeff_upgrade_restore_old_stack_after_stop; then exit 0; else exit $?; fi
      `, [runDir, failureService]);

      expect(result.status).toBe(70);
      expect(readFileSync(join(runDir, "failed_phase"), "utf8")).toBe("old-stack-restore\n");
      expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe(`${failureService}\n`);
      expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe(`restore-${failureService}-not-ready\n`);
    }
  );

  it("preserves candidate failure evidence when old-stack restoration succeeds", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-restore-preserves-failure-"));
    writeFileSync(join(runDir, "previous_sha"), "previous-sha\n");
    writeFileSync(join(runDir, "failed_phase"), "restarting-data\n");
    writeFileSync(join(runDir, "failure_service"), "api\n");
    writeFileSync(join(runDir, "failure_code"), "candidate-api-live\n");
    writeFileSync(join(runDir, "failure_summary"), "The candidate API liveness probe failed.\n");
    for (const service of ["api", "worker", "web"]) {
      writeFileSync(join(runDir, `previous_image_tag_${service}`), `wiseeff-app:previous-${service}\n`);
    }

    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=restore-preserves-failure
      upgrade_target_sha=target-sha
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_compose() { return 0; }
      wiseeff_upgrade_compose_for_image() { return 0; }
      wiseeff_upgrade_recreate_previous_app_services() { return 0; }
      wiseeff_upgrade_wait_data_plane_ready() { return 0; }
      wiseeff_upgrade_queue_command_for_image() { return 0; }
      wiseeff_upgrade_probe_api() { return 0; }
      wiseeff_upgrade_probe_worker() { return 0; }
      wiseeff_upgrade_probe_web() { return 0; }
      wiseeff_upgrade_verify_previous_app_images() { return 0; }
      wiseeff_upgrade_public_probe() { return 0; }
      wiseeff_upgrade_restore_old_stack_after_stop
    `, [runDir]);

    expect(result.status).toBe(0);
    expect(readFileSync(join(runDir, "phase"), "utf8")).toBe("old-stack-restored\n");
    expect(readFileSync(join(runDir, "failed_phase"), "utf8")).toBe("restarting-data\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("api\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("candidate-api-live\n");
  });

  it("preserves a final worker failure when entering recovery-required", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-final-worker-failure-"));
    writeFileSync(join(runDir, "phase"), "validating-public\n");
    writeFileSync(join(runDir, "outcome"), "running\n");

    const result = runLibrary(`
      upgrade_run_dir="$1"
      upgrade_run_id=final-worker-failure
      upgrade_json=false
      upgrade_candidate_image_tag=wiseeff-app:candidate
      wiseeff_upgrade_public_probe() { return 0; }
      wiseeff_upgrade_verify_final_state() {
        wiseeff_upgrade_record_failure validating-public worker candidate-worker-health 'The candidate worker liveness or Docker health probe failed during final verification.'
        return 1
      }
      wiseeff_upgrade_compose() { return 0; }
      wiseeff_upgrade_queue_command_for_image() { return 0; }
      if wiseeff_upgrade_complete_candidate; then exit 0; else exit $?; fi
    `, [runDir]);

    expect(result.status).toBe(70);
    expect(readFileSync(join(runDir, "outcome"), "utf8")).toBe("recovery-required\n");
    expect(readFileSync(join(runDir, "recovery_started"), "utf8")).toBe("true\n");
    expect(readFileSync(join(runDir, "failure_service"), "utf8")).toBe("worker\n");
    expect(readFileSync(join(runDir, "failure_code"), "utf8")).toBe("candidate-worker-health\n");
  });

  it("prepares the bundled base image before the candidate build", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-base-before-build-"));
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_target_sha=target-sha
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_ensure_base_image() { printf 'prepare-base\\n'; }
      wiseeff_upgrade_compose() { printf 'build-app\\n'; }
      wiseeff_upgrade_docker() { return 0; }
      wiseeff_upgrade_build_candidate
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_RUN_DIR: runDir } });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/prepare-base[\s\S]*build-app/);
  });

  it("does not enter the candidate build when base-image preparation fails", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-base-failure-"));
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_target_sha=target-sha
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_ensure_base_image() { printf 'base-image-invalid\\n' >&2; return 42; }
      wiseeff_upgrade_compose() { printf 'should-not-build\\n'; }
      wiseeff_upgrade_docker() { return 0; }
      if wiseeff_upgrade_build_candidate; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_RUN_DIR: runDir } });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("base-image-invalid");
    expect(result.stdout).not.toContain("should-not-build");
    expect(readFileSync(join(runDir, "diagnostics", "summary.txt"), "utf8")).toContain("category=base-image");
    expect(readFileSync(join(runDir, "diagnostics", "build.log"), "utf8")).toContain("base-image-invalid");
  });

  it("accepts the pinned config digest returned by a classic Docker image store after loading", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-base-image-"));
    const imagesDir = join(repoRoot, "ops", "self-hosted", "images");
    const runDir = join(repoRoot, "run");
    mkdirSync(imagesDir, { recursive: true });
    mkdirSync(runDir);
    const archive = Buffer.from("verified-test-image-archive");
    const archiveSha = createHash("sha256").update(archive).digest("hex");
    writeFileSync(join(imagesDir, "node-test-amd64.tar"), archive);
    writeFileSync(join(imagesDir, "base-image-bundle.env"), [
      "WISEEFF_BASE_IMAGE_REF=node:22.21.1-alpine",
      "WISEEFF_BASE_IMAGE_ARCHIVE=node-test-amd64.tar",
      "WISEEFF_BASE_IMAGE_ARCHIVE_REF=node:22.21.1-alpine-amd64",
      "WISEEFF_BASE_IMAGE_PLATFORM=linux/amd64",
      "WISEEFF_BASE_IMAGE_ID=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "WISEEFF_BASE_IMAGE_CONFIG_ID=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      `WISEEFF_BASE_IMAGE_ARCHIVE_SHA256=${archiveSha}`,
      ""
    ].join("\n"));

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$WISEEFF_TEST_REPO_ROOT"
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      docker_state="$WISEEFF_TEST_RUN_DIR/docker-state"
      mkdir -p "$docker_state"
      wiseeff_upgrade_docker() {
        case "$1 $2" in
          "version --format") printf 'linux/amd64\\n' ;;
          "image inspect")
            ref="$5"
            if [ "$ref" = "node:22.21.1-alpine-amd64" ] && [ -f "$docker_state/loaded" ]; then
              printf 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc|linux/amd64\\n'
              return 0
            fi
            if [ "$ref" = "node:22.21.1-alpine" ] && [ -f "$docker_state/tagged" ]; then
              printf 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc|linux/amd64\\n'
              return 0
            fi
            return 1
            ;;
          "load -i")
            printf '%s\\n' "$3" > "$docker_state/load-path"
            touch "$docker_state/loaded"
            ;;
          "tag node:22.21.1-alpine-amd64")
            [ "$3" = "node:22.21.1-alpine" ] || return 91
            touch "$docker_state/tagged"
            ;;
          *) return 92 ;;
        esac
      }
      wiseeff_upgrade_ensure_base_image
    `], {
      encoding: "utf8",
      env: { ...process.env, WISEEFF_TEST_REPO_ROOT: repoRoot, WISEEFF_TEST_RUN_DIR: runDir }
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(runDir, "docker-state", "load-path"), "utf8").trim()).toBe(
      join(imagesDir, "node-test-amd64.tar")
    );
    expect(existsSync(join(runDir, "docker-state", "tagged"))).toBe(true);
    expect(readFileSync(join(runDir, "base_image_source"), "utf8")).toBe("bundled-archive\n");
  });

  it("reports both accepted digests and the actual Docker identity when a loaded image mismatches", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-base-image-mismatch-"));
    const imagesDir = join(repoRoot, "ops", "self-hosted", "images");
    mkdirSync(imagesDir, { recursive: true });
    const archive = Buffer.from("verified-test-image-archive");
    const archiveSha = createHash("sha256").update(archive).digest("hex");
    writeFileSync(join(imagesDir, "node-test-amd64.tar"), archive);
    writeFileSync(join(imagesDir, "base-image-bundle.env"), [
      "WISEEFF_BASE_IMAGE_REF=node:22.21.1-alpine",
      "WISEEFF_BASE_IMAGE_ARCHIVE=node-test-amd64.tar",
      "WISEEFF_BASE_IMAGE_ARCHIVE_REF=node:22.21.1-alpine-amd64",
      "WISEEFF_BASE_IMAGE_PLATFORM=linux/amd64",
      "WISEEFF_BASE_IMAGE_ID=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "WISEEFF_BASE_IMAGE_CONFIG_ID=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      `WISEEFF_BASE_IMAGE_ARCHIVE_SHA256=${archiveSha}`,
      ""
    ].join("\n"));

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$WISEEFF_TEST_REPO_ROOT"
      upgrade_run_dir=""
      loaded=false
      wiseeff_upgrade_docker() {
        case "$1 $2" in
          "version --format") printf 'linux/amd64\\n' ;;
          "load -i") loaded=true ;;
          "image inspect")
            [ "$loaded" = "true" ] || return 1
            printf 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd|linux/amd64\\n'
            ;;
          *) return 92 ;;
        esac
      }
      if wiseeff_upgrade_ensure_base_image; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_REPO_ROOT: repoRoot } });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("manifest=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
    expect(result.stderr).toContain("config=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    expect(result.stderr).toContain("actual=sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd|linux/amd64");
  });

  it("rejects a modified base-image archive without asking Docker to load it", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-base-image-tampered-"));
    const imagesDir = join(repoRoot, "ops", "self-hosted", "images");
    const runDir = join(repoRoot, "run");
    mkdirSync(imagesDir, { recursive: true });
    mkdirSync(runDir);
    writeFileSync(join(imagesDir, "node-test-amd64.tar"), "tampered");
    writeFileSync(join(imagesDir, "base-image-bundle.env"), [
      "WISEEFF_BASE_IMAGE_REF=node:22.21.1-alpine",
      "WISEEFF_BASE_IMAGE_ARCHIVE=node-test-amd64.tar",
      "WISEEFF_BASE_IMAGE_ARCHIVE_REF=node:22.21.1-alpine-amd64",
      "WISEEFF_BASE_IMAGE_PLATFORM=linux/amd64",
      "WISEEFF_BASE_IMAGE_ID=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "WISEEFF_BASE_IMAGE_CONFIG_ID=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "WISEEFF_BASE_IMAGE_ARCHIVE_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ""
    ].join("\n"));

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$WISEEFF_TEST_REPO_ROOT"
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      wiseeff_upgrade_docker() { printf 'docker-must-not-run\\n'; return 93; }
      if wiseeff_upgrade_ensure_base_image; then exit 0; else exit $?; fi
    `], {
      encoding: "utf8",
      env: { ...process.env, WISEEFF_TEST_REPO_ROOT: repoRoot, WISEEFF_TEST_RUN_DIR: runDir }
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("docker-must-not-run");
    expect(result.stderr).toContain("checksum");
  });

  it("keeps plan-time target bundle validation read-only and reports that apply will load it", () => {
    const archive = "target-archive-blob";
    const archiveSha = createHash("sha256").update(archive).digest("hex");
    const contract = [
      "WISEEFF_BASE_IMAGE_REF=node:22.21.1-alpine",
      "WISEEFF_BASE_IMAGE_ARCHIVE=node-test-amd64.tar",
      "WISEEFF_BASE_IMAGE_ARCHIVE_REF=node:22.21.1-alpine-amd64",
      "WISEEFF_BASE_IMAGE_PLATFORM=linux/amd64",
      "WISEEFF_BASE_IMAGE_ID=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "WISEEFF_BASE_IMAGE_CONFIG_ID=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      `WISEEFF_BASE_IMAGE_ARCHIVE_SHA256=${archiveSha}`
    ].join("\n");
    const planDirectory = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-plan-base-"));
    const mutationLog = join(planDirectory, "docker-mutations");
    const buildNetworkConfig = join(planDirectory, "build-network.env");
    writeFileSync(
      buildNetworkConfig,
      "HTTPS_PROXY=http://operator:plan-secret@proxy.example.com:8080\nWISEEFF_NPM_REGISTRY=https://npm.example.com/repository/npm/\n",
      { mode: 0o600 }
    );
    chmodSync(buildNetworkConfig, 0o600);

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_target_sha=target-sha
      wiseeff_upgrade_git() {
        if [ "$1" = "show" ]; then
          case "$2" in
            *:ops/self-hosted/images/base-image-bundle.env) printf '%s' "$WISEEFF_TEST_CONTRACT" ;;
            *:ops/self-hosted/Dockerfile) printf 'FROM node:22.21.1-alpine AS runtime\\n' ;;
            *:ops/self-hosted/images/node-test-amd64.tar) printf '%s' "$WISEEFF_TEST_ARCHIVE" ;;
            *) return 81 ;;
          esac
          return 0
        fi
        if [ "$1" = "cat-file" ]; then printf 'blob\\n'; return 0; fi
        return 82
      }
      wiseeff_upgrade_docker() {
        if [ "$1 $2" = "version --format" ]; then printf 'linux/amd64\\n'; return 0; fi
        if [ "$1 $2" = "image inspect" ]; then return 1; fi
        printf '%s\\n' "$*" >> "$WISEEFF_TEST_MUTATION_LOG"
        return 83
      }
      wiseeff_upgrade_validate_target_base_image_bundle
      printf 'status=%s\\n' "$upgrade_base_image_status"
      upgrade_json=true
      upgrade_previous_sha=previous-sha
      upgrade_ref=origin/main
      upgrade_migrations=""
      upgrade_restart=false
      wiseeff_build_network_prepare "$PWD/ops/self-hosted" "$WISEEFF_TEST_BUILD_NETWORK_CONFIG"
      wiseeff_upgrade_print_plan
    `], {
      encoding: "utf8",
      env: {
        ...process.env,
        WISEEFF_TEST_CONTRACT: contract,
        WISEEFF_TEST_ARCHIVE: archive,
        WISEEFF_TEST_MUTATION_LOG: mutationLog,
        WISEEFF_TEST_BUILD_NETWORK_CONFIG: buildNetworkConfig,
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        NO_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
        no_proxy: ""
      }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("status=ready-bundled");
    expect(result.stdout).toContain('"source":"bundled-archive"');
    expect(result.stdout).toContain('"id":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"');
    expect(result.stdout).toContain('"configId":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"');
    expect(result.stdout).toContain(
      '"buildNetwork":{"proxy":"configured","npmRegistry":"npm.example.com","corporateCa":"not configured","buildTlsPolicy":"verify","runtimeProxy":false}'
    );
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("plan-secret");
    expect(existsSync(mutationLog)).toBe(false);
  });

  it("skips Docker load and tag when the exact pinned base image is already present", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-base-image-local-"));
    const imagesDir = join(repoRoot, "ops", "self-hosted", "images");
    const runDir = join(repoRoot, "run");
    mkdirSync(imagesDir, { recursive: true });
    mkdirSync(runDir);
    const archive = Buffer.from("verified-test-image-archive");
    const archiveSha = createHash("sha256").update(archive).digest("hex");
    writeFileSync(join(imagesDir, "node-test-amd64.tar"), archive);
    writeFileSync(join(imagesDir, "base-image-bundle.env"), [
      "WISEEFF_BASE_IMAGE_REF=node:22.21.1-alpine",
      "WISEEFF_BASE_IMAGE_ARCHIVE=node-test-amd64.tar",
      "WISEEFF_BASE_IMAGE_ARCHIVE_REF=node:22.21.1-alpine-amd64",
      "WISEEFF_BASE_IMAGE_PLATFORM=linux/amd64",
      "WISEEFF_BASE_IMAGE_ID=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "WISEEFF_BASE_IMAGE_CONFIG_ID=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      `WISEEFF_BASE_IMAGE_ARCHIVE_SHA256=${archiveSha}`,
      ""
    ].join("\n"));

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$WISEEFF_TEST_REPO_ROOT"
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      wiseeff_upgrade_docker() {
        if [ "$1 $2" = "version --format" ]; then printf 'linux/amd64\\n'; return 0; fi
        if [ "$1 $2" = "image inspect" ]; then
          printf 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee|linux/amd64\\n'
          return 0
        fi
        printf 'unexpected-mutation=%s\\n' "$*"
        return 84
      }
      wiseeff_upgrade_ensure_base_image
    `], {
      encoding: "utf8",
      env: { ...process.env, WISEEFF_TEST_REPO_ROOT: repoRoot, WISEEFF_TEST_RUN_DIR: runDir }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("unexpected-mutation");
    expect(readFileSync(join(runDir, "base_image_source"), "utf8")).toBe("local\n");
  });

  it("fails before Docker load when the host platform does not match the bundle", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-base-image-platform-"));
    const imagesDir = join(repoRoot, "ops", "self-hosted", "images");
    mkdirSync(imagesDir, { recursive: true });
    const archive = Buffer.from("verified-test-image-archive");
    const archiveSha = createHash("sha256").update(archive).digest("hex");
    writeFileSync(join(imagesDir, "node-test-amd64.tar"), archive);
    writeFileSync(join(imagesDir, "base-image-bundle.env"), [
      "WISEEFF_BASE_IMAGE_REF=node:22.21.1-alpine",
      "WISEEFF_BASE_IMAGE_ARCHIVE=node-test-amd64.tar",
      "WISEEFF_BASE_IMAGE_ARCHIVE_REF=node:22.21.1-alpine-amd64",
      "WISEEFF_BASE_IMAGE_PLATFORM=linux/amd64",
      "WISEEFF_BASE_IMAGE_ID=sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "WISEEFF_BASE_IMAGE_CONFIG_ID=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      `WISEEFF_BASE_IMAGE_ARCHIVE_SHA256=${archiveSha}`,
      ""
    ].join("\n"));

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$WISEEFF_TEST_REPO_ROOT"
      upgrade_run_dir=""
      wiseeff_upgrade_docker() {
        if [ "$1 $2" = "version --format" ]; then printf 'linux/arm64\\n'; return 0; fi
        printf 'docker-must-not-mutate\\n'
        return 85
      }
      if wiseeff_upgrade_ensure_base_image; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_REPO_ROOT: repoRoot } });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("does not match Docker server platform");
    expect(result.stdout).not.toContain("docker-must-not-mutate");
  });

  it("retains private diagnostics without inspecting or journaling a failed candidate image", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-build-failure-"));
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_target_sha=target-sha
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_ensure_base_image() { return 0; }
      wiseeff_upgrade_compose() {
        printf 'progress=%s\\n' "$BUILDKIT_PROGRESS"
        printf 'proxy=https://operator:build-secret@registry.example.com\\n'
        printf 'NPM_TOKEN=build-token-secret\\n'
        printf 'npm error code EAI_AGAIN\\n'
        return 23
      }
      wiseeff_upgrade_docker() { printf 'should-not-inspect\\n'; return 0; }
      if wiseeff_upgrade_build_candidate; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_RUN_DIR: runDir } });

    expect(result.status).toBe(23);
    expect(result.stdout).toContain("progress=plain");
    expect(result.stdout).toContain("npm error code EAI_AGAIN");
    expect(result.stdout).toContain("[REDACTED]");
    expect(result.stdout).not.toContain("build-secret");
    expect(result.stdout).not.toContain("build-token-secret");
    expect(result.stdout).not.toContain("should-not-inspect");
    const buildLog = readFileSync(join(runDir, "diagnostics", "build.log"), "utf8");
    expect(buildLog).toContain("EAI_AGAIN");
    expect(buildLog).toContain("[REDACTED]");
    expect(buildLog).not.toContain("build-secret");
    expect(buildLog).not.toContain("build-token-secret");
    expect(readFileSync(join(runDir, "diagnostics", "summary.txt"), "utf8")).toContain("category=dns");
    expect(readFileSync(join(runDir, "build_status"), "utf8")).toBe("failed\n");
    expect(existsSync(join(runDir, "candidate_image_tag"))).toBe(false);
    expect(statSync(join(runDir, "diagnostics", "build.log")).mode & 0o777).toBe(0o600);
    expect(statSync(join(runDir, "diagnostics", "summary.txt")).mode & 0o777).toBe(0o600);
  });

  it("points restricted-network failures at the managed build-network entry", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-network-guidance-"));
    const diagnosticsDir = join(runDir, "diagnostics");
    mkdirSync(diagnosticsDir);
    writeFileSync(join(diagnosticsDir, "build.log"), "npm error ETIMEDOUT registry.example.com\n");

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      upgrade_build_log="$WISEEFF_TEST_RUN_DIR/diagnostics/build.log"
      upgrade_build_summary="$WISEEFF_TEST_RUN_DIR/diagnostics/summary.txt"
      wiseeff_upgrade_write_build_failure_summary 1
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_RUN_DIR: runDir } });

    expect(result.status).toBe(0);
    const summary = readFileSync(join(diagnosticsDir, "summary.txt"), "utf8");
    expect(summary).toContain("category=network");
    expect(summary).toContain("./scripts/build-network.sh status");
    expect(summary).toContain("Docker daemon proxy");
  });

  it("preserves a target-checkout failure and does not start the build", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-checkout-failure-"));
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_target_sha=target-sha
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_git() { return 31; }
      wiseeff_upgrade_compose() { printf 'should-not-build\\n'; return 0; }
      wiseeff_upgrade_docker() { printf 'should-not-inspect\\n'; return 0; }
      if wiseeff_upgrade_build_candidate; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_RUN_DIR: runDir } });

    expect(result.status).toBe(31);
    expect(result.stdout).not.toContain("should-not-build");
    expect(result.stdout).not.toContain("should-not-inspect");
    expect(readFileSync(join(runDir, "diagnostics", "summary.txt"), "utf8")).toContain("category=source-checkout");
    expect(readFileSync(join(runDir, "build_status"), "utf8")).toBe("failed\n");
  });

  it("records an image-inspection failure without journaling a candidate tag", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-inspect-failure-"));
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_target_sha=target-sha
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_ensure_base_image() { return 0; }
      wiseeff_upgrade_compose() { printf 'build-complete\\n'; return 0; }
      wiseeff_upgrade_docker() { return 29; }
      if wiseeff_upgrade_build_candidate; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_RUN_DIR: runDir } });

    expect(result.status).toBe(29);
    expect(readFileSync(join(runDir, "diagnostics", "summary.txt"), "utf8")).toContain("category=image-inspection");
    expect(readFileSync(join(runDir, "build_status"), "utf8")).toBe("failed\n");
    expect(existsSync(join(runDir, "candidate_image_tag"))).toBe(false);
  });

  it("journals a successful commit-addressed candidate and its build evidence", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-build-success-"));
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_target_sha=target-sha
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_ensure_base_image() { return 0; }
      wiseeff_upgrade_compose() { printf 'build-complete\\n'; return 0; }
      wiseeff_upgrade_docker() { return 0; }
      wiseeff_upgrade_build_candidate
    `], { encoding: "utf8", env: { ...process.env, WISEEFF_TEST_RUN_DIR: runDir } });

    expect(result.status).toBe(0);
    expect(readFileSync(join(runDir, "candidate_image_tag"), "utf8")).toBe("wiseeff-app:target-sha\n");
    expect(readFileSync(join(runDir, "build_status"), "utf8")).toBe("passed\n");
    expect(readFileSync(join(runDir, "diagnostics", "summary.txt"), "utf8")).toContain("status=passed");
  });

  it("stops the recovery-point sequence after the first failed store", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      wiseeff_upgrade_snapshot_postgres() { printf 'postgres-failed\\n'; return 41; }
      wiseeff_upgrade_snapshot_objects() { printf 'should-not-snapshot-objects\\n'; return 0; }
      if wiseeff_upgrade_snapshot_all; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(41);
    expect(result.stdout).toContain("postgres-failed");
    expect(result.stdout).not.toContain("should-not-snapshot-objects");
  });

  it("accepts legacy mixed app images and records compatibility mode", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_run_dir=""
      wiseeff_upgrade_compose() { printf 'container-%s\\n' "$3"; }
      wiseeff_upgrade_docker() {
        template="$3"
        container="$4"
        case "$template" in
          *'.Image'*)
            case "$container" in
              *api) printf 'image-api\\n' ;;
              *worker) printf 'image-worker\\n' ;;
              *web) printf 'image-web\\n' ;;
              *) printf 'image-shared\\n' ;;
            esac
            ;;
          *compose.project*) printf 'self-hosted\\n' ;;
          *Networks*) printf 'self-hosted_default\\n' ;;
        esac
      }
      if wiseeff_upgrade_collect_runtime; then
        printf 'mixed=%s\\n' "$upgrade_mixed_app_images"
      else
        exit $?
      fi
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("mixed=true");
  });

  it("tags the previous image independently for api, worker, and web", () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-images-"));
    for (const service of ["api", "worker", "web"]) {
      writeFileSync(join(stateRoot, `image_${service}`), `sha256:${service}\n`);
    }
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_run_dir="$1"
      upgrade_run_id=run-1
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_docker() { printf '%s\\n' "$*"; }
      wiseeff_upgrade_tag_previous_images
    `, "test", stateRoot], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sha256:api wiseeff-app:wiseeff-previous-api-run-1");
    expect(result.stdout).toContain("sha256:worker wiseeff-app:wiseeff-previous-worker-run-1");
    expect(result.stdout).toContain("sha256:web wiseeff-app:wiseeff-previous-web-run-1");
    expect(readFileSync(join(stateRoot, "previous_image_tag_api"), "utf8")).toContain("previous-api-run-1");
    expect(readFileSync(join(stateRoot, "previous_image_tag_worker"), "utf8")).toContain("previous-worker-run-1");
    expect(readFileSync(join(stateRoot, "previous_image_tag_web"), "utf8")).toContain("previous-web-run-1");
  });

  it("restores each previous service with its recorded image repository and tag", () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-restore-images-"));
    for (const service of ["api", "worker", "web"]) {
      writeFileSync(join(stateRoot, `previous_image_tag_${service}`), `registry.example:5000/team/wiseeff:previous-${service}\n`);
    }
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_run_dir="$1"
      wiseeff_upgrade_compose() {
        printf 'repo=%s tag=%s service=%s\\n' "$WISEEFF_APP_IMAGE" "$WISEEFF_APP_TAG" "\${!#}"
      }
      wiseeff_upgrade_recreate_previous_app_services
    `, "test", stateRoot], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("repo=registry.example:5000/team/wiseeff tag=previous-api service=api");
    expect(result.stdout).toContain("repo=registry.example:5000/team/wiseeff tag=previous-worker service=worker");
    expect(result.stdout).toContain("repo=registry.example:5000/team/wiseeff tag=previous-web service=web");
  });

  it("rejects root for networked runtime actions", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_action=plan
      export SUDO_USER=deploy
      id() { [ "$1" = "-u" ] && { printf '0\\n'; return 0; }; return 1; }
      wiseeff_upgrade_reject_root_runtime
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("Do not run plan as root");
  });

  it("gives direct root sessions an explicit deployment-user preparation command", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_action=apply
      unset SUDO_USER
      id() { [ "$1" = "-u" ] && { printf '0\\n'; return 0; }; return 1; }
      wiseeff_upgrade_reject_root_runtime
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("prepare-host --operator USER --yes");
  });

  it("requires root and confirmation for host preparation", () => {
    const result = runUpgrade(["prepare-host", "--yes"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("must run through sudo");
  });

  it("refuses to prepare checkout source directories as operation state", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$PWD"
      wiseeff_upgrade_prepare_host_validate_scope "$PWD/src" /tmp/wiseeff-journal /tmp/wiseeff-backup
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("must stay under");
  });

  it("prepares protected host paths for the invoking deployment user", () => {
    const preparationRoot = mkdtempSync(join(tmpdir(), "wiseeff-host-prepare-"));
    const operationRoot = join(preparationRoot, "state");
    const journalRoot = join(preparationRoot, "journals");
    const backupRoot = join(preparationRoot, "backups");
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_repo_root="$PWD"
      upgrade_yes=true
      upgrade_operator=""
      export SUDO_USER=deploy
      export WISEEFF_OPERATION_LOCK_DIR="$1"
      export WISEEFF_UPGRADE_STATE_DIR="$2"
      export WISEEFF_UPGRADE_BACKUP_ROOT="$3"
      id() {
        case "$*" in
          '-u') printf '0\\n' ;;
          'deploy') return 0 ;;
          '-gn deploy') printf 'deploy\\n' ;;
          '-nG deploy') printf 'deploy\\n' ;;
          '-un') printf 'root\\n' ;;
          *) return 1 ;;
        esac
      }
      getent() { return 0; }
      usermod() { printf 'usermod:%s\\n' "$*"; }
      chown() { return 0; }
      find() { return 0; }
      realpath() { while [ "$#" -gt 1 ]; do shift; done; printf '%s\\n' "$1"; }
      wiseeff_operation_lock_clear_stale() { return 0; }
      wiseeff_operation_lock_acquire() { operation_lock_mode=test; return 0; }
      wiseeff_operation_lock_release() { return 0; }
      wiseeff_upgrade_run_prepare_host
    `, "test", operationRoot, journalRoot, backupRoot], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("usermod:-aG docker deploy");
    expect(result.stdout).toContain("WiseEff host preparation completed");
    expect(result.stdout).toContain(`journal_root: ${journalRoot}`);
  });

  it("reports a free host lock", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "wiseeff-lock-free-"));
    const result = runUpgrade(["lock-status"], { WISEEFF_OPERATION_LOCK_DIR: lockRoot });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("lock_state=free");
  });

  it("refuses to clear a live host lock and prints owner metadata", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "wiseeff-lock-live-"));
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/operation-lock.sh
      wiseeff_operation_lock_acquire "$1" held holder-test
      if wiseeff_operation_lock_clear_stale "$1"; then result=0; else result=$?; fi
      wiseeff_operation_lock_release
      exit "$result"
    `, "test", lockRoot], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain("Refusing to unlock a live WiseEff host operation");
    expect(result.stderr).toContain("operation=holder-test");
  });

  it("moves a proven-stale fallback lock aside", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "wiseeff-lock-stale-"));
    const lockDir = join(lockRoot, ".operation.lock.d");
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "pid"), "99999999\n");
    writeFileSync(join(lockDir, "owner"), "pid=99999999\nuser=deploy\noperation=old-upgrade\n");
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/operation-lock.sh
      command() {
        if [ "$1" = "-v" ] && [ "$2" = "flock" ]; then return 1; fi
        builtin command "$@"
      }
      wiseeff_operation_lock_clear_stale "$1"
    `, "test", lockRoot], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(existsSync(lockDir)).toBe(false);
    expect(readdirSync(lockRoot).some((entry) => entry.startsWith(".operation.lock.d.stale."))).toBe(true);
  });

  it("refuses to clear a recent pidless fallback lock during its acquisition race window", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "wiseeff-lock-initializing-"));
    mkdirSync(join(lockRoot, ".operation.lock.d"));
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/operation-lock.sh
      command() {
        if [ "$1" = "-v" ] && [ "$2" = "flock" ]; then return 1; fi
        builtin command "$@"
      }
      wiseeff_operation_lock_clear_stale "$1"
    `, "test", lockRoot], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(75);
    expect(result.stderr).toContain("retry after the stale-lock grace period");
  });

  it("automatically recovers a proven-stale fallback lock on acquire", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "wiseeff-lock-auto-recover-"));
    const lockDir = join(lockRoot, ".operation.lock.d");
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, "pid"), "99999999\n");
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/operation-lock.sh
      command() {
        if [ "$1" = "-v" ] && [ "$2" = "flock" ]; then return 1; fi
        builtin command "$@"
      }
      wiseeff_operation_lock_acquire "$1" held replacement-upgrade
      wiseeff_operation_lock_release
    `, "test", lockRoot], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Recovered a proven-stale WiseEff fallback host lock");
    expect(readdirSync(lockRoot).some((entry) => entry.startsWith(".operation.lock.d.stale."))).toBe(true);
  });

  it("rejects symlinked lock paths instead of following them", () => {
    const lockRoot = mkdtempSync(join(tmpdir(), "wiseeff-lock-symlink-"));
    const externalRoot = mkdtempSync(join(tmpdir(), "wiseeff-lock-external-"));
    symlinkSync(externalRoot, join(lockRoot, ".operation.lock.d"));
    const result = runUpgrade(["unlock"], { WISEEFF_OPERATION_LOCK_DIR: lockRoot });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("host lock paths must not be symlinks");
  });

  it("rejects unknown actions with the usage exit class", () => {
    const result = runUpgrade(["not-an-action"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown action");
  });

  it("requires explicit confirmation for non-interactive apply", () => {
    const result = runUpgrade(["apply", "--non-interactive"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--yes");
  });

  it("keeps status read-only when a requested run does not exist", () => {
    const result = runUpgrade(["status", "--run-id", "missing-run"], {
      WISEEFF_UPGRADE_STATE_DIR: "/tmp/wiseeff-upgrade-test-state-that-does-not-exist"
    });

    expect(result.status).toBe(10);
    expect(result.stderr).toContain("Run not found");
  });

  it("renders a persisted run as JSON without sourcing its fields", () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-status-"));
    const runDir = join(stateRoot, "run-1");
    mkdirSync(runDir);
    writeFileSync(join(runDir, "run_id"), "run-1\n");
    writeFileSync(join(runDir, "phase"), "completed\n");
    writeFileSync(join(runDir, "outcome"), "completed\n");
    writeFileSync(join(runDir, "previous_sha"), "abc123\n");
    writeFileSync(join(runDir, "target_sha"), "def456\n");
    writeFileSync(join(runDir, "backup_dir"), "/var/backups/wiseeff/upgrades/run-1\n");
    writeFileSync(join(runDir, "build_status"), "failed\n");
    writeFileSync(join(runDir, "diagnostics_dir"), `${runDir}/diagnostics\n`);
    writeFileSync(join(runDir, "build_log"), `${runDir}/diagnostics/build.log\n`);
    writeFileSync(join(runDir, "build_summary"), `${runDir}/diagnostics/summary.txt\n`);
    writeFileSync(join(runDir, "base_image_ref"), "node:22.21.1-alpine\n");
    writeFileSync(join(runDir, "base_image_id"), "sha256:eeee\n");
    writeFileSync(join(runDir, "base_image_config_id"), "sha256:cccc\n");
    writeFileSync(join(runDir, "base_image_platform"), "linux/amd64\n");
    writeFileSync(join(runDir, "base_image_source"), "bundled-archive\n");
    writeFileSync(join(runDir, "base_image_status"), "ready\n");
    writeFileSync(join(runDir, "build_proxy_status"), "configured\n");
    writeFileSync(join(runDir, "npm_registry_host"), "npm.example.com\n");
    writeFileSync(join(runDir, "corporate_ca_status"), "configured\n");
    writeFileSync(join(runDir, "build_tls_policy"), "insecure\n");
    writeFileSync(join(runDir, "build_transport_fingerprint"), `${"a".repeat(64)}\n`);
    writeFileSync(join(runDir, "completed_with_insecure_build_transport"), "true\n");
    writeFileSync(join(runDir, "runtime_proxy_status"), "false\n");
    writeFileSync(join(runDir, "failed_phase"), "old-stack-restore\n");
    writeFileSync(join(runDir, "failure_service"), "worker\n");
    writeFileSync(join(runDir, "failure_code"), "restore-worker-health\n");
    writeFileSync(join(runDir, "failure_summary"), "The restored worker liveness or Docker health probe failed.\n");
    writeFileSync(join(runDir, "recovery_started"), "true\n");
    writeFileSync(join(runDir, "recovery_verified"), "false\n");
    writeFileSync(join(runDir, "recovery_failure_summary"), "action=queue-pause code=97 summary=queue pause failed.\n");
    writeFileSync(join(runDir, "next_action"), "none\n");
    writeFileSync(join(runDir, "status"), "run_id=run-1\nphase=completed\noutcome=completed\n");

    const result = runUpgrade(["status", "--json", "--run-id", "run-1", "--state-dir", stateRoot]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      runId: "run-1",
      phase: "completed",
      outcome: "completed",
      buildStatus: "failed",
      diagnosticsDir: `${runDir}/diagnostics`,
      buildLog: `${runDir}/diagnostics/build.log`,
      buildSummary: `${runDir}/diagnostics/summary.txt`,
      baseImageRef: "node:22.21.1-alpine",
      baseImageId: "sha256:eeee",
      baseImageConfigId: "sha256:cccc",
      baseImagePlatform: "linux/amd64",
      baseImageSource: "bundled-archive",
      baseImageStatus: "ready",
      buildNetwork: {
        proxy: "configured",
        npmRegistry: "npm.example.com",
        corporateCa: "configured",
        buildTlsPolicy: "insecure",
        transportFingerprint: "a".repeat(64),
        runtimeProxy: false
      },
      completedWithInsecureBuildTransport: true,
      failedPhase: "old-stack-restore",
      failureService: "worker",
      failureCode: "restore-worker-health",
      failureSummary: "The restored worker liveness or Docker health probe failed.",
      recoveryStarted: "true",
      recoveryVerified: "false",
      recoveryFailureSummary: "action=queue-pause code=97 summary=queue pause failed."
    });
    expect(result.stdout).not.toContain("POSTGRES_PASSWORD");
  });

  it("records insecure build provenance from persisted run state during completion", () => {
    const runDir = mkdtempSync(join(tmpdir(), "wiseeff-upgrade-insecure-completion-"));
    writeFileSync(join(runDir, "build_tls_policy"), "insecure\n");
    writeFileSync(join(runDir, "phase"), "validating-public\n");

    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      unset WISEEFF_BUILD_TLS_POLICY
      wiseeff_upgrade_record_build_transport_completion
      cat "$WISEEFF_TEST_RUN_DIR/completed_with_insecure_build_transport"
      grep 'event=completed-with-insecure-build-transport' "$WISEEFF_TEST_RUN_DIR/events.log"
    `], {
      encoding: "utf8",
      env: { ...process.env, WISEEFF_TEST_RUN_DIR: runDir }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("true");
    expect(result.stdout).toContain("runtime-tls=unchanged");
  });

  it("lists the protected candidate recovery action in command help", () => {
    const result = runUpgrade(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("recover-candidate");
  });

  it.each(["resume", "recover-candidate", "rollback"])('requires --run-id for %s', (action) => {
    const result = runUpgrade([action]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("requires --run-id");
  });

  it("keeps destructive volume and reset operations outside the upgrade module", () => {
    const implementation = readFileSync("ops/self-hosted/scripts/upgrade-lib.sh", "utf8");

    expect(implementation).not.toMatch(/down\s+-v|volume\s+rm|system\s+prune|git\s+(reset|clean)/);
    expect(implementation).not.toMatch(/db:seed|selfhost:.*provision|setup\.sh\s+--force/);
    expect(readFileSync("ops/self-hosted/upgrade-protocol.env", "utf8")).toContain("WISEEFF_UPGRADE_PROTOCOL_VERSION=1");
    expect(statSync("ops/self-hosted/scripts/upgrade.sh").mode & 0o111).not.toBe(0);
  });
});
