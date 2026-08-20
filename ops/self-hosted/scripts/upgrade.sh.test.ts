import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
