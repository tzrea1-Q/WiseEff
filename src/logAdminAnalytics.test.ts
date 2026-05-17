import { describe, expect, it } from "vitest";
import { canAccessPage } from "./app/permissions";
import * as logAdminAnalytics from "./logAdminAnalytics";
import { applyTableFilters, applyTimeWindow, deriveInsight, deriveMetrics } from "./logAdminAnalytics";
import type { LogRecord } from "./mockData";

describe("log admin role policy compatibility", () => {
  it("uses Admin-only page access for log admin", () => {
    expect(canAccessPage("admin", "log-admin")).toBe(true);
    expect(canAccessPage("committer", "log-admin")).toBe(false);
    expect(canAccessPage("user", "log-admin")).toBe(false);
    expect(canAccessPage("guest", "log-admin")).toBe(false);
  });

  it("does not expose a private log admin role helper", () => {
    expect((logAdminAnalytics as Record<string, unknown>).deriveLogAdminRole).toBeUndefined();
  });
});

function mkLog(id: string, minutesAgo: number, base: number): LogRecord {
  return {
    id,
    reportId: `RPT-${id}`,
    fileName: `${id}.log`,
    projectId: "aurora",
    source: "Test",
    fileSizeMB: 1,
    status: "Complete",
    stage: "report",
    confidence: 90,
    conclusion: "",
    impact: "",
    evidence: [],
    suggestedActions: [],
    severity: "Info",
    rawLines: [],
    capturedAt: "",
    updatedAt: "",
    updatedAtIso: new Date(base - minutesAgo * 60_000).toISOString(),
    submittedBy: "test"
  };
}

describe("applyTimeWindow", () => {
  const now = new Date(2026, 4, 10, 12, 0, 0).getTime();
  const fakeNow = new Date(now);

  it("today includes logs from today's 00:00 onward", () => {
    const logs = [
      mkLog("t-5", 5, now),
      mkLog("t-780", 780, now),
      mkLog("t-2days", 2 * 24 * 60, now)
    ];

    const result = applyTimeWindow(logs, "today", fakeNow);

    expect(result.map((log) => log.id)).toEqual(["t-5"]);
  });

  it("7d includes logs within last 7 days", () => {
    const logs = [mkLog("today", 5, now), mkLog("d6", 6 * 24 * 60, now), mkLog("d8", 8 * 24 * 60, now)];

    const result = applyTimeWindow(logs, "7d", fakeNow);

    expect(result.map((log) => log.id).sort()).toEqual(["d6", "today"]);
  });

  it("30d includes logs within last 30 days", () => {
    const logs = [mkLog("d29", 29 * 24 * 60, now), mkLog("d31", 31 * 24 * 60, now)];

    const result = applyTimeWindow(logs, "30d", fakeNow);

    expect(result.map((log) => log.id)).toEqual(["d29"]);
  });

  it("returns empty array when no logs match", () => {
    const logs = [mkLog("d100", 100 * 24 * 60, now)];

    const result = applyTimeWindow(logs, "today", fakeNow);

    expect(result).toEqual([]);
  });

  it("handles today edge case where log at 00:00 exactly is included", () => {
    const logs = [
      {
        ...mkLog("edge", 0, now),
        updatedAtIso: new Date(2026, 4, 10, 0, 0, 0).toISOString()
      }
    ];

    const result = applyTimeWindow(logs, "today", fakeNow);

    expect(result).toHaveLength(1);
  });

  it("uses the local calendar day for today boundaries", () => {
    const localNow = new Date(2026, 4, 11, 8, 0, 0);
    const logs = [
      {
        ...mkLog("local-0030", 0, localNow.getTime()),
        updatedAtIso: new Date(2026, 4, 11, 0, 30, 0).toISOString()
      },
      {
        ...mkLog("previous-2359", 0, localNow.getTime()),
        updatedAtIso: new Date(2026, 4, 10, 23, 59, 0).toISOString()
      }
    ];

    const result = applyTimeWindow(logs, "today", localNow);

    expect(result.map((log) => log.id)).toEqual(["local-0030"]);
  });
});

function mkFullLog(overrides: Partial<LogRecord>): LogRecord {
  return {
    id: "x",
    reportId: "RPT-X",
    fileName: "x.log",
    projectId: "aurora",
    source: "Test",
    fileSizeMB: 1,
    status: "Complete",
    stage: "report",
    confidence: 80,
    conclusion: "",
    impact: "",
    evidence: [],
    suggestedActions: [],
    severity: "Info",
    rawLines: [],
    capturedAt: "",
    updatedAt: "",
    updatedAtIso: new Date().toISOString(),
    submittedBy: "u",
    ...overrides
  };
}

