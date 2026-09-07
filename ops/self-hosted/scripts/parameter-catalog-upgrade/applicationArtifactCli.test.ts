import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../upgrade.sh", import.meta.url));
const run = (...args: string[]) => spawnSync("bash", [entry, ...args], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: "utf8", timeout: 10_000,
});

describe("actual upgrade artifact terminal admission", () => {
  it.each([
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
});
