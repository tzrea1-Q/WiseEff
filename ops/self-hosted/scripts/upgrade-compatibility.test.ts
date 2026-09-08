import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function run(command: string) {
  return spawnSync("bash", ["-c", `source ops/self-hosted/scripts/upgrade-lib.sh\n${command}`], { encoding: "utf8" });
}

describe("UPG-01 ordinary stack compatibility", () => {
  it.each(["resume", "recover_candidate"])("refuses canonical %s before candidate mutation", (action) => {
    const result = run(`
      wiseeff_upgrade_reject_root_runtime() { :; }
      wiseeff_upgrade_load_run() { :; }
      wiseeff_upgrade_acquire_lock() { :; }
      wiseeff_upgrade_release_lock() { :; }
      wiseeff_upgrade_validate_env() { :; }
      wiseeff_upgrade_git() { printf '100644 blob fixture\\tserver/modules/catalog-cutover/interface.ts\\n'; }
      wiseeff_upgrade_state_read() {
        case "$1" in
          outcome) printf running;; phase|failed_phase) printf candidate-recovery-verifying;;
          migration_started|recovery_point_verified) printf true;;
        esac
      }
      wiseeff_upgrade_state_write() { echo UNAUTHORIZED-MUTATION; }
      wiseeff_upgrade_compose() { echo UNAUTHORIZED-MUTATION; }
      upgrade_run_id=fixture; upgrade_target_sha=fixture
      upgrade_candidate_image_tag=fixture; upgrade_confirm=recover-candidate-fixture
      wiseeff_upgrade_run_${action}
    `);
    expect(result.status).toBe(70);
    expect(result.stderr).toContain("PCAT-UPG-STACK-CATALOG-UNSUPPORTED");
    expect(result.stdout).not.toContain("UNAUTHORIZED-MUTATION");
  });
  it("fails closed if immutable target inspection fails", () => {
    const result = run(`wiseeff_upgrade_git() { return 1; }; upgrade_target_sha=unknown; wiseeff_upgrade_require_supported_stack_target`);
    expect(result.status).toBe(10);
    expect(result.stderr).toContain("PCAT-UPG-TARGET-UNKNOWN");
  });
  it("keeps pre-migration old-stack restoration separate from candidate authorization", () => {
    const result = run(`
      wiseeff_upgrade_reject_root_runtime() { :; }; wiseeff_upgrade_load_run() { :; }
      wiseeff_upgrade_acquire_lock() { :; }; wiseeff_upgrade_release_lock() { :; }
      wiseeff_upgrade_validate_env() { :; }; wiseeff_upgrade_state_read() { printf false; }
      wiseeff_upgrade_restore_old_stack_after_stop() { printf OLD-STACK-RESTORE; }
      wiseeff_upgrade_run_resume
    `);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("OLD-STACK-RESTORE");
  });
  it("refuses canonical same-SHA before no-op or downtime", () => {
    const result = run(`
      wiseeff_upgrade_acquire_lock() { :; }
      wiseeff_upgrade_release_lock() { :; }
      wiseeff_upgrade_preflight() { upgrade_previous_sha=abc; upgrade_target_sha=abc; }
      wiseeff_upgrade_git() { printf '100644 blob fixture\\tserver/modules/catalog-cutover/interface.ts\\n'; }
      wiseeff_upgrade_target_app_image_is_running() { return 0; }
      wiseeff_upgrade_public_probe() { return 0; }
      wiseeff_upgrade_init_run() { echo UNAUTHORIZED-MUTATION; }
      upgrade_restart=false; upgrade_json=true
      wiseeff_upgrade_run_apply
    `);
    expect(result.status).toBe(10);
    expect(result.stderr).toContain("PCAT-UPG-STACK-CATALOG-UNSUPPORTED");
    expect(result.stdout).not.toContain("noop");
    expect(result.stdout).not.toContain("UNAUTHORIZED-MUTATION");
  });
});
