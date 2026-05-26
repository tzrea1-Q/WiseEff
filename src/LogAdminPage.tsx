import { Download, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DataTable,
  LogRecordDrawer,
  PageInsightBar,
  TimeWindowSelect,
  type Column
} from "@/components/admin";
import { Button } from "@/components/ui/button";
import { canPerform } from "@/app/permissions";
import { cn } from "@/lib/utils";
import { applyTableFilters, applyTimeWindow, deriveInsight, deriveMetrics } from "@/logAdminAnalytics";
import { STAGE_LABELS, type LogRecord, type LogStatus, type PrototypeState, type TimeWindow } from "@/mockData";
import { useTopBarActions } from "@/components/layout";
import type { LogRuntimeActions } from "@/application/logs/logRuntime";
import type { AppAction } from "./App";

export type LogAdminPageProps = {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
  logActions?: LogRuntimeActions;
};

const statusLabels: Record<LogStatus, string> = {
  Processing: "处理中",
  Complete: "已完成",
  Failed: "失败"
};

const statusBadgeClasses: Record<LogStatus, string> = {
  Processing: "bg-blue-100 text-blue-900",
  Complete: "bg-emerald-100 text-emerald-900",
  Failed: "bg-destructive/15 text-destructive"
};

function StatusBadge({ status }: { status: LogStatus }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", statusBadgeClasses[status])}>
      {statusLabels[status]}
    </span>
  );
}

const INSIGHT_DISMISS_KEY = "log-admin-insight-dismissed";

function todayDateKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function readInsightDismissed(): boolean {
  try {
    return localStorage.getItem(INSIGHT_DISMISS_KEY) === todayDateKey();
  } catch {
    return false;
  }
}

function writeInsightDismissed(): void {
  try {
    localStorage.setItem(INSIGHT_DISMISS_KEY, todayDateKey());
  } catch {
    // Ignore storage restrictions in embedded or test environments.
  }
}

