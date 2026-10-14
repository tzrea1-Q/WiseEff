import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertShardJobs, type Identity } from "./ci-required-results";
import { balanceServerShards } from "./server-shard-plan";
import { finishServerReceipt, qualityLanes, playwrightInventory, validateShardInventories, vitestExecution, vitestInventory, type ShardReceipt } from "./ci-shard-results";

const identity: Identity = {
  event: "pull_request", mode: "", fullAcceptance: false, ref: "refs/pull/1/merge",
  base: "1".repeat(40), head: "2".repeat(40), sha: "3".repeat(40), tree: "4".repeat(40), runId: "100", attempt: "1"
};
const testId = (index: number) => String(index).repeat(64);
function receipts(kind: "quality" | "server"): ShardReceipt[] {
  const lanes = kind === "server" ? ["1", "2"] : qualityLanes;
  const warmup = kind === "quality" ? [testId(9)] : [];
  const inventory = { tests: [...lanes.map((_, index) => testId(index + 1)), ...warmup].sort(), warmup,
    files: [...lanes.map((lane) => `${lane}/test.ts`), ...(kind === "quality" ? ["runtime-warmup/test.ts"] : [])].sort() };
  return lanes.map((lane, index) => ({ version: 1, kind, lane, identity,
    inventory: kind === "server" ? { ...inventory, tests: [testId(index + 1)] } : inventory,
    executed: { tests: [testId(index + 1), ...warmup].sort(), warmup,
      files: [`${lane}/test.ts`, ...(kind === "quality" ? ["runtime-warmup/test.ts"] : [])].sort() }, receipt: null }));
}

describe("complete CI shard inventories", () => {
  it.each([undefined, "", "3/2", "1/3", "1"])("rejects an absent or invalid backend shard before reading receipts: %s", (shard) => {
    vi.stubEnv("WISEEFF_CI_SERVER_SHARD", shard);
    try {
      expect(() => finishServerReceipt({}, identity)).toThrow("CI_SHARD_LANE");
    } finally { vi.unstubAllEnvs(); }
  });
  it.each(["quality", "server"] as const)("requires every %s lane and exactly-once inventory", (kind) => {
    expect(validateShardInventories(receipts(kind), kind, identity).tests.length).toBe(kind === "server" ? 2 : 5);
  });
  it.each(["quality", "server"] as const)("rejects a missing, duplicate, extra or unknown %s lane", (kind) => {
    const valid = receipts(kind);
    for (const altered of [valid.slice(1), [...valid, valid[0]], [valid[0], valid[0], ...valid.slice(2)], valid.map((receipt, index) => index ? receipt : { ...receipt, lane: "unknown" })]) {
      expect(() => validateShardInventories(altered, kind, identity)).toThrow();
    }
  });
  it.each(["quality", "server"] as const)("rejects lost, duplicated, foreign and drifted %s tests", (kind) => {
    for (const mutation of ["lost", "duplicated", "foreign", "plan", "identity", "file"]) {
      const changed = structuredClone(receipts(kind));
      if (mutation === "lost") changed[0].executed.tests.shift();
      if (mutation === "duplicated") changed[0].executed.tests.push(changed[0].executed.tests[0]);
      if (mutation === "foreign") changed[0].executed.tests[0] = testId(8);
      if (mutation === "plan") changed[0].inventory.tests[0] = testId(8);
      if (mutation === "identity") changed[0].identity.attempt = "2";
      if (mutation === "file") changed[0].executed.files.push("foreign/test.ts");
      expect(() => validateShardInventories(changed, kind, identity)).toThrow();
    }
  });
  it("requires one warmup per quality lane, never treating a product test as repeated setup", () => {
    for (const mutation of ["missing", "duplicate", "extraExecution", "foreign", "none"]) {
      const changed = structuredClone(receipts("quality"));
      if (mutation === "missing") changed[0].executed.warmup = [];
      if (mutation === "duplicate") changed[0].executed.warmup.push(testId(9));
      if (mutation === "extraExecution") changed[0].executed.tests.push(testId(9));
      if (mutation === "foreign") changed[0].executed.warmup = [changed[0].executed.tests[0]];
      if (mutation === "none") for (const receipt of changed) { receipt.inventory.warmup = []; receipt.executed.warmup = []; }
      expect(() => validateShardInventories(changed, "quality", identity)).toThrow();
    }
  });
  it("rejects backend files with overlapping shard ownership", () => {
    const changed = receipts("server");
    changed[1].executed.files.push(changed[0].executed.files[0]);
    expect(() => validateShardInventories(changed, "server", identity)).toThrow("FILE_OVERLAP");
  });

  it("includes 18 newly registered compact tests in visual receipts and rejects lost or duplicated coverage", () => {
    const compact = playwrightInventory({ errors: [], suites: [{ title: "compact.quality.spec.ts",
      specs: Array.from({ length: 18 }, (_, index) => ({ title: `compact ${index}`, file: "compact.quality.spec.ts",
        line: index + 1, column: 1, ok: true, tests: [{ projectName: "compact", expectedStatus: "passed",
          status: "expected", results: [{ status: "passed", retry: 0 }] }] })) }] }, true);
    expect(compact.tests).toHaveLength(18);
    const expanded = receipts("quality");
    for (const receipt of expanded) {
      receipt.inventory = { ...receipt.inventory, tests: [...receipt.inventory.tests, ...compact.tests].sort(),
        files: [...receipt.inventory.files, ...compact.files].sort() };
      if (receipt.lane === "visual") receipt.executed = { ...receipt.executed,
        tests: [...receipt.executed.tests, ...compact.tests].sort(), files: [...receipt.executed.files, ...compact.files].sort() };
    }
    expect(validateShardInventories(expanded, "quality", identity).tests).toHaveLength(23);
    const missing = structuredClone(expanded);
    missing[0].executed.tests = missing[0].executed.tests.filter((test) => test !== compact.tests[0]);
    expect(() => validateShardInventories(missing, "quality", identity)).toThrow();
    const duplicated = structuredClone(expanded);
    duplicated[1].executed.tests.push(compact.tests[0]);
    expect(() => validateShardInventories(duplicated, "quality", identity)).toThrow();
  });
});

