import { describe, expect, it } from "vitest";

import { parseLogText } from "./parser";
import { runLogPrefilter } from "./prefilter";

function parseFixture(content: string) {
  const parsed = parseLogText({ fileName: "fixture.log", content: Buffer.from(content, "utf8") });
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed;
}

describe("runLogPrefilter", () => {
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
