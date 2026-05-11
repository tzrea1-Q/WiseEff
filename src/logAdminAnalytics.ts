import type { LogAdminRole, LogRecord, LogStatus, TimeWindow } from "./mockData";

export function deriveLogAdminRole(activeRoleId: string): LogAdminRole {
  if (activeRoleId === "admin") {
    return "Admin";
  }
  if (activeRoleId === "parameter-admin") {
    return "Editor";
  }
  return "Viewer";
}

function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function applyTimeWindow(logs: LogRecord[], timeWindow: TimeWindow, now: Date = new Date()): LogRecord[] {
  const today00 = startOfDay(now);
  let thresholdMs: number;

  if (timeWindow === "today") {
    thresholdMs = today00.getTime();
  } else if (timeWindow === "7d") {
    thresholdMs = today00.getTime() - 7 * 24 * 60 * 60 * 1000;
  } else {
    thresholdMs = today00.getTime() - 30 * 24 * 60 * 60 * 1000;
  }

  return logs.filter((log) => Date.parse(log.updatedAtIso) >= thresholdMs);
}

export type LogTableFilters = {
  tableQuery: string;
  statusFilter: LogStatus | "all";
  moduleFilter: string | "all";
  sortBy: { key: string; dir: "asc" | "desc" };
};

function sortAccessor(log: LogRecord, key: string): string | number {
  switch (key) {
    case "reportId":
      return log.reportId;
    case "fileName":
      return log.fileName;
    case "projectId":
      return log.projectId;
    case "source":
      return log.source;
    case "stage":
      return log.stage;
    case "status":
      return log.status;
    case "confidence":
      return log.confidence;
    case "fileSizeMB":
      return log.fileSizeMB;
    case "updatedAtIso":
      return log.updatedAtIso;
    default:
      return log.updatedAtIso;
  }
}

