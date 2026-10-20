import "./log-admin.css";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { ExportSkillPackageDialog } from "@/features/log-skills/SkillPackageDialogs";
import type { AnalysisSkill } from "@/features/log-skills/types";
import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LogRecordDrawer,
  PageInsightBar,
  TimeWindowSelect,
  type Column
} from "@/components/admin";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { useCollectionTab } from "@/hooks/useCollectionTab";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/common/SearchField";
import { canPerform } from "@/app/permissions";
import { cn } from "@/lib/utils";
import { applyTableFilters, applyTimeWindow, deriveInsight, deriveMetrics } from "@/logAdminAnalytics";
import { formatPercent } from "@/domain/format/formatPercent";
import type { LogRecord, LogStatus, PrototypeState, TimeWindow } from "@/domain/prototype/types";
import type { LogDomain, LogFeedbackInsight } from "@/domain/logs/types";
import { logRuntimeFailureNotification, type LogRuntimeActions } from "@/application/logs/logRuntime";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { dispatchXiaozeOpenHandoff } from "@/features/agent/xiaozeOpenHandoff";
import type { AppAction } from "@/application/state/appState";

import { CreateSkillDialog } from "@/features/log-skills/CreateSkillDialog";
import { ImportSkillPackageDialog } from "@/features/log-skills/SkillPackageDialogs";
import { SectionSkeleton } from "@/components/common/SectionState";
import { LogAdminOverview, matchesOverviewFilter, type OverviewRecordFilter } from "@/features/log-analysis/LogAdminOverview";
import type { SkillAuthoringRepository, SkillWorkspaceRepository } from "@/features/log-skills/types";

const collectionTabs = ["overview", "records", "skills", "quality"] as const;