export function LogAdminPage({ state, dispatch, onNavigate, search: _search, logActions: _logActions }: LogAdminPageProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("today");
  const [tableQuery, setTableQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LogStatus[]>([]);
  const [moduleFilter, setModuleFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "updatedAtIso", dir: "desc" });
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [undoArchive, setUndoArchive] = useState<{ logId: string; fileName: string } | null>(null);
  const [insightDismissed, setInsightDismissed] = useState<boolean>(() => readInsightDismissed());

  useEffect(() => {
    if (!undoArchive) {
      return undefined;
    }

    const timer = window.setTimeout(() => setUndoArchive(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undoArchive]);

  const visibleLogs = useMemo(
    () => state.logs.filter((log) => !state.archivedLogIds.includes(log.id)),
    [state.archivedLogIds, state.logs]
  );
  const windowLogs = useMemo(() => applyTimeWindow(visibleLogs, timeWindow), [timeWindow, visibleLogs]);
  const metrics = useMemo(() => deriveMetrics(windowLogs, timeWindow, visibleLogs), [timeWindow, visibleLogs, windowLogs]);
  const filteredRows = useMemo(
    () => applyTableFilters(windowLogs, { tableQuery, statusFilter, moduleFilter, sortBy }),
    [moduleFilter, sortBy, statusFilter, tableQuery, windowLogs]
  );
  const availableModules = useMemo(() => Array.from(new Set(windowLogs.map((log) => log.source))).sort(), [windowLogs]);
  const insight = useMemo(() => deriveInsight(windowLogs, visibleLogs), [visibleLogs, windowLogs]);
  const canAct = canPerform(state.activeRoleId, "admin.access");
  const selectedRecord = selectedRecordId ? state.logs.find((log) => log.id === selectedRecordId) ?? null : null;

  const projectName = (projectId: string): string => state.configDraft.projects.find((project) => project.id === projectId)?.name ?? projectId;
  const toggleStatusFilter = (status: string) => {
    if (!Object.keys(statusLabels).includes(status)) return;
    setStatusFilter((current) =>
      current.includes(status as LogStatus) ? current.filter((item) => item !== status) : [...current, status as LogStatus]
    );
  };
  const toggleModuleFilter = (module: string) => {
    setModuleFilter((current) => (current.includes(module) ? current.filter((item) => item !== module) : [...current, module]));
  };

  const columns: Column<LogRecord>[] = [
    {
      key: "reportId",
      header: "Report ID",
      render: (record) => <span className="font-mono text-xs text-primary">{record.reportId}</span>,
      sortAccessor: (record) => record.reportId,
      widthClass: "w-28"
    },
    {
      key: "fileName",
      header: "文件名",
      render: (record) => <span className="font-medium text-foreground">{record.fileName}</span>,
      sortAccessor: (record) => record.fileName
    },
    {
      key: "projectId",
      header: "项目",
      headerFilter: {
        label: "项目",
        values: Array.from(new Set(windowLogs.map((record) => projectName(record.projectId)))),
        getValue: (record) => projectName(record.projectId)
      },
      render: (record) => <span className="text-muted-foreground">{projectName(record.projectId)}</span>,
      sortAccessor: (record) => record.projectId,
      widthClass: "w-36"
    },
    {
      key: "source",
      header: "来源模块",
      headerFilter: {
        label: "来源模块",
        values: availableModules,
        selectedValues: moduleFilter,
        getValue: (record) => record.source,
        onToggle: toggleModuleFilter,
        onClear: () => setModuleFilter([])
      },
      render: (record) => <span className="text-muted-foreground">{record.source}</span>,
      sortAccessor: (record) => record.source,
      widthClass: "w-36"
    },
    {
      key: "stage",
      header: "分析阶段",
      render: (record) => <span className="text-xs text-muted-foreground">{STAGE_LABELS[record.stage]}</span>,
      sortAccessor: (record) => record.stage,
      widthClass: "w-28"
    },
    {
      key: "status",
      header: "状态",
      headerFilter: {
        label: "状态",
        values: ["Processing", "Complete", "Failed"],
        selectedValues: statusFilter,
        getValue: (record) => record.status,
        renderLabel: (status) => statusLabels[status as LogStatus] ?? status,
        onToggle: toggleStatusFilter,
        onClear: () => setStatusFilter([]),
        align: "right"
      },
      render: (record) => <StatusBadge status={record.status} />,
      sortAccessor: (record) => record.status,
      widthClass: "w-24"
    },
    {
      key: "confidence",
      header: "置信度",
      render: (record) =>
        record.status === "Failed" ? <span className="text-muted-foreground">-</span> : <span className="font-mono text-xs">{record.confidence}%</span>,
      sortAccessor: (record) => record.confidence,
      align: "right",
      widthClass: "w-24"
    },
    {
      key: "action",
      header: "",
      render: () => <span className="text-xs text-primary">查看</span>,
      align: "right",
      widthClass: "w-20"
    }
  ];

  const resetFilters = () => {
    setTableQuery("");
    setStatusFilter([]);
    setModuleFilter([]);
    setSortBy({ key: "updatedAtIso", dir: "desc" });
  };

  const handleInsightAction = (kind: "locate-failures" | "send-to-agent" | "dismiss") => {
    if (!insight) {
      return;
    }
    if (kind === "dismiss") {
      writeInsightDismissed();
      setInsightDismissed(true);
      return;
    }
    if (kind === "locate-failures") {
      setStatusFilter(["Failed"]);
      return;
    }

    const preset =
      insight.severity === "error"
        ? "log-admin-failures"
        : insight.severity === "warn"
          ? "log-admin-stuck"
          : "log-admin-confidence-drop";
    dispatch({ type: "OPEN_AGENT_WITH_PRESET", preset });
  };

  const handleExport = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      timeWindow,
      metrics,
      rows: filteredRows.map((record) => ({
        reportId: record.reportId,
        fileName: record.fileName,
        projectId: record.projectId,
        source: record.source,
        status: record.status,
        stage: record.stage,
        confidence: record.confidence,
        updatedAtIso: record.updatedAtIso
      }))
    };

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `log-admin-report-${todayDateKey()}.json`;
      document.body.appendChild(anchor);
      if (!navigator.userAgent.toLowerCase().includes("jsdom")) {
        anchor.click();
      }
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      // jsdom and locked-down browser contexts may not support synthetic downloads.
    }

    dispatch({ type: "LOG_ADMIN_EXPORT_REPORT", timeWindow });
  };

  const handleSync = () => {
    dispatch({ type: "LOG_ADMIN_SYNC_LOGS" });
  };

  const hasActiveFilters = tableQuery !== "" || statusFilter.length > 0 || moduleFilter.length > 0;
  useTopBarActions(
    <>
      <TimeWindowSelect value={timeWindow} onChange={setTimeWindow} />
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download data-icon="inline-start" />
        导出报表
      </Button>
      <Button size="sm" onClick={handleSync}>
        <RefreshCw data-icon="inline-start" />
        同步日志
      </Button>
    </>,
    [filteredRows, metrics, timeWindow]
  );

  return (
    <div className="log-admin-page flex flex-col gap-5 p-6">
      {insight && !insightDismissed ? (
        <PageInsightBar
          severity={insight.severity}
          headline={insight.headline}
          description={insight.description}
          onDismiss={() => {
            writeInsightDismissed();
            setInsightDismissed(true);
          }}
          actions={insight.actions.map((action) => ({
            label: action.label,
            onClick: () => handleInsightAction(action.kind),
            tone: action.kind === "locate-failures" ? ("primary" as const) : ("subtle" as const)
          }))}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4">
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">日志分析记录</h2>
          </div>
          <DataTable
            aria-label="日志分析记录"
            rows={filteredRows}
            rowKey={(record) => record.id}
            columns={columns}
            onRowClick={(record) => setSelectedRecordId(record.id)}
            selectedRowKey={selectedRecordId ?? undefined}
            pageSize={8}
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={tableQuery}
                  onChange={(event) => setTableQuery(event.target.value)}
                  placeholder="搜索 RPT- 或文件名"
                  className="h-7 w-56 rounded-md border border-border bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="h-7 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    重置
                  </button>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  显示 {filteredRows.length} / {windowLogs.length} 条
                </span>
              </div>
            }
            emptyState={
              hasActiveFilters ? (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">未匹配任何记录</p>
                  <button type="button" onClick={resetFilters} className="mt-2 text-xs text-primary hover:underline">
                    重置筛选
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">当前时间窗口内暂无日志</p>
              )
            }
          />
        </section>
      </div>

      <LogRecordDrawer
        record={selectedRecord}
        open={!!selectedRecord}
        onClose={() => setSelectedRecordId(null)}
        onNavigateToWorkbench={(id) => {
          const target = state.logs.find((log) => log.id === id);
          onNavigate(`/logs${target ? `?id=${target.reportId}` : ""}`);
          setSelectedRecordId(null);
        }}
        onReanalyze={(id) => {
          dispatch({ type: "LOG_ADMIN_REANALYZE_LOG", logId: id });
          setSelectedRecordId(null);
        }}
        onArchive={(id) => {
          const log = state.logs.find((item) => item.id === id);
          dispatch({ type: "LOG_ADMIN_ARCHIVE_LOG", logId: id });
          if (log) {
            setUndoArchive({ logId: id, fileName: log.fileName });
          }
          setSelectedRecordId(null);
        }}
        canAct={canAct}
      />

      {undoArchive ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-lg"
        >
          <span className="text-sm text-foreground">
            已归档 <span className="font-mono text-xs">{undoArchive.fileName}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "LOG_ADMIN_UNARCHIVE_LOG", logId: undoArchive.logId });
              setUndoArchive(null);
            }}
            className="text-sm font-medium text-primary hover:underline"
          >
            撤销
          </button>
        </div>
      ) : null}
    </div>
  );
}
