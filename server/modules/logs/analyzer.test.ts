import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createRuleBasedLogAnalyzer } from "./analyzer";
import { parseLogText } from "./parser";

async function parseFixture() {
  const content = await readFile("test-fixtures/logs/charging-foldback.log");
  const parsed = parseLogText({ fileName: "charging-foldback.log", content });
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed;
}

describe("createRuleBasedLogAnalyzer", () => {
  it("reports thermal foldback fixture with stable evidence and actions", async () => {
    const analyzer = createRuleBasedLogAnalyzer();
    const parsed = await parseFixture();

    const report = await analyzer.analyze({ parsed, analysisQuestion: "Why did charging slow down?" });

    expect(["Warning", "Critical"]).toContain(report.severity);
    expect(report.confidence).toBe(0.85);
    expect(report.conclusion).toMatch(/thermal|foldback/i);
    expect(report.reportContext.analysisQuestion).toBe("Why did charging slow down?");
    expect(report.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleHit: "thermal-foldback",
          lineNumbers: [2, 3, 4]
        })
      ])
    );
    expect(report.suggestedActions.length).toBeGreaterThanOrEqual(2);
  });

  it("reports timeout and retry evidence as communication-timeout", async () => {
    const parsed = parseLogText({
      fileName: "timeout.log",
      content: Buffer.from("INFO request sent\nWARN timeout waiting for controller retry=1\n", "utf8")
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });

    expect(report.confidence).toBe(0.72);
    expect(report.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleHit: "communication-timeout", lineNumbers: [2] })])
    );
  });

  it("does not report charge-current reduction for request-only lines", async () => {
    const parsed = parseLogText({
      fileName: "request-only.log",
      content: Buffer.from("INFO charge request requested_ma=5000\n", "utf8")
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });

    expect(report.evidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleHit: "charge-current-reduction" })])
    );
  });

  it("reports charge-current reduction when requested and delivered current differ", async () => {
    const parsed = parseLogText({
      fileName: "current-reduction.log",
      content: Buffer.from("WARN charge_current_ma=3200 requested_ma=5000\n", "utf8")
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });

    expect(report.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleHit: "charge-current-reduction", lineNumbers: [1] })])
    );
  });

  it("reports offline and disconnect evidence as device-offline", async () => {
    const parsed = parseLogText({
      fileName: "offline.txt",
      content: Buffer.from("ERROR code=DEVICE_UNAVAILABLE device offline\nWARN disconnect detected\n", "utf8")
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });

    expect(report.confidence).toBe(0.85);
    expect(report.severity).toBe("Critical");
    expect(report.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleHit: "device-offline", lineNumbers: [1, 2] })])
    );
  });

  it("extracts machine-readable error codes with stable evidence lines", async () => {
    const parsed = parseLogText({
      fileName: "error-codes.log",
      content: Buffer.from(
        [
          "INFO controller started",
          "ERROR code=E_TIMEOUT module=modem detail=\"request timed out\"",
          "WARN retry=1",
          "ERROR code=DEVICE_UNAVAILABLE device offline"
        ].join("\n"),
        "utf8"
      )
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });

    expect(report.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleHit: "error-code",
          lineNumbers: [2, 4],
          inference: expect.stringMatching(/error code/i),
          suggestedAction: expect.stringMatching(/error code/i)
        })
      ])
    );
  });

  it("reports no findings with low confidence and a collect-more-context action", async () => {
    const parsed = parseLogText({
      fileName: "quiet.csv",
      content: Buffer.from("2026-05-25T10:00:00Z INFO session completed current_ma=1200\n", "utf8")
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });

    expect(report.severity).toBe("Info");
    expect(report.confidence).toBeLessThan(0.5);
    expect(report.evidence).toEqual([]);
    expect(report.suggestedActions.join(" ")).toMatch(/collect more context/i);
  });

  it("includes analysis question in context without inventing evidence lines", async () => {
    const parsed = parseLogText({
      fileName: "question.log",
      content: Buffer.from("INFO system ready\n", "utf8")
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    const report = await createRuleBasedLogAnalyzer().analyze({
      parsed,
      analysisQuestion: "Was there an E_TIMEOUT?"
    });

    expect(report.reportContext.analysisQuestion).toBe("Was there an E_TIMEOUT?");
    expect(report.evidence).toEqual([]);
  });
});