export function applyTableFilters(logs: LogRecord[], filters: LogTableFilters): LogRecord[] {
  const query = filters.tableQuery.trim().toLowerCase();
  const filtered = logs.filter((log) => {
    if (query) {
      const haystack = `${log.reportId} ${log.fileName}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    if (filters.statusFilter !== "all" && log.status !== filters.statusFilter) {
      return false;
    }
    if (filters.moduleFilter !== "all" && log.source !== filters.moduleFilter) {
      return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    const av = sortAccessor(a, filters.sortBy.key);
    const bv = sortAccessor(b, filters.sortBy.key);

    if (av < bv) {
      return filters.sortBy.dir === "asc" ? -1 : 1;
    }
    if (av > bv) {
      return filters.sortBy.dir === "asc" ? 1 : -1;
    }
    return 0;
  });
}

export type LogAdminMetrics = {
  todayCount: {
    value: number;
    trendPct: number;
    sparkline: number[];
  };
  avgConfidence: {
    value: number;
    trendPct: number;
  };
  failedCount: {
    value: number;
    severity: "ok" | "warn" | "error";
  };
  throughputPeak: {
    fileName: string;
    sizeMB: number;
    bars: number[];
  };
};

function bucketByHour(logs: LogRecord[], buckets: number, now: Date): number[] {
  const end = now.getTime();
  const spanMs = buckets * 60 * 60 * 1000;
  const start = end - spanMs;
  const counts = Array<number>(buckets).fill(0);

  for (const log of logs) {
    const time = Date.parse(log.updatedAtIso);
    if (time < start || time > end) {
      continue;
    }
    const index = Math.min(buckets - 1, Math.floor((time - start) / (spanMs / buckets)));
    counts[index] += 1;
  }

  return counts;
}

function bucketSizes(logs: LogRecord[], buckets: number): number[] {
  const sorted = [...logs].sort((a, b) => b.fileSizeMB - a.fileSizeMB).slice(0, buckets);

  return Array<number>(buckets)
    .fill(0)
    .map((_, index) => sorted[index]?.fileSizeMB ?? 0);
}

export function deriveMetrics(
  logs: LogRecord[],
  _timeWindow: TimeWindow,
  allLogs: LogRecord[],
  now: Date = new Date()
): LogAdminMetrics {
  const completeLogs = logs.filter((log) => log.status === "Complete" && log.confidence > 0);
  const failedLogs = logs.filter((log) => log.status === "Failed");
  const avgConfidence =
    completeLogs.length > 0
      ? Math.round(completeLogs.reduce((sum, log) => sum + log.confidence, 0) / completeLogs.length)
      : 0;
  const todayStart = startOfDay(now).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const yesterdayLogs = allLogs.filter((log) => {
    const time = Date.parse(log.updatedAtIso);
    return time < todayStart && time >= yesterdayStart;
  });
  const trendPct = yesterdayLogs.length > 0 ? Math.round(((logs.length - yesterdayLogs.length) / yesterdayLogs.length) * 100) : 0;
  const yesterdayComplete = yesterdayLogs.filter((log) => log.status === "Complete" && log.confidence > 0);
  const yesterdayAvg =
    yesterdayComplete.length > 0
      ? Math.round(yesterdayComplete.reduce((sum, log) => sum + log.confidence, 0) / yesterdayComplete.length)
      : 0;
  const peakLog = [...logs].sort((a, b) => b.fileSizeMB - a.fileSizeMB)[0];
  let severity: LogAdminMetrics["failedCount"]["severity"] = "ok";

  if (failedLogs.length >= 3) {
    severity = "error";
  } else if (failedLogs.length > 0) {
    severity = "warn";
  }

  return {
    todayCount: {
      value: logs.length,
      trendPct,
      sparkline: bucketByHour(logs, 8, now)
    },
    avgConfidence: {
      value: avgConfidence,
      trendPct: yesterdayAvg > 0 ? avgConfidence - yesterdayAvg : 0
    },
    failedCount: {
      value: failedLogs.length,
      severity
    },
    throughputPeak: {
      fileName: peakLog?.fileName ?? "",
      sizeMB: peakLog?.fileSizeMB ?? 0,
      bars: bucketSizes(logs, 7)
    }
  };
}

export type LogAdminInsightAction = {
  label: string;
  kind: "locate-failures" | "send-to-agent" | "dismiss";
};

export type LogAdminInsight = {
  severity: "info" | "warn" | "error";
  headline: string;
  description?: string;
  actions: LogAdminInsightAction[];
};

function averageConfidence(logs: LogRecord[]): number {
  const complete = logs.filter((log) => log.status === "Complete" && log.confidence > 0);

  if (complete.length === 0) {
    return 0;
  }

  return Math.round(complete.reduce((sum, log) => sum + log.confidence, 0) / complete.length);
}

export function deriveInsight(logs: LogRecord[], allLogs: LogRecord[], now: Date = new Date()): LogAdminInsight | null {
  const failures = logs.filter((log) => log.status === "Failed");

  if (failures.length > 0) {
    const names = failures
      .slice(0, 2)
      .map((log) => log.fileName)
      .join(", ");

    return {
      severity: "error",
      headline: `检测到 ${failures.length} 份日志解析失败`,
      description: failures.length === 1 ? names : `包括 ${names}${failures.length > 2 ? " 等" : ""}`,
      actions: [
        { label: "定位失败记录", kind: "locate-failures" },
        { label: "交给 Agent 分析", kind: "send-to-agent" },
        { label: "关闭今日提示", kind: "dismiss" }
      ]
    };
  }

  const nowMs = now.getTime();
  const stuck = logs.filter((log) => {
    if (log.status !== "Processing") {
      return false;
    }
    return (nowMs - Date.parse(log.updatedAtIso)) / 60_000 > 10;
  });

  if (stuck.length > 0) {
    return {
      severity: "warn",
      headline: `${stuck.length} 份日志分析超过 10 分钟未完成`,
      description: stuck[0].fileName,
      actions: [
        { label: "交给 Agent 分析", kind: "send-to-agent" },
        { label: "关闭今日提示", kind: "dismiss" }
      ]
    };
  }

  const todayStart = startOfDay(now).getTime();
  const weekLogs = allLogs.filter((log) => {
    const time = Date.parse(log.updatedAtIso);
    return time < todayStart && time >= todayStart - 7 * 24 * 60 * 60_000;
  });
  const todayAvg = averageConfidence(logs);
  const weekAvg = averageConfidence(weekLogs);

  if (todayAvg > 0 && weekAvg > 0 && weekAvg - todayAvg >= 5) {
    return {
      severity: "info",
      headline: `今日置信度 ${todayAvg}% 较 7 日均值下降 ${weekAvg - todayAvg} 点`,
      description: "建议对今日低置信度记录抽查",
      actions: [
        { label: "交给 Agent 分析", kind: "send-to-agent" },
        { label: "关闭今日提示", kind: "dismiss" }
      ]
    };
  }

  return null;
}
