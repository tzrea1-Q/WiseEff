import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import * as componentRunner from "./run-upgrade-component-tests";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

it("isolates bootstrap credential mutation in its own mandatory cluster and exact collection", () => {
  const file = "server/modules/catalog-cutover/retirement/bootstrapCredentialFence.integration.test.ts";
  const command = componentRunner.componentTestCommands("bootstrap-credential-pg16");
  expect(command).toHaveLength(1);
  expect(command[0].slice(1)).toEqual(["run", "--config", "vitest.upgrade-bootstrap-credential.config.ts", file]);
  expect(componentRunner.componentTestCommands("retirement-existing-pg16").flat()).not.toContain(file);
  const config = readFileSync(new URL("../vitest.upgrade-bootstrap-credential.config.ts", import.meta.url), "utf8");
  expect(config).toContain("assertOwnedUpgradeTestTarget();");
  expect(config).toContain(`include: ["${file}"]`);
  expect(config).toContain("passWithNoTests: false");
  expect(config).not.toContain("testTimeout:");
  expect(config).not.toContain("hookTimeout:");
  expect(readFileSync(new URL("../vitest.server.config.ts", import.meta.url), "utf8")).toContain(`"${file}"`);
  const job = workflow.split("\n  upgrade-components:\n")[1]?.split("\n  acceptance-quality:")[0];
  expect(job).toContain("--suite bootstrap-credential-pg16 --github-hosted");
  expect(job).not.toContain("continue-on-error: true");
});

it("refuses bootstrap collection without its parent's ownership receipt instead of using an ambient database", () => {
  const run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "list", "--config", "vitest.upgrade-bootstrap-credential.config.ts"],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME }, encoding: "utf8", timeout: 10000 });
  expect(run.error).toBeUndefined();
  expect(run.status).not.toBe(0);
  expect(run.stderr + run.stdout).toContain("upgrade-tests-require-explicit-owned-postgres-receipt");
});

it("runs the actual docs-check package command in the owned pgvector lane, separately from generation", () => {
  expect(componentRunner.componentTestCommands("docs-check")).toEqual([["run", "docs:check", "--", "--require-database"]]);
  expect(componentRunner.componentTestExecutable("docs-check")).toBe("npm");
  expect(componentRunner.componentTestExecutable("schema-doc")).toBe(process.execPath);
  expect(componentRunner.componentTestCommands("schema-doc")[0].slice(0, 2)).toEqual(["--import", "tsx"]);
  expect(componentRunner.componentTestCommands("schema-doc")[0][2]).toMatch(/scripts\/generate-db-schema-doc\.ts$/);
  expect(() => componentRunner.componentTestExecutable("__proto__")).toThrow("unknown-upgrade-component-suite");
  const runner = readFileSync(new URL("./run-upgrade-component-tests.ts", import.meta.url), "utf8");
  expect(runner).toContain('"docs-check": { image: "pgvector/pgvector:pg16", files: [], config: "", command: "docs-check" }');
  expect(runner).toContain("spawn(componentTestExecutable(args[3]), command");
});

it("runs all four frozen source-lock cases as a mandatory serial stage in ordinary, owned and Hosted scripts", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(pkg.scripts["test:scripts"]).toBe("tsx scripts/check-workspace-links.ts && npm run test:scripts:source-lock && vitest run --config vitest.scripts.config.ts");
  expect(pkg.scripts["test:scripts:source-lock"]).toBe("vitest run --config vitest.scripts-source-lock.config.ts");
  const frozen = "scripts/wayfinder/parameter-catalog-rehearsal-source-lock.test.ts";
  const ordinary = readFileSync(new URL("../vitest.scripts.config.ts", import.meta.url), "utf8");
  expect(ordinary).toContain(`"${frozen}"`);
  const serial = readFileSync(new URL("../vitest.scripts-source-lock.config.ts", import.meta.url), "utf8");
  expect(serial).toContain(`include: ["${frozen}"]`);
  expect(serial).toContain("passWithNoTests: false");
  expect(serial).toContain("testTimeout: 60_000");
  expect(serial).toContain("fileParallelism: false");
  expect(serial).toContain("maxWorkers: 1");
  const commands = componentRunner.componentTestCommands("scripts-pgvector");
  expect(commands.map(command => command.slice(1))).toEqual([
    ["run", "--config", "vitest.scripts-source-lock.config.ts"],
    ["run", "--config", "vitest.scripts.config.ts"],
  ]);
  expect(componentRunner.componentTestCommands("reader-pg16")).toHaveLength(1);
  expect(() => componentRunner.componentTestCommands("not-a-suite")).toThrow("unknown-upgrade-component-suite");
  expect(workflow).toContain("run: npm run test:scripts");
  expect(workflow.split("  required:\n")[1]).toContain("needs.build-and-test.result");
});

