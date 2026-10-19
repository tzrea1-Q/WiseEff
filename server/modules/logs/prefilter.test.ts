import { describe, expect, it } from "vitest";

import { parseLogText } from "./parser";
import { createPrefilterBudget, prefilterLogStream, runLogPrefilter } from "./prefilter";

function parseFixture(content: string) {
  const parsed = parseLogText({ fileName: "fixture.log", content: Buffer.from(content, "utf8") });
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed;
}

describe("runLogPrefilter", () => {
  it("shares retained reference/code budgets across file streams while counting all entries", async () => {
    const budget = { references: 10, codes: 2, codeBytes: 2048 };
    const entries = parseFixture(Array.from({ length: 30 }, (_, i) => `ERROR code=${i}-${"x".repeat(1000)}`).join("\n")).entries;
    const first = await prefilterLogStream((async function* () { yield* entries; })(), undefined, budget);
    const second = await prefilterLogStream((async function* () { yield* entries; })(), undefined, budget);
    expect(first.severityCounts.error).toBe(30); expect(second.severityCounts.error).toBe(30);
    expect(first.truncated).toBe(true); expect(second.truncated).toBe(true);
    expect(first.errorCodeStats).toHaveLength(2); expect(second.errorCodeStats).toHaveLength(0);
    expect(first.errorCodeStats.every((stat) => stat.code.length < 300)).toBe(true);
    expect(budget.references).toBe(0); expect(budget.codes).toBe(0);
    expect(createPrefilterBudget().references).toBeGreaterThan(0);
  });
  it("collects rule evidence, anomaly lines, error-code stats, and severity counts", () => {
    const parsed = parseFixture(
      [
        "2026-05-25T10:00:00Z INFO session started",
        "2026-05-25T10:00:01Z WARN thermal foldback engaged battery_temp=52C",
        "2026-05-25T10:00:02Z ERROR charge fault code=E_THERMAL_FOLDBACK",
        "2026-05-25T10:00:03Z INFO heartbeat ok"
      ].join("\n")
    );

    const findings = runLogPrefilter(parsed.entries);

    expect(findings.ruleHits).toContain("thermal-foldback");
    expect(findings.ruleHits).toContain("error-code");
    expect(findings.anomalyLineNumbers).toContain(2);
    expect(findings.anomalyLineNumbers).toContain(3);
    expect(findings.errorCodeStats).toEqual([{ code: "E_THERMAL_FOLDBACK", count: 1, lineNumbers: [3] }]);
    expect(findings.severityCounts).toEqual({ error: 1, warn: 1, info: 2 });
  });

  it("returns empty findings for a nominal log", () => {
    const parsed = parseFixture("2026-05-25T10:00:00Z INFO all good\n2026-05-25T10:00:01Z INFO still good");

    const findings = runLogPrefilter(parsed.entries);

    expect(findings.evidence).toEqual([]);
    expect(findings.ruleHits).toEqual([]);
    expect(findings.anomalyLineNumbers).toEqual([]);
    expect(findings.errorCodeStats).toEqual([]);
  });
});
