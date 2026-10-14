import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { consistencyReadOnlyRoutes, consistencyRoutes, selectConsistencyRoutes } from "../e2e/quality/consistency-routes";
import { parseQualityLane, qualityLanes, selectQualityProjects, shouldRegisterConsistencyFixture } from "../e2e/quality/quality-partition";
import { compactQualityRoutes } from "../e2e/quality/compact-routes";
import { playwrightInventory, validateShardInventories, type ShardReceipt } from "./ci-shard-results";
import type { Identity } from "./ci-required-results";

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
  it("assigns stylesheet fixtures exactly once across balanced consistency lanes", () => {
    const registrations = Array.from({ length: 31 }, (_, index) => index);
    const first = registrations.filter((index) => shouldRegisterConsistencyFixture("consistency-1", index));
    const second = registrations.filter((index) => shouldRegisterConsistencyFixture("consistency-2", index));
    expect(first[0]).toBe(0);
    expect(second[0]).toBe(1);
    expect([...first, ...second].sort((left, right) => left - right)).toEqual(registrations);
    expect(Math.abs(first.length - second.length)).toBeLessThanOrEqual(1);
    expect(registrations.every((index) => shouldRegisterConsistencyFixture(undefined, index))).toBe(true);
    for (const lane of ["visual", "accessibility"] as const) {
      expect(registrations.some((index) => shouldRegisterConsistencyFixture(lane, index))).toBe(false);
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

  it("auto-assigns 75 new route states deterministically with a balanced, disjoint complete union", () => {
    const additional = Array.from({ length: 75 }, (_, index) => ({
      ...consistencyReadOnlyRoutes[0],
      path: `${index < 15 ? "/parameters" : `/new-route-${Math.floor((index - 15) / 6)}`}?tab=${index % 3}&source=${index}`
    }));
    const routes = [...consistencyReadOnlyRoutes, ...additional];
    const partitions = (["consistency-1", "consistency-2"] as const).map((lane) => {
      const selected = selectConsistencyRoutes(lane, routes);
      expect(selected.map((route) => route.path).sort())
        .toEqual(selectConsistencyRoutes(lane, [...routes].reverse()).map((route) => route.path).sort());
      for (const route of selected) {
        const group = (candidate: typeof route) => candidate.path.split("?")[0] === route.path.split("?")[0];
        expect(selected.filter(group)).toEqual(routes.filter(group));
      }
      return selected;
    });
    const combined = partitions.flat().map((route) => route.path);
    expect(new Set(combined).size).toBe(routes.length);
    expect(combined.sort()).toEqual(routes.map((route) => route.path).sort());
    const largestGroup = Math.max(...routes.map((route) => routes.filter((candidate) =>
      candidate.path.split("?")[0] === route.path.split("?")[0]).length));
    expect(Math.abs(partitions[0].length - partitions[1].length)).toBeLessThanOrEqual(largestGroup);
  });

  it("covers every existing route and project variant exactly once in balanced, disjoint partitions", () => {
    const unfiltered = selectConsistencyRoutes(undefined);
    expect(unfiltered.map((route) => route.path)).toEqual([
      ...consistencyRoutes.map((route) => route.path),
      ...["atlas", "aurora", "nebula"].map((project) => `/parameters?project=${project}`)
    ]);
    const first = selectConsistencyRoutes("consistency-1");
    const second = selectConsistencyRoutes("consistency-2");
    const paths = [...first, ...second].map((route) => route.path);
    expect(new Set(paths).size).toBe(unfiltered.length);
    expect(paths.sort()).toEqual(unfiltered.map((route) => route.path).sort());
    expect(Math.abs(first.length - second.length)).toBeLessThanOrEqual(1);
    for (const selected of [first, second]) {
      for (const route of selected) {
        expect(selected.filter((candidate) => candidate.path.split("?")[0] === route.path.split("?")[0]))
          .toEqual(unfiltered.filter((candidate) => candidate.path.split("?")[0] === route.path.split("?")[0]));
      }
    }
    expect(selectConsistencyRoutes("visual")).toEqual([]);
    expect(selectConsistencyRoutes("accessibility")).toEqual([]);
  });

  it("assigns route groups independently of registration order without mutating inputs", () => {
    const routes = [...consistencyReadOnlyRoutes].reverse();
    const original = [...routes];
    for (const lane of ["consistency-1", "consistency-2"] as const) {
      expect(selectConsistencyRoutes(lane, routes).map((route) => route.path).sort())
        .toEqual(selectConsistencyRoutes(lane).map((route) => route.path).sort());
      expect(selectConsistencyRoutes(lane, [])).toEqual([]);
    }
    expect(routes).toEqual(original);
    expect(selectConsistencyRoutes("consistency-1", routes.slice(0, 1))).toEqual(routes.slice(0, 1));
    expect(selectConsistencyRoutes("consistency-2", routes.slice(0, 1))).toEqual([]);
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
      ["returning", "first-time", "connected"].map((readiness) => `Bridge readiness on ${path}: ${readiness} (${theme})`)));
    expect(titles(unfiltered).filter((title) => title.startsWith("asserts read-only UI consistency")).sort())
      .toEqual(routeTitles.sort());
    expect(titles(unfiltered)).toEqual(expect.arrayContaining([...homeTitles, ...bridgeTitles]));
    for (const path of ["/knowledge-admin", "/log-admin", "/log-admin?tab=domains", "/log-admin?tab=quality"]) {
      expect(consistencyReadOnlyRoutes.map((route) => route.path)).toContain(path);
    }
    const compact = unfiltered.filter((key) => JSON.parse(key)[0] === "compact");
    expect(compact).toHaveLength(compactQualityRoutes.length * 2);
    const identity: Identity = {
      event: "pull_request", mode: "", fullAcceptance: false, ref: "refs/pull/1142/merge",
      base: "1".repeat(40), head: "2".repeat(40), sha: "3".repeat(40), tree: "4".repeat(40), runId: "100", attempt: "1"
    };
    const inventory = playwrightInventory(JSON.parse(baseline.stdout), false);
    const receipts: ShardReceipt[] = [];
    const consistencyCounts: number[] = [];
    const partitioned: string[] = [];
    for (const lane of qualityLanes) {
      const result = listRegistrations(lane);
      expect(result.status, result.stderr).toBe(0);
      const keys = registrationKeys(result.stdout);
      expect(keys.filter((key) => JSON.parse(key)[0] === "runtime-warmup")).toEqual(warmup);
      const tests = keys.filter((key) => JSON.parse(key)[0] !== "runtime-warmup");
      expect(tests.length).toBeGreaterThan(0);
      expect(keys.filter((key) => JSON.parse(key)[0] === "compact")).toEqual(lane === "visual" ? compact : []);
      expect(titles(keys).filter((title) => title.startsWith("Bridge readiness on /"))).toEqual(lane === "consistency-1" ? bridgeTitles : []);
      expect(titles(keys).filter((title) => title.startsWith("asserts public home"))).toEqual(lane === "consistency-2" ? homeTitles : []);
      if (lane.startsWith("consistency-")) consistencyCounts.push(tests.length);
      receipts.push({ version: 1, kind: "quality", lane, identity, inventory,
        executed: playwrightInventory(JSON.parse(result.stdout), false), receipt: null });
      partitioned.push(...tests);
    }
    expect(new Set(partitioned).size).toBe(partitioned.length);
    const styleFixtures = unfiltered.filter((key) => JSON.parse(key)[1] === "styles.consistency.collector.spec.ts");
    expect(styleFixtures).toHaveLength(31);
    expect(partitioned.filter((key) => JSON.parse(key)[1] === "styles.consistency.collector.spec.ts").sort()).toEqual(styleFixtures.sort());
    expect(partitioned.sort()).toEqual(unfiltered.filter((key) => JSON.parse(key)[0] !== "runtime-warmup").sort());
    expect(Math.abs(consistencyCounts[0] - consistencyCounts[1])).toBeLessThanOrEqual(2);
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
