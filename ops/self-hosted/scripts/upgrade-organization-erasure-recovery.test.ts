import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function rollback(options: { failure?: string; actor?: string; captured?: boolean; missingCapture?: boolean;
  restoreData?: boolean; migrationStarted?: boolean; emptyCapture?: boolean; publicationStops?: boolean;
  action?: "resume" | "recover-candidate" | "old-stack" | "verify-restored" } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "wiseeff-erasure-restore-"));
  for (const [key, value] of Object.entries({ migration_started: String(options.migrationStarted ?? true), outcome: "recovery-required",
    phase: "recovery-required", previous_image_tag_api: "wiseeff-app:previous" })) {
    writeFileSync(join(directory, key), value);
  }
  if (options.captured) {
    writeFileSync(join(directory, "organization_erasure_capture_verified"), "true");
    writeFileSync(join(directory, "organization_erasure_restore_started"), "true");
    if (!options.missingCapture) writeFileSync(join(directory, "organization-erasures.json"), options.emptyCapture ? "" : "latest-deletions\n");
  }
  try {
    const result = spawnSync("bash", ["-c", `
      source "$WISEEFF_TEST_UPGRADE_LIB"
      upgrade_run_dir="$WISEEFF_TEST_RUN_DIR"
      upgrade_run_id=erasure-restore
      upgrade_previous_sha=previous-sha
      upgrade_candidate_image_tag=wiseeff-app:new-with-erasure-cli
      upgrade_restore_data="$WISEEFF_TEST_RESTORE_DATA"
      upgrade_confirm=restore-erasure-restore
      upgrade_json=false
      trace() { printf '%s\\n' "$*" >> "$upgrade_run_dir/trace"; }
      wiseeff_upgrade_reject_root_runtime() { return 0; }
      wiseeff_upgrade_load_run() { :; }
      wiseeff_upgrade_acquire_lock() { :; }
      wiseeff_upgrade_release_lock() { :; }
      wiseeff_upgrade_validate_env() { return 0; }
      wiseeff_upgrade_compose() { trace "compose $*"; return 0; }
      wiseeff_upgrade_compose_for_image() {
        trace "image $*"
        case "$*" in
          *'scripts/organization-erasure-recovery.ts capture '*)
            [ "$WISEEFF_TEST_FAILURE" != capture ] || return 91
            printf 'latest-deletions\\n' > "$upgrade_run_dir/organization-erasures.json" ;;
          *'scripts/organization-erasure-recovery.ts replay '*)
            [ "$WISEEFF_TEST_FAILURE" != replay ] || return 92 ;;
        esac
        return 0
      }
      wiseeff_upgrade_queue_command_for_image() { trace "queue-$1"; return 0; }
      wiseeff_upgrade_isolate_publication() {
        trace publication-stopped
        wiseeff_upgrade_state_write publication_manager_isolated "$WISEEFF_TEST_PUBLICATION_STOPS"
      }
      wiseeff_upgrade_git() { trace checkout; }
      wiseeff_upgrade_previous_data_plane_up() { trace data-plane; }
      wiseeff_upgrade_wait_data_plane_ready() { return 0; }
      wiseeff_upgrade_verify_backup_manifest() { return 0; }
      wiseeff_upgrade_restore_postgres() { trace postgres-restored; }
      wiseeff_upgrade_restore_objects() { trace objects-restored; }
      wiseeff_upgrade_restore_redis() { trace redis-restored; }
      wiseeff_upgrade_snapshot_manifest() { return 0; }
      wiseeff_upgrade_recreate_previous_app_services() { trace apps-started; }
      wiseeff_upgrade_probe_api() { return 0; }
      wiseeff_upgrade_probe_worker() { return 0; }
      wiseeff_upgrade_probe_web() { return 0; }
      wiseeff_upgrade_verify_previous_app_images() { return 0; }
      wiseeff_upgrade_wait_public_probe() { trace public-open; }
      case "$WISEEFF_TEST_ACTION" in
        resume) wiseeff_upgrade_run_resume ;;
        recover-candidate) wiseeff_upgrade_run_recover_candidate ;;
        old-stack) wiseeff_upgrade_restore_old_stack_after_stop ;;
        verify-restored) wiseeff_upgrade_verify_restored_stack ;;
        *) wiseeff_upgrade_run_rollback ;;
      esac
    `], { encoding: "utf8", env: { ...process.env,
      WISEEFF_TEST_UPGRADE_LIB: resolve("ops/self-hosted/scripts/upgrade-lib.sh"),
      WISEEFF_TEST_RUN_DIR: directory, WISEEFF_TEST_FAILURE: options.failure ?? "",
      WISEEFF_TEST_RESTORE_DATA: String(options.restoreData ?? true),
      WISEEFF_TEST_PUBLICATION_STOPS: String(options.publicationStops ?? true),
      WISEEFF_TEST_ACTION: options.action ?? "rollback",
      WISEEFF_ORGANIZATION_ERASURE_REPLAY_ACTOR_ID: options.actor ?? "surviving-platform-user" } });
    const read = (name: string) => {
      try { return readFileSync(join(directory, name), "utf8").trim(); } catch { return ""; }
    };
    return { result, trace: read("trace"), capture: read("organization-erasures.json"),
      outcome: read("outcome"), failure: read("failure_code"), replayed: read("organization_erasure_replay_verified") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("rollback organization deletion replay", () => {
  it("preserves latest deletion state before replacing stores and replays before starting producers or access", () => {
    const output = rollback();
    expect(output.result.status, output.result.stderr).toBe(0);
    const events = output.trace.split("\n");
    const capture = events.findIndex(event => event.includes(".ts capture "));
    const replay = events.findIndex(event => event.includes(".ts replay "));
    expect(capture).toBeGreaterThan(events.indexOf("publication-stopped"));
    expect(capture).toBeLessThan(events.indexOf("checkout"));
    expect(capture).toBeLessThan(events.indexOf("postgres-restored"));
    expect(replay).toBeGreaterThan(events.indexOf("redis-restored"));
    expect(events.slice(events.indexOf("redis-restored") + 1, replay)).toContain("queue-pause");
    expect(replay).toBeLessThan(events.indexOf("apps-started"));
    expect(replay).toBeLessThan(events.indexOf("queue-resume"));
    expect(output.trace).toContain("wiseeff-app:new-with-erasure-cli run --rm --no-deps");
    expect(output.trace).toContain("--actor surviving-platform-user");
    expect(output.replayed).toBe("true");
    expect(output.outcome).toBe("rolled-back");
  });

  it("refuses a restart-only rollback after replacement began without completed deletion replay", () => {
    const output = rollback({ captured: true, migrationStarted: false, restoreData: false });
    expect(output.result.status, output.result.stderr).toBe(70);
    expect(output.trace).not.toContain("apps-started");
    expect(output.trace).not.toContain("queue-resume");
    expect(output.trace).not.toContain("public-open");
  });

  it.each(["resume", "recover-candidate", "old-stack", "verify-restored"] as const)(
    "prevents %s from reopening an interrupted restore before deletion replay", action => {
      const output = rollback({ captured: true, action });
      expect(output.result.status, output.result.stderr).toBe(70);
      expect(output.trace).not.toContain("apps-started");
      expect(output.trace).not.toContain("queue-resume");
      expect(output.trace).not.toContain("public-open");
    });

  it.each(["capture", "replay"])("keeps producers and access closed when %s fails", failure => {
    const output = rollback({ failure });
    expect(output.result.status, output.result.stderr).toBe(70);
    expect(output.failure).toBe(`rollback-erasure-${failure}`);
    expect(output.outcome).toBe("recovery-required");
    expect(output.trace).not.toContain("apps-started");
    expect(output.trace).not.toContain("queue-resume");
    expect(output.trace).not.toContain("public-open");
    if (failure === "capture") expect(output.trace).not.toContain("postgres-restored");
  });

  it("reuses the preserved latest state after an interrupted restore instead of capturing the older database", () => {
    const output = rollback({ captured: true });
    expect(output.result.status, output.result.stderr).toBe(0);
    expect(output.trace).not.toContain(".ts capture ");
    expect(output.trace).toContain(".ts replay ");
    expect(output.capture).toBe("latest-deletions");
  });

  it("refuses to capture deletion state while the publication manager remains a writer", () => {
    const output = rollback({ publicationStops: false });
    expect(output.result.status, output.result.stderr).toBe(70);
    expect(output.trace).not.toContain(".ts capture ");
    expect(output.trace).not.toContain("postgres-restored");
  });

  it.each([{ missingCapture: true }, { emptyCapture: true }, { actor: "" }])(
    "refuses missing deletion authority/state before restoring stores: %j", options => {
      const output = rollback({ captured: true, ...options });
      expect(output.result.status, output.result.stderr).toBe(70);
      expect(output.failure).toBe("rollback-erasure-capture");
      expect(output.trace).not.toContain(".ts capture ");
      expect(output.trace).not.toContain("postgres-restored");
      expect(output.trace).not.toContain("apps-started");
    });
});
