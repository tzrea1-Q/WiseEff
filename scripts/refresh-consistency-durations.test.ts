import { describe, expect, it } from "vitest";
import { consistencyDurationsFromReports } from "./refresh-consistency-durations";

function report(title: string, durations: number[], file = "e2e/quality/consistency.quality.spec.ts") {
  return { suites: [{ suites: [{ specs: [{ title, file, tests: [{ projectName: "consistency",
    results: durations.map((duration, index) => ({ status: index === 0 ? "failed" : "passed", duration }))
  }] }] }] }] };
}

describe("consistency duration refresh", () => {
  it("combines nested per-lane reports by stable title, sums retries, and excludes other specs/projects and skipped tests", () => {
    const first = report("/route?state=open (light)", [40, 60]);
    const second = report("/route?state=open (dark)", [80]);
    const skipped = report("skipped", [0]);
    skipped.suites[0].suites[0].specs[0].tests[0].results[0].status = "skipped";
    const visual = report("visual", [500]);
    visual.suites[0].suites[0].specs[0].tests[0].projectName = "visual";
    const inputs = [first, second, skipped, visual, report("collector", [18], "styles.consistency.collector.spec.ts")];
    const expected = { "/route?state=open (dark)": 80, "/route?state=open (light)": 100 };
    expect(consistencyDurationsFromReports(inputs)).toEqual(expected);
    expect(Object.keys(consistencyDurationsFromReports([...inputs].reverse()))).toEqual(Object.keys(expected));
  });

  it("rejects empty, duplicate and invalid measurements before replacing the snapshot", () => {
    const valid = report("/route (light)", [10]);
    for (const reports of [[], [null], [{ suites: [] }], [valid, valid], [report("bad", [-1])],
      [report("bad", [NaN])], [report("bad", [Infinity])]]) {
      expect(() => consistencyDurationsFromReports(reports)).toThrow("Invalid consistency duration report");
    }
  });

  it("refreshes the snapshot through the documented CLI and preserves it on invalid input", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "consistency-durations-"));
    try {
      mkdirSync(path.join(root, "scripts"));
      mkdirSync(path.join(root, "e2e/quality"), { recursive: true });
      const script = path.join(root, "scripts/refresh-consistency-durations.ts");
      copyFileSync(new URL("./refresh-consistency-durations.ts", import.meta.url), script);
      const first = path.join(root, "first.json");
      const second = path.join(root, "second.json");
      writeFileSync(first, JSON.stringify(report("/route (light)", [10])));
      writeFileSync(second, JSON.stringify(report("/route (dark)", [20])));
      execFileSync(process.execPath, ["--experimental-strip-types", script, first, second], { stdio: "pipe" });
      const snapshot = path.join(root, "e2e/quality/consistency-durations.json");
      const saved = readFileSync(snapshot, "utf8");
      expect(JSON.parse(saved)).toMatchObject({ fixtureDurationMs: { "/route (dark)": 20, "/route (light)": 10 } });
      const invalid = spawnSync(process.execPath, ["--experimental-strip-types", script, first, first], { encoding: "utf8" });
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toContain("Invalid consistency duration report");
      expect(readFileSync(snapshot, "utf8")).toBe(saved);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
