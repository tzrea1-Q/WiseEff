import { describe, expect, it } from "vitest";
import { parseLogText } from "./parser";
import { createLogFileReader } from "./fileReader";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { prefilterLogStream } from "./prefilter";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet, type AnalyzeLogInput } from "./analyzer";
import { createLlmLogAnalyzer } from "./analyzer/llmAnalyzer";
import { extractLogSignalsCooperatively } from "./genericSignals";
import { defaultChargingRuleSet } from "./chargingSignalRules";

describe("streaming analyzer parity beyond the preview", () => {
  it.each([
    ["ERROR unrelated subsystem\nkernel panic", defaultChargingRuleSet.hitDefaults.confidence],
    ["ERROR thermal foldback", 0.85]
  ])("only raises skill confidence for matched error evidence beyond the preview: %s", async (tail, confidence) => {
    const content = ["WARN thermal foldback", ...Array.from({ length: 399 }, () => "INFO healthy"), tail].join("\n");
    const full = parseLogText({ fileName: "test.log", content });
    const preview = parseLogText({ fileName: "test.log", content: content.split("\n").slice(0, 400).join("\n") });
    if (!full.ok || !preview.ok) throw new Error("Invalid fixture");
    const store = createMemoryObjectStore();
    const object = await store.put({ organizationId: "org", fileName: "test.log", contentType: "text/plain", bytes: Buffer.from(content) });
    const file = { path: "test.log", sizeBytes: content.length, encoding: "utf-8" as const, lossy: false,
      lineCount: full.rawLines.length, status: "analyzed" as const, skipReason: null, objectKey: object.storageKey };
    const reader = createLogFileReader(store, file);
    const prefilter = await prefilterLogStream(reader.entries(), defaultChargingRuleSet);
    const signalSummary = await extractLogSignalsCooperatively([{ path: file.path, reader }], defaultChargingRuleSet);
    const analyzer = createRuleBasedLogAnalyzer();
    const streamed = await analyzer.analyze({ parsed: preview, files: [{ ...file, parsed: preview, reader, prefilter }],
      signalRules: defaultChargingRuleSet, signalSummary, stats: { lineCount: full.rawLines.length, entryCount: full.entries.length } });
    expect(streamed).toEqual(await analyzer.analyze({ parsed: full, files: [{ ...file, parsed: full }], signalRules: defaultChargingRuleSet, signalSummary }));
    expect(streamed).toMatchObject({ confidence, conclusion: "Charging behavior is consistent with thermal foldback protection." });
  });

  it("includes real EOF anomalies in model excerpts and error-dependent fallback conclusions", async () => {
    const content = ["WARN early-warning", ...Array.from({ length: 399 }, () => "INFO healthy"), "ERROR tail-failure"].join("\n");
    const full = parseLogText({ fileName: "test.log", content });
    const preview = parseLogText({ fileName: "test.log", content: content.split("\n").slice(0, 400).join("\n") });
    if (!full.ok || !preview.ok) throw new Error("Invalid fixture");
    const signalRules = { ...genericSignalRuleSet, rules: [{ id: "early", anyOf: [{ type: "text" as const, pattern: "early-warning|tail-failure" }], stageId: "pattern" as const,
      inference: "Early warning", suggestedAction: "Inspect", analysis: { conclusion: { value: "Warning and error confirmed", priority: 1, requiresErrorEvidence: true }, suggestedActions: [] } }] };
    const store = createMemoryObjectStore();
    const object = await store.put({ organizationId: "org", fileName: "test.log", contentType: "text/plain", bytes: Buffer.from(content) });
    const file = { path: "test.log", sizeBytes: content.length, encoding: "utf-8" as const, lossy: false, lineCount: 401, status: "analyzed" as const,
      skipReason: null, objectKey: object.storageKey };
    const reader = createLogFileReader(store, file);
    const { objectKey: _objectKey, ...metadata } = file;
    const prefilter = await prefilterLogStream(reader.entries(), signalRules);
    const signalSummary = await extractLogSignalsCooperatively([{ path: file.path, reader }], signalRules);
    const streamed: AnalyzeLogInput = { parsed: preview, files: [{ ...metadata, parsed: preview, reader, prefilter }], signalRules, signalSummary, stats: { lineCount: 401, entryCount: 401 } };
    const analyzer = createRuleBasedLogAnalyzer();
    expect(await analyzer.analyze(streamed)).toEqual(await analyzer.analyze({ parsed: full, files: [{ ...file, parsed: full }], signalRules, signalSummary }));
    let mission = "";
    const llm = createLlmLogAnalyzer({ modelLabel: "scripted", tokenBudget: 8000, model: { async invoke(messages) {
      mission = messages[1].content;
      return { content: JSON.stringify({ conclusion: "Tail failure", impact: "Device", severity: "Warning", confidence: 0.8,
        suggestedActions: ["Inspect"], evidence: [{ filePath: "test.log", lineNumbers: [401], inference: "Tail", suggestedAction: "Inspect" }] }) };
    } } });
    expect(await llm.analyze(streamed)).toMatchObject({ analysisSource: "agent", evidence: [{ lineNumbers: [401] }], reportContext: { lineCount: 401 } });
    expect(mission).toContain('"test.log":L401: ERROR tail-failure');
    expect(mission).not.toContain("objectKey");
  });
});
