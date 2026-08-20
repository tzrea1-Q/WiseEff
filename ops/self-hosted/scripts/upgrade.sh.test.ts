import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

describe("upgrade.sh public interface", () => {
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

  it("does not inspect or journal a candidate when its build fails", () => {
    const result = spawnSync("bash", ["-c", `
      source ops/self-hosted/scripts/upgrade-lib.sh
      upgrade_target_sha=target-sha
      wiseeff_upgrade_app_image_name() { printf 'wiseeff-app\\n'; }
      wiseeff_upgrade_git() { return 0; }
      wiseeff_upgrade_compose() { printf 'build-failed\\n'; return 23; }
      wiseeff_upgrade_docker() { printf 'should-not-inspect\\n'; return 0; }
      wiseeff_upgrade_state_write() { printf 'should-not-journal\\n'; return 0; }
      if wiseeff_upgrade_build_candidate; then exit 0; else exit $?; fi
    `], { encoding: "utf8", env: { ...process.env } });

    expect(result.status).toBe(23);
    expect(result.stdout).toContain("build-failed");
    expect(result.stdout).not.toContain("should-not-inspect");
    expect(result.stdout).not.toContain("should-not-journal");
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
    writeFileSync(join(runDir, "next_action"), "none\n");
    writeFileSync(join(runDir, "status"), "run_id=run-1\nphase=completed\noutcome=completed\n");

    const result = runUpgrade(["status", "--json", "--run-id", "run-1", "--state-dir", stateRoot]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ runId: "run-1", phase: "completed", outcome: "completed" });
    expect(result.stdout).not.toContain("POSTGRES_PASSWORD");
  });

  it.each(["resume", "rollback"])('requires --run-id for %s', (action) => {
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
