import { describe, expect, it } from "vitest";
import { reducer } from "./App";
import { initialState, SEVERITY_LABELS, STAGE_LABELS, type LogSeverity, type LogStageId } from "./mockData";

describe("log mockData · label 常量", () => {
  it("STAGE_LABELS 覆盖所有 LogStageId 且为中文", () => {
    const stageIds: LogStageId[] = ["parse", "pattern", "rootcause", "report"];

    for (const id of stageIds) {
      expect(STAGE_LABELS[id]).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it("SEVERITY_LABELS 覆盖所有 LogSeverity 且为中文", () => {
    const severities: LogSeverity[] = ["Critical", "Warning", "Info"];

    for (const severity of severities) {
      expect(SEVERITY_LABELS[severity]).toMatch(/[\u4e00-\u9fa5]/);
    }
  });
});

describe("log mockData · 新增字段契约", () => {
  it.each(initialState.logs.map((log) => [log.id, log]))("%s 具备 severity/rawLines/capturedAt", (_id, log) => {
    expect(["Critical", "Warning", "Info"]).toContain(log.severity);
    expect(Array.isArray(log.rawLines)).toBe(true);
    expect(typeof log.capturedAt).toBe("string");
  });

  it("log-active 提供 relatedParameterId=aurora-battery-temp-target", () => {
    const log = initialState.logs.find((item) => item.id === "log-active");

    expect(log?.relatedParameterId).toBe("aurora-battery-temp-target");
  });

  it("log-failed 提供 failureReason", () => {
    const log = initialState.logs.find((item) => item.id === "log-failed");

    expect(log?.failureReason).toMatch(/格式不支持|二进制/);
  });
});

describe("log mockData · stage 使用 LogStageId", () => {
  it("每条 log 的 stage 都是 LogStageId", () => {
    const ids = new Set<LogStageId>(["parse", "pattern", "rootcause", "report"]);

    for (const log of initialState.logs) {
      expect(ids.has(log.stage as LogStageId)).toBe(true);
    }
  });
});

describe("log mockData · evidence 已结构化", () => {
  it("每条 evidence 包含 id/stageId/lineNumbers/inference/suggestedAction", () => {
    for (const log of initialState.logs) {
      for (const evidence of log.evidence) {
        expect(typeof evidence.id).toBe("string");
        expect(["parse", "pattern", "rootcause", "report"]).toContain(evidence.stageId);
        expect(Array.isArray(evidence.lineNumbers)).toBe(true);
        expect(evidence.lineNumbers.length).toBeGreaterThan(0);
        expect(typeof evidence.inference).toBe("string");
        expect(typeof evidence.suggestedAction).toBe("string");
      }
    }
  });

  it("每条 evidence.lineNumbers 都落在 rawLines 范围内", () => {
    for (const log of initialState.logs) {
      for (const evidence of log.evidence) {
        for (const lineNumber of evidence.lineNumbers) {
          expect(lineNumber).toBeGreaterThanOrEqual(1);
          expect(lineNumber).toBeLessThanOrEqual(log.rawLines.length);
        }
      }
    }
  });

  it("上传后 state.logs 仍满足 evidence lineNumbers 不越界", () => {
    const states = [
      reducer(initialState, { type: "SIMULATE_LOG_UPLOAD", fileName: "fresh.log", supported: true }),
      reducer(initialState, { type: "SIMULATE_LOG_UPLOAD", fileName: "fresh.bin", supported: false })
    ];

    for (const state of states) {
      for (const log of state.logs) {
        for (const evidence of log.evidence) {
          for (const lineNumber of evidence.lineNumbers) {
            expect(lineNumber).toBeGreaterThanOrEqual(1);
            expect(lineNumber).toBeLessThanOrEqual(log.rawLines.length);
          }
        }
      }
    }
  });
});