describe("applyTableFilters", () => {
  const rows: LogRecord[] = [
    mkFullLog({
      id: "a",
      reportId: "RPT-100",
      fileName: "alpha.log",
      source: "Battery Thermal",
      status: "Complete",
      confidence: 85,
      fileSizeMB: 50
    }),
    mkFullLog({
      id: "b",
      reportId: "RPT-200",
      fileName: "bravo.log",
      source: "PD Negotiation",
      status: "Failed",
      confidence: 0,
      fileSizeMB: 10
    }),
    mkFullLog({
      id: "c",
      reportId: "RPT-300",
      fileName: "charlie.log",
      source: "Battery Thermal",
      status: "Processing",
      confidence: 72,
      fileSizeMB: 20
    })
  ];

  it("no filters returns all rows", () => {
    const result = applyTableFilters(rows, {
      tableQuery: "",
      statusFilter: "all",
      moduleFilter: "all",
      sortBy: { key: "updatedAtIso", dir: "desc" }
    });

    expect(result).toHaveLength(3);
  });

  it("filters by search query on fileName case-insensitively", () => {
    const result = applyTableFilters(rows, {
      tableQuery: "ALPHA",
      statusFilter: "all",
      moduleFilter: "all",
      sortBy: { key: "updatedAtIso", dir: "desc" }
    });

    expect(result.map((row) => row.id)).toEqual(["a"]);
  });

  it("filters by search query on reportId", () => {
    const result = applyTableFilters(rows, {
      tableQuery: "RPT-200",
      statusFilter: "all",
      moduleFilter: "all",
      sortBy: { key: "updatedAtIso", dir: "desc" }
    });

    expect(result.map((row) => row.id)).toEqual(["b"]);
  });

  it("filters by status", () => {
    const result = applyTableFilters(rows, {
      tableQuery: "",
      statusFilter: "Failed",
      moduleFilter: "all",
      sortBy: { key: "updatedAtIso", dir: "desc" }
    });

    expect(result.map((row) => row.id)).toEqual(["b"]);
  });

  it("filters by module source", () => {
    const result = applyTableFilters(rows, {
      tableQuery: "",
      statusFilter: "all",
      moduleFilter: "Battery Thermal",
      sortBy: { key: "updatedAtIso", dir: "desc" }
    });

    expect(result.map((row) => row.id).sort()).toEqual(["a", "c"]);
  });

  it("sorts by confidence ascending", () => {
    const result = applyTableFilters(rows, {
      tableQuery: "",
      statusFilter: "all",
      moduleFilter: "all",
      sortBy: { key: "confidence", dir: "asc" }
    });

    expect(result.map((row) => row.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by fileSizeMB descending", () => {
    const result = applyTableFilters(rows, {
      tableQuery: "",
      statusFilter: "all",
      moduleFilter: "all",
      sortBy: { key: "fileSizeMB", dir: "desc" }
    });

    expect(result.map((row) => row.id)).toEqual(["a", "c", "b"]);
  });

  it("combines all filters and sort", () => {
    const result = applyTableFilters(rows, {
      tableQuery: "log",
      statusFilter: "all",
      moduleFilter: "Battery Thermal",
      sortBy: { key: "confidence", dir: "desc" }
    });

    expect(result.map((row) => row.id)).toEqual(["a", "c"]);
  });
});

describe("deriveMetrics", () => {
  const now = new Date("2026-05-10T12:00:00Z");
  const nowMs = now.getTime();

  it("todayCount returns count of today's logs", () => {
    const logs = [mkLog("t1", 30, nowMs), mkLog("t2", 60, nowMs)];

    const result = deriveMetrics(logs, "today", logs, now);

    expect(result.todayCount.value).toBe(2);
  });

  it("avgConfidence ignores failed logs", () => {
    const logs = [
      mkFullLog({ id: "a", status: "Complete", confidence: 80, updatedAtIso: new Date(nowMs - 30 * 60_000).toISOString() }),
      mkFullLog({ id: "b", status: "Complete", confidence: 90, updatedAtIso: new Date(nowMs - 60 * 60_000).toISOString() }),
      mkFullLog({ id: "f", status: "Failed", confidence: 0, updatedAtIso: new Date(nowMs - 90 * 60_000).toISOString() })
    ];

    const result = deriveMetrics(logs, "today", logs, now);

    expect(result.avgConfidence.value).toBe(85);
  });

  it("failedCount returns count of failed logs", () => {
    const logs = [
      mkFullLog({ id: "f1", status: "Failed", confidence: 0, updatedAtIso: new Date(nowMs - 10 * 60_000).toISOString() }),
      mkFullLog({ id: "c1", status: "Complete", confidence: 80, updatedAtIso: new Date(nowMs - 20 * 60_000).toISOString() })
    ];

    const result = deriveMetrics(logs, "today", logs, now);

    expect(result.failedCount.value).toBe(1);
    expect(result.failedCount.severity).toBe("warn");
  });

  it("failedCount severity is ok when zero failures", () => {
    const logs = [
      mkFullLog({ id: "c1", status: "Complete", confidence: 80, updatedAtIso: new Date(nowMs - 20 * 60_000).toISOString() })
    ];

    const result = deriveMetrics(logs, "today", logs, now);

    expect(result.failedCount.severity).toBe("ok");
  });

  it("failedCount severity is error when three or more failures", () => {
    const logs = [
      mkFullLog({ id: "f1", status: "Failed", confidence: 0, updatedAtIso: new Date(nowMs - 10 * 60_000).toISOString() }),
      mkFullLog({ id: "f2", status: "Failed", confidence: 0, updatedAtIso: new Date(nowMs - 20 * 60_000).toISOString() }),
      mkFullLog({ id: "f3", status: "Failed", confidence: 0, updatedAtIso: new Date(nowMs - 30 * 60_000).toISOString() })
    ];

    const result = deriveMetrics(logs, "today", logs, now);

    expect(result.failedCount.severity).toBe("error");
  });

  it("throughputPeak returns the largest log", () => {
    const logs = [
      mkFullLog({
        id: "a",
        fileName: "small.log",
        fileSizeMB: 2,
        status: "Complete",
        confidence: 80,
        updatedAtIso: new Date(nowMs - 10 * 60_000).toISOString()
      }),
      mkFullLog({
        id: "b",
        fileName: "big.log",
        fileSizeMB: 100,
        status: "Complete",
        confidence: 90,
        updatedAtIso: new Date(nowMs - 20 * 60_000).toISOString()
      })
    ];

    const result = deriveMetrics(logs, "today", logs, now);

    expect(result.throughputPeak.fileName).toBe("big.log");
    expect(result.throughputPeak.sizeMB).toBe(100);
  });

  it("returns zero values when logs is empty", () => {
    const result = deriveMetrics([], "today", [], now);

    expect(result.todayCount.value).toBe(0);
    expect(result.avgConfidence.value).toBe(0);
    expect(result.failedCount.value).toBe(0);
    expect(result.throughputPeak.sizeMB).toBe(0);
  });
});

describe("deriveInsight", () => {
  const now = new Date("2026-05-10T12:00:00Z");
  const nowMs = now.getTime();

  it("rule 1 returns error insight when any Failed log exists", () => {
    const logs = [
      mkFullLog({ id: "f", status: "Failed", confidence: 0, updatedAtIso: new Date(nowMs - 30 * 60_000).toISOString() })
    ];

    const insight = deriveInsight(logs, logs, now);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe("error");
    expect(insight?.headline).toContain("1 份");
    expect(insight?.headline).toContain("失败");
    expect(insight?.actions.some((action) => action.kind === "locate-failures")).toBe(true);
  });

  it("rule 2 returns warn insight when Processing is older than 10 minutes and no failures", () => {
    const logs = [
      mkFullLog({ id: "p", status: "Processing", confidence: 70, updatedAtIso: new Date(nowMs - 15 * 60_000).toISOString() })
    ];

    const insight = deriveInsight(logs, logs, now);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe("warn");
    expect(insight?.headline).toContain("10 分钟");
  });

  it("rule 2 does not trigger when Processing is fresh", () => {
    const logs = [
      mkFullLog({ id: "p", status: "Processing", confidence: 70, updatedAtIso: new Date(nowMs - 5 * 60_000).toISOString() })
    ];

    const insight = deriveInsight(logs, logs, now);

    expect(insight).toBeNull();
  });

  it("rule 3 returns info insight when today's avg is 5+ points below 7-day avg", () => {
    const todayLogs = [
      mkFullLog({ id: "t1", status: "Complete", confidence: 80, updatedAtIso: new Date(nowMs - 30 * 60_000).toISOString() })
    ];
    const olderLogs = [
      mkFullLog({
        id: "o1",
        status: "Complete",
        confidence: 90,
        updatedAtIso: new Date(nowMs - 3 * 24 * 60 * 60_000).toISOString()
      }),
      mkFullLog({
        id: "o2",
        status: "Complete",
        confidence: 92,
        updatedAtIso: new Date(nowMs - 4 * 24 * 60 * 60_000).toISOString()
      }),
      mkFullLog({
        id: "o3",
        status: "Complete",
        confidence: 88,
        updatedAtIso: new Date(nowMs - 5 * 24 * 60 * 60_000).toISOString()
      })
    ];

    const insight = deriveInsight(todayLogs, [...todayLogs, ...olderLogs], now);

    expect(insight).not.toBeNull();
    expect(insight?.severity).toBe("info");
    expect(insight?.headline).toMatch(/置信度/);
  });

  it("rule 4 returns null when no rule triggers", () => {
    const logs = [
      mkFullLog({ id: "c", status: "Complete", confidence: 90, updatedAtIso: new Date(nowMs - 10 * 60_000).toISOString() })
    ];

    const insight = deriveInsight(logs, logs, now);

    expect(insight).toBeNull();
  });

  it("prioritizes failed insight over processing-stuck", () => {
    const logs = [
      mkFullLog({ id: "f", status: "Failed", confidence: 0, updatedAtIso: new Date(nowMs - 30 * 60_000).toISOString() }),
      mkFullLog({ id: "p", status: "Processing", confidence: 70, updatedAtIso: new Date(nowMs - 30 * 60_000).toISOString() })
    ];

    const insight = deriveInsight(logs, logs, now);

    expect(insight?.severity).toBe("error");
  });
});
