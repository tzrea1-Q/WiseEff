import { describe, expect, it } from "vitest";
import { previewLogFormat } from "./formatPreview";
import { formatPreviewResponseSchema } from "./formatProfile";
import { logSkillTemplates } from "./skillTemplates";
import { parseLogText } from "./parser";

describe("basic format preview", () => {
  it.each(logSkillTemplates)("uses the unchanged runtime parser for $id", ({ spec }) => {
    const sampleText = "[ 12.345] <3> charger error\n  detail=one\n10-19 12:34:56.789 123 456 W Charger: temp=71\n2026-10-19T12:00:00Z INFO ready\n";
    const result = formatPreviewResponseSchema.parse(previewLogFormat({ sampleText, formatProfile: spec.formatProfile }));
    const parsed = parseLogText({ fileName: "sample.log", content: sampleText }, { profile: spec.formatProfile });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(result.entries.map(({ text, timestamp, severity, lineNumbers }) => ({ message: text, timestamp, severity, lineNumber: lineNumbers[0] })))
      .toEqual(parsed.entries.map(({ message, timestamp, severity, lineNumber }) => ({ message, timestamp, severity, lineNumber })));
  });

  it.each(["indent", "start-pattern"] as const)("shows per-line timestamps and severity with %s entry grouping", (mode) => {
    const result = previewLogFormat({ sampleText: "[12] ERROR bad\n  WARN detail\n\n[13] INFO next\n", formatProfile: {
      timestampPattern: "^\\[(\\d+)\\]", severityMap: { error: ["ERROR"], warn: ["WARN"] },
      multiline: mode === "indent" ? { mode } : { mode, startPattern: "^\\[" }
    } });
    expect(result.lines).toEqual([
      { line: 1, text: "[12] ERROR bad", timestamp: "12", severity: "error" },
      { line: 2, text: "  WARN detail", timestamp: undefined, severity: "warn" },
      { line: 3, text: "", timestamp: undefined, severity: "info" },
      { line: 4, text: "[13] INFO next", timestamp: "13", severity: "info" }
    ]);
    expect(result.entries).toEqual([
      { lineNumbers: [1, 2], text: "ERROR bad\nWARN detail", timestamp: "12", severity: "error" },
      { lineNumbers: [4], text: "INFO next", timestamp: "13", severity: "info" }
    ]);
  });

  it("rejects invalid formats and capped samples without changing runtime schema", () => {
    for (const formatProfile of [{ unknown: true }, { timestampPattern: "(?=x)" }, { multiline: { mode: "start-pattern" } }]) {
      expect(() => previewLogFormat({ sampleText: "x", formatProfile })).toThrow();
    }
    for (const sampleText of ["x\n".repeat(501), "x".repeat(6145), Array(500).fill("界".repeat(1000)).join("\n")]) {
      expect(() => previewLogFormat({ sampleText, formatProfile: {} })).toThrow();
    }
    expect(previewLogFormat({ sampleText: "", formatProfile: {} })).toEqual({ lines: [], entries: [] });
  });
});
