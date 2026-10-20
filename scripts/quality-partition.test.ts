import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { consistencyReadOnlyRoutes } from "../e2e/quality/consistency-routes";
import { consistencyFixturePlan, parseQualityLane, qualityLanes, selectQualityProjects, shouldRegisterConsistencyFixture } from "../e2e/quality/quality-partition";
import { compactQualityRoutes } from "../e2e/quality/compact-routes";
import { playwrightInventory, validateShardInventories, type ShardReceipt } from "./ci-shard-results";
import type { Identity } from "./ci-required-results";
import { balanceAcceptanceShards } from "./acceptance-shard-plan";

type ListedSuite = {
  title: string;
  suites?: ListedSuite[];
  specs?: { file: string; title: string; tests: { projectName: string }[] }[];
};

function listRegistrations(lane?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, WISEEFF_ACCEPTANCE_OWNED_RUNTIME: "true", WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true" };
  delete env.WISEEFF_QUALITY_LANE;
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
  delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
  if (lane !== undefined) env.WISEEFF_QUALITY_LANE = lane;
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url)),
    "test", "--config", "playwright.quality.config.ts", "--list", "--reporter=json"
  ], { env, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return result;
}

function registrationKeys(output: string) {
  const report = JSON.parse(output) as { suites: ListedSuite[]; errors: unknown[] };
  expect(report.errors).toEqual([]);
  const keys: string[] = [];
  function visit(suites: ListedSuite[], parents: string[] = []) {
    for (const suite of suites) {
      const titles = [...parents, suite.title];
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) keys.push(JSON.stringify([test.projectName, spec.file, ...titles, spec.title]));
      }
      visit(suite.suites ?? [], titles);
    }
  }
  visit(report.suites);
  expect(keys.length).toBeGreaterThan(0);
  expect(new Set(keys).size).toBe(keys.length);
  return keys;
}

