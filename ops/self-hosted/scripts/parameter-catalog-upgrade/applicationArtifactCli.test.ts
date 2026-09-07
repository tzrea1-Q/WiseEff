import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readdir, rm, readFile, stat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../upgrade.sh", import.meta.url));
const run = (...args: string[]) => spawnSync("bash", [entry, ...args], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: "utf8", timeout: 10_000,
});

describe("actual upgrade artifact terminal admission", () => {
  it.each([
    ["artifact-init"],
    ["artifact-prepare"],
    ["artifact-inspect"],
    ["artifact-prepare", "--journal", "/absent", "--journal", "/other"],
    ["artifact-inspect", "--journal", "/absent", "--run-id", "test", "--force"],
    ["artifact-inspect", "--journal", "/absent", "--run-id", "test", "--source-sha", "a".repeat(40)],
    ["artifact-prepare", "apply"],
  ])("rejects ambiguous or missing inputs before build: %j", (...args) => {
    const result = run(...args);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("PCAT-UPG-ARTIFACT-ARGUMENTS-INVALID");
    expect(result.stdout).not.toContain("releaseApproved");
  });
  it("explicitly creates only a new empty run through the actual entry and refuses replacement", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "artifact-cli-init-")));
    const journal = path.join(directory, "journal.json");
    try {
      const initialized = run("artifact-init", "--journal", journal, "--run-id", "new-artifact-run");
      expect(initialized.error).toBeUndefined();
      expect(initialized.status, initialized.stderr).toBe(0);
      expect(JSON.parse(initialized.stdout)).toEqual({ ok: true, scope: "empty-artifact-run-only", runId: "new-artifact-run", releaseApproved: false });
      const bytes = await readFile(journal);
      expect(JSON.parse(bytes.toString())).toMatchObject({ runId: "new-artifact-run", state: "idle", entries: [], cutoverRunId: null, planDigest: null });
      expect((await stat(journal)).mode & 0o777).toBe(0o600);
      expect(run("artifact-init", "--journal", journal, "--run-id", "new-artifact-run").status).toBe(2);
      expect(run("artifact-init", "--journal", journal, "--run-id", "different-run").status).toBe(2);
      expect(await readFile(journal)).toEqual(bytes);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("runs the fixed entry from another directory and never creates a missing journal", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "artifact-cli-"));
    try {
      const result = spawnSync("bash", [entry, "artifact-inspect", "--journal", path.join(directory, "journal.json"), "--run-id", "existing-run"], {
        cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME,
          DATABASE_URL: "postgres://private:must-not-escape@unreachable.invalid/private",
          WISEEFF_CATALOG_APPLY_MODE: "populated" }, encoding: "utf8", timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stderr.trim()).toBe("PCAT-UPG-ARTIFACT-JOURNAL-UNAVAILABLE");
      expect(result.stdout).toBe("");
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
