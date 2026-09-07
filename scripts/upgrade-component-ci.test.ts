import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

it.each(["skipped", "failure", "cancelled", "success"])("the actual merge-bar program requires reader CI when L1 runs: %s", result => {
  const source = workflow.split("  required:\n")[1]?.match(/python3 - <<'PY'\n([\s\S]*?)\n\s+PY/)?.[1];
  expect(source).toBeDefined();
  const code = source!.split("\n").map(line => line.slice(10)).join("\n")
    .replaceAll("${{ needs.detect.outputs.run_l1 }}", "true")
    .replaceAll("${{ needs.upgrade-components.result }}", result)
    .replace(/\$\{\{ needs\.[a-z-]+\.result \}\}/g, "success");
  const executed = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  expect(executed.error).toBeUndefined();
  expect(executed.status, executed.stderr + executed.stdout).toBe(result === "success" ? 0 : 1);
});

it("routes the cluster-wide reader mutation test to the mandatory independently owned CI lane", () => {
  const job = workflow.split("\n  upgrade-components:\n")[1]?.split("\n  acceptance-quality:")[0];
  expect(job).toBeDefined();
  expect(job).toContain("runs-on: ubuntu-latest");
  expect(job).toContain("needs.detect.outputs.run_l1 == 'true'");
  expect(job).toContain("id-token: write");
  expect(job).toContain("--suite reader-pg16 --github-hosted");
  expect(job).toContain("--suite report-pg16 --github-hosted");
  expect(job).toContain("--suite activation-pg16 --github-hosted");
  expect(job).toContain("--suite authority-pg16 --github-hosted");
  expect(workflow.split("  required:\n")[1]).toContain("- upgrade-components");
  const server = readFileSync(new URL("../vitest.server.config.ts", import.meta.url), "utf8");
  expect(server).toContain('"server/modules/catalog-kernel/security/catalogReader.integration.test.ts"');
  expect(server).toContain('"server/modules/catalog-cutover/activation/activation.integration.test.ts"');
  const scripts = readFileSync(new URL("../vitest.scripts.config.ts", import.meta.url), "utf8");
  expect(scripts).toContain('"ops/self-hosted/scripts/parameter-catalog-upgrade/deploymentAuthority.integration.test.ts"');
});
