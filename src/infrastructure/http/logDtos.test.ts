import { describe, expect, it } from "vitest";

import {
  confidencePercentFromDto,
  jobSnapshotFromDto,
  logListFromDto,
  logRecordFromDto,
  type LogJobDto,
  type LogRecordDto
} from "./logDtos";

const baseLogDto: LogRecordDto = {
  id: "log-1",
  reportId: "report-1",
  fileName: "pack-controller.log",
  source: "upload",
  fileSizeBytes: 1_572_864,
  status: "complete",
  archiveState: "active",
  stage: "report",
  confidence: 0.91,
  conclusion: "Charge current derated after thermal warning.",
  impact: "Fast charge throughput reduced.",
  evidence: [
    {
      id: "ev-1",
      stageId: "pattern",
      lineNumbers: [12, 13, 21],
      inference: "Thermal warnings cluster before derating.",
      suggestedAction: "Check pack coolant loop.",
      ruleHit: "thermal-derate"
    }
  ],
  suggestedActions: ["Inspect coolant loop"],
  severity: "Warning",
  rawLines: ["12 WARN temp=74", "13 WARN temp=75", "21 INFO derate=1"],
  capturedAt: "2026-05-25T02:00:00.000Z",
  updatedAt: "2026-05-25T02:05:00.000Z",
  submittedBy: "Xu Yun",
  relatedParameterId: "fast-charge-current",
  relatedParameterPin: {
    kind: "canonical-pin",
    bindingId: "fast-charge-current",
    definitionRevisionId: "drev-fast-charge"
  },
  device: "BMS-A",
  analysisQuestion: "Why did current drop?"
};

describe("log http dto mappers", () => {
  it("maps backend complete status to frontend Complete", () => {
    expect(logRecordFromDto(baseLogDto)).toMatchObject({
      id: "log-1",
      status: "Complete",
      archiveState: "active",
      fileSizeMB: 1.5,
      relatedParameterId: "fast-charge-current",
      updatedAtIso: "2026-05-25T02:05:00.000Z"
    });
  });

  it("maps archived backend logs to frontend archiveState", () => {
    const archived = logRecordFromDto({ ...baseLogDto, archiveState: "archived" });

    expect(archived.archiveState).toBe("archived");
  });

  it("maps backend failed status to frontend Failed and keeps failureReason", () => {
    const failed = logRecordFromDto({
      ...baseLogDto,
      status: "failed",
      failureReason: "Unsupported encoding."
    });

    expect(failed.status).toBe("Failed");
    expect(failed.failureReason).toBe("Unsupported encoding.");
  });

  it("normalizes analyzer ratio confidence to percent", () => {
    expect(confidencePercentFromDto(0.85)).toBe(85);
    expect(confidencePercentFromDto(0.856)).toBe(86);
    expect(confidencePercentFromDto(0)).toBe(0);
    expect(confidencePercentFromDto(1)).toBe(100);
  });

  it("keeps confidence values that are already percentages", () => {
    expect(confidencePercentFromDto(92)).toBe(92);
    expect(confidencePercentFromDto(100)).toBe(100);
  });

  it("maps record confidence through the percent normalization", () => {
    expect(logRecordFromDto(baseLogDto).confidence).toBe(91);
    expect(logRecordFromDto({ ...baseLogDto, confidence: 88 }).confidence).toBe(88);
  });

  it("preserves evidence line numbers and raw lines exactly", () => {
    const log = logRecordFromDto(baseLogDto);

    expect(log.evidence[0].lineNumbers).toEqual([12, 13, 21]);
    expect(log.rawLines).toEqual(["12 WARN temp=74", "13 WARN temp=75", "21 INFO derate=1"]);
  });

  it("maps backend job payload to a log job snapshot", () => {
    const dto: LogJobDto = {
      id: "job-1",
      kind: "log-analysis",
      logId: "log-1",
      runId: "run-1",
      status: "processing",
      progress: 55,
      currentStage: "rootcause",
      error: null,
      updatedAt: "2026-05-25T02:06:00.000Z"
    };

    expect(jobSnapshotFromDto(dto)).toEqual(dto);
  });

  it("unwraps log list response items", () => {
    expect(logListFromDto({ items: [baseLogDto] })).toHaveLength(1);
    expect(logListFromDto({ items: [baseLogDto] })[0].status).toBe("Complete");
  });
});