describe("native test discovery and execution", () => {
  it("discovers the server-config inventory without setup and executes every owned file with setup", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "wiseeff-shard-native-"));
    try {
      const config = path.join(directory, "vitest.config.mjs");
      const setup = path.join(directory, "setup.mjs");
      const marker = path.join(directory, "setup-runs.txt");
      writeFileSync(setup, `import { appendFileSync } from "node:fs";
export default () => { if (process.argv[2] === "list") throw new Error("Discovery ran global setup"); appendFileSync(${JSON.stringify(marker)}, "setup\\n"); };`);
      writeFileSync(config, `import serverConfig from ${JSON.stringify(path.resolve("vitest.server.config.ts"))};
export default { ...serverConfig, test: { ...serverConfig.test, setupFiles: [], maxWorkers: 1,
globalSetup: serverConfig.test.globalSetup.length ? [${JSON.stringify(setup)}] : [] } };`);
      mkdirSync(path.join(directory, "server"));
      mkdirSync(path.join(directory, "node_modules/server"), { recursive: true });
      writeFileSync(path.join(directory, "node_modules/server/excluded.test.ts"), 'throw new Error("Excluded file was loaded");');
      for (const name of ["first", "second", "third", "fourth"]) writeFileSync(path.join(directory, "server", `${name}.test.ts`),
        `import { describe, test, expect } from ${JSON.stringify(path.resolve("node_modules/vitest/dist/index.js"))};\ndescribe("parent", () => { test.each([1, 2])("case %i", value => expect(value).toBeGreaterThan(0)); });`);
      const args = [path.resolve("node_modules/vitest/vitest.mjs"), "--config", config, "--root", directory, "--configLoader", "runner", "--includeTaskLocation"];
      const listedFiles = JSON.parse(execFileSync(process.execPath, [args[0], "list", ...args.slice(1), "--filesOnly", "--json"], { encoding: "utf8" }));
      expect(existsSync(marker)).toBe(false);
      const allFiles = listedFiles.map((entry: { file: string }) => path.relative(directory, entry.file)).sort();
      expect(allFiles).toHaveLength(4);
      const plan = balanceServerShards(allFiles, 2, { "server/first.test.ts": 90, "server/second.test.ts": 80,
        "server/third.test.ts": 20, "server/fourth.test.ts": 10 });
      const shards: ShardReceipt[] = [];
      for (const lane of ["1", "2"]) {
        const files = plan[Number(lane) - 1].files;
        const collectionOutput = path.join(directory, `collection-${lane}.json`);
        const output = path.join(directory, `report-${lane}.json`);
        execFileSync(process.execPath, [args[0], "run", ...args.slice(1), ...files.map((file) => path.resolve(directory, file)), "--reporter=json",
          `--reporter=${path.resolve("scripts/ci-server-inventory-reporter.ts")}`, `--outputFile=${output}`],
        { stdio: "pipe", env: { ...process.env, WISEEFF_CI_SERVER_INVENTORY_FILE: collectionOutput } });
        const owned = vitestInventory(JSON.parse(readFileSync(collectionOutput, "utf8")), directory);
        const executed = vitestExecution(JSON.parse(readFileSync(output, "utf8")), directory);
        expect(owned).toEqual(executed);
        expect(owned.files).toEqual(files);
        expect(owned.files).toHaveLength(2);
        shards.push({ version: 1, kind: "server", lane, identity, inventory: { ...owned, files: allFiles },
          executed, receipt: null });
      }
      expect(validateShardInventories(shards, "server", identity).tests).toHaveLength(8);
      expect(readFileSync(marker, "utf8")).toBe("setup\nsetup\n");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);
  const report = () => ({ errors: [], suites: [{ title: "visual.quality.spec.ts", specs: [{ title: "snapshot", file: "visual.quality.spec.ts", line: 4, column: 1, ok: true,
    tests: [{ projectName: "visual", expectedStatus: "passed", status: "expected", results: [{ status: "passed", retry: 0 }] }] }] }] });
  it("matches full Vitest collection names, locations and file paths to JSON assertions", () => {
    const location = { line: 10, column: 3 };
    const planned = vitestInventory([{ file: "/repo/server/example.test.ts", name: "parent > nested > case", location }], "/repo");
    const actual = vitestExecution({ testResults: [{ name: "/repo/server/example.test.ts", assertionResults: [
      { ancestorTitles: ["parent", "nested"], title: "case", status: "passed", location }
    ] }] }, "/repo");
    expect(actual).toEqual(planned);
    expect(() => vitestExecution({ testResults: [{ name: "/repo/server/example.test.ts", assertionResults: [{ title: "case", status: "skipped" }] }] }, "/repo")).toThrow();
  });
  it("matches Playwright list to real report and rejects skips, retries, expected failures and report errors", () => {
    expect(playwrightInventory(report(), true)).toEqual(playwrightInventory(report(), false));
    for (const mutation of ["skipped", "expectedFailure", "retry", "flaky", "notOk", "error", "notRun"]) {
      const changed = report();
      const spec = changed.suites[0].specs[0];
      const test = spec.tests[0];
      if (mutation === "skipped") test.results[0].status = "skipped";
      if (mutation === "expectedFailure") test.expectedStatus = "failed";
      if (mutation === "retry") test.results.push({ status: "passed", retry: 1 });
      if (mutation === "flaky") test.status = "flaky";
      if (mutation === "notOk") spec.ok = false;
      if (mutation === "error") (changed.errors as unknown[]).push({ message: "collector failed" });
      if (mutation === "notRun") test.results = [];
      expect(() => playwrightInventory(changed, true)).toThrow();
    }
  });
  it("does not accept zero collected tests or out-of-root paths", () => {
    expect(() => vitestInventory([], "/repo")).toThrow();
    expect(() => vitestInventory([{ file: "/other/test.ts", name: "case" }], "/repo")).toThrow();
    expect(() => playwrightInventory({ suites: [], errors: [] }, false)).toThrow();
  });
});

