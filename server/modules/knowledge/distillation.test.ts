import { describe, expect, it } from "vitest";

import type { LogRecordDto } from "../logs/types";
import { buildLogDistillationDraft, LOG_DISTILLATION_TAG } from "./distillation";

function makeLog(overrides: Partial<LogRecordDto> = {}): LogRecordDto {
  return {
    id: "log-1",
    reportId: "report-run-1",
    fileName: "charging-timeout.log",
    source: "upload",
    fileSizeBytes: 2048,
    status: "complete",
    archiveState: "active",
    stage: "report",
    confidence: 87,
    conclusion: "快充后段降频源于电池温度超过 45 度触发降流保护",
    impact: "夜间快充整体时长增加约 25 分钟。",
    evidence: [
      {
        id: "evidence-1",
        stageId: "rootcause",
        lineNumbers: [2, 3],
        inference: "NTC 采样显示温度台阶式上升。",
        suggestedAction: "按 0.5A 步长下调快充电流。",
        ruleHit: "RULE-THERMAL-042"
      }
    ],
    suggestedActions: ["下调快充电流", "复核 NTC 采样间隔"],
    severity: "Critical",
    rawLines: ["boot ok", "temp=45.2C stage up", "current step down 0.5A"],
    capturedAt: "2026-08-12T02:00:00.000Z",
    updatedAt: "2026-08-12T02:10:00.000Z",
    submittedBy: "徐云",
    analysisQuestion: "为什么充电后段降频?",
    ...overrides
  };
}

describe("buildLogDistillationDraft", () => {
  it("titles the draft from the conclusion and seeds 日志分析 + severity tags", () => {
    const draft = buildLogDistillationDraft(makeLog());

    expect(draft.title).toBe("快充后段降频源于电池温度超过 45 度触发降流保护");
    expect(draft.tags).toEqual([LOG_DISTILLATION_TAG, "严重"]);
  });

  it("assembles the body from conclusion, impact, severity, evidence line references, and suggested actions", () => {
    const draft = buildLogDistillationDraft(makeLog());

    expect(draft.contentMarkdown).toContain("## 分析问题");
    expect(draft.contentMarkdown).toContain("为什么充电后段降频?");
    expect(draft.contentMarkdown).toContain("## 结论");
    expect(draft.contentMarkdown).toContain("快充后段降频源于电池温度超过 45 度触发降流保护");
    expect(draft.contentMarkdown).toContain("## 影响");
    expect(draft.contentMarkdown).toContain("夜间快充整体时长增加约 25 分钟。");
    expect(draft.contentMarkdown).toContain("严重(Critical)· 置信度 87%");
    expect(draft.contentMarkdown).toContain("### 证据 01 · 行 2, 3");
    expect(draft.contentMarkdown).toContain("> `#2 temp=45.2C stage up`");
    expect(draft.contentMarkdown).toContain("> `#3 current step down 0.5A`");
    expect(draft.contentMarkdown).toContain("**推断**:NTC 采样显示温度台阶式上升。");
    expect(draft.contentMarkdown).toContain("**处置**:按 0.5A 步长下调快充电流。");
    expect(draft.contentMarkdown).toContain("- 下调快充电流");
    expect(draft.contentMarkdown).toContain("- 复核 NTC 采样间隔");
    expect(draft.contentMarkdown).toContain("charging-timeout.log");
  });

  it("never leaks analyzer internals: rule ids stay out of the draft", () => {
    const draft = buildLogDistillationDraft(makeLog());

    expect(draft.contentMarkdown).not.toContain("RULE-THERMAL-042");
  });

  it("caps the title at 200 characters and falls back to the file name when the conclusion is empty", () => {
    const long = buildLogDistillationDraft(makeLog({ conclusion: "长".repeat(300) }));
    expect(long.title).toHaveLength(200);

    const empty = buildLogDistillationDraft(makeLog({ conclusion: "  " }));
    expect(empty.title).toBe("日志分析:charging-timeout.log");
  });

  it("marks out-of-range evidence line references instead of throwing", () => {
    const draft = buildLogDistillationDraft(
      makeLog({
        evidence: [
          {
            id: "evidence-oob",
            stageId: "parse",
            lineNumbers: [99],
            inference: "越界证据。",
            suggestedAction: "复查行号。"
          }
        ]
      })
    );

    expect(draft.contentMarkdown).toContain("> `#99`（原始日志行不可用）");
  });

  it("omits the question, evidence, and suggested-action sections when absent", () => {
    const draft = buildLogDistillationDraft(
      makeLog({ analysisQuestion: undefined, evidence: [], suggestedActions: [] })
    );

    expect(draft.contentMarkdown).not.toContain("## 分析问题");
    expect(draft.contentMarkdown).not.toContain("## 证据(行引用)");
    expect(draft.contentMarkdown).not.toContain("## 建议处置");
  });
});
