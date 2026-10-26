import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Identity, NativeSummary } from "./ci-required-results";

const { sameIdentity }: typeof import("./ci-required-results") = await import(new URL("./ci-required-results.ts", import.meta.url).href);
const { qualityLanes }: typeof import("../e2e/quality/quality-partition") = await import(new URL("../e2e/quality/quality-partition.ts", import.meta.url).href);
const { balanceServerShards }: typeof import("./server-shard-plan") = await import(new URL("./server-shard-plan.ts", import.meta.url).href);
export { qualityLanes };
type Kind = "server" | "quality";
type Inventory = { tests: string[]; warmup: string[]; files: string[] };
export type ShardReceipt = {
  version: 1; kind: Kind; lane: string; identity: Identity;
  inventory: Inventory; executed: Inventory; receipt: unknown;
};

function requireShard(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`CI_SHARD_${code}`);
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sorted = (values: string[]) => [...values].sort();
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
function relativeFile(file: string, root: string): string {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  requireShard(relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative), "PATH");
  return relative.replaceAll("\\", "/");
}
function inventory(tests: string[], warmup: string[], files: string[]): Inventory {
  requireShard(tests.length > 0, "EMPTY");
  return { tests: sorted(tests), warmup: sorted(warmup), files: sorted([...new Set(files)]) };
}

export function vitestInventory(value: Array<{ file: string; name: string; location?: unknown }>, root: string): Inventory {
  requireShard(Array.isArray(value), "DISCOVERY");
  return inventory(value.map((test) => {
    requireShard(typeof test.file === "string" && typeof test.name === "string", "DISCOVERY");
    return digest([relativeFile(test.file, root), test.name, test.location ?? null]);
  }), [], value.map((test) => relativeFile(test.file, root)));
}

export function vitestExecution(report: any, root: string): Inventory {
  requireShard(Array.isArray(report.testResults), "REPORT");
  const entries = report.testResults.flatMap((file: any) => {
    requireShard(Array.isArray(file.assertionResults), "REPORT");
    return file.assertionResults.map((test: any) => {
      requireShard(test.status === "passed" && Array.isArray(test.ancestorTitles) && typeof test.title === "string", "NOT_PASSED");
      return { file: file.name, name: [...test.ancestorTitles, test.title].join(" > "), location: test.location };
    });
  });
  return vitestInventory(entries, root);
}