describe("matrix scheduling fail-closed", () => {
  it.each(["server", "quality"] as const)("accepts %s only when every selected worker succeeds", (kind) => {
    const job = kind === "server" ? "l1-server-shards" : "acceptance-quality-lanes";
    const input = { identity, needs: { detect: { result: "success", outputs: { selected: "true", docs_only: "false", run_l1: "true", run_quality: "true", run_smoke: "true", run_l2: "false" } }, [job]: { result: "success" } } };
    expect(assertShardJobs(input, kind)).toBe(true);
    for (const result of ["failure", "cancelled", "skipped", "missing"]) {
      expect(() => assertShardJobs({ ...input, needs: { ...input.needs, [job]: { result } } }, kind)).toThrow();
    }
  });
  it.each(["server", "quality"] as const)("only accepts intentionally skipped %s matrices on docs-only", (kind) => {
    const job = kind === "server" ? "l1-server-shards" : "acceptance-quality-lanes";
    const input = { identity, needs: { detect: { result: "success", outputs: { selected: "true", docs_only: "true", run_l1: "false", run_quality: "false", run_smoke: "false", run_l2: "false" } }, [job]: { result: "skipped" } } };
    expect(assertShardJobs(input, kind)).toBe(false);
    expect(() => assertShardJobs({ ...input, needs: { ...input.needs, [job]: { result: "success" } } }, kind)).toThrow();
  });
});
