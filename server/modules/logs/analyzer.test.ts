import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createRuleBasedLogAnalyzer, genericSignalRuleSet } from "./analyzer";
import { parseLogText } from "./parser";
import { defaultChargingRuleSet, seededChargingRuleSet } from "./chargingSignalRules";

async function parseFixture() {
  const content = await readFile("test-fixtures/logs/charging-foldback.log");
  const parsed = parseLogText({ fileName: "charging-foldback.log", content });
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed;
}

describe("createRuleBasedLogAnalyzer", () => {
  it.each([defaultChargingRuleSet, seededChargingRuleSet])("does not treat normal telemetry or retry settings as charging faults", async (signalRules) => {
    const content = Array.from({ length: 216 }, (_, index) =>
      `INFO battery_temp=${25 + index % 10} charge_current_ma=3000 requested_ma=3000 thermal_limit=45 timeout_ms=500 retry=0 disconnect_count=0`).join("\n");
    const parsed = parseLogText({ fileName: "telemetry.log", content });
    if (!parsed.ok) throw new Error(parsed.reason);
    const report = await createRuleBasedLogAnalyzer().analyze({ parsed, signalRules });
    expect(report.evidence).toEqual([]);
    expect(report.conclusion).toBe("未发现符合已知规则的异常。");
  });

  it("returns Chinese fallback conclusions, impact, evidence and actions without internal rule IDs", async () => {
    const parsed = await parseFixture();
    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });
    expect(report.conclusion).toBe("充电表现符合过热保护降额特征。");
    expect(report.evidence).toContainEqual(expect.objectContaining({
      ruleHit: "thermal-foldback", lineNumbers: [3, 4], inference: "过热保护降低了充电输出。"
    }));
    const text = [report.conclusion, report.impact, ...report.suggestedActions,
      ...report.evidence.flatMap((item) => [item.inference, item.suggestedAction])];
    expect(text.every((value) => /[\u4e00-\u9fff]/.test(value))).toBe(true);
    expect(text.join(" ")).not.toMatch(/[A-Za-z]/);
  });

  it.each(["WARN thermal foldback active", "WARN battery_temp=52 exceeds limit", "WARN thermal derating active",
    "ERROR code=THERMAL_FOLDBACK", "WARN charge output derated"])("retains explicit foldback and derating evidence: %s", async (content) => {
    const parsed = parseLogText({ fileName: "foldback.log", content });
    if (!parsed.ok) throw new Error(parsed.reason);
    const report = await createRuleBasedLogAnalyzer().analyze({ parsed, signalRules: seededChargingRuleSet });
    expect(report.evidence).toContainEqual(expect.objectContaining({ ruleHit: "thermal-foldback", lineNumbers: [1] }));
  });

  it.each(['{"level":"error","message":"controller timeout"}', '{"level":"info","msg":"scheduling retry","backoff_s":300}', "ERROR timeout.", "WARN retry=1", "WARN retrying request", "ERROR timeout waiting for controller",
    "ERROR request timed out", "ERROR code=E_TIMEOUT"])("retains actual timeout and retry evidence: %s", async (content) => {
    const parsed = parseLogText({ fileName: "timeout.log", content });
    if (!parsed.ok) throw new Error(parsed.reason);
    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });
    expect(report.evidence).toContainEqual(expect.objectContaining({ ruleHit: "communication-timeout", lineNumbers: [1] }));
  });

  it("does not report thermal foldback for ordinary charge-controller telemetry", async () => {
    const parsed = parseLogText({ fileName: "telemetry.log", content: "charge_ctrl: soc=40% ibus=2.95A battery_temp=40.2C" });
    if (!parsed.ok) throw new Error(parsed.reason);
    const report = await createRuleBasedLogAnalyzer().analyze({ parsed, signalRules: seededChargingRuleSet });
    expect(report.evidence).toEqual([]);
  });

  it("does not interpret a zero JSON retry counter as an actual retry", async () => {
    const parsed = parseLogText({ fileName: "telemetry.json", content: '{"soc":40,"battery_temp":40.2,"retry":0}' });
    if (!parsed.ok) throw new Error(parsed.reason);
    const report = await createRuleBasedLogAnalyzer().analyze({ parsed, signalRules: seededChargingRuleSet });
    expect(report.evidence).toEqual([]);
  });
  it("keeps generic errors supplementary without upgrading the pinned thermal conclusion's confidence", async () => {
    const parsed = parseLogText({ fileName: "charging.log", content: "WARN thermal foldback\nERROR unrelated subsystem\nkernel panic" });
    if (!parsed.ok) throw new Error(parsed.reason);
    const report = await createRuleBasedLogAnalyzer().analyze({ parsed, signalRules: defaultChargingRuleSet });
    expect(report).toMatchObject({ conclusion: "充电表现符合过热保护降额特征。",
      confidence: defaultChargingRuleSet.hitDefaults.confidence, severity: "Warning" });
    expect(report.evidence.map((item) => item.ruleHit)).toEqual(["thermal-foldback", "generic:first-error", "generic:crash"]);
  });
  it("does not activate a skill rule whose id collides with a generic signal", async () => {
    const parsed = parseLogText({ fileName: "panic.log", content: "kernel panic" });
    if (!parsed.ok) throw new Error(parsed.reason);
    const report = await createRuleBasedLogAnalyzer().analyze({ parsed, signalRules: { ...genericSignalRuleSet, rules: [{
      id: "generic:crash", anyOf: [{ type: "text", pattern: "only-this-matches" }], stageId: "rootcause", inference: "Unmatched skill",
      suggestedAction: "Unmatched action", analysis: { conclusion: { value: "Unmatched conclusion", priority: 1 },
        confidence: { value: 1, priority: 1 }, suggestedActions: [] }
    }] } });
    expect(report.conclusion).toBe(genericSignalRuleSet.hitDefaults.conclusion);
    expect(report.confidence).toBe(0.55);
    expect(report.evidence).toMatchObject([{ ruleHit: "generic:crash", lineNumbers: [1], inference: "检测到内核崩溃（Kernel panic）" }]);
  });
  it("reports thermal foldback fixture with stable evidence and actions", async () => {
    const analyzer = createRuleBasedLogAnalyzer();
    const parsed = await parseFixture();

    const report = await analyzer.analyze({ parsed, analysisQuestion: "Why did charging slow down?" });

    expect(["Warning", "Critical"]).toContain(report.severity);
    expect(report.confidence).toBe(0.85);
    expect(report.conclusion).toMatch(/过热|降额/);
    expect(report.reportContext.analysisQuestion).toBe("Why did charging slow down?");
    expect(report.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleHit: "thermal-foldback",
          lineNumbers: [3, 4]
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

  it("does not report charge-current reduction for generic foldback lines", async () => {
    const parsed = parseLogText({
      fileName: "foldback.log",
      content: Buffer.from("WARN controller entered foldback mode reason=policy\n", "utf8")
    });
    if (!parsed.ok) throw new Error(parsed.reason);

    const report = await createRuleBasedLogAnalyzer().analyze({ parsed });

    expect(report.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleHit: "thermal-foldback", lineNumbers: [1] })])
    );
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
          inference: expect.stringMatching(/错误码/),
          suggestedAction: expect.stringMatching(/错误码/)
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
    expect(report.suggestedActions.join(" ")).toMatch(/收集/);
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
