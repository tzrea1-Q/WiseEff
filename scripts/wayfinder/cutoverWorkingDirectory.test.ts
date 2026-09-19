import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wayfinderInspect = path.join(projectRoot, "scripts/wayfinder/inspect-parameter-catalog-cutover.ts");
const opsWrapper = path.join(projectRoot, "ops/self-hosted/scripts/parameter-catalog-cutover.sh");
const secretUrl = "postgres://wiseeff:super-secret-pass@127.0.0.1:55438/does-not-exist";

describe("cutover diagnostics from both working directories", () => {
  it("redacts database secrets from repository root and ops/self-hosted entries", () => {
    chmodSync(opsWrapper, 0o755);
    const fromRoot = spawnSync(
      "npx",
      ["tsx", wayfinderInspect, "--database-url", secretUrl, "--run-id", "missing-run"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    const fromOps = spawnSync(
      "bash",
      [opsWrapper, "inspect", "--database-url", secretUrl, "--run-id", "missing-run"],
      { cwd: path.join(projectRoot, "ops/self-hosted"), encoding: "utf8" },
    );
    for (const result of [fromRoot, fromOps]) {
      const text = `${result.stdout}\n${result.stderr}`;
      expect(text).not.toContain("super-secret-pass");
    }
  });
});