it.each(["upgrade-components", "build-and-test"].flatMap(job => ["skipped", "failure", "cancelled", "success"].map(result => ({ job, result }))))("the actual merge-bar program requires $job when L1 runs: $result", ({ job, result }) => {
  const source = workflow.split("  required:\n")[1]?.match(/python3 - <<'PY'\n([\s\S]*?)\n\s+PY/)?.[1];
  expect(source).toBeDefined();
  const code = source!.split("\n").map(line => line.slice(10)).join("\n")
    .replaceAll("${{ needs.detect.outputs.run_l1 }}", "true")
    .replaceAll(`\${{ needs.${job}.result }}`, result)
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
  expect(job).not.toContain("--suite activation-pg16"); // Unsealed P12 contract is a separate Scratch branch.
  expect(job).toContain("--suite authority-pg16 --github-hosted");
  expect(job).toContain("--suite bindings-pg16 --github-hosted");
  expect(job).toContain("--suite log-redis --github-hosted");
  expect(job).toContain("--suite activation-existing-pg16 --github-hosted");
  expect(job).toContain("--suite retirement-existing-pg16 --github-hosted");
  expect(job).not.toContain("continue-on-error: true");
  expect(workflow.split("  required:\n")[1]).toContain("- upgrade-components");
  const server = readFileSync(new URL("../vitest.server.config.ts", import.meta.url), "utf8");
  const redisTest = "server/modules/logs/logAnalysisQueueRuntime.redis.integration.test.ts";
  expect(server).toContain(`"${redisTest}"`);
  expect(server).toContain('"server/modules/catalog-cutover/activation/activation.integration.test.ts"');
  expect(server).toContain('"server/modules/catalog-cutover/retirement/loginFence.integration.test.ts"');
  const redisConfig = readFileSync(new URL("../vitest.upgrade-redis.config.ts", import.meta.url), "utf8");
  expect(redisConfig).toContain(`include: ["${redisTest}"]`);
  expect(redisConfig).toContain("owned-redis-runner-required");
  expect(server).toContain('"server/modules/catalog-kernel/security/catalogReader.integration.test.ts"');
  expect(server).toContain('"server/modules/catalog-cutover/runtimeState.test.ts"');
  const runner = readFileSync(new URL("./run-upgrade-component-tests.ts", import.meta.url), "utf8");
  expect(runner).toContain(`"log-redis": { image: "redis:7-alpine", files: ["${redisTest}"], config: "vitest.upgrade-redis.config.ts" }`);
  expect(runner.split("const bindingFiles = ")[1]?.split(";\n")[0])
    .toContain('"server/modules/catalog-cutover/runtimeState.test.ts"');
  const scripts = readFileSync(new URL("../vitest.scripts.config.ts", import.meta.url), "utf8");
  expect(scripts).toContain('"ops/self-hosted/scripts/parameter-catalog-upgrade/deploymentAuthority.integration.test.ts"');
  expect(scripts).toContain('"scripts/retirement-endpoint-supervision.docker.test.ts"');
  const retirement = readFileSync(new URL("../vitest.upgrade-retirement.config.ts", import.meta.url), "utf8");
  expect(retirement).toContain("owned-retirement-runner-required");
  expect(retirement).toContain("passWithNoTests: false");
  for (const file of componentRunner.componentTestCommands("retirement-existing-pg16")[0].slice(-2)) expect(retirement).toContain(`"${file}"`);
});