export function playwrightInventory(report: any, executed: boolean): Inventory {
  requireShard(Array.isArray(report.suites) && Array.isArray(report.errors) && report.errors.length === 0, "REPORT");
  const tests: string[] = [];
  const warmup: string[] = [];
  const files: string[] = [];
  const visit = (suite: any, titles: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        requireShard(typeof test.projectName === "string" && typeof spec.file === "string" && typeof spec.title === "string", "REPORT");
        requireShard(test.expectedStatus === "passed", "EXPECTED_FAILURE_OR_SKIP");
        if (executed) requireShard(spec.ok === true && test.status === "expected" && test.results?.length === 1
          && test.results[0].status === "passed" && test.results[0].retry === 0, "NOT_PASSED");
        const id = digest([test.projectName, spec.file, spec.line, spec.column, titles, spec.title]);
        tests.push(id);
        if (test.projectName === "runtime-warmup") warmup.push(id);
        files.push(`${test.projectName}/${spec.file}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child, [...titles, child.title]);
  };
  for (const suite of report.suites) visit(suite, [suite.title]);
  return inventory(tests, warmup, files);
}

export function selectShardReceipts(receipts: ShardReceipt[], kind: Kind, identity: Identity): ShardReceipt[] {
  requireShard(kind === "server" || kind === "quality", "KIND");
  const lanes: readonly string[] = kind === "server" ? ["1", "2", "3"] : qualityLanes;
  const selected = new Map<string, ShardReceipt>();
  const seen = new Set<string>();
  for (const receipt of receipts) {
    requireShard(receipt.version === 1 && receipt.kind === kind && lanes.includes(receipt.lane), "LANE");
    sameIdentity(receipt.identity, identity);
    const key = `${receipt.lane}:${receipt.identity.attempt}`;
    requireShard(!seen.has(key), "LANES");
    seen.add(key);
    const previous = selected.get(receipt.lane);
    if (!previous || BigInt(receipt.identity.attempt) > BigInt(previous.identity.attempt)) selected.set(receipt.lane, receipt);
  }
  requireShard(selected.size === lanes.length, "LANES");
  return lanes.map((lane) => selected.get(lane)!);
}

export function readShardReceipts(directory: string, kind: Kind, identity: Identity): ShardReceipt[] {
  const receipts = readdirSync(directory).map((name) => {
    const folder = path.join(directory, name);
    requireShard(equal(readdirSync(folder), ["receipt.json"]), "ARTIFACTS");
    const text = readFileSync(path.join(folder, "receipt.json"), "utf8");
    const size = Buffer.byteLength(text, "utf8");
    requireShard(size > 0 && size <= 8 * 1024 * 1024, "SIZE");
    const receipt: ShardReceipt = JSON.parse(text);
    requireShard(name === `wiseeff-ci-${kind}-${receipt.identity.attempt}-${receipt.lane}`, "ARTIFACTS");
    return receipt;
  });
  return selectShardReceipts(receipts, kind, identity);
}

export function validateShardInventories(receipts: ShardReceipt[], kind: Kind, identity: Identity): Inventory {
  receipts = selectShardReceipts(receipts, kind, identity);
  const planned = receipts[0]?.inventory;
  requireShard(planned && Array.isArray(planned.tests) && planned.tests.length > 0, "EMPTY");
  for (const receipt of receipts) {
    requireShard(kind === "server" ? equal(receipt.inventory.files, planned.files) && equal(receipt.inventory.warmup, planned.warmup)
      : equal(receipt.inventory, planned), "PLAN_MISMATCH");
    if (kind === "server") requireShard(equal(receipt.inventory.tests, receipt.executed.tests), "COVERAGE");
    for (const entries of [receipt.inventory, receipt.executed]) {
      requireShard(Array.isArray(entries.tests) && entries.tests.length > 0 && entries.tests.every((id) => /^[a-f0-9]{64}$/.test(id)), "TESTS");
      requireShard(Array.isArray(entries.warmup) && new Set(entries.warmup).size === entries.warmup.length
        && entries.warmup.every((id) => entries.tests.filter((test) => test === id).length === 1), "WARMUP");
      requireShard(Array.isArray(entries.files) && entries.files.length > 0 && entries.files.every((file) => typeof file === "string")
        && new Set(entries.files).size === entries.files.length, "FILES");
    }
    requireShard(equal(receipt.executed.warmup, planned.warmup), "WARMUP");
  }
  requireShard(kind === "quality" ? planned.warmup.length > 0 : planned.warmup.length === 0, "WARMUP");
  const required = kind === "server" ? receipts.flatMap((receipt) => receipt.inventory.tests) : planned.tests;
  const executed = receipts.flatMap((receipt) => receipt.executed.tests.filter((id) => !planned.warmup.includes(id)));
  requireShard(equal(sorted(executed), sorted(required.filter((id) => !planned.warmup.includes(id)))), "COVERAGE");
  const files = receipts.flatMap((receipt) => receipt.executed.files);
  requireShard(equal(sorted([...new Set(files)]), planned.files), "FILES");
  if (kind === "server") requireShard(new Set(files).size === files.length, "FILE_OVERLAP");
  return kind === "server" ? { ...planned, tests: sorted(required) } : planned;
}

function receiptDirectory(): string {
  requireShard(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP), "TEMP");
  const directory = path.join(process.env.RUNNER_TEMP, "wiseeff-ci-shard");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}
function save(name: string, value: unknown) {
  writeFileSync(path.join(receiptDirectory(), name), JSON.stringify(value), { mode: 0o600, flag: "wx" });
}
function load(name: string): any {
  return JSON.parse(readFileSync(path.join(receiptDirectory(), name), "utf8"));
}

export function discoverServerInventory(identity: Identity): void {
  requireShard(/^[123]\/3$/.test(process.env.WISEEFF_CI_SERVER_SHARD ?? ""), "LANE");
  const startedAt = Date.now();
  const args = ["node_modules/vitest/vitest.mjs", "list", "--config", "vitest.server.config.ts"];
  const listed = JSON.parse(execFileSync(process.execPath, [...args, "--filesOnly", "--json"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
  requireShard(Array.isArray(listed) && listed.length > 0, "DISCOVERY_EMPTY");
  const files = listed.map((entry: { file: string }) => {
    requireShard(entry !== null && typeof entry.file === "string", "DISCOVERY_FILE");
    return relativeFile(entry.file, process.cwd());
  }).sort();
  const plan = balanceServerShards(files);
  const selected = plan[Number(process.env.WISEEFF_CI_SERVER_SHARD!.split("/")[0]) - 1];
  save("discovery.json", { identity, inventory: { tests: [], warmup: [], files }, owned: { files: selected.files } });
  console.log(`CI backend discovery: ${Date.now() - startedAt} ms; shard ${process.env.WISEEFF_CI_SERVER_SHARD}: ${selected.files.length}/${files.length} files, scheduling weight ${selected.durationMs} ms (not wall time).`);
}

export function serverShardFiles(): string[] {
  return load("discovery.json").owned.files.map((file: string) => path.resolve(file));
}

export function recordServerExecution(report: unknown, files: string[], native: NativeSummary, collection: Parameters<typeof vitestInventory>[0]): void {
  const discovery = load("discovery.json");
  requireShard(equal(discovery.identity, native.identity), "IDENTITY");
  const collected = vitestInventory(collection, process.cwd());
  const executed = vitestExecution(report, process.cwd());
  requireShard(equal(collected, executed) && equal(discovery.owned.files, collected.files)
    && equal(sorted(files.map((file) => relativeFile(file, process.cwd()))), executed.files), "COVERAGE");
  save("execution.json", { collected, executed, native });
}

export function finishServerReceipt(receipt: any, identity: Identity): void {
  const shard = process.env.WISEEFF_CI_SERVER_SHARD;
  requireShard(shard !== undefined && /^[123]\/3$/.test(shard), "LANE");
  const discovery = load("discovery.json");
  const execution = load("execution.json");
  requireShard(equal(discovery.identity, identity) && equal(execution.native, receipt.reports.server), "IDENTITY");
  save("receipt.json", { version: 1, kind: "server", lane: shard.split("/")[0],
    identity, inventory: { ...discovery.inventory, tests: execution.collected.tests }, executed: execution.executed, receipt } satisfies ShardReceipt);
}

async function runQuality() {
  const ci = await import(new URL("./ci-required-results.ts", import.meta.url).href);
  const identity: Identity = ci.currentIdentity();
  const lane = process.env.WISEEFF_QUALITY_LANE;
  requireShard(process.env.GITHUB_JOB === "acceptance-quality-lanes" && qualityLanes.includes(lane as typeof qualityLanes[number]), "LANE");
  const directory = receiptDirectory();
  const list = (name: string, selectedLane: string) => {
    const output = path.join(directory, name);
    execFileSync(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", "playwright.quality.config.ts", "--list", "--reporter=json"], {
      stdio: "inherit", env: { ...process.env, WISEEFF_QUALITY_LANE: selectedLane || undefined, PLAYWRIGHT_JSON_OUTPUT_FILE: output }
    });
    return playwrightInventory(JSON.parse(readFileSync(output, "utf8")), false);
  };
  const planned = list("planned.json", "");
  const owned = list("owned.json", lane!);
  const output = path.join(directory, "results.json");
  const result = spawnSync("npm", ["run", "acceptance:quality-run"], { stdio: "inherit", env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: output } });
  if (existsSync(output)) writeFileSync(path.join(process.env.WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR ?? "test-results/quality", "results.json"), readFileSync(output, "utf8"));
  requireShard(result.status === 0 && !result.error, "COMMAND_FAILED");
  const report = JSON.parse(readFileSync(output, "utf8"));
  const executed = playwrightInventory(report, true);
  requireShard(equal(owned, executed), "COVERAGE");
  save("receipt.json", { version: 1, kind: "quality", lane: lane!, identity, inventory: planned, executed, receipt: null } satisfies ShardReceipt);
  console.log(`CI quality ${lane}: ${executed.tests.length} passed, including ${executed.warmup.length} runtime warmup.`);
}

async function aggregate(kind: Kind) {
  requireShard(kind === "server" || kind === "quality", "KIND");
  const ci = await import(new URL("./ci-required-results.ts", import.meta.url).href);
  const identity: Identity = ci.currentIdentity();
  requireShard(process.env.GITHUB_JOB === (kind === "server" ? "l1-server" : "acceptance-quality"), "JOB");
  const selected = ci.assertShardJobs({ identity, needs: JSON.parse(process.env.EFF_NEEDS ?? "") }, kind);
  ci.writeOutput("identity", identity);
  if (!selected) {
    if (kind === "server") { ci.writeOutput("receipt", null); ci.writeOutput("shadow", null); }
    return;
  }
  requireShard(process.env.RUNNER_TEMP, "TEMP");
  const directory = path.join(process.env.RUNNER_TEMP, "wiseeff-ci-shards");
  const lanes: readonly string[] = kind === "server" ? ["1", "2", "3"] : qualityLanes;
  const receipts = readShardReceipts(directory, kind, identity);
  const planned = validateShardInventories(receipts, kind, identity);
  if (kind === "server") {
    for (const receipt of receipts) {
      ci.assertL1Receipt(receipt.receipt, "l1-server", identity);
      const native = (receipt.receipt as any).reports.server;
      requireShard(native.skipped === 0 && native.passed === receipt.executed.tests.length
        && native.files === receipt.executed.files.length, "COUNTERS");
    }
    const native: NativeSummary = { version: 1, command: "server", identity, passed: planned.tests.length, skipped: 0,
      files: planned.files.length, optionalSkips: {}, sha256: digest(receipts.map((receipt) => (receipt.receipt as any).reports.server.sha256)),
      filesSha256: digest(sorted(planned.files.map((file) => path.resolve(file)))) };
    const receipt = { ...(receipts[0].receipt as any), identity, reports: { server: native } };
    ci.writeOutput("receipt", receipt);
    ci.writeOutput("shadow", ci.runShadowAdapter(identity, "server", planned.files.map((file) => path.resolve(file)), native));
  }
  console.log(`CI ${kind}: ${lanes.length} complete lanes; ${planned.tests.length} registered tests covered exactly once (warmup repeated per quality lane).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, kind] = process.argv.slice(2);
  (mode === "quality" ? runQuality() : mode === "aggregate" ? aggregate(kind as Kind) : Promise.reject(new Error("CI_SHARD_COMMAND")))
    .catch((error) => { console.error(error instanceof Error && /^CI_[A-Z_]+$/.test(error.message) ? error.message : "CI_SHARD_REJECTED"); process.exitCode = 1; });
}