export type LogAdminPageProps = {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
  logActions?: LogRuntimeActions;
  skillRepository?: Partial<SkillAuthoringRepository & SkillWorkspaceRepository & Pick<LogAnalysisRepository, "getLog">>;
  apiMode?: boolean;
  /** Kept for page composition; knowledge editing lives in the workspace. */
  knowledgeRepository?: KnowledgeRepository;
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
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium", statusBadgeClasses[status])}>
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

type PendingLogAction = "archive" | "reanalyze" | "feedback" | "unarchive";

function pendingKey(kind: PendingLogAction, logId: string): string {
  return `${kind}:${logId}`;
}

function runtimeAlreadyNotified(error: unknown): boolean {
  return error instanceof Error && (error as { alreadyNotified?: unknown }).alreadyNotified === true;
}

function domainStatusLabel(status: LogDomain["status"]): string {
  return status === "active" ? "已发布" : "已归档";
}

function skillStatusLabel(skill: LogDomain): string {
  if (skill.status === "archived") return "已归档";
  if (skill.hasDraft || !skill.currentRevision?.publishedAt) return "有未发布更改";
  return `已发布 v${skill.currentRevision.number}`;
}

function adminDateTime(iso: string): string {
  return formatAbsolute(iso).slice(0, 16).replaceAll("-", "/");
}

function LogDomainGovernanceSection({
  canGovern,
  logActions,
  onNavigate,
  skillRepository,
  apiMode,
  refreshKey,
  refreshAction
}: {
  canGovern: boolean;
  logActions?: LogRuntimeActions;
  refreshKey: number;
  refreshAction: ReactNode;
  onNavigate: (path: string) => void;
  skillRepository?: Partial<SkillAuthoringRepository & SkillWorkspaceRepository>;
  apiMode: boolean;
}) {
  const [domains, setDomains] = useState<LogDomain[] | null>(null);
  const domainsLoading = Boolean(logActions) && domains === null;
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportSkill, setExportSkill] = useState<AnalysisSkill | null>(null);
  const [pending, setPending] = useState(false);
  const [exportError, setExportError] = useState("");
  const [skillStatusFilter, setSkillStatusFilter] = useState<string[]>([]);

  const refreshDomains = useCallback(async () => {
    if (!logActions) {
      return;
    }
    setDomains(await logActions.listLogDomains({ includeArchived: true }));
  }, [logActions]);

  useEffect(() => {
    void refreshDomains();
  }, [refreshDomains, refreshKey]);

  const openCreateForm = () => {
    setCreateOpen(true);
  };

  const openExport = async (domain: LogDomain) => {
    if (!skillRepository?.getLogSkill || pending) return;
    setPending(true);
    setExportError("");
    try {
      setExportSkill(await skillRepository.getLogSkill(domain.id));
    } catch {
      setExportError("无法加载技能，请重试。");
    } finally {
      setPending(false);
    }
  };

  const archiveDomain = async (domainId: string) => {
    if (!logActions || pending) {
      return;
    }
    setPending(true);
    try {
      await logActions.archiveLogDomain(domainId);
      await refreshDomains();
    } finally {
      setPending(false);
    }
  };

  const domainColumns: Column<LogDomain>[] = [
    {
      key: "name",
      header: "名称",
      render: (domain) => (
        <div className="log-admin-skill-name">
          <Button asChild variant="link" className={cn("font-medium", domain.status === "archived" && "opacity-60")}>
            <a href={`/log-admin/skills/${encodeURIComponent(domain.id)}`}
              onClick={(event) => { event.stopPropagation(); if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(event.currentTarget.getAttribute("href")!); } }}>{domain.name}</a>
          </Button>
          {domain.description ? <span className="block truncate text-xs text-muted-foreground" title={domain.description}>{domain.description}</span> : null}
        </div>
      ),
      sortAccessor: (domain) => domain.name
    },
    {
      key: "status",
      header: "状态",
      headerFilter: {
        label: "状态",
        values: ["active", "archived"],
        selectedValues: skillStatusFilter,
        onToggle: (value) => setSkillStatusFilter((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]),
        onClear: () => setSkillStatusFilter([]),
        getValue: (domain) => domain.status,
        renderLabel: (status) => domainStatusLabel(status as LogDomain["status"]),
        align: "right"
      },
      render: (domain) => (
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium",
            domain.status === "archived" && "opacity-60",
            domain.status === "active" ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"
          )}
        >
          {skillStatusLabel(domain)}
        </span>
      ),
      sortAccessor: (domain) => skillStatusLabel(domain)
    },
    { key: "analyses7d", header: "近 7 天分析", render: (skill) => skill.analyses7d ?? 0, sortAccessor: (skill) => skill.analyses7d ?? 0 },
    { key: "helpfulRate7d", header: "有帮助率", render: (skill) => skill.helpfulRate7d == null ? "—" : formatPercent(skill.helpfulRate7d), sortAccessor: (skill) => skill.helpfulRate7d ?? -1 },
    { key: "updatedAt", header: "更新时间", render: (skill) => adminDateTime(skill.updatedAt), sortAccessor: (skill) => skill.updatedAt }
  ];

  return (
    <section className="flex flex-col gap-2" aria-label="日志分析技能治理" data-testid="log-domain-governance" aria-busy={domainsLoading}>
      {!canGovern ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          需要管理员权限才能管理分析技能。
        </p>
      ) : !logActions ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          请连接服务后管理分析技能。
        </p>
      ) : (
        <>
          <AdminListPage label="分析技能治理"
            headerContent={false}
            headerActions={<>{refreshAction}<Button size="sm" variant="outline" onClick={() => setImportOpen(true)} disabled={!apiMode || !skillRepository?.importSkillPackage || pending || domainsLoading}>导入技能包</Button>
              <Button size="sm" onClick={openCreateForm} disabled={pending || domainsLoading}>新建技能</Button></>}
            filterBar={<p className="text-sm text-muted-foreground">上传日志时会自动推荐匹配的技能；没有匹配时按通用分析处理。</p>}
            table={{ "aria-label": "分析技能列表", rows: domains ?? [], rowKey: (domain) => domain.id, columns: domainColumns, pageSize: 50, tableClassName: "log-admin-skills-table",
              onRowClick: (domain) => onNavigate(`/log-admin/skills/${encodeURIComponent(domain.id)}`),
              emptyState: domainsLoading ? <SectionSkeleton label="正在加载分析技能" /> : <div className="section-empty justify-items-center text-center">
                <strong>{skillStatusFilter.length > 0 ? "未匹配任何技能" : "还没有分析技能"}</strong>
                {skillStatusFilter.length === 0 ? <p>从模板创建技能，并上传样例日志开始配置。</p> : null}
                {skillStatusFilter.length > 0 ? <Button variant="outline" onClick={() => setSkillStatusFilter([])}>重置筛选</Button> : <Button variant="outline" onClick={() => onNavigate("/logs")}>前往日志分析</Button>}
              </div> }}
            rowActions={(domain) => ({ label: domain.name,
              items: [
                { id: "export", label: "导出技能包", disabled: pending || !skillRepository?.getLogSkill || !skillRepository.exportSkillPackage, onSelect: () => openExport(domain) },
                ...(domain.status === "active" ? [{ id: "archive", label: "归档", disabled: pending, destructive: true as const,
                  confirmation: { title: `归档「${domain.name}」`, description: "归档后，新日志不再推荐此技能；已有日志及分析记录保留。", confirmLabel: "归档技能" },
                  onSelect: () => archiveDomain(domain.id) }] : [])
              ]
            })}
            emptyState={{ message: "还没有分析技能", actionLabel: "", onAction: () => undefined }} />

          {createOpen ? <CreateSkillDialog repository={skillRepository} apiMode={apiMode} skills={domains ?? []}
            onDismiss={() => setCreateOpen(false)} onNavigate={onNavigate} /> : null}
          {importOpen && skillRepository ? <ImportSkillPackageDialog repository={skillRepository} onDismiss={() => setImportOpen(false)} onNavigate={onNavigate}
            onImported={() => { void refreshDomains(); }} /> : null}

          {exportError ? <p role="alert" className="text-sm text-destructive">{exportError}</p> : null}
          {exportSkill && skillRepository ? <ExportSkillPackageDialog skill={exportSkill} dirty={false} repository={skillRepository} onDismiss={() => setExportSkill(null)} /> : null}

        </>
      )}
    </section>
  );
}