describe("quality partitions", () => {
  it("loads the same duration plan under plain Node strip-types", () => {
    const moduleUrl = new URL("../e2e/quality/quality-partition.ts", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval",
      `const { consistencyFixturePlan } = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(consistencyFixturePlan));`
    ], { encoding: "utf8", timeout: 30_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(consistencyFixturePlan);
  });

  it("assigns unknown stable fixture IDs exactly once with an order-independent fallback", () => {
    const registrations = Array.from({ length: 31 }, (_, index) => `/new-route-${index}?state=open (dark)`);
    const owners = (ids: string[]) => Object.fromEntries(ids.map((id) => {
      const lanes = qualityLanes.filter((lane) => shouldRegisterConsistencyFixture(lane, id));
      expect(lanes).toHaveLength(1);
      return [id, lanes[0]];
    }));
    expect(owners([...registrations].reverse())).toEqual(owners(registrations));
    expect(new Set(Object.values(owners(registrations))).size).toBe(2);
    expect(registrations.every((id) => shouldRegisterConsistencyFixture(undefined, id))).toBe(true);
    for (const lane of ["visual", "accessibility"] as const) {
      expect(registrations.some((id) => shouldRegisterConsistencyFixture(lane, id))).toBe(false);
    }
  });

  it("accepts only exact lane names, with an unset lane retaining the full suite", () => {
    expect(parseQualityLane(undefined)).toBeUndefined();
    for (const lane of qualityLanes) expect(parseQualityLane(lane)).toBe(lane);
    for (const value of ["", " ", "consistency", "consistency-3", "VISUAL", "visual "]) {
      expect(() => parseQualityLane(value)).toThrow("WISEEFF_QUALITY_LANE must be");
    }
  });

  it("keeps warmup in every lane, visual with optional compact, and accessibility with responsive", () => {
    const projects = ["runtime-warmup", "a11y", "visual", "consistency", "responsive", "compact"].map((name) => ({ name }));
    expect(selectQualityProjects(projects, undefined)).toEqual(projects);
    expect(selectQualityProjects(projects, "visual").map((project) => project.name))
      .toEqual(["runtime-warmup", "visual", "compact"]);
    expect(selectQualityProjects(projects, "accessibility").map((project) => project.name)).toEqual(["runtime-warmup", "a11y", "responsive"]);
    for (const lane of ["consistency-1", "consistency-2"] as const) {
      expect(selectQualityProjects(projects, lane).map((project) => project.name)).toEqual(["runtime-warmup", "consistency"]);
    }
    expect(selectQualityProjects(projects.filter((project) => project.name !== "compact"), "visual").map((project) => project.name))
      .toEqual(["runtime-warmup", "visual"]);
  });

  it("rejects unknown or unnamed project registrations before filtering any lane", () => {
    for (const lane of [undefined, ...qualityLanes]) {
      for (const project of [{ name: "future-project" }, { name: "" }, {}]) {
        expect(() => selectQualityProjects([{ name: "runtime-warmup" }, project], lane))
          .toThrow("Unknown quality project registration");
      }
    }
  });

  it.each([false, true])("covers the project union with compact registered: %s", (compactPresent) => {
    const projects = ["runtime-warmup", "visual", "consistency", "a11y", "responsive", ...(compactPresent ? ["compact"] : [])]
      .map((name) => ({ name }));
    const selected = qualityLanes.flatMap((lane) => selectQualityProjects(projects, lane).map((project) => project.name));
    expect([...new Set(selected)].sort()).toEqual(projects.map((project) => project.name).sort());
    for (const project of projects) {
      expect(selected.filter((name) => name === project.name)).toHaveLength(
        project.name === "runtime-warmup" ? 4 : project.name === "consistency" ? 2 : 1
      );
    }
    expect(selectQualityProjects(projects, "visual").some((project) => project.name === "compact")).toBe(compactPresent);
  });

  it("balances measured fixture durations exactly once, independent of input order", () => {
    const { fixtureDurationMs } = JSON.parse(readFileSync(
      new URL("../e2e/quality/consistency-durations.json", import.meta.url), "utf8",
    )) as { fixtureDurationMs: Record<string, number> };
    const ids = Object.keys(fixtureDurationMs);
    expect(consistencyFixturePlan.flatMap((shard) => shard.files).sort()).toEqual([...ids].sort());
    expect(balanceAcceptanceShards([...ids].reverse(), 2, fixtureDurationMs, 0)).toEqual(consistencyFixturePlan);
    expect(Math.abs(consistencyFixturePlan[0].durationMs - consistencyFixturePlan[1].durationMs))
      .toBeLessThanOrEqual(Math.max(...Object.values(fixtureDurationMs)));
    for (const [index, shard] of consistencyFixturePlan.entries()) {
      const lane = index === 0 ? "consistency-1" : "consistency-2";
      expect(ids.filter((id) => shouldRegisterConsistencyFixture(lane, id)).sort()).toEqual(shard.files);
      expect(shard.durationMs).toBe(shard.files.reduce((total, id) => total + fixtureDurationMs[id], 0));
    }
  });

  it("makes the real four-lane registration union equal the full suite, repeating only warmup", () => {
    const baseline = listRegistrations();
    expect(baseline.status, baseline.stderr).toBe(0);
    const unfiltered = registrationKeys(baseline.stdout);
    const warmup = unfiltered.filter((key) => JSON.parse(key)[0] === "runtime-warmup");
    expect(warmup.length).toBeGreaterThan(0);
    const titles = (keys: string[]) => keys.map((key) => JSON.parse(key).at(-1) as string);
    const routeTitles = consistencyReadOnlyRoutes.flatMap((route) => ["light", "dark"].map((theme) =>
      `asserts read-only UI consistency for ${route.path} (${theme})`));
    const homeTitles = ["light", "dark"].map((theme) => `asserts public home accessibility semantics (${theme})`);
    const bridgeTitles = ["/node-debugging", "/dts-reload"].flatMap((path) => ["light", "dark"].flatMap((theme) =>
      ["returning", "first-time", "pairing", "connected"].map((readiness) => `Bridge readiness on ${path}: ${readiness} (${theme})`)));
    expect(titles(unfiltered).filter((title) => title.startsWith("asserts read-only UI consistency")).sort())
      .toEqual(routeTitles.sort());
    expect(titles(unfiltered)).toEqual(expect.arrayContaining([...homeTitles, ...bridgeTitles]));
    for (const path of ["/knowledge-admin", "/log-admin", "/log-admin?tab=skills", "/log-admin?tab=quality"]) {
      expect(consistencyReadOnlyRoutes.map((route) => route.path)).toContain(path);
    }
    const compact = unfiltered.filter((key) => JSON.parse(key)[0] === "compact");
    expect(compact).toHaveLength(compactQualityRoutes.length * 2);
    const identity: Identity = {
      event: "pull_request", mode: "", fullAcceptance: false, ref: "refs/pull/1142/merge",
      base: "1".repeat(40), head: "2".repeat(40), sha: "3".repeat(40), tree: "4".repeat(40), repository: "tzrea1-Q/WiseEff", runId: "100", attempt: "1"
    };
    const inventory = playwrightInventory(JSON.parse(baseline.stdout), false);
    const receipts: ShardReceipt[] = [];
    const partitioned: string[] = [];
    for (const lane of qualityLanes) {
      const result = listRegistrations(lane);
      expect(result.status, result.stderr).toBe(0);
      const keys = registrationKeys(result.stdout);
      expect(keys.filter((key) => JSON.parse(key)[0] === "runtime-warmup")).toEqual(warmup);
      const tests = keys.filter((key) => JSON.parse(key)[0] !== "runtime-warmup");
      expect(tests.length).toBeGreaterThan(0);
      expect(keys.filter((key) => JSON.parse(key)[0] === "compact")).toEqual(lane === "visual" ? compact : []);
      const consistencyTitles = [...routeTitles, ...bridgeTitles, ...homeTitles,
        "aligns parameter toolbar actions across DTS and JSON views",
        "keeps multiline node read details complete and locally scrollable (UI fixture, no hardware proof)",
        "keeps long DTS string details and unchanged previews bounded (read-only response fixture)"];
      expect(titles(keys.filter((key) => JSON.parse(key)[1] === "consistency.quality.spec.ts")).sort())
        .toEqual(consistencyTitles.filter((id) => shouldRegisterConsistencyFixture(lane, id)).sort());
      expect(keys.filter((key) => JSON.parse(key)[1] === "styles.consistency.collector.spec.ts"))
        .toEqual(unfiltered.filter((key) => JSON.parse(key)[1] === "styles.consistency.collector.spec.ts"
          && shouldRegisterConsistencyFixture(lane, JSON.parse(key).at(-1))));
      receipts.push({ version: 1, kind: "quality", lane, identity, inventory,
        executed: playwrightInventory(JSON.parse(result.stdout), false), receipt: null });
      partitioned.push(...tests);
    }
    expect(new Set(partitioned).size).toBe(partitioned.length);
    const styleFixtures = unfiltered.filter((key) => JSON.parse(key)[1] === "styles.consistency.collector.spec.ts");
    expect(styleFixtures).toHaveLength(31);
    expect(partitioned.filter((key) => JSON.parse(key)[1] === "styles.consistency.collector.spec.ts").sort()).toEqual(styleFixtures.sort());
    expect(partitioned.sort()).toEqual(unfiltered.filter((key) => JSON.parse(key)[0] !== "runtime-warmup").sort());
    expect(validateShardInventories(receipts, "quality", identity)).toEqual(inventory);
    const missing = structuredClone(receipts);
    const missingId = missing[1].executed.tests.find((id) => !inventory.warmup.includes(id));
    missing[1].executed.tests = missing[1].executed.tests.filter((id) => id !== missingId);
    expect(() => validateShardInventories(missing, "quality", identity)).toThrow("COVERAGE");
    const duplicated = structuredClone(receipts);
    duplicated[2].executed.tests.push(duplicated[1].executed.tests.find((id) => !inventory.warmup.includes(id))!);
    expect(() => validateShardInventories(duplicated, "quality", identity)).toThrow("COVERAGE");
  });

  it("fails closed at the Playwright config boundary for an unknown lane", () => {
    const result = listRegistrations("unknown");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("WISEEFF_QUALITY_LANE must be");
  });
});
