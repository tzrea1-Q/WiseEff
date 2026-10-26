import { describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertShardJobs, l1CommandIds, type Identity } from "./ci-required-results";
import { balanceServerShards } from "./server-shard-plan";
import { finishServerReceipt, qualityLanes, playwrightInventory, readShardReceipts, selectShardReceipts, validateShardInventories, vitestExecution, vitestInventory, type ShardReceipt } from "./ci-shard-results";

const identity: Identity = {
  event: "pull_request", mode: "", fullAcceptance: false, ref: "refs/pull/1/merge",
  base: "1".repeat(40), head: "2".repeat(40), sha: "3".repeat(40), tree: "4".repeat(40), repository: "tzrea1-Q/WiseEff", runId: "100", attempt: "1"
};
const testId = (index: number) => String(index).repeat(64);
function receipts(kind: "quality" | "server"): ShardReceipt[] {
  const lanes = kind === "server" ? ["1", "2", "3"] : qualityLanes;
  const warmup = kind === "quality" ? [testId(9)] : [];
  const inventory = { tests: [...lanes.map((_, index) => testId(index + 1)), ...warmup].sort(), warmup,
    files: [...lanes.map((lane) => `${lane}/test.ts`), ...(kind === "quality" ? ["runtime-warmup/test.ts"] : [])].sort() };
  return lanes.map((lane, index) => ({ version: 1, kind, lane, identity,
    inventory: kind === "server" ? { ...inventory, tests: [testId(index + 1)] } : inventory,
    executed: { tests: [testId(index + 1), ...warmup].sort(), warmup,
      files: [`${lane}/test.ts`, ...(kind === "quality" ? ["runtime-warmup/test.ts"] : [])].sort() }, receipt: null }));
}