const feedbackAnalysisSourceLabels: Record<"agent" | "rules-fallback" | "none", string> = {
  agent: "AI 分析",
  "rules-fallback": "降级 · 规则回退",
  none: "未标注来源"
};

function feedbackInsightRowKey(row: LogFeedbackInsight): string {
  return `${row.logDomainId ?? "uncategorized"}:${row.analysisSource ?? "none"}:${row.promptVersion ?? "none"}`;
}

/**
 * Analysis-quality insights (P3 online monitoring, evaluation build order step 3):
 * helpful rate per log domain × analysis source × prompt version over the page's
 * shared time window. Read-only aggregation of `log_feedback` — the shared golden
 * case set stays the quality anchor; this section watches live feedback drift.
 */
function FeedbackQualityInsightsSection({
  timeWindow,
  logActions,
  refreshKey,
  onRowsChange,
  onLoadingChange,
  onErrorChange,
  headerActions,
  onTimeWindowChange,
  onViewRecords
}: {
  timeWindow: TimeWindow;
  logActions?: LogRuntimeActions;
  refreshKey: number;
  onRowsChange: (rows: LogFeedbackInsight[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onErrorChange: (unavailable: boolean) => void;
  headerActions: ReactNode;
  onTimeWindowChange: (value: TimeWindow) => void;
  onViewRecords: () => void;
}) {
  const [rows, setRows] = useState<LogFeedbackInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);


  useEffect(() => {
    if (!logActions) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    onLoadingChange(true);
    setUnavailable(false);
    onErrorChange(false);
    void logActions
      .listFeedbackInsights({ timeWindow })
      .then((items) => {
        if (!cancelled) {
          setRows(items);
          onRowsChange(items);
        }
      })
      .catch(() => {
        if (!cancelled) { setRows([]); onRowsChange([]); setUnavailable(true); onErrorChange(true); }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          onLoadingChange(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [logActions, onErrorChange, onLoadingChange, onRowsChange, refreshKey, timeWindow]);

  const columns: Column<LogFeedbackInsight>[] = [
    {
      key: "logDomainName",
      header: "技能",
      render: (row) => (
        <span className={cn("text-sm", row.logDomainName ? "font-medium text-foreground" : "text-muted-foreground")}>
          {row.logDomainName ?? "通用分析"}
        </span>
      ),
      sortAccessor: (row) => row.logDomainName ?? ""
    },
    {
      key: "analysisSource",
      header: "分析来源",
      render: (row) => <span className="text-xs text-muted-foreground">{feedbackAnalysisSourceLabels[row.analysisSource ?? "none"]}</span>,
      sortAccessor: (row) => row.analysisSource ?? ""
    },
    {
      key: "totalCount",
      header: "反馈数",
      render: (row) => <span className="font-mono text-xs">{row.totalCount}</span>,
      sortAccessor: (row) => row.totalCount,
      align: "right",
      widthClass: "w-24"
    },
    {
      key: "helpfulRate",
      header: "有帮助率",
      render: (row) => {
        const percent = Math.round(row.helpfulRate * 100);
        return (
          <span
            className={cn(
              "font-mono text-xs",
              percent >= 80 ? "text-emerald-700" : percent >= 50 ? "text-amber-700" : "text-destructive"
            )}
          >
            {percent}%（{row.helpfulCount}/{row.totalCount}）
          </span>
        );
      },
      sortAccessor: (row) => row.helpfulRate,
      align: "right",
      widthClass: "w-32"
    }
  ];

  return (
    <section className="flex flex-col gap-2" aria-label="分析质量" data-testid="feedback-quality-insights" aria-busy={loading}>
      {!logActions ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          请连接服务后查看分析质量。
        </p>
      ) : (
        <AdminListPage label="分析质量"
          headerContent={false}
          headerActions={headerActions}
          filterBar={<TimeWindowSelect value={timeWindow} onChange={onTimeWindowChange} />}
          table={{ "aria-label": "分析质量反馈聚合", rows, rowKey: feedbackInsightRowKey, columns, pageSize: 6 }}
          emptyState={{ message: loading ? "正在加载反馈数据…" : unavailable ? "反馈数据暂不可用，请刷新重试。" : "暂无反馈", actionLabel: "查看分析记录", onAction: onViewRecords }} />
      )}
    </section>
  );
}

export function LogAdminPage({ state, dispatch, onNavigate, search: _search, logActions, skillRepository, apiMode = false }: LogAdminPageProps) {
  const [collection, selectCollection] = useCollectionTab(collectionTabs, new URLSearchParams(window.location.search).get("tab") === "domains" ? "skills" : "overview");
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("today");
  const [tableQuery, setTableQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LogStatus[]>([]);
  const [overviewFilter, setOverviewFilter] = useState<OverviewRecordFilter | null>(null);
  const [sortBy, setSortBy] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "updatedAtIso", dir: "desc" });
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [undoArchive, setUndoArchive] = useState<{ logId: string; fileName: string } | null>(null);
  const [insightDismissed, setInsightDismissed] = useState<boolean>(() => readInsightDismissed());
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const [syncPending, setSyncPending] = useState(false);
  const [logView, setLogView] = useState<"active" | "archived">("active");
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [skillsRefreshKey, setSkillsRefreshKey] = useState(0);
  const [qualityRows, setQualityRows] = useState<LogFeedbackInsight[]>([]);
  const [qualityLoading, setQualityLoading] = useState(Boolean(logActions));
  const [qualityUnavailable, setQualityUnavailable] = useState(false);
  const [feedbackInsightsRefreshKey, setFeedbackInsightsRefreshKey] = useState(0);

  const runPendingAction = async (kind: PendingLogAction, logId: string, action: () => Promise<void>) => {
    const key = pendingKey(kind, logId);
    setPendingActions((current) => new Set(current).add(key));
    try {
      await action();
    } catch (error) {
      if (!runtimeAlreadyNotified(error)) {
        dispatch({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
      }
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!undoArchive) {
      return undefined;
    }

    // The archived view makes archiving reversible any time; the undo window
    // still gives a fast path for accidental clicks.
    const timer = window.setTimeout(() => setUndoArchive(null), 10000);
    return () => window.clearTimeout(timer);
  }, [undoArchive]);

  // Load archived records lazily when entering the archived view in API mode.
  useEffect(() => {
    if (logView !== "archived" || archivedLoaded || !logActions) {
      return;
    }
    setArchivedLoaded(true);
    void logActions.refresh({ includeArchived: true }).catch(() => {
      setArchivedLoaded(false);
    });
  }, [archivedLoaded, logActions, logView]);

  const visibleLogs = useMemo(
    () => state.logs.filter((log) => !state.archivedLogIds.includes(log.id)),
    [state.archivedLogIds, state.logs]
  );
  const archivedLogs = useMemo(
    () => state.logs.filter((log) => state.archivedLogIds.includes(log.id)),
    [state.archivedLogIds, state.logs]
  );
  const windowLogs = useMemo(() => applyTimeWindow(visibleLogs, timeWindow), [timeWindow, visibleLogs]);
  const metrics = useMemo(() => deriveMetrics(windowLogs, timeWindow, visibleLogs), [timeWindow, visibleLogs, windowLogs]);
  const tableSourceLogs = useMemo(() => (logView === "archived" ? archivedLogs : windowLogs).filter((log) => matchesOverviewFilter(log, overviewFilter)), [archivedLogs, logView, overviewFilter, windowLogs]);
  const filteredRows = useMemo(
    () => applyTableFilters(tableSourceLogs, { tableQuery, statusFilter, moduleFilter: [], sortBy }),
    [sortBy, statusFilter, tableQuery, tableSourceLogs]
  );
  const insight = useMemo(() => deriveInsight(windowLogs, visibleLogs), [visibleLogs, windowLogs]);
  const canAct = canPerform(state.activeRoleId, "admin.access");
  const selectedRecord = selectedRecordId ? state.logs.find((log) => log.id === selectedRecordId) ?? null : null;

  const unarchiveLog = (logId: string) => {
    if (!logActions) {
      dispatch({ type: "LOG_ADMIN_UNARCHIVE_LOG", logId });
      setUndoArchive((current) => (current?.logId === logId ? null : current));
      return;
    }
    void runPendingAction("unarchive", logId, async () => {
      await logActions.unarchive(logId);
      setUndoArchive((current) => (current?.logId === logId ? null : current));
    });
  };

  const toggleStatusFilter = (status: string) => {
    if (!Object.keys(statusLabels).includes(status)) return;
    setStatusFilter((current) =>
      current.includes(status as LogStatus) ? current.filter((item) => item !== status) : [...current, status as LogStatus]
    );
  };
  const columns: Column<LogRecord>[] = [
    {
      key: "fileName",
      header: "文件",
      render: (record) => <Button variant="link" className="font-medium" onClick={() => setSelectedRecordId(record.id)}>{record.fileName.trim() || record.reportId}</Button>,
      sortAccessor: (record) => record.fileName
    },
    {
      key: "logDomainName",
      header: "技能",
      render: (record) => record.logDomainName ?? "通用分析",
      sortAccessor: (record) => record.logDomainName ?? "通用分析"
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
        record.status === "Failed" ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <span className="inline-flex items-center justify-end gap-1 text-xs">
            <span className="font-mono">{formatPercent(record.confidence)}</span>
            <span className="rounded border border-border px-1 text-muted-foreground">{record.analysisSource === "agent" ? "AI" : "规则"}</span>
          </span>
        ),
      sortAccessor: (record) => record.confidence,
      align: "right",
      widthClass: "w-28"
    },
    { key: "submittedBy", header: "上传者", render: (record) => record.submittedBy, sortAccessor: (record) => record.submittedBy },
    { key: "capturedAt", header: "上传时间", render: (record) => adminDateTime(record.capturedAt), sortAccessor: (record) => record.capturedAt }
  ];

  const resetFilters = () => {
    setTableQuery("");
    setStatusFilter([]);
    setOverviewFilter(null);
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
    if (wiseEffRuntimeMode === "api") {
      dispatchXiaozeOpenHandoff(preset);
      return;
    }
    dispatch({
      type: "PUSH_NOTIFICATION",
      message: "日志治理分析需在 API 模式下通过右下角「小泽」继续。"
    });
  };

  const handleExport = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      timeWindow,
      ...(collection === "records" ? { metrics } : {}),
      rows: collection === "quality" ? qualityRows : filteredRows.map((record) => ({
        reportId: record.reportId,
        fileName: record.fileName,
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

  const handleSync = async () => {
    if (collection === "skills") { setSkillsRefreshKey((key) => key + 1); return; }
    if (collection === "quality") { setFeedbackInsightsRefreshKey((key) => key + 1); return; }
    if (collection === "overview") setFeedbackInsightsRefreshKey((key) => key + 1);
    if (!logActions) {
      dispatch({ type: "LOG_ADMIN_SYNC_LOGS" });
      return;
    }

    setSyncPending(true);
    try {
      await logActions.refresh({ includeArchived: true });
    } catch (error) {
      if (!runtimeAlreadyNotified(error)) {
        dispatch({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
      }
    } finally {
      setSyncPending(false);
    }
  };

  const selectedRecordArchivePending = selectedRecord ? pendingActions.has(pendingKey("archive", selectedRecord.id)) : false;
  const selectedRecordReanalyzePending = selectedRecord ? pendingActions.has(pendingKey("reanalyze", selectedRecord.id)) : false;
  const selectedRecordFeedbackPending = selectedRecord ? pendingActions.has(pendingKey("feedback", selectedRecord.id)) : false;
  const undoArchivePending = undoArchive ? pendingActions.has(pendingKey("unarchive", undoArchive.logId)) : false;

  const hasActiveFilters = tableQuery !== "" || statusFilter.length > 0 || overviewFilter !== null;
  const refreshAction = (
    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncPending} aria-busy={syncPending || undefined}>
      <RefreshCw data-icon="inline-start" />
      刷新
    </Button>
  );
  const reportHeaderActions = (
    <>
      {refreshAction}
      <Button size="sm" onClick={handleExport}>
        <Download data-icon="inline-start" />
        导出报表
      </Button>
    </>
  );

  return (
    <div className="log-admin-page flex flex-col gap-5">
      {collection === "records" && insight && !insightDismissed ? (
        <PageInsightBar
          variant={insight.severity}
          headline={insight.headline}
          description={insight.description}
          onDismiss={() => {
            writeInsightDismissed();
            setInsightDismissed(true);
          }}
          actions={insight.actions.map((action) => ({
            label: action.label,
            onClick: () => handleInsightAction(action.kind),
            variant: "subtle" as const
          }))}
        />
      ) : null}

      <ViewSwitch variant="tabs" ariaLabel="日志后台集合" value={collection} onValueChange={selectCollection}
        items={[
          { value: "overview", label: "概览", id: "log-tab-overview", panelId: "log-panel-overview" },
          { value: "records", label: "日志分析记录", id: "log-tab-records", panelId: "log-panel-records" },
          { value: "skills", label: "分析技能", id: "log-tab-skills", panelId: "log-panel-skills" },
          { value: "quality", label: "分析质量", id: "log-tab-quality", panelId: "log-panel-quality" }
        ]} />
      <TabPanel id={`log-panel-${collection}`} aria-labelledby={`log-tab-${collection}`}>
        {collection === "overview" ? <LogAdminOverview logs={windowLogs} allLogs={visibleLogs} timeWindow={timeWindow} feedback={qualityRows} feedbackLoading={qualityLoading} feedbackUnavailable={qualityUnavailable}
          controls={<><TimeWindowSelect value={timeWindow} onChange={setTimeWindow} /><div className="flex items-center gap-2">{refreshAction}<Button onClick={() => onNavigate("/logs")}>进入智能分析</Button></div></>}
          onViewRecords={(filter) => { resetFilters(); setOverviewFilter(filter); setLogView("active"); selectCollection("records"); }} /> : null}
        <div hidden={collection !== "skills"}>
          <LogDomainGovernanceSection canGovern={canPerform(state.activeRoleId, "logs.admin-domains")} logActions={logActions} refreshKey={skillsRefreshKey} onNavigate={onNavigate}
            skillRepository={skillRepository} apiMode={apiMode} refreshAction={refreshAction} />
        </div>
        <div hidden={collection !== "quality"}>
          <FeedbackQualityInsightsSection timeWindow={timeWindow} logActions={logActions} refreshKey={feedbackInsightsRefreshKey} onRowsChange={setQualityRows} onLoadingChange={setQualityLoading} onErrorChange={setQualityUnavailable}
            headerActions={reportHeaderActions} onTimeWindowChange={setTimeWindow} onViewRecords={() => { resetFilters(); selectCollection("records"); }} />
        </div>
        {collection === "records" ? (
          <AdminListPage label="日志分析记录"
            headerActions={reportHeaderActions}
            headerContent={<ViewSwitch variant="toggle" ariaLabel="日志视图切换" value={logView} onValueChange={(value) => setLogView(value as "active" | "archived")}
              items={[{ value: "active", label: "活跃日志" }, { value: "archived", label: archivedLogs.length > 0 ? `已归档（${archivedLogs.length}）` : "已归档" }]} />}
            filterBar={<>
              <div className="flex w-full flex-wrap items-center gap-2">
                <TimeWindowSelect value={timeWindow} onChange={setTimeWindow} />
                <SearchField
                  value={tableQuery}
                  onValueChange={setTableQuery}
                  placeholder="搜索文件名、技能或结论"
                  ariaLabel="搜索日志分析记录"
                />
                {overviewFilter ? <span className="text-xs text-muted-foreground">{overviewFilter.kind === "degraded" ? "降级到规则" : overviewFilter.kind === "generic" ? "通用分析" : overviewFilter.kind === "skill" ? "所选技能" : overviewFilter.kind === "review" ? "待复核" : overviewFilter.reason ?? "失败记录"}</span> : null}
                {hasActiveFilters && filteredRows.length > 0 ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="h-7 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    重置筛选
                  </button>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  显示 {filteredRows.length} / {tableSourceLogs.length} 条
                </span>
              </div>
            </>}
            table={{ "aria-label": "日志分析记录", rows: filteredRows, rowKey: (record) => record.id, columns,
              onRowClick: (record) => setSelectedRecordId(record.id), selectedRowKey: selectedRecordId ?? undefined, pageSize: 8 }}
            rowActions={logView === "archived" && canAct ? (record) => ({ label: record.fileName,
              items: logView === "archived" && canAct ? [{ id: "restore", label: "恢复", disabled: pendingActions.has(pendingKey("unarchive", record.id)), onSelect: () => unarchiveLog(record.id) }] : []
            }) : undefined}
            emptyState={{ message: hasActiveFilters ? "未匹配任何记录" : logView === "archived" ? "暂无已归档日志" : "当前时间窗口内暂无日志",
              actionLabel: hasActiveFilters ? "重置筛选" : "前往日志分析", onAction: hasActiveFilters ? resetFilters : () => onNavigate("/logs") }} />
        ) : null}
      </TabPanel>

      <LogRecordDrawer
        key={selectedRecord?.id ?? "closed"}
        record={selectedRecord}
        loadRecord={skillRepository?.getLog}
        skillRepository={skillRepository}
        open={!!selectedRecord}
        onClose={() => setSelectedRecordId(null)}
        onNavigateToWorkbench={(id) => {
          const target = state.logs.find((log) => log.id === id);
          onNavigate(`/logs${target ? `?id=${target.reportId}` : ""}`);
          setSelectedRecordId(null);
        }}
        onReanalyze={(id) => {
          if (!logActions) {
            dispatch({ type: "LOG_ADMIN_REANALYZE_LOG", logId: id });
            setSelectedRecordId(null);
            return;
          }

          void runPendingAction("reanalyze", id, async () => {
            await logActions.rerun({ logId: id });
            setSelectedRecordId(null);
          });
        }}
        onArchive={(id) => {
          const log = state.logs.find((item) => item.id === id);
          if (!logActions) {
            dispatch({ type: "LOG_ADMIN_ARCHIVE_LOG", logId: id });
            if (log) {
              setUndoArchive({ logId: id, fileName: log.fileName });
            }
            setSelectedRecordId(null);
            return;
          }

          void runPendingAction("archive", id, async () => {
            await logActions.archive(id);
            // The post-archive refresh only returns active logs, so the archived
            // record drops out of local state; force the archived view to reload
            // from the server next time it opens instead of showing a stale blank.
            setArchivedLoaded(false);
            if (log) {
              setUndoArchive({ logId: id, fileName: log.fileName });
            }
            setSelectedRecordId(null);
          });
        }}
        onSubmitHelpfulFeedback={(id) => {
          if (!logActions) {
            const log = state.logs.find((item) => item.id === id);
            dispatch({ type: "ADD_NOTIFICATION", message: log ? `${log.fileName} 反馈已记录` : "日志反馈已记录" });
            return;
          }

          void runPendingAction("feedback", id, async () => {
            await logActions.submitFeedback({ logId: id, rating: "helpful" });
            setFeedbackInsightsRefreshKey((key) => key + 1);
          });
        }}
        canAct={canAct}
        reanalyzePending={selectedRecordReanalyzePending}
        archivePending={selectedRecordArchivePending}
        feedbackPending={selectedRecordFeedbackPending}
      />

      {undoArchive ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-lg"
        >
          <span className="text-sm text-foreground">
            已归档 <span className="font-mono text-xs">{undoArchive.fileName}</span>
            <span className="ml-1 text-xs text-muted-foreground">（可随时在「已归档」视图恢复）</span>
          </span>
          <button
            type="button"
            disabled={undoArchivePending}
            aria-busy={undoArchivePending || undefined}
            onClick={() => unarchiveLog(undoArchive.logId)}
            className="text-sm font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            撤销
          </button>
        </div>
      ) : null}
    </div>
  );
}
