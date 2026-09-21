import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "ops/self-hosted/scripts/seed-rebuild.sh";

function executable(path: string, contents: string) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-rebuild-"));
  const repo = join(directory, "repo");
  const composeDir = join(directory, "compose");
  const state = join(directory, "state");
  const backup = join(directory, "backup");
  const envFile = join(composeDir, ".env");
  const compose = join(directory, "compose-mock");
  const docker = join(directory, "docker-mock");
  const invocation = join(directory, "compose-invocation");

  mkdirSync(composeDir);
  spawnSync("git", ["init", "-q", repo]);
  spawnSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  spawnSync("git", ["-C", repo, "config", "user.name", "Test"]);
  writeFileSync(join(repo, "README"), "test\n");
  spawnSync("git", ["-C", repo, "add", "README"]);
  spawnSync("git", ["-C", repo, "commit", "-qm", "fixture"]);
  const sha = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();

  writeFileSync(
    envFile,
    [
      "DATABASE_URL=postgres://wiseeff:secret@example.invalid/wiseeff",
      "WISEEFF_CATALOG_BOOTSTRAP_DATABASE_URL=postgres://bootstrap:secret@example.invalid/wiseeff",
      "POSTGRES_PASSWORD=secret",
      "OBJECT_STORE_MODE=s3",
      "OBJECT_STORAGE_ENDPOINT=http://minio:9000",
      "OBJECT_STORAGE_BUCKET=wiseeff",
      "OBJECT_STORAGE_ACCESS_KEY_ID=access",
      "OBJECT_STORAGE_SECRET_ACCESS_KEY=secret",
      "LOG_ANALYSIS_QUEUE_MODE=polling",
      "NOTIFICATION_QUEUE_MODE=polling",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  executable(
    compose,
    [
      "#!/bin/sh",
      "printf '%s\\n' \\\"$*\\\" >> '" + invocation + "'",
      "case \"$*\" in *'ps -aq api'*) printf '%s\\n' fixture-api; exit 0 ;; esac",
      "mount=''",
      "previous=''",
      "for argument in \"$@\"; do",
      "  if [ \"$previous\" = -v ]; then mount=\"$argument\"; fi",
      "  previous=\"$argument\"",
      "done",
      "run_dir=$(printf '%s' \"$mount\" | sed 's#:/run/wiseeff-seed-rebuild:rw$##')",
      "cat > \"$run_dir/core-state.json\" <<EOF",
      "{\"plan\":{\"digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"candidateSha\":\"" + sha + "\",\"organizationId\":\"org-test\",\"actorUserId\":\"operator@example.invalid\",\"seedDigest\":\"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"scope\":\"atlas-aurora-nebula\"}}",
      "EOF",
      "chmod 600 \"$run_dir/core-state.json\"",
      "printf '%s\\n' 'diagnostic postgres://user:secret@example.invalid/db?password=secret'",
    ].join("\n") + "\n",
  );
  executable(docker, ["#!/bin/sh", "if [ \"$1\" = info ]; then printf '%s\\n' /var/lib/docker; exit 0; fi",
    `if [ "$1" = inspect ]; then printf '%s\\n' wiseeff-app:${sha}; fi`, "exit 0", ""].join("\n"));
  return { directory, repo, composeDir, state, backup, envFile, compose, docker, invocation };
}

describe("self-hosted seed rebuild boundary", () => {
  it("captures preservation only after verified isolation and backup, including backup retry", () => {
    for (const action of ["seed_begin", "seed_resume_maintenance"]) {
      for (const capture of ["recorded", "failed", "empty", "data-failed", "identity-failed"]) {
        const captures = capture === "recorded";
        const planDigest = `sha256:${"b".repeat(64)}`;
        const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-baseline-"));
        const state = join(directory, "state");
        const events = join(directory, "events");
        mkdirSync(state);
        const output = join(directory, "output");
        writeFileSync(output, captures ? JSON.stringify({ ok: true, status: "maintenance-baseline-recorded",
          digest: `sha256:${"a".repeat(64)}` }) : "");
        const result = spawnSync("bash", ["-c", [
          `source '${process.cwd()}/${script}'`, `seed_run_dir='${state}'`,
          `seed_backup_root='${directory}/backups'`, `seed_backup_dir='${directory}/backups/run1'`,
          `lock_root='${directory}/lock'`, "seed_run_id=run1", "seed_actor=actor", "seed_org=org",
          `seed_plan_digest=${planDigest}`, `seed_confirm_plan=${planDigest}`, "seed_digest=seed",
          "seed_state_write phase recovery-required", `seed_state_write plan_digest ${planDigest}`,
          `seed_state_write confirmed_plan_digest ${planDigest}`,
          `seed_state_write core_last_output '${output}'`,
          "seed_state_write candidate_sha sha", "seed_state_write seed_backup_verified false",
          "seed_state_write queue_paused_verified true", "seed_state_write queue_drained true",
          "seed_state_write service_publication-manager_present true", "seed_state_write writers_stopped true",
          ...["seed_setup_paths", "seed_prepare_run", "seed_load_run", "seed_validate_runtime",
            "seed_require_clean_checkout", "wiseeff_operation_lock_acquire", "wiseeff_operation_lock_release",
            "seed_require_core_plan", "seed_capture_runtime", "seed_require_initial_running",
            "seed_require_pinned_images", "seed_require_backup_database", "wiseeff_upgrade_probe_api",
            "seed_capture_publication", "seed_queue_capture_initial", "wiseeff_upgrade_publication_freeze",
            "wiseeff_upgrade_compose", "seed_queue_drain", "seed_verify_service_stopped",
            "seed_verify_backup_path", "seed_write_backup_marker", "wiseeff_upgrade_wait_data_plane_ready",
            "seed_verify_identity", "seed_core_is_unmutated_plan", "seed_queue_verify_paused",
            "wiseeff_upgrade_state_write", "seed_write_json"].map(name => `${name}() { :; }`),
          "seed_current_sha() { printf sha; }", "seed_current_env_fingerprint() { printf fingerprint; }",
          "seed_publication_status() { printf true; }", "wiseeff_upgrade_fingerprint() { printf fingerprint; }",
          `wiseeff_upgrade_snapshot_all() { printf 'backup\\n' >> '${events}'; }`,
          `wiseeff_upgrade_verify_backup_manifest() { printf 'backup-verified\\n' >> '${events}'; }`,
          `wiseeff_upgrade_wait_data_plane_ready() { [ "$(seed_state_read seed_backup_verified)" != true ] || [ '${capture}' != data-failed ]; }`,
          `seed_verify_identity() { [ "$(seed_state_read seed_backup_verified)" != true ] || [ '${capture}' != identity-failed ]; }`,
          `seed_verify_maintenance() { [ "$(seed_state_read seed_backup_verified)" = true ] && [ "$(seed_state_read writers_stopped)" = true ] && printf 'isolated\\n' >> '${events}'; }`,
          `seed_core_command() { [ "$1" = maintenance-baseline ] && [ "$seed_candidate_sha" = sha ] && [ "$seed_plan_digest" = ${planDigest} ] || return 80; printf 'baseline\\n' >> '${events}'; return ${capture === "failed" ? 1 : 0}; }`,
          `${action} || exit $?`,
        ].join("\n")], { encoding: "utf8" });
        expect(result.status, result.stderr).toBe(captures ? 0 : 70);
        expect(readFileSync(events, "utf8").trim().split("\n"))
          .toEqual(["backup", "backup-verified", ...(["data-failed", "identity-failed"].includes(capture) ? [] : ["isolated", "baseline"])]);
        expect(readFileSync(join(state, "phase"), "utf8").trim())
          .toBe(captures ? "maintenance-begun" : "recovery-required");
        if (!captures) expect(readFileSync(join(state, "next_action"), "utf8"))
          .toContain("recover --run-id run1 --confirm restore-run1");
      }
    }
  });

  it("finishes only after verified core output and re-isolates a failed restoration", () => {
    for (const [verified, restored] of [[true, true], [false, true], [true, false]]) {
      const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-finish-"));
      writeFileSync(join(directory, "output"), JSON.stringify({ ok: true, status: "verified", backendVerified: verified }));
      const result = spawnSync("bash", ["-c", [
        `source '${process.cwd()}/${script}'`, `seed_run_dir='${directory}'`,
        "seed_run_id=run1", "seed_confirm_plan=plan", `lock_root='${directory}/lock'`,
        "seed_state_write plan_digest plan", "seed_state_write seed_backup_verified true",
        `seed_state_write core_last_output '${directory}/output'`,
        ...["seed_load_run", "seed_bind_confirmed_plan", "seed_validate_runtime", "seed_require_clean_checkout",
          "wiseeff_operation_lock_acquire", "wiseeff_operation_lock_release", "seed_verify_identity",
          "seed_verify_maintenance", "seed_check_core_identity", "seed_core_command", "seed_write_json"]
          .map((name) => `${name}() { :; }`),
        `seed_restore_initial_state() { touch '${directory}/restore'; return ${restored ? 0 : 1}; }`,
        `seed_reisolate_after_restore_failure() { touch '${directory}/isolated'; }`,
        "seed_finish || exit $?",
      ].join("\n")], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(verified && restored ? 0 : 70);
      expect(existsSync(join(directory, "restore"))).toBe(verified);
      expect(existsSync(join(directory, "isolated"))).toBe(verified && !restored);
      expect(readFileSync(join(directory, "phase"), "utf8").trim()).toBe(verified && restored ? "completed" : "recovery-required");
    }
  });

  it("reports the restored queue state after reopening the original services", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-restored-status-"));
    const result = spawnSync("bash", ["-c", [
      `source '${process.cwd()}/${script}'`, `seed_run_dir='${directory}'`,
      "seed_state_write queue_initial_paused false", "seed_state_write queue_paused true",
      "seed_state_write publication_initial_frozen false",
      ...["seed_write_json", "wiseeff_upgrade_compose", "wiseeff_upgrade_wait_data_plane_ready",
        "seed_start_original_services", "seed_wait_original_app_health", "seed_restore_queue_state",
        "seed_restore_proxy_state", "seed_restore_publication_state", "seed_verify_identity",
        "seed_verify_original_state"].map((name) => `${name}() { :; }`),
      "seed_restore_initial_state", "seed_state_read queue_paused",
    ].join("\n")], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("false");
  });

  it("waits for restored Docker health and refuses a service that never becomes healthy", () => {
    for (const recovers of [true, false]) {
      const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-restored-health-"));
      const result = spawnSync("bash", ["-c", [
        `source '${process.cwd()}/${script}'`, `seed_run_dir='${directory}'`,
        "seed_state_write service_proxy_present true", "seed_state_write container_proxy fixture-proxy",
        "seed_state_write service_proxy_status running", "seed_state_write service_proxy_health healthy",
        "WISEEFF_UPGRADE_HEALTH_ATTEMPTS=3", "WISEEFF_UPGRADE_HEALTH_INTERVAL_SECONDS=0",
        "wiseeff_upgrade_compose() { printf '%s\\n' fixture-proxy; }",
        `wiseeff_upgrade_docker() { case "$*" in *State.Status*) echo running ;; *State.Health*) if ${recovers ? "true" : "false"} && [ -f '${directory}/probed' ]; then echo healthy; else touch '${directory}/probed'; echo starting; fi ;; esac; }`,
        "wiseeff_upgrade_record_failure() { :; }", "seed_restore_queue_state() { :; }",
        "seed_restore_publication_state() { :; }", "seed_verify_original_state || exit $?",
      ].join("\n")], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(recovers ? 0 : 70);
    }
  });

  it("pins helper image/env and starts existing containers without recreation", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-compose-pin-"));
    const compose = join(directory, "compose");
    executable(compose, '#!/bin/sh\nprintf "%s|%s|%s\\n" "$WISEEFF_APP_IMAGE:$WISEEFF_APP_TAG" "$WISEEFF_ENV_FILE" "$*"\n');
    const result = spawnSync("bash", ["-c", [
      `source '${process.cwd()}/${script}'`, `seed_compose='${compose}'`,
      "seed_api_image_ref=owned-app:reviewed", "upgrade_env_file=/private/owned.env",
      "wiseeff_upgrade_compose up -d --no-build postgres redis minio",
    ].join("\n")], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('owned-app:reviewed|/private/owned.env|--env-file /private/owned.env up --no-recreate -d --no-build postgres redis minio');
  });

  it("refuses another run's backup directory and a symlinked recovery point", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-seed-backup-scope-"));
    mkdirSync(join(root, "run1"));
    mkdirSync(join(root, "other-run"));
    symlinkSync(join(root, "other-run"), join(root, "run1-retry-1-123"));
    for (const [name, expected] of [["run1", 0], ["other-run", 1], ["run1-retry-1-123", 1]] as const) {
      const result = spawnSync("bash", ["-c", [
        `source '${process.cwd()}/${script}'`, `seed_backup_root='${root}'`,
        `seed_backup_dir='${join(root, name)}'`, "seed_run_id=run1", "seed_verify_backup_path || exit $?",
      ].join("\n")], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(expected);
    }
  });

  it("binds the backup database to the planned name, OID and actual Compose address", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-db-proof-"));
    writeFileSync(join(directory, "container_postgres"), "owned-postgres\n");
    const database = { name: "wiseeff", oid: "12345", serverAddress: "172.26.0.5/32", serverPort: 5432 };
    const shell = [
      `source '${process.cwd()}/${script}'`, `seed_run_dir='${directory}'`,
      "wiseeff_upgrade_compose() { printf '12345\\n'; }",
      "wiseeff_upgrade_docker() { printf '172.26.0.5 invalid IP \\n'; }",
      "seed_require_backup_database || exit $?",
    ].join("\n");
    for (const [value, expected] of [
      [database, 0], [{ ...database, name: "another" }, 70],
      [{ ...database, oid: "other" }, 70], [{ ...database, serverAddress: "172.26.0.6/32" }, 70],
    ] as const) {
      writeFileSync(join(directory, "core-state.json"), JSON.stringify({ plan: { database: value } }));
      const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(expected);
    }
  });

  it("refuses stores outside the Compose recovery boundary", () => {
    const f = fixture();
    const shell = [
      `source '${process.cwd()}/${script}'`, `env_file='${f.envFile}'`, `upgrade_env_file='${f.envFile}'`,
      "wiseeff_upgrade_validate_env() { :; }", "wiseeff_upgrade_validate_backup_root() { :; }",
      `seed_compose='${f.compose}'`, "seed_validate_runtime || exit $?",
    ].join("\n");
    const original = readFileSync(f.envFile, "utf8");
    for (const [settings, expected] of [
      [original, 0], [original.replace("http://minio:9000", "https://external.invalid"), 10],
      [original.replaceAll("QUEUE_MODE=polling", "QUEUE_MODE=durable") + "REDIS_URL=redis://external.invalid:6379\n", 10],
    ] as const) {
      writeFileSync(f.envFile, settings);
      const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(expected);
    }
  });

  it("runs the read-only plan through a mocked one-off and sanitizes diagnostics", () => {
    const f = fixture();
    const result = spawnSync(
      "bash",
      [script, "plan", "--run-id", "run1", "--actor", "operator@example.invalid", "--organization-id", "org-test"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          WISEEFF_SEED_REBUILD_REPO_ROOT: f.repo,
          WISEEFF_SEED_REBUILD_COMPOSE_DIR: f.composeDir,
          WISEEFF_SEED_REBUILD_COMPOSE: f.compose,
          WISEEFF_SEED_REBUILD_DOCKER: f.docker,
          WISEEFF_SEED_REBUILD_ENV_FILE: f.envFile,
          WISEEFF_SEED_REBUILD_STATE_DIR: f.state,
          WISEEFF_SEED_REBUILD_BACKUP_ROOT: f.backup,
          WISEEFF_SEED_REBUILD_LOCK_DIR: join(f.directory, "locks"),
        },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Seed rebuild plan recorded. run_id=run1");
    expect(result.stdout).not.toContain("secret");
    const runDir = join(f.state, "run1");
    expect(existsSync(join(runDir, "core-state.json"))).toBe(true);
    expect(readFileSync(join(runDir, "core-output"), "utf8")).not.toContain("secret");
    const invocation = readFileSync(f.invocation, "utf8");
    expect(invocation).toContain("--run-id\nrun1");
    expect(invocation).not.toContain("--scope");
    expect(invocation).toContain("--user");
    expect(invocation).toContain("./node_modules/.bin/tsx");
  });

  it("rejects arbitrary core arguments and malformed digests before Docker", () => {
    const help = spawnSync("bash", [script, "command", "--run-id", "run1", "--core-command", "rebuild", "--evil"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(help.status).not.toBe(0);
    expect(help.stderr).toContain("Unknown option: --evil");

    const digest = spawnSync("bash", [script, "begin", "--run-id", "run1", "--confirm-plan", "sha256:not-a-digest"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(digest.status).not.toBe(0);
    expect(digest.stderr).toContain("Expected a sha256:<64 lowercase hexadecimal> digest");
  });

  it("starts the manager only for the controlled publication window and refreezes after stopping it", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-publish-"));
    const state = join(directory, "state");
    const log = join(directory, "events");
    mkdirSync(state);
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "lock_root='" + directory + "/lock'",
      "seed_backup_dir='" + directory + "/backup'",
      "seed_stage=vendor",
      "seed_publish_actor=reviewer@example.invalid",
      "seed_confirm_artifact=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "seed_confirm_plan=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "seed_state_write confirmed_plan_digest \"$seed_confirm_plan\"",
      "seed_state_write plan_digest \"$seed_confirm_plan\"",
      "seed_state_write recovery_point_verified true",
      "seed_state_write phase maintenance-begun",
      "seed_state_write checkout_sha abc",
      "seed_state_write candidate_sha abc",
      "seed_state_write seed_digest sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "seed_state_write actor_user_id operator",
      "seed_state_write organization_id org",
      "seed_state_write scope atlas-aurora-nebula",
      "seed_state_write service_publication-manager_present true",
      "seed_state_write service_publication-manager_status running",
      "seed_load_run() { :; }",
      "seed_validate_runtime() { :; }",
      "seed_require_clean_checkout() { :; }",
      "wiseeff_operation_lock_acquire() { :; }",
      "wiseeff_operation_lock_release() { :; }",
      "seed_verify_identity() { :; }",
      "seed_verify_maintenance() { :; }",
      "seed_check_core_identity() { :; }",
      "seed_verify_service_stopped() { :; }",
      "seed_write_json() { :; }",
      "seed_publication_status() { if [ \"${seed_publication_unfrozen:-false}\" = true ]; then printf '%s\\n' false; else printf '%s\\n' true; fi; }",
      "wiseeff_upgrade_publication_freeze() { printf 'freeze:%s\\n' \"$1\" >> '" + log + "'; if [ \"$1\" = true ]; then seed_publication_unfrozen=false; else seed_publication_unfrozen=true; fi; }",
      "wiseeff_upgrade_compose() { printf 'compose:%s\\n' \"$*\" >> '" + log + "'; }",
      "seed_core_command() { printf 'core:%s\\n' \"$1\" >> '" + log + "'; }",
      "seed_poll_catalog_success() { printf 'poll\\n' >> '" + log + "'; }",
      "seed_catalog_publish",
    ].join("\n");
   const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
   expect(result.status).toBe(0);
    const events = readFileSync(log, "utf8").trim().split("\n");
    expect(events).toEqual([
      "freeze:false",
      "core:catalog-publish",
      "compose:up -d --no-build --no-deps publication-manager",
      "poll",
      "compose:stop -t 60 publication-manager",
      "freeze:true",
    ]);
  });

  it("fails before any quiescence command when the immutable core plan is not valid", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-begin-"));
    const state = join(directory, "state");
    const log = join(directory, "events");
    mkdirSync(state);
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "seed_backup_dir='" + directory + "/backup'",
      "repo_root='" + directory + "'",
      "env_file='" + directory + "/env'",
      "lock_root='" + directory + "/lock'",
      "seed_actor=operator",
      "seed_org=org",
      "seed_plan_digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "seed_confirm_plan=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "seed_digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "seed_setup_paths() { :; }",
      "seed_prepare_run() { :; }",
      "seed_validate_runtime() { :; }",
      "seed_require_clean_checkout() { :; }",
      "wiseeff_operation_lock_acquire() { :; }",
      "wiseeff_operation_lock_release() { :; }",
      "seed_write_json() { :; }",
      "seed_require_core_plan() { printf 'plan\\n' >> '" + log + "'; return 70; }",
      "seed_capture_runtime() { printf 'capture\\n' >> '" + log + "'; }",
      "set +e",
      "seed_begin",
    ].join("\n");
   const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
   expect(result.status).toBe(70);
    expect(readFileSync(log, "utf8")).toBe("plan\n");
  });

  it("re-isolates writers and queues when restoration fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-reisolate-"));
    const state = join(directory, "state");
    const log = join(directory, "events");
    mkdirSync(state);
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "seed_state_write queue_mode durable",
      "seed_state_write service_api_present true",
      "seed_state_write service_worker_present true",
      "seed_state_write service_web_present true",
      "seed_state_write service_publication-manager_present true",
      "seed_validate_runtime() { :; }",
      "wiseeff_upgrade_compose() { printf 'compose:%s\\n' \"$*\" >> '" + log + "'; }",
      "seed_queue_command() { printf 'queue:%s\\n' \"$1\" >> '" + log + "'; }",
      "seed_queue_verify_paused() { return 0; }",
      "seed_queue_drain() { printf 'queue:drain\\n' >> '" + log + "'; }",
      "seed_verify_service_stopped() { :; }",
      "wiseeff_upgrade_publication_freeze() { printf 'freeze:%s\\n' \"$1\" >> '" + log + "'; }",
      "seed_publication_status() { printf '%s\\n' true; }",
      "seed_write_json() { :; }",
      "seed_reisolate_after_restore_failure",
    ].join("\n");
    const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const events = readFileSync(log, "utf8");
    expect(events).toContain("compose:stop -t 60 proxy");
    expect(events).toContain("queue:pause");
    expect(events).toContain("queue:drain");
    expect(events).toContain("compose:stop -t 60 api");
    expect(events).toContain("compose:stop -t 60 worker");
    expect(events).toContain("compose:stop -t 60 web");
    expect(events).toContain("compose:stop -t 60 publication-manager");
    expect(events).toContain("freeze:true");
  });

  it("does not treat the upgrade helper's early flag as a verified wrapper backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-backup-flag-"));
    const state = join(directory, "state");
    const backup = join(directory, "backup");
    mkdirSync(state);
    mkdirSync(backup);
    writeFileSync(join(backup, "manifest.sha256"), "manifest\n", { mode: 0o600 });
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "seed_backup_dir='" + backup + "'",
      "seed_state_write recovery_point_verified true",
      "seed_state_write seed_backup_verified false",
      "seed_set_next_action_for_recovery",
      "printf '%s|%s|%s\\n' \"$(seed_state_read recovery_point_verified)\" \"$(seed_state_read seed_backup_verified)\" \"$(seed_state_read next_action)\"",
    ].join("\n");
    const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("true|false|resume-maintenance --run-id run1 or abort --run-id run1");
  });

  it("rejects a changed recovery manifest even when its replacement is otherwise present", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-stale-manifest-"));
    const state = join(directory, "state");
    const backup = join(directory, "run1");
    const manifest = join(backup, "manifest.sha256");
    mkdirSync(state);
    mkdirSync(backup);
    writeFileSync(manifest, "original\n", { mode: 0o600 });
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "seed_backup_dir='" + backup + "'",
      "seed_backup_root='" + directory + "'",
      "seed_state_write recovery_manifest_digest \"sha256:$(wiseeff_upgrade_fingerprint '" + manifest + "')\"",
      "printf '%s\\n' replacement > '" + manifest + "'",
      "set +e",
      "seed_verify_manifest_identity",
      "code=$?",
      "set -e",
      "printf '%s\\n' \"$code\"",
    ].join("\n");
    const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("70");
  });

  it("attempts refreeze even when stopping the temporary manager fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-refreeze-"));
    const state = join(directory, "state");
    const log = join(directory, "events");
    mkdirSync(state);
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "seed_publication_manager_started=true",
      "seed_publication_unfrozen=true",
      "seed_state_write seed_backup_verified false",
      "seed_publication_status() { printf '%s\\n' true; }",
      "wiseeff_upgrade_compose() { printf 'compose:%s\\n' \"$*\" >> '" + log + "'; return 1; }",
      "wiseeff_upgrade_publication_freeze() { printf 'freeze:%s\\n' \"$1\" >> '" + log + "'; }",
      "set +e",
      "seed_publication_refreeze",
      "code=$?",
      "set -e",
      "printf '%s|%s\\n' \"$code\" \"${seed_publication_unfrozen:-false}\"",
    ].join("\n");
    const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("70|false");
    expect(readFileSync(log, "utf8")).toContain("freeze:true\n");
  });

  it("retries interrupted whole-state recovery from restoring-state", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-recover-retry-"));
    const state = join(directory, "state");
    const log = join(directory, "events");
    mkdirSync(state);
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "lock_root='" + directory + "/lock'",
      "seed_confirm=restore-run1",
      "seed_state_write phase restoring-state",
      "seed_state_write seed_backup_verified true",
      "seed_load_run() { :; }",
      "seed_validate_runtime() { :; }",
      "seed_require_clean_checkout() { :; }",
      "wiseeff_operation_lock_acquire() { :; }",
      "wiseeff_operation_lock_release() { :; }",
      "seed_verify_identity() { :; }",
      "seed_recover_whole_state() { printf 'retry\\n' >> '" + log + "'; }",
      "seed_write_json() { :; }",
      "seed_recover",
    ].join("\n");
    const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(readFileSync(log, "utf8")).toBe("retry\n");
    expect(readFileSync(join(state, "phase"), "utf8").trim()).toBe("recovered");
  });

  it("refuses abort after the core journal records a mutation", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-abort-guard-"));
    const state = join(directory, "state");
    const log = join(directory, "events");
    mkdirSync(state);
    writeFileSync(join(state, "core-state.json"), '{"phase":"planned","publications":{"vendor":true}}\n', { mode: 0o600 });
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "seed_state_write phase recovery-required",
      "seed_state_write seed_backup_verified false",
      "seed_load_run() { :; }",
      "seed_validate_runtime() { :; }",
      "seed_require_clean_checkout() { :; }",
      "wiseeff_upgrade_compose() { printf 'compose\\n' >> '" + log + "'; }",
      "set +e",
      "seed_abort",
      "code=$?",
      "set -e",
      "printf '%s\\n' \"$code\"",
    ].join("\n");
    const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("70");
    expect(existsSync(log)).toBe(false);
  });

  it("uses a fresh recovery directory when an unverified backup is retried", () => {
    const directory = mkdtempSync(join(tmpdir(), "wiseeff-seed-backup-retry-"));
    const state = join(directory, "state");
    const backupRoot = join(directory, "backups");
    const oldBackup = join(backupRoot, "run1");
    const log = join(directory, "events");
    mkdirSync(state);
    writeFileSync(join(state, "core-state.json"), JSON.stringify({ plan: { digest: "plan", candidateSha: "sha" } }));
    mkdirSync(oldBackup, { recursive: true });
    writeFileSync(join(oldBackup, "partial"), "keep\n");
    const shell = [
      "source '" + process.cwd() + "/" + script + "'",
      "seed_run_id=run1",
      "seed_run_dir='" + state + "'",
      "lock_root='" + directory + "/lock'",
      "seed_backup_dir='" + oldBackup + "'",
      "seed_backup_root='" + backupRoot + "'",
      "seed_state_write phase recovery-required",
      "seed_state_write seed_backup_verified false",
      "seed_state_write queue_paused_verified true",
      "seed_state_write queue_drained true",
      "seed_state_write queue_mode durable",
      "seed_state_write service_publication-manager_present true",
      "seed_load_run() { :; }",
      "seed_validate_runtime() { :; }",
      "seed_require_clean_checkout() { :; }",
      "seed_core_is_unmutated_plan() { :; }",
      "seed_verify_identity() { :; }",
      "seed_verify_service_stopped() { :; }",
      "seed_queue_verify_paused() { :; }",
      "seed_queue_drain() { printf 'queue-drain\\n' >> '" + log + "'; seed_state_write queue_drained true; }",
      "seed_publication_status() { printf '%s\\n' true; }",
      "wiseeff_operation_lock_acquire() { :; }",
      "wiseeff_operation_lock_release() { :; }",
      "wiseeff_upgrade_compose() { printf 'compose:%s\\n' \"$*\" >> '" + log + "'; }",
      "wiseeff_upgrade_wait_data_plane_ready() { :; }",
      "wiseeff_upgrade_snapshot_all() { printf 'snapshot:%s\\n' \"$upgrade_backup_dir\" >> '" + log + "'; return 1; }",
      "wiseeff_upgrade_verify_backup_manifest() { return 1; }",
      "wiseeff_upgrade_state_write() { :; }",
      "seed_write_json() { :; }",
      "set +e",
      "seed_resume_maintenance",
      "code=$?",
      "set -e",
      "printf '%s|%s\\n' \"$code\" \"$(seed_state_read backup_dir)\"",
    ].join("\n");
    const result = spawnSync("bash", ["-c", shell], { encoding: "utf8" });
    expect(result.status).toBe(0);
    const [code, retriedDir] = result.stdout.trim().split("|");
    expect(code).toBe("70");
    expect(retriedDir).toContain("run1-retry-");
    expect(retriedDir).not.toBe(oldBackup);
    expect(existsSync(join(oldBackup, "partial"))).toBe(true);
    const events = readFileSync(log, "utf8");
    expect(events).toContain("compose:up -d --no-build postgres redis minio minio-init");
    expect(events).toContain(`snapshot:${retriedDir}`);
  });
});