describe("complete CI shard inventories", () => {
  it("retains the failed quality command's native report without publishing a success receipt", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "wiseeff-quality-failure-"));
    try {
      const report = { errors: [], stats: { duration: 120 }, suites: [{ title: "visual.quality.spec.ts", specs: [{
        file: "visual.quality.spec.ts", title: "fails the original assertion", tests: [{ projectName: "visual", expectedStatus: "passed",
          results: [{ status: "failed", errors: [{ message: "expect(locator).toHaveCount(expected) failed" }] }] }]
      }] }] };
      const bin = path.join(directory, "bin"), artifacts = path.join(directory, "artifacts");
      mkdirSync(bin); mkdirSync(artifacts); mkdirSync(path.join(directory, "node_modules/playwright"), { recursive: true });
      writeFileSync(path.join(directory, "node_modules/playwright/cli.js"),
        `require('node:fs').writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, ${JSON.stringify(JSON.stringify(report))});`);
      const npm = path.join(bin, "npm");
      writeFileSync(npm, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, ${JSON.stringify(JSON.stringify(report))}); process.exit(1);`);
      chmodSync(npm, 0o755);
      const result = spawnSync(process.execPath, ["--experimental-strip-types", path.resolve("scripts/ci-shard-results.ts"), "quality"], {
        cwd: directory, encoding: "utf8", env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          GIT_DIR: execFileSync("git", ["rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim(),
          GITHUB_SHA: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: identity.repository,
          GITHUB_RUN_ID: identity.runId, GITHUB_RUN_ATTEMPT: identity.attempt, GITHUB_JOB: "acceptance-quality-lanes",
          EFF_FULL_ACCEPTANCE: "false", EFF_BASE_SHA: "", EFF_HEAD_SHA: "", EFF_MODE: "",
          WISEEFF_QUALITY_LANE: "visual", WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR: artifacts, RUNNER_TEMP: directory }
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("CI_SHARD_COMMAND_FAILED");
      expect(JSON.parse(readFileSync(path.join(artifacts, "results.json"), "utf8"))).toEqual(report);
      expect(existsSync(path.join(directory, "wiseeff-ci-shard/receipt.json"))).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each([undefined, "", "3/2", "1/2", "4/3", "1/4", "1"])("rejects an absent or invalid backend shard before reading receipts: %s", (shard) => {
    vi.stubEnv("WISEEFF_CI_SERVER_SHARD", shard);
    try {
      expect(() => finishServerReceipt({}, identity)).toThrow("CI_SHARD_LANE");
    } finally { vi.unstubAllEnvs(); }
  });
  it.each(["quality", "server"] as const)("requires every %s lane and exactly-once inventory", (kind) => {
    expect(validateShardInventories(receipts(kind), kind, identity).tests.length).toBe(kind === "server" ? 3 : 5);
  });
  it.each(["quality", "server"] as const)("accepts earlier-attempt %s receipts and selects the newest per lane numerically", (kind) => {
    const older = receipts(kind).map((receipt) => ({ ...receipt, identity: { ...identity, attempt: "9" } }));
    const newest = { ...older[0], identity: { ...identity, attempt: "10" } };
    const current = { ...identity, attempt: "10" };
    for (const candidates of [[...older, newest], [newest, ...older]]) {
      expect(selectShardReceipts(candidates, kind, current)).toEqual([newest, ...older.slice(1)]);
      expect(validateShardInventories(candidates, kind, current)).toEqual(kind === "server"
        ? { ...newest.inventory, tests: older.flatMap((receipt) => receipt.inventory.tests).sort() } : newest.inventory);
    }
    expect(() => validateShardInventories([...older.slice(0, -1), newest], kind, current)).toThrow("CI_SHARD_LANES");
    expect(() => selectShardReceipts([...older, newest, older[0]], kind, current)).toThrow("CI_SHARD_LANES");
    const brokenNewest = { ...newest, executed: { ...newest.executed, tests: [] } };
    expect(() => validateShardInventories([...older, brokenNewest], kind, current)).toThrow();
  });
  it.each(["quality", "server"] as const)("rejects foreign, future and missing %s receipt identity even on a superseded lane", (kind) => {
    const valid = receipts(kind);
    for (const changed of [{ repository: "other/WiseEff" }, { repository: undefined }, { runId: "101" },
      { sha: "5".repeat(40) }, { head: "5".repeat(40) }, { base: "5".repeat(40) }, { tree: "5".repeat(40) },
      { ref: "refs/pull/2/merge" }, { fullAcceptance: true }, { attempt: "3" }, { attempt: "0" }, { attempt: undefined }]) {
      const foreign = { ...valid[0], identity: { ...identity, ...changed } } as ShardReceipt;
      const newest = { ...valid[0], identity: { ...identity, attempt: "2" } };
      expect(() => validateShardInventories([...valid.slice(1), foreign, newest], kind, { ...identity, attempt: "2" })).toThrow();
    }
  });
  it.each(["quality", "server"] as const)("loads all attempt-qualified %s artifact folders without merging them", (kind) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "wiseeff-ci-artifacts-"));
    try {
      const older = receipts(kind);
      const newest = { ...older[0], identity: { ...identity, attempt: "2" } };
      for (const receipt of [...older, newest]) {
        const folder = path.join(directory, `wiseeff-ci-${kind}-${receipt.identity.attempt}-${receipt.lane}`);
        mkdirSync(folder);
        writeFileSync(path.join(folder, "receipt.json"), JSON.stringify(receipt));
      }
      const current = { ...identity, attempt: "2" };
      expect(readShardReceipts(directory, kind, current)).toEqual([newest, ...older.slice(1)]);
      const newestFolder = path.join(directory, `wiseeff-ci-${kind}-2-${newest.lane}`);
      renameSync(newestFolder, path.join(directory, `wiseeff-ci-${kind}-3-${newest.lane}`));
      expect(() => readShardReceipts(directory, kind, current)).toThrow("CI_SHARD_ARTIFACTS");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it.each(["success", "missing-third", "duplicate-third", "foreign-third", "empty-third", "skipped-third", "failed-third", "cancelled-third"])("requires all three successful backend receipts when aggregating mixed attempts: %s", (scenario) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "wiseeff-ci-aggregate-"));
    try {
      const current: Identity = { ...identity, event: "push", ref: "refs/heads/main", base: "", head: "", attempt: "3",
        sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim() };
      const shards = receipts("server").map((receipt, index) => {
        const shardIdentity = { ...current, attempt: String(index + 1) };
        return { ...receipt, identity: shardIdentity, receipt: { version: 1, job: "l1-server", identity: shardIdentity,
          commands: Object.fromEntries(l1CommandIds["l1-server"].map((command) => [command, "success"])),
          reports: { server: { version: 1, command: "server", identity: shardIdentity, passed: 1, skipped: 0, files: 1,
            optionalSkips: {}, sha256: "a".repeat(64), filesSha256: "b".repeat(64) } } } };
      });
      if (scenario === "missing-third") shards.pop();
      if (scenario === "duplicate-third") shards[2].lane = "2";
      if (scenario === "foreign-third") shards[2].identity = { ...shards[2].identity, sha: "5".repeat(40) };
      if (scenario === "empty-third") shards[2].executed.tests = [];
      if (scenario === "skipped-third") shards[2].receipt.reports.server.skipped = 1;
      if (scenario === "failed-third") shards[2].receipt.commands.server = "failure";
      for (const receipt of shards) {
        const folder = path.join(directory, "wiseeff-ci-shards", `wiseeff-ci-server-${receipt.identity.attempt}-${receipt.lane}`);
        mkdirSync(folder, { recursive: true });
        writeFileSync(path.join(folder, "receipt.json"), JSON.stringify(receipt));
      }
      const output = path.join(directory, "output");
      const needs = { detect: { result: "success", outputs: { selected: "true", docs_only: "false", run_l1: "true", run_quality: "true", run_smoke: "false", run_l2: "true" } },
        "l1-server-shards": { result: scenario === "cancelled-third" ? "cancelled" : "success" } };
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/ci-shard-results.ts", "aggregate", "server"], { encoding: "utf8",
        env: { ...process.env, GITHUB_REPOSITORY: current.repository, GITHUB_RUN_ID: current.runId, GITHUB_RUN_ATTEMPT: current.attempt,
          GITHUB_EVENT_NAME: current.event, GITHUB_REF: current.ref, GITHUB_SHA: current.sha, GITHUB_JOB: "l1-server", GITHUB_OUTPUT: output,
          EFF_BASE_SHA: "", EFF_HEAD_SHA: "", EFF_MODE: "", EFF_FULL_ACCEPTANCE: "false", EFF_NEEDS: JSON.stringify(needs), RUNNER_TEMP: directory } });
      if (scenario !== "success") {
        expect(result.status, scenario).toBe(1);
        expect(existsSync(output) ? readFileSync(output, "utf8") : "").not.toContain("receipt=");
        return;
      }
      expect(result.status, result.stderr).toBe(0);
      const outputs = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))];
      }));
      expect(outputs.identity).toEqual(current);
      expect(outputs.receipt.identity).toEqual(current);
      expect(outputs.receipt.reports.server).toMatchObject({ identity: current, passed: 3, files: 3 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
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
    changed[2].executed.files.push(changed[0].executed.files[0]);
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
      for (const name of ["first", "second", "third", "fourth", "fifth", "sixth"]) writeFileSync(path.join(directory, "server", `${name}.test.ts`),
        `import { describe, test, expect } from ${JSON.stringify(path.resolve("node_modules/vitest/dist/index.js"))};\ndescribe("parent", () => { test.each([1, 2])("case %i", value => expect(value).toBeGreaterThan(0)); });`);
      const args = [path.resolve("node_modules/vitest/vitest.mjs"), "--config", config, "--root", directory, "--configLoader", "runner", "--includeTaskLocation"];
      const listedFiles = JSON.parse(execFileSync(process.execPath, [args[0], "list", ...args.slice(1), "--filesOnly", "--json"], { encoding: "utf8" }));
      expect(existsSync(marker)).toBe(false);
      const allFiles = listedFiles.map((entry: { file: string }) => path.relative(directory, entry.file)).sort();
      expect(allFiles).toHaveLength(6);
      const plan = balanceServerShards(allFiles, 3, { "server/first.test.ts": 90, "server/second.test.ts": 80,
        "server/third.test.ts": 20, "server/fourth.test.ts": 10, "server/fifth.test.ts": 70, "server/sixth.test.ts": 30 });
      const shards: ShardReceipt[] = [];
      for (const lane of ["1", "2", "3"]) {
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
        shards.push({ version: 1, kind: "server", lane, identity: { ...identity, attempt: lane }, inventory: { ...owned, files: allFiles },
          executed, receipt: null });
      }
      expect(validateShardInventories(shards, "server", { ...identity, attempt: "3" }).tests).toHaveLength(12);
      expect(readFileSync(marker, "utf8")).toBe("setup\nsetup\nsetup\n");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 30_000);
  it("matches real unsharded Vitest list against three native shard reports", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "wiseeff-shard-native-"));
    try {
      const config = path.join(directory, "vitest.config.mjs");
      writeFileSync(config, 'export default { test: { include: ["*.test.mjs"], environment: "node", maxWorkers: 1 } };');
      for (const name of ["first", "second", "third", "fourth", "fifth", "sixth"]) writeFileSync(path.join(directory, `${name}.test.mjs`),
        `import { describe, test, expect } from ${JSON.stringify(path.resolve("node_modules/vitest/dist/index.js"))};\ndescribe("parent", () => { test.each([1, 2])("case %i", value => expect(value).toBeGreaterThan(0)); });`);
      const args = [path.resolve("node_modules/vitest/vitest.mjs"), "--config", config, "--root", directory, "--configLoader", "runner", "--includeTaskLocation"];
      const listed = path.join(directory, "listed.json");
      execFileSync(process.execPath, [args[0], "list", ...args.slice(1), `--json=${listed}`], { stdio: "pipe" });
      const planned = vitestInventory(JSON.parse(readFileSync(listed, "utf8")), directory);
      const shards: ShardReceipt[] = [];
      for (const lane of ["1", "2", "3"]) {
        const ownedList = path.join(directory, `owned-${lane}.json`);
        execFileSync(process.execPath, [args[0], "list", ...args.slice(1), `--shard=${lane}/3`, `--json=${ownedList}`], { stdio: "pipe" });
        const owned = vitestInventory(JSON.parse(readFileSync(ownedList, "utf8")), directory);
        const output = path.join(directory, `report-${lane}.json`);
        execFileSync(process.execPath, [args[0], "run", ...args.slice(1), `--shard=${lane}/3`, "--reporter=json", `--outputFile=${output}`], { stdio: "pipe" });
        const executed = vitestExecution(JSON.parse(readFileSync(output, "utf8")), directory);
        expect(owned).toEqual(executed);
        expect(owned.files).toHaveLength(2);
        shards.push({ version: 1, kind: "server", lane, identity, inventory: { ...planned, tests: owned.tests },
          executed, receipt: null });
      }
      expect(validateShardInventories(shards, "server", identity)).toEqual(planned);
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
