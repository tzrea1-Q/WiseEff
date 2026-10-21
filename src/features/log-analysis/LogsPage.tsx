import { SelectControl } from "@/components/common/SelectControl";
import { DecodedFields } from "./DecodedFields";
import { SourceEvidence } from "./SourceEvidence";
import { Button } from "@/components/ui/button";
import { SignalsTab } from "./SignalsTab";
import { LogFileDrawer } from "./LogFileDrawer";
import { LogTraceTab } from "./AnalysisTrace";
import { AnalysisCaseDialog } from "@/features/log-skills/AnalysisCaseDialog";
import type { AnalysisCasePrefill } from "@/features/log-skills/types";
import { readRecommendationHeads } from "./recommendationHeads";
import { canPerform } from "@/app/permissions";
import { ColumnFilter } from "@/components/ColumnFilter";
import { useTopBarActions } from "@/components/layout";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "@/components/tableFilterUtils";
import { type PageProps } from "@/app/routes";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SearchField } from "@/components/common/SearchField";
import { ViewSwitch } from "@/components/ui/view-switch";
import { RelatedKnowledgeSection } from "@/features/log-analysis/RelatedKnowledgeSection";
import { adaptivePollDelayMs } from "@/application/logs/logRuntime";
import type { LogAnalysisRepository, LogRelatedParameterPin, LogSkillRecommendations } from "@/application/ports/LogAnalysisRepository";
import type { ParameterRepository, ProjectSummary } from "@/application/ports/ParameterRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogProtectedProjectBindingListResponse } from "@/infrastructure/http/parameterCatalogDtos";
import type { LogDomain, LogSkillRecommendationReason } from "@/domain/logs/types";
import { isSupportedLogUploadFileName, mockLogUploadAccept } from "@/domain/logs/uploadExtensions";
import { formatPercent, normalizePercentValue } from "@/domain/format/formatPercent";
import { formatBytes } from "@/domain/format/formatBytes";
import { FileDropZone } from "@/components/common/FileDropZone";
import { formatLogDateTime } from "@/domain/format/formatDateTime";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { classifyAnalysisDegradation } from "@/domain/logs/analysisProvenance";
import { SEVERITY_LABELS, STAGE_LABELS, type LogEvidence, type LogRecord, type LogStageId } from "@/domain/prototype/types";
import { presentError, presentErrorMessage } from "@/infrastructure/http/presentError";
import { EmptyState, PanelHeader, SectionLabel } from "@/workbenchUi";
import {
  AlertTriangle,
  Check,
  FileText,
  ListChecks,
  Upload,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import "./log-analysis.css";

const logStatusLabels: Record<LogRecord["status"], string> = {
  Processing: "处理中",
  Complete: "已完成",
  Failed: "失败"
};

const LOG_LINE_RE = /^(\S+)\s+(\w+)\s+\[([^\]]+)\]\s*(.*)/;

function parseLogLine(line: string) {
  const m = LOG_LINE_RE.exec(line);
  if (m) {
    return { time: m[1], module: `${m[2]} [${m[3]}]`, content: m[4] };
  }
  return { time: "", module: "", content: line };
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type LogsAuxTab = "report" | "files" | "signals" | "trace";

function createEmptyLogRecord(): LogRecord {
  const nowIso = new Date(0).toISOString();

  return {
    id: "empty-log-selection",
    reportId: "RPT-EMPTY",
    fileName: "暂无日志",
    source: "Empty State",
    fileSizeMB: 0,
    status: "Failed",
    stage: "parse",
    confidence: 0,
    conclusion: "暂无日志记录",
    impact: "上传日志后将生成分析结果。",
    evidence: [],
    suggestedActions: [],
    severity: "Info",
    rawLines: [],
    capturedAt: "等待上传",
    updatedAt: "等待上传",
    updatedAtIso: nowIso,
    submittedBy: "雷泽",
    archiveState: "active"
  };
}

export function LogsPage({ state, dispatch, onNavigate, logActions, runtime, knowledgeCapability, sessionPermissions }: PageProps) {
  const knowledgeRepository = runtime?.knowledgeRepository;
  const logRepository = runtime?.logAnalysisRepository;
  const canViewTrace = sessionPermissions ? sessionPermissions.includes("logs:admin-domains") : canPerform(state.activeRoleId, "logs.admin-domains");
  const [selectedLogDetail, setSelectedLogDetail] = useState<{ summary: LogRecord; record: LogRecord } | null>(null);
  const [selectedLogId, setSelectedLogId] = useState(() => {
    // Deep link: /logs?logId=<id> (the target of 复制链接) restores the selection.
    const requested = new URLSearchParams(window.location.search).get("logId");
    if (requested && state.logs.some((log) => log.id === requested)) {
      return requested;
    }
    return state.logs[0]?.id ?? "";
  });
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadLogDomains, setUploadLogDomains] = useState<LogDomain[]>([]);
  const [distilPending, setDistilPending] = useState(false);
  const [casePrefill, setCasePrefill] = useState<(AnalysisCasePrefill & { sourceRecordId: string }) | null>(null);
  const [casePending, setCasePending] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ fileName: string; previousLogIds: Set<string> } | null>(null);
  const [feedbackLogId, setFeedbackLogId] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackRatings, setFeedbackRatings] = useState<Record<string, "helpful" | "not_helpful">>({});
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("all");
  const historyLogs = useMemo(() => [...state.logs].sort((a, b) =>
    new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()).filter((log) =>
    log.fileName.toLocaleLowerCase().includes(historySearch.trim().toLocaleLowerCase())
    && (historyStatus === "all" || log.status === historyStatus)), [state.logs, historySearch, historyStatus]);
  const [selectedAuxTab, setAuxTab] = useState<LogsAuxTab>("report");
  const auxTab = selectedAuxTab === "trace" && !canViewTrace ? "report" : selectedAuxTab;
  const [hoveredEvidenceId, setHoveredEvidenceId] = useState<string | null>(null);
  const [focusedEvidenceId, setFocusedEvidenceId] = useState<string | null>(null);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [focusedSignalLine, setFocusedSignalLine] = useState<number | null>(null);
  const [viewer, setViewer] = useState<{ file: string; lines: number[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const prevLogCount = useRef(state.logs.length);
  const emptyLogRecord = useMemo(() => createEmptyLogRecord(), []);
  const selectedLog = state.logs.find((log) => log.id === selectedLogId) ?? state.logs[0];

  // The list contains summaries with empty evidence/raw lines. Hydrate only
  // the selected record; a list refresh or job update invalidates this detail.
  useEffect(() => {
    if (!logRepository || !selectedLog || selectedLog.status === "Processing") return;
    let cancelled = false;
    logRepository.getLog(selectedLog.id).then((record) => {
      if (!cancelled && record?.id === selectedLog.id && record.status === selectedLog.status
        && record.updatedAtIso >= selectedLog.updatedAtIso) setSelectedLogDetail({ summary: selectedLog, record });
    }, (error: unknown) => {
      if (!cancelled) dispatch({ type: "ADD_NOTIFICATION", message: presentError(error, "日志详情加载失败，请稍后重试。") });
    });
    return () => { cancelled = true; };
  }, [logRepository, selectedLog, dispatch]);

  // A reload loses the upload/rerun job poll; resume the selected report from its summary.
  useEffect(() => {
    if (!logRepository || !selectedLog || selectedLog.status !== "Processing") return;
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    let scheduledMs = 0;
    const schedule = () => {
      const delayMs = adaptivePollDelayMs(attempt++);
      if (scheduledMs + delayMs > 300_000) return;
      scheduledMs += delayMs;
      timer = window.setTimeout(() => {
        void logRepository.getLog(selectedLog.id).then((record) => {
          if (cancelled) return;
          if (record?.id === selectedLog.id && record.status !== "Processing"
            && record.updatedAtIso >= selectedLog.updatedAtIso) {
            dispatch({ type: "UPSERT_LOG_RECORD", log: record });
          } else schedule();
        }, (error: unknown) => {
          if (!cancelled) dispatch({ type: "ADD_NOTIFICATION", message: presentError(error, "日志详情加载失败，请稍后重试。") });
        });
      }, delayMs);
    };
    schedule();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [logRepository, selectedLog, dispatch]);

  // API mode hydrates logs after mount, so a deep-linked id may not exist yet
  // at first render; consume it once the record arrives.
  const pendingDeepLinkLogIdRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get("logId")
  );
  useEffect(() => {
    const wanted = pendingDeepLinkLogIdRef.current;
    if (!wanted) {
      return;
    }
    if (state.logs.some((log) => log.id === wanted)) {
      setSelectedLogId(wanted);
      pendingDeepLinkLogIdRef.current = null;
      // The hydration that delivered this record must not trigger the
      // newest-upload auto-selection below and override the deep link.
      prevLogCount.current = state.logs.length;
    }
  }, [state.logs]);

  // Keep the address bar shareable (the 复制链接 target) without history spam.
  useEffect(() => {
    if (!selectedLogId || !window.location.pathname.startsWith("/logs") || pendingDeepLinkLogIdRef.current) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("logId") === selectedLogId) {
      return;
    }
    params.set("logId", selectedLogId);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [selectedLogId]);
  const hasActiveLog = Boolean(selectedLog);
  const activeLog = selectedLogDetail && selectedLogDetail.summary === selectedLog ? selectedLogDetail.record : selectedLog ?? emptyLogRecord;
  const rawFile = activeLog.files?.find((file) => file.status === "analyzed");
  const rawFilePath = rawFile?.path ?? activeLog.fileName;
  const readViewerLines = useCallback(async (startLine: number, endLine: number) => {
    const file = viewer?.file ?? rawFilePath;
    if (logRepository?.getLogLines) return logRepository.getLogLines(activeLog.id, file, startLine, endLine);
    if (file !== rawFilePath) throw new Error("当前日志视图未包含此文件，请连接日志服务后重试。");
    return { file, startLine, endLine: Math.min(endLine, activeLog.rawLines.length), totalLines: activeLog.rawLines.length,
      lines: activeLog.rawLines.slice(startLine - 1, endLine).map((content, index) => ({ lineNumber: startLine + index, content })) };
  }, [logRepository, activeLog.id, activeLog.rawLines, rawFilePath, viewer?.file]);
  const relatedParameterUnlocated = Boolean(logActions && activeLog.relatedParameterId && !activeLog.relatedParameterProjectId);
  const evidenceByLine = useMemo(() => {
    const map = new Map<number, LogEvidence[]>();

    for (const evidence of activeLog.evidence) {
      if (evidence.filePath && evidence.filePath !== rawFilePath) continue;
      for (const lineNumber of evidence.lineNumbers) {
        map.set(lineNumber, [...(map.get(lineNumber) ?? []), evidence]);
      }
    }

    return map;
  }, [activeLog, rawFilePath]);
  const matchLines = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }

    return activeLog.rawLines.reduce<number[]>((items, line, index) => {
      if (line.toLowerCase().includes(query)) {
        items.push(index + 1);
      }
      return items;
    }, []);
  }, [activeLog.rawLines, searchQuery]);

  useEffect(() => {
    if (state.logs.length > prevLogCount.current) {
      setSelectedLogId(state.logs[0].id);
      setAuxTab("report");
    }
    prevLogCount.current = state.logs.length;
  }, [state.logs]);

  // Reducer notifications render through the global AppToastLayer in both
  // runtime modes (the API-mode inbox never receives ADD_NOTIFICATION), so no
  // per-page bridge is needed here.

  useEffect(() => {
    setSearchQuery("");
    setActiveMatchIndex(0);
    setHoveredEvidenceId(null);
    setFocusedEvidenceId(null);
    setHoveredLine(null);
    setFocusedSignalLine(null);
    setViewer(null);
  }, [activeLog.id]);

  useEffect(() => {
    if (auxTab !== "report" || focusedSignalLine === null) return;
    const row = document.querySelector<HTMLElement>(`[data-testid="rawlog-line-${focusedSignalLine}"]`);
    row?.scrollIntoView({ block: "center" });
    row?.focus({ preventScroll: true });
  }, [auxTab, focusedSignalLine]);

  useEffect(() => {
    setLiveMessage(hasActiveLog ? `已切换到 ${activeLog.fileName}，${logStatusLabels[activeLog.status]}${activeLog.status === "Complete" ? `，置信度 ${formatPercent(activeLog.confidence)}` : ""}` : "暂无日志记录，请上传日志。");
  }, [activeLog.confidence, activeLog.fileName, activeLog.id, activeLog.status, hasActiveLog]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (activeMatchIndex > Math.max(matchLines.length - 1, 0)) {
      setActiveMatchIndex(Math.max(matchLines.length - 1, 0));
    }
  }, [activeMatchIndex, matchLines.length]);

  useEffect(() => {
    if (!pendingUpload) {
      return;
    }

    const createdLog = state.logs.find((log) => !pendingUpload.previousLogIds.has(log.id));
    if (createdLog) {
      setPendingUpload(null);
      setUploadDialogOpen(false);
    }
  }, [pendingUpload, state.logs]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && searchInputRef.current) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const focusEvidence = (id: string) => {
    setFocusedEvidenceId(id);
    const evidence = activeLog.evidence.find((item) => item.id === id);
    const firstLine = evidence?.lineNumbers[0];
    if (!firstLine || (evidence?.filePath && evidence.filePath !== rawFilePath)) {
      return;
    }

    document.querySelector(`[data-testid="rawlog-line-${firstLine}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const focusLineEvidence = (lineNumber: number) => {
    const evidence = evidenceByLine.get(lineNumber)?.[0];
    if (!evidence) {
      return;
    }

    setFocusedEvidenceId(evidence.id);
    document.getElementById(`evidence-card-${evidence.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const onPrimary = () => {
    if (!hasActiveLog) {
      return;
    }

    const params = new URLSearchParams();

    if (activeLog.relatedParameterId && activeLog.relatedParameterProjectId) {
      params.set("project", activeLog.relatedParameterProjectId);
      params.set("bindingId", activeLog.relatedParameterId);
    } else if (activeLog.relatedParameterId && !logActions) {
      params.set("parameter", activeLog.relatedParameterId);
    }
    params.set("logId", activeLog.id);

    onNavigate(`/parameters?${params.toString()}`);
  };

  const onExport = () => {
    if (!hasActiveLog) {
      return;
    }

    const markdown = [
      `# ${activeLog.fileName}`,
      "",
      `- 状态：${logStatusLabels[activeLog.status]}`,
      `- 严重度：${SEVERITY_LABELS[activeLog.severity]}`,
      `- 置信度：${formatPercent(activeLog.confidence)}`,
      `- 上传时间：${formatLogDateTime(activeLog.capturedAt)}`,
      "",
      "## 结论",
      activeLog.conclusion,
      "",
      "## 影响",
      activeLog.impact,
      "",
      "## 证据链",
      ...activeLog.evidence.flatMap((evidence, index) => [
        `### 证据 ${String(index + 1).padStart(2, "0")} · ${STAGE_LABELS[evidence.stageId]}`,
        ...evidence.lineNumbers.map((lineNumber) => evidence.filePath ? `> ${evidence.filePath}:${lineNumber}` : `> \`${activeLog.rawLines[lineNumber - 1] ?? ""}\``),
        "",
        `**推断**：${evidence.inference}`,
        "",
        `**处置**：${evidence.suggestedAction}`,
        ""
      ])
    ].join("\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `${activeLog.fileName}-analysis.md`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    dispatch({ type: "ADD_NOTIFICATION", message: "报告已导出" });
  };

  const onCopyLink = async () => {
    if (!hasActiveLog) {
      return;
    }

    const link = new URL("/logs", window.location.origin);

    link.searchParams.set("logId", activeLog.id);

    try {
      await navigator.clipboard.writeText(link.toString());
      dispatch({ type: "ADD_NOTIFICATION", message: "分析链接已复制" });
    } catch {
      dispatch({ type: "ADD_NOTIFICATION", message: "浏览器不支持剪贴板写入" });
    }
  };

  const onAskAgent = () => {
    document.querySelector<HTMLButtonElement>(".xiaoze-chat-toggle-anchor button")?.click();
  };

  // Distil-to-knowledge (design D15): pre-fills a knowledge draft from this
  // analysis record and hands off into the /knowledge draft editor deep link.
  const canDistil = Boolean(knowledgeRepository && knowledgeCapability?.canEdit);
  const onDistil = useCallback(async () => {
    if (!knowledgeRepository || !hasActiveLog || distilPending) {
      return;
    }
    setDistilPending(true);
    try {
      const draft = await knowledgeRepository.distillFromLog(activeLog.id);
      dispatch({ type: "ADD_NOTIFICATION", message: "已生成知识草稿,请在知识库中审阅后发布" });
      onNavigate(`/knowledge?entryId=${encodeURIComponent(draft.id)}`);
    } catch (error) {
      dispatch({
        type: "ADD_NOTIFICATION",
        message: presentError(error, "沉淀为知识失败,请稍后重试")
      });
    } finally {
      setDistilPending(false);
    }
  }, [activeLog.id, dispatch, distilPending, hasActiveLog, knowledgeRepository, onNavigate]);

  const selectedFeedbackLog = feedbackLogId ? state.logs.find((log) => log.id === feedbackLogId) ?? null : null;
  const submitFeedback = async (log: LogRecord, rating: "helpful" | "not_helpful", note?: string) => {
    if (feedbackPending) return;
    setFeedbackPending(true);
    setFeedbackError(null);
    try {
      await logActions?.submitFeedback({ logId: log.id, rating, ...(note ? { note } : {}) });
      setFeedbackRatings((current) => ({ ...current, [log.id]: rating }));
      setFeedbackLogId(null);
      dispatch({ type: "ADD_NOTIFICATION", message: "已提交分析反馈" });
    } catch (error) {
      setFeedbackError(presentError(error, "反馈提交失败，请重试。"));
    } finally {
      setFeedbackPending(false);
    }
  };
  const openUploadDialog = useCallback(() => setUploadDialogOpen(true), []);

  useEffect(() => {
    if (!uploadDialogOpen || !logActions) {
      return;
    }

    let cancelled = false;
    void logActions.listLogDomains().then((domains) => {
      if (!cancelled) {
        setUploadLogDomains(domains.filter((domain) => domain.currentRevision?.publishedAt !== null));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [logActions, uploadDialogOpen]);

  const handleUploadLog = useCallback(
    async (files: File[], supported: boolean, question?: string, logDomainId?: string, relatedParameterPin?: LogRelatedParameterPin, sourceVersion?: string, skillSelection?: "generic") => {
      const file = files[0];
      if (!logActions) {
        dispatch({ type: "SIMULATE_LOG_UPLOAD", fileName: file.name, supported, question });
        setUploadDialogOpen(false);
        return;
      }

      const beforeLogIds = new Set(state.logs.map((log) => log.id));
      setPendingUpload({ fileName: file.name, previousLogIds: beforeLogIds });

      try {
        await logActions.upload({ file, files, analysisQuestion: question, skillId: logDomainId, sourceVersion,
          ...(skillSelection ? { skillSelection } : {}),
          ...(relatedParameterPin ? { relatedParameterPin } : {}) });
      } catch (error) {
        setPendingUpload(null);
        throw error;
      }
    },
    [dispatch, logActions, state.logs]
  );
  const handleRetryLog = useCallback(() => {
    if (!logActions) {
      setUploadDialogOpen(true);
      return;
    }

    void logActions.rerun({ logId: activeLog.id, analysisQuestion: activeLog.analysisQuestion }).catch(() => undefined);
  }, [activeLog.analysisQuestion, activeLog.id, logActions]);

  return (
    <div className="logs-v2">
      <div role="status" aria-live="polite" aria-label="日志切换状态" className="sr-only" data-testid="log-live-region">
        {liveMessage}
      </div>
      <LogsPageHeader />
      {hasActiveLog ? <NavigatorWorkbench
        pageKey="logs"
        navigatorLabel="日志记录"
        taskLabel="日志任务区"
        panelId={hasActiveLog ? `logs-aux-${auxTab}` : undefined}
        tabId={hasActiveLog ? `logs-aux-tab-${auxTab}` : undefined}
        toolbar={hasActiveLog ? <ViewSwitch variant="tabs" ariaLabel="日志辅助信息" value={auxTab}
          onValueChange={(value) => setAuxTab(value as LogsAuxTab)}
          items={([["report", "报告"], ["signals", "信号"], ["files", "文件"], ["trace", "分析轨迹"]] as const)
            .filter(([value]) => value !== "trace" || canViewTrace)
            .map(([value, label]) => ({ value, label, id: `logs-aux-tab-${value}`, panelId: `logs-aux-${value}` }))} /> : undefined}
        primaryAction={hasActiveLog ? <Button onClick={openUploadDialog}>
          <Upload size={16} />上传新日志
        </Button> : undefined}
        navigator={<aside className="logs-aux-panel" aria-label="历史日志记录">
          {state.logs.length ? <div className="logs-history-filters">
            <SearchField value={historySearch} onValueChange={setHistorySearch} ariaLabel="搜索日志记录" placeholder="搜索文件名" />
            <SelectControl ariaLabel="日志状态" value={historyStatus} onValueChange={setHistoryStatus}
              options={[{ value: "all", label: "全部" }, { value: "Complete", label: "已完成" }, { value: "Processing", label: "处理中" }, { value: "Failed", label: "失败" }]} />
          </div> : null}
          <div className="history-panel">
            {historyLogs.map((log) => (
              <button aria-pressed={log.id === activeLog.id} className={log.id === activeLog.id ? "history-item active" : "history-item"}
                key={log.id} type="button" onClick={() => setSelectedLogId(log.id)}>
                <strong title={log.fileName}>{log.fileName}</strong>
                <span className="logs-history-status"><span className="analysis-provenance__badge">{logStatusLabels[log.status]}</span></span>
                <time>{formatLogDateTime(log.capturedAt)}</time>
              </button>
            ))}
            {state.logs.length > 0 && !historyLogs.length ? <p>没有匹配的日志记录</p> : null}
          </div>
        </aside>}
      >
      {hasActiveLog ? <LogConclusionCard
          log={activeLog}
          canViewSkill={canViewTrace}
          onNavigate={onNavigate}
          onAskAgent={onAskAgent}
          onCopyLink={onCopyLink}
          onDistil={canDistil ? onDistil : undefined}
          distilPending={distilPending}
          onSaveCase={canViewTrace && activeLog.status === "Complete" && activeLog.logDomainId && logRepository?.getAnalysisCasePrefill && logRepository.createAnalysisCase ? () => {
            setCasePending(true);
            void logRepository.getAnalysisCasePrefill!(activeLog.id).then((prefill) => setCasePrefill({ ...prefill, sourceRecordId: activeLog.id }))
              .catch((cause) => dispatch({ type: "ADD_NOTIFICATION", message: presentError(cause, "无法加载测试用例，请重试。") }))
              .finally(() => setCasePending(false));
          } : undefined}
          casePending={casePending}
          onExport={onExport}
          feedbackRating={feedbackRatings[activeLog.id]}
          feedbackPending={feedbackPending}
          feedbackError={selectedFeedbackLog ? null : feedbackError}
          onFeedback={(rating) => { setFeedbackError(null); if (rating === "helpful") void submitFeedback(activeLog, rating); else setFeedbackLogId(activeLog.id); }}
          onPrimary={onPrimary}
          relatedParameterLocated={Boolean(activeLog.relatedParameterId && (activeLog.relatedParameterProjectId || !logActions))}
          relatedParameterUnlocated={relatedParameterUnlocated}
          onRetry={activeLog.status === "Failed" ? openUploadDialog : handleRetryLog}
        /> : null}
      {!hasActiveLog ? <div className="logs-empty-state"><h2>还没有日志</h2><p>支持文本日志或压缩包</p>
        <Button onClick={openUploadDialog}>上传日志</Button></div> : auxTab === "trace" ? (canViewTrace ? <LogTraceTab key={`${activeLog.id}:${activeLog.updatedAtIso}`} logId={activeLog.id} analysis={activeLog} repository={logRepository}
        onOpenLine={(file, line, lines) => setViewer({ file, lines: lines ?? [line] })} /> : null)
        : auxTab === "signals" ? <SignalsTab summary={activeLog.signalSummary} rawFilePath={rawFilePath} rawLineCount={activeLog.rawLines.length} fileCount={activeLog.files?.length || 1}
        allFilesAvailable={Boolean(logRepository?.getLogLines)}
        onAnchor={(anchor) => {
          if (logRepository?.getLogLines) { setViewer({ file: anchor.file, lines: [anchor.line] }); return; }
          setSearchQuery(""); setFocusedSignalLine(anchor.line); setAuxTab("report");
        }} />
        : auxTab === "files" ? <LogFilesTable log={activeLog} /> : <div className="logs-v2-main">

        {activeLog.status !== "Failed" ? (
          <>
            {activeLog.status === "Processing" ? <LogStageTimeline stage={activeLog.stage} status={activeLog.status} /> : null}
            {activeLog.status === "Complete" ? <>
            <section className="analysis-card logs-v2-analysis" aria-label="分析结果">
              <PanelHeader title="分析结果" />
              {(activeLog.files?.filter((file) => file.status === "analyzed").length ?? 0) > 1
                ? <p className="px-3 text-sm text-muted-foreground">当前原始日志：{rawFilePath}；证据按各自文件与行号定位。</p> : null}
              {rawFile && activeLog.rawLines.length > 0 && activeLog.rawLines.length < rawFile.lineCount
                ? <p className="px-3 text-sm text-muted-foreground">原始日志预览：前 {activeLog.rawLines.length} 行，共 {rawFile.lineCount} 行。点击证据或信号查看更多上下文。</p> : null}
              <div className="logs-v2-split">
                <RawLogViewer
                  key={activeLog.id}
                  activeMatchIndex={activeMatchIndex}
                  evidenceByLine={evidenceByLine}
                  focusedEvidenceId={focusedEvidenceId}
                  focusedSignalLine={focusedSignalLine}
                  hoveredEvidenceId={hoveredEvidenceId}
                  hoveredLine={hoveredLine}
                  matchLines={matchLines}
                  rawLines={activeLog.rawLines}
                  searchInputRef={searchInputRef}
                  searchQuery={searchQuery}
                  onActiveMatchIndexChange={setActiveMatchIndex}
                  onClickLine={focusLineEvidence}
                  onHoverLine={setHoveredLine}
                  onSearchQueryChange={setSearchQuery}
                />
                <EvidenceChainPanel
                  loadSourceExcerpt={logRepository?.getSourceEvidence ? (evidenceId) => logRepository.getSourceEvidence!(activeLog.id, evidenceId) : undefined}
                  rawFilePath={rawFilePath}
                  evidence={activeLog.evidence}
                  focusedEvidenceId={focusedEvidenceId}
                  hoveredLine={hoveredLine}
                  rawLines={activeLog.rawLines}
                  onClickEvidence={focusEvidence}
                  onHoverEvidence={setHoveredEvidenceId}
                  onOpenFile={(file, lines) => setViewer({ file, lines })}
                />
              </div>
            </section>
            </> : null}
          </>
        ) : null}
        {hasActiveLog && activeLog.status === "Complete" && knowledgeRepository && knowledgeCapability?.canView ? (
          <RelatedKnowledgeSection logId={activeLog.id} repository={knowledgeRepository} onNavigate={onNavigate} />
        ) : null}
      </div>}
      </NavigatorWorkbench> : <section className="logs-empty-state" aria-label="日志任务区">
        <h2>还没有日志</h2><p>支持文本日志或压缩包</p><Button onClick={openUploadDialog}>上传日志</Button>
      </section>}
      {casePrefill ? <AnalysisCaseDialog title="存为分析用例" initial={casePrefill} availableFiles={casePrefill.files}
        originalUploads={casePrefill.originalUploads} sourceDegradation={casePrefill.sourceDegradation} onClose={() => setCasePrefill(null)} onSave={async (input) => {
        await logRepository!.createAnalysisCase!(casePrefill.skillId, { ...input, sourceRecordId: casePrefill.sourceRecordId });
        dispatch({ type: "ADD_NOTIFICATION", message: "已保存为分析用例" });
      }} /> : null}
      {uploadDialogOpen ? (
        <UploadLogDialog
          accept={logActions ? null : mockLogUploadAccept}
          archivesSupported={!!logActions}
          domains={uploadLogDomains}
          recommendationRepository={logActions ? logRepository : undefined}
          parameterRepository={logActions ? runtime?.parameterRepository : undefined}
          parameterCatalogRepository={logActions ? runtime?.parameterCatalogRepository : undefined}
          onClose={() => setUploadDialogOpen(false)}
          onUpload={handleUploadLog}
        />
      ) : null}
      {selectedFeedbackLog ? (
        <LogAnalysisFeedbackDialog
          log={selectedFeedbackLog}
          pending={feedbackPending}
          error={feedbackError}
          onClose={() => {
            if (feedbackPending) return;
            setFeedbackLogId(null);
            setFeedbackError(null);
          }}
          onSubmit={(note) => { void submitFeedback(selectedFeedbackLog, "not_helpful", note); }}
        />
      ) : null}
      {/* Reducer notifications render through the global AppToastLayer in both runtime modes. */}
      {viewer ? <LogFileDrawer key={`${activeLog.id}:${viewer.file}:${viewer.lines.join(",")}`} file={viewer.file} citedLines={viewer.lines}
        readLines={readViewerLines} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}

function isSupportedLogFile(fileName: string, archivesSupported = false) {
  return isSupportedLogUploadFileName(fileName, archivesSupported);
}

const UNCATEGORIZED_LOG_DOMAIN_VALUE = "";
const AUTO_LOG_SKILL_VALUE = "__auto__";

function recommendationReasonLabel(reason: LogSkillRecommendationReason) {
  const ref = reason.ref ?? "";
  switch (reason.source) {
    case "skill-glob": return `适用文件规则 ${ref}${reason.role ? `（${reason.role}）` : ""}`;
    case "extractor-glob": return `抽取规则文件 ${ref}`;
    case "extractor": return `抽取规则 ${ref} 命中`;
    case "signal": return `信号规则「${ref}」命中`;
    case "format-timestamp": return "时间戳格式匹配";
    case "format-severity": return `${ref === "error" ? "错误" : ref === "warn" ? "警告" : ref === "info" ? "信息" : ref} 级别格式匹配`;
    default: return reason.kind === "file" ? "适用文件匹配" : "日志特征匹配";
  }
}

function RecommendationReasons({ reasons, label }: { reasons: LogSkillRecommendationReason[]; label: string }) {
  return <>
    <ul className="log-skill-reasons" aria-label={label}>
      {reasons.slice(0, 5).map((reason, index) => <li key={index}>
        <code className="log-skill-reason-file">{reason.file}</code><span>{recommendationReasonLabel(reason)}</span>
      </li>)}
    </ul>
    {reasons.length > 5 ? <p className="log-skill-reasons-more">另有 {reasons.length - 5} 条</p> : null}
  </>;
}

function UploadLogDialog({
  accept = mockLogUploadAccept,
  archivesSupported = false,
  domains = [],
  recommendationRepository,
  parameterRepository,
  parameterCatalogRepository,
  onClose,
  onUpload
}: {
  accept?: string | null;
  archivesSupported?: boolean;
  domains?: LogDomain[];
  recommendationRepository?: Pick<LogAnalysisRepository, "recommendLogSkills">;
  parameterRepository?: Pick<ParameterRepository, "listProjects">;
  parameterCatalogRepository?: Pick<ParameterCatalogRepository, "listProtectedProjectBindings">;
  onClose: () => void;
  onUpload: (files: File[], supported: boolean, question?: string, logDomainId?: string,
    relatedParameterPin?: LogRelatedParameterPin, sourceVersion?: string, skillSelection?: "generic") => Promise<void> | void;
}) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [question, setQuestion] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState<string>(AUTO_LOG_SKILL_VALUE);
  const [recommendation, setRecommendation] = useState<LogSkillRecommendations | null>(null);
  const [recommending, setRecommending] = useState(false);
  const manualSelection = useRef(false);
  const recommended = recommendation?.recommendations.find((item) => item.skillId === recommendation.recommendedSkillId);
  const recommendedDomain = domains.find((domain) => domain.id === recommended?.skillId);
  const resolvedDomainId = selectedDomainId === AUTO_LOG_SKILL_VALUE ? recommendedDomain?.id
    : selectedDomainId === UNCATEGORIZED_LOG_DOMAIN_VALUE ? undefined : selectedDomainId;
  const [sourceVersion, setSourceVersion] = useState("");
  const readySourceVersions = domains.find((domain) => domain.id === resolvedDomainId)?.readySourceVersions ?? [];
  const [supported, setSupported] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [bindings, setBindings] = useState<CatalogProtectedProjectBindingListResponse["items"]>([]);
  const [bindingId, setBindingId] = useState("");
  const [bindingLoading, setBindingLoading] = useState(false);
  const [bindingError, setBindingError] = useState("");
  const [bindingRefresh, setBindingRefresh] = useState(0);
  const binding = bindings.find((item) => item.projectId === projectId && item.id === bindingId);
  const relatedParameterPin: LogRelatedParameterPin | undefined = binding ? {
    kind: "canonical-pin", projectId, bindingId: binding.id,
    definitionRevisionId: binding.effectiveRevisionId!
  } : undefined;
  const associationReady = !projectId || Boolean(!bindingLoading && !bindingError && relatedParameterPin);

  useEffect(() => {
    const recommend = recommendationRepository?.recommendLogSkills;
    setRecommendation(null);
    if (!manualSelection.current) { setSelectedDomainId(AUTO_LOG_SKILL_VALUE); setSourceVersion(""); }
    if (!recommend || !selectedFiles.length) { setRecommending(false); return; }
    const controller = new AbortController();
    setRecommending(true);
    // Advisory only: reading archives and scoring share a three-second deadline.
    const timeout = window.setTimeout(() => { controller.abort(); setRecommending(false); }, 3000);
    void readRecommendationHeads(selectedFiles, controller.signal)
      .then((files) => controller.signal.aborted ? null : recommend(files, controller.signal))
      .then((result) => { if (!controller.signal.aborted) setRecommendation(result); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setRecommending(false); window.clearTimeout(timeout); });
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [selectedFiles, recommendationRepository]);

  useEffect(() => {
    if (!parameterRepository) return;
    let cancelled = false;
    setBindingError("");
    void parameterRepository.listProjects().then((items) => {
      if (!cancelled) setProjects(items);
    }).catch((cause) => {
      if (!cancelled) setBindingError(presentError(cause, "加载可关联项目失败；可以不关联参数上传。"));
    });
    return () => { cancelled = true; };
  }, [parameterRepository, bindingRefresh]);

  useEffect(() => {
    setBindings([]);
    setBindingId("");
    if (!projectId || !parameterRepository) {
      setBindingLoading(false);
      return;
    }
    let cancelled = false;
    setBindingLoading(true);
    setBindingError("");
    void (parameterCatalogRepository?.listProtectedProjectBindings?.(projectId)
      ?? Promise.reject(new Error("Canonical binding reader unavailable"))).then(({ items }) => {
      if (cancelled) return;
      setBindings(items.filter((item) =>
        item.projectId === projectId && item.id && item.effectiveRevisionId && item.currentValueId));
    }).catch((cause) => {
      if (!cancelled) setBindingError(presentError(cause, "加载项目参数失败；请重试或取消关联。"));
    }).finally(() => { if (!cancelled) setBindingLoading(false); });
    return () => { cancelled = true; };
  }, [parameterRepository, parameterCatalogRepository, projectId, bindingRefresh]);

  const selectFiles = (files: File[]) => {
    setSelectedFiles(files);
    const limitError = files.length > 2000 ? "文件数超过默认 2000 个上限，实际以服务端配置为准。"
      : files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024 ? "上传总大小超过默认 100 MiB 上限，实际以服务端配置为准。"
      : files.length > 1 && files.some((file) => /\.(gz|tgz|zip|tar)$/i.test(file.name)) ? "请选择多个文本文件或一个压缩包。"
      : new Set(files.map((file) => file.name)).size !== files.length ? "不能上传同名文件。" : "";
    setSelectionError(limitError);
    setUploadError("");
    const nextSupported = !limitError && ((archivesSupported && files.length > 1)
      || files.every((file) => isSupportedLogFile(file.name, archivesSupported)));
    setSupported(nextSupported);
  };

  const uploadSelected = () => {
    if (!selectedFiles.length || selectionError || uploading || !associationReady) {
      return;
    }
    setUploading(true);
    void Promise.resolve(onUpload(selectedFiles, supported, question, manualSelection.current ? resolvedDomainId : undefined, relatedParameterPin,
      readySourceVersions.includes(sourceVersion) ? sourceVersion : undefined,
      manualSelection.current && !resolvedDomainId ? "generic" : undefined))
      .catch((error) => setUploadError(presentError(error, "上传失败，请重试。")))
      .finally(() => setUploading(false));
  };

  return (
    <ModalDialog open onDismiss={uploading ? undefined : onClose} className="confirm-dialog upload-dialog">
      {({ titleId }) => (
        <>
        <div className="upload-dialog__header">
          <div>
            <h2 id={titleId}><strong>上传日志</strong></h2>
            <p>文本日志或压缩包，单次最多 100 MiB</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭上传日志" disabled={uploading} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <FileDropZone label="选择日志文件" accept={accept ?? undefined} multiple disabled={uploading} files={selectedFiles}
          onSelect={selectFiles} onRemove={(index) => selectFiles(selectedFiles.filter((_, at) => at !== index))}
          hint={archivesSupported ? "支持 .log、.txt、.csv、.json 文本日志，或一个 .tar、.tar.gz、.tgz、.zip、.gz 压缩包。" : "支持 .log、.txt、.csv、.json 文本日志；演示模式将模拟创建分析任务。"} />
        {selectionError || uploadError ? <p role="alert">{selectionError || uploadError}</p> : null}
        <label className="upload-question-field" htmlFor="upload-log-domain">
          <span>分析技能（可选）</span>
          <SelectControl
            id="upload-log-domain"
            ariaLabel="分析技能（可选）"
            value={selectedDomainId}
            onValueChange={(value) => {
              manualSelection.current = value !== AUTO_LOG_SKILL_VALUE;
              setSelectedDomainId(value);
              setSourceVersion("");
            }}
            options={[{ value: AUTO_LOG_SKILL_VALUE, label: recommendedDomain ? `${recommendedDomain.name}（推荐）` : "自动推荐（无匹配时通用分析）" },
              { value: UNCATEGORIZED_LOG_DOMAIN_VALUE, label: "不使用技能（通用分析）" }, ...domains
                .filter((domain) => domain.id !== recommendedDomain?.id || domain.id === selectedDomainId)
                .map((domain) => ({ value: domain.id, label: domain.name, hidden: domain.id === recommendedDomain?.id }))]}
          />
        </label>
        {recommending ? <p role="status" className="text-sm text-muted-foreground">正在推荐分析技能…</p> : null}
        {recommended && recommendedDomain ? <div className="text-sm text-muted-foreground">
          <p>推荐：{recommendedDomain.name} · {recommended.reasons[0] ? `匹配 ${recommended.reasons[0].file}` : "匹配日志特征"}（{recommended.reasons.length} 条理由）</p>
          <details><summary>查看理由</summary><RecommendationReasons reasons={recommended.reasons} label="技能推荐理由" /></details>
        </div> : null}
        {readySourceVersions.length || parameterRepository ? <details className="upload-advanced-options">
          <summary>高级选项</summary>
        {readySourceVersions.length ? (
          <label className="upload-question-field" htmlFor="upload-source-version">
            <span>源码版本（可选）</span>
            <SelectControl id="upload-source-version" ariaLabel="源码版本（可选）" ariaDescribedBy="upload-source-version-help"
              value={sourceVersion} disabled={uploading} onValueChange={setSourceVersion}
              options={[{ value: "", label: "使用默认快照" }, ...readySourceVersions.map((version) => ({ value: version, label: version }))]} />
            <span id="upload-source-version-help">选择源码快照版本；不选择时使用技能版本的默认快照。</span>
          </label>
        ) : null}
        {parameterRepository ? (
          <>
            <label className="upload-question-field" htmlFor="upload-parameter-project">
              <span>关联参数的项目（可选）</span>
              <SelectControl id="upload-parameter-project" ariaLabel="关联参数的项目（可选）" value={projectId} disabled={uploading}
                onValueChange={setProjectId}
                options={[{ value: "", label: "不关联参数" }, ...projects.map((project) => ({ value: project.id, label: `${project.code} · ${project.name}` }))]} />
            </label>
            {projectId ? (
              <label className="upload-question-field" htmlFor="upload-parameter-binding">
                <span>项目参数</span>
                <SelectControl id="upload-parameter-binding" ariaLabel="项目参数" value={bindingId} disabled={uploading || bindingLoading}
                  onValueChange={setBindingId}
                  options={[{ value: "", label: bindingLoading ? "正在加载参数…" : "请选择项目参数" }, ...bindings.map((item) => ({ value: item.id, label: item.displayName || "未命名参数" }))]} />
                {!bindingLoading && !bindingError && !bindings.length ? <span>该项目暂无可关联的当前参数。</span> : null}
              </label>
            ) : null}
            {bindingError ? <p role="alert">{bindingError}{" "}
              <button type="button" className="button subtle" disabled={uploading || bindingLoading}
                onClick={() => setBindingRefresh((value) => value + 1)}>重试加载关联参数</button>
            </p> : null}
          </>
        ) : null}
        </details> : null}
        <label className="upload-question-field" htmlFor="upload-analysis-question">
          <span>分析问题（可选）</span>
          <textarea
            id="upload-analysis-question"
            value={question}
            placeholder="例如：为什么充电后段降频？"
            rows={3}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        {selectedFiles.length && !supported && !selectionError ? <p className="text-sm text-muted-foreground">未识别文件扩展名，可仍然上传，由服务端校验是否为文本日志。</p> : null}
        <div className="upload-dialog__actions">
            <button className="button subtle" type="button" disabled={uploading} onClick={onClose}>
              取消
            </button>
            <button className="button primary" type="button" aria-busy={uploading ? "true" : undefined} disabled={!selectedFiles.length || !supported || uploading || !associationReady} onClick={uploadSelected}>
              开始分析
            </button>
          {selectedFiles.length && !supported && !selectionError ? (
            <button className="button subtle" type="button" aria-busy={uploading ? "true" : undefined} disabled={uploading || !associationReady} onClick={uploadSelected}>
              仍然上传
            </button>
          ) : null}
        </div>
        </>
      )}
    </ModalDialog>
  );
}

function LogsPageHeader() {
  useTopBarActions(null, []);

  return null;
}

function ConfidenceBar({
  value,
  status,
}: {
  value: number;
  status: LogRecord["status"];
}) {
  const percent = normalizePercentValue(value);
  const tone = status === "Processing" ? "indeterminate" : percent >= 90 ? "high" : percent >= 70 ? "mid" : "low";

  return (
    <div className={classNames("confidence-bar", `confidence-bar--${tone}`)}>
      <div>
        <span>置信度</span>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div aria-label="分析置信度" aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} role="progressbar">
        <i style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

function AnalysisProvenanceBadges({ log, canViewSkill, onNavigate }: { log: LogRecord; canViewSkill: boolean; onNavigate: (path: string) => void }) {
  const degraded = classifyAnalysisDegradation(log);

  return (
    <div className="analysis-provenance" data-testid="analysis-provenance">
      <div className="analysis-provenance__badges">
        <span className="analysis-provenance__badge">{log.analysisSource === "rules-fallback" ? "规则回退" : "AI 分析"}</span>
        {degraded && log.analysisSource !== "rules-fallback" ? <span className="analysis-provenance__badge">提前收敛</span> : null}
        {log.logDomainName && log.skillSelection?.mode !== "generic" ? <>
          {canViewSkill && log.logDomainId ? <a className="analysis-provenance__badge" href={`/log-admin/skills/${encodeURIComponent(log.logDomainId)}`}
            onClick={(event) => { event.preventDefault(); onNavigate(`/log-admin/skills/${encodeURIComponent(log.logDomainId!)}`); }}>
            技能：{log.logDomainName}{log.skillRevision ? ` v${log.skillRevision.number}` : ""}
          </a> : <span className="analysis-provenance__badge">技能：{log.logDomainName}{log.skillRevision ? ` v${log.skillRevision.number}` : ""}</span>}
          {log.skillSelection ? <span className="analysis-provenance__badge">{log.skillSelection.mode === "recommended" ? "自动推荐" : "手动选择"}</span> : null}
        </> : <span className="analysis-provenance__badge">通用分析</span>}
        {log.sourceSnapshot && log.sourceSnapshotSelection !== "none" ? (
          <span className="analysis-provenance__badge analysis-provenance__badge--domain">
            源码{log.sourceSnapshot.versionLabel ? ` ${log.sourceSnapshot.versionLabel}` : ""}
          </span>
        ) : null}
      </div>
      {log.requestedSourceVersion && log.sourceSnapshotSelection !== "matched_version" ? (
        <p className="analysis-provenance__reason">未找到源码版本 {log.requestedSourceVersion}；{log.sourceSnapshot ? "已使用默认快照。" : "没有可用的默认快照。"}</p>
      ) : null}
      {log.knowledgeRevisions?.length ? <details className="analysis-provenance__reason">
        <summary>实际检索的知识修订（{log.knowledgeRevisions.length}）</summary>
        <ul>{log.knowledgeRevisions.map(({ entryId, revisionId, pages }) => {
          const href = revisionId && pages?.length
            ? `/knowledge?${new URLSearchParams({ entryId, revisionId, page: String(pages[0]) })}`
            : `/knowledge?entryId=${encodeURIComponent(entryId)}`;
          return <li key={`${entryId}:${revisionId}`}>
            {revisionId ? <><a href={href} onClick={(event) => {
              event.preventDefault(); onNavigate(href);
            }}>查看知识条目（已固定修订）</a>
            {pages?.length ? <span> 第 {pages.map((page, index) => {
              const pageHref = `/knowledge?${new URLSearchParams({ entryId, revisionId, page: String(page) })}`;
              return <span key={page}>{index ? "、" : ""}<a href={pageHref} aria-label={`打开第 ${page} 页`}
                onClick={(event) => { event.preventDefault(); onNavigate(pageHref); }}>{page}</a></span>;
            })} 页</span> : null}</> : <span>无权查看的条目</span>}
          </li>;
        })}</ul>
      </details> : null}
      {degraded ? (
        <p className="analysis-provenance__reason">{degraded.reason}</p>
      ) : null}
    </div>
  );
}

function LogConclusionCard({
  log, canViewSkill, onNavigate, onAskAgent, onPrimary, relatedParameterLocated = false,
  relatedParameterUnlocated = false, onExport, onCopyLink, onDistil, distilPending = false,
  onSaveCase, casePending = false, onFeedback, feedbackRating, feedbackPending, feedbackError, onRetry
}: {
  log: LogRecord;
  canViewSkill: boolean;
  onNavigate: (path: string) => void;
  onAskAgent: () => void;
  onPrimary: () => void;
  relatedParameterLocated?: boolean;
  relatedParameterUnlocated?: boolean;
  onExport: () => void;
  onCopyLink: () => void;
  onDistil?: () => void;
  distilPending?: boolean;
  onSaveCase?: () => void;
  casePending?: boolean;
  onFeedback: (rating: "helpful" | "not_helpful") => void;
  feedbackRating?: "helpful" | "not_helpful";
  feedbackPending: boolean;
  feedbackError: string | null;
  onRetry: () => void;
}) {
  if (log.status === "Failed") return <LogErrorAlert log={log} onRetry={onRetry} />;
  const complete = log.status === "Complete";
  return <section className="logs-conclusion-card" aria-labelledby="log-conclusion-title">
    <div className="logs-conclusion-head">
      <span className="analysis-provenance__badge">{logStatusLabels[log.status]}</span>
      <div>
        <h2 id="log-conclusion-title" className={!complete ? "logs-analyzing-anim" : undefined}>{complete ? log.conclusion : "正在分析…"}</h2>
        {complete ? <p>{log.impact}</p> : null}
      </div>
    </div>
    <LogHeaderMeta log={log} />
    {complete ? <AnalysisProvenanceBadges log={log} canViewSkill={canViewSkill} onNavigate={onNavigate} /> : null}
    {log.analysisQuestion ? <div className="logs-analysis-question"><strong>用户问题</strong><span>{log.analysisQuestion}</span></div> : null}
    {complete ? <>
      <ConfidenceBar value={log.confidence} status={log.status} />
      <div className="logs-conclusion-actions">
        {relatedParameterLocated ? <Button onClick={onPrimary}>查看关联参数</Button> : null}
        <RowActionMenu label="报告操作" triggerLabel="更多" items={[
          { id: "export", label: "导出报告", onSelect: onExport },
          { id: "copy", label: "复制链接", onSelect: onCopyLink },
          { id: "ask", label: "问 Agent", onSelect: onAskAgent },
          ...(onDistil ? [{ id: "distil", label: "沉淀为知识", disabled: distilPending, onSelect: onDistil }] : []),
          ...(onSaveCase ? [{ id: "case", label: "存为分析用例", disabled: casePending, onSelect: onSaveCase }] : []),
          ...(!relatedParameterLocated && !relatedParameterUnlocated ? [{ id: "parameter", label: "生成参数修改请求", onSelect: onPrimary }] : []),
          { id: "retry", label: "重新分析", onSelect: onRetry }
        ]} />
        <div role="group" aria-label="分析反馈" className="logs-conclusion-actions">
          {feedbackRating ? <span role="status">已反馈：{feedbackRating === "helpful" ? "有帮助" : "没帮助"}</span> : null}
          <Button variant="outline" size="sm" disabled={feedbackPending} aria-pressed={feedbackRating === "helpful"} onClick={() => onFeedback("helpful")}>有帮助</Button>
          <Button variant="outline" size="sm" disabled={feedbackPending} aria-pressed={feedbackRating === "not_helpful"} onClick={() => onFeedback("not_helpful")}>没帮助</Button>
        </div>
      </div>
      {feedbackError ? <p role="alert">{feedbackError}</p> : null}
    </> : null}
  </section>;
}

function LogHeaderMeta({ log }: { log: LogRecord }) {
  const sizeBytes = log.files?.length ? log.files.reduce((sum, file) => sum + file.sizeBytes, 0) : log.fileSizeMB * 1024 ** 2;
  return <p className="logs-header-meta">
    {log.createdByCredentialId ? `通过集成凭据 ${log.createdByCredentialName ?? "上传"}` : log.submittedBy}
    {" · "}{formatLogDateTime(log.capturedAt)}{" · "}
    {log.files?.length || 1} 个文件 / {formatBytes(sizeBytes)}
  </p>;
}

function LogAnalysisFeedbackDialog({
  log,
  pending = false,
  error = null,
  onClose,
  onSubmit
}: {
  log: LogRecord;
  pending?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (issue: string) => void;
}) {
  const [issue, setIssue] = useState("");

  const submitFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    onSubmit(issue.trim());
  };

  return (
    <ModalDialog open onDismiss={onClose} className="confirm-dialog log-feedback-dialog">
      {({ titleId }) => (
      <form className="modal-form-contents" onSubmit={submitFeedback}>
        <div className="upload-dialog__header">
          <div>
            <h2 id={titleId}>
              <strong>没帮助</strong>
            </h2>
            <p>{log.fileName}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭反馈分析质量" disabled={pending} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="upload-question-field" htmlFor="log-feedback-issue">
          <span>补充说明（可选）</span>
          <textarea
            id="log-feedback-issue"
            value={issue}
            placeholder="例如：根因判断错误、证据不足"
            rows={3}
            disabled={pending}
            onChange={(event) => setIssue(event.target.value)}
          />
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="upload-dialog__actions">
          <button className="button subtle" type="button" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? "提交中…" : "提交反馈"}
          </button>
        </div>
      </form>
      )}
    </ModalDialog>
  );
}

function LogErrorAlert({ log, onRetry }: { log: LogRecord; onRetry: () => void }) {
  // Fixed short title + one mapped reason line: the backend failureReason is
  // English and used to render twice (conclusion falls back to failureReason).
  const reason = presentErrorMessage(
    log.failureReason ?? log.conclusion,
    "日志处理失败，请重试或重新上传。"
  );
  return <section className="log-error-alert" role="alert">
    <AlertTriangle size={22} aria-hidden />
    <div>
      <strong>日志处理失败</strong>
      <p>在 {STAGE_LABELS[log.stage]} 阶段失败 · <span>{reason}</span></p>
      <p>{log.fileName}</p>
      <LogHeaderMeta log={log} />
      <Button variant="outline" onClick={onRetry}>重新上传</Button>
    </div>
  </section>;
}

function LogStageTimeline({ stage, status }: { stage: LogStageId; status: LogRecord["status"] }) {
  const order: LogStageId[] = ["parse", "pattern", "rootcause", "report"];
  const currentIndex = Math.max(0, order.indexOf(stage));

  return (
    <ol className="log-timeline" aria-label="分析流程">
      {order.map((id, index) => {
        const done = index < currentIndex || (index === currentIndex && status === "Complete");
        const current = index === currentIndex && status === "Processing";
        const failed = index === currentIndex && status === "Failed";
        const aborted = index > currentIndex && status === "Failed";
        const className = classNames(
          "log-timeline__step",
          done && "log-timeline__step--done",
          current && "log-timeline__step--current",
          failed && "log-timeline__step--failed",
          aborted && "log-timeline__step--aborted"
        );

        return (
          <li aria-current={current ? "step" : undefined} className={className} key={id}>
            <span>{failed ? "!" : done ? <Check size={14} /> : index + 1}</span>
            <small>{STAGE_LABELS[id]}{aborted ? " · 已中止" : ""}</small>
          </li>
        );
      })}
    </ol>
  );
}

function RawLogViewer({
  rawLines,
  evidenceByLine,
  hoveredEvidenceId,
  focusedEvidenceId,
  focusedSignalLine,
  hoveredLine,
  searchQuery,
  matchLines,
  activeMatchIndex,
  searchInputRef,
  onSearchQueryChange,
  onActiveMatchIndexChange,
  onHoverLine,
  onClickLine
}: {
  rawLines: string[];
  evidenceByLine: Map<number, LogEvidence[]>;
  hoveredEvidenceId: string | null;
  focusedEvidenceId: string | null;
  focusedSignalLine: number | null;
  hoveredLine: number | null;
  searchQuery: string;
  matchLines: number[];
  activeMatchIndex: number;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchQueryChange: (value: string) => void;
  onActiveMatchIndexChange: React.Dispatch<React.SetStateAction<number>>;
  onHoverLine: (line: number | null) => void;
  onClickLine: (line: number) => void;
}) {
  const activeMatchLine = matchLines[activeMatchIndex];
  const matchLineSet = useMemo(() => new Set(matchLines), [matchLines]);
  const [rawLogColumnFilters, setRawLogColumnFilters] = useState<HeaderFilterState>({});
  const [wrapLines, setWrapLines] = useState(false);
  const rawLogRows = useMemo(
    () =>
      rawLines.map((line, index) => ({
        line,
        lineNumber: index + 1,
        parsed: parseLogLine(line)
      })),
    [rawLines]
  );
  const visibleRawLogRows = useMemo(
    () =>
      rawLogRows.filter((row) =>
        (["time", "module", "content"] as const).every((key) => {
          const selectedValues = rawLogColumnFilters[key] ?? [];
          return selectedValues.length === 0 || selectedValues.includes(row.parsed[key]);
        })
      ),
    [rawLogColumnFilters, rawLogRows]
  );
  const showTime = visibleRawLogRows.some((row) => row.parsed.time);
  const showModule = visibleRawLogRows.some((row) => row.parsed.module);
  const toggleRawLogColumnFilter = (key: "time" | "module" | "content", value: string) => {
    setRawLogColumnFilters((current) => ({
      ...current,
      [key]: toggleFilterValue(current[key] ?? [], value)
    }));
  };
  const clearRawLogColumnFilter = (key: "time" | "module" | "content") => {
    setRawLogColumnFilters((current) => ({ ...current, [key]: [] }));
  };
  const renderRawLogHeader = (key: "time" | "module" | "content", label: string) => (
    <div className="rawlog-table__head-cell">
      <span>{label}</span>
      <ColumnFilter
        label={label}
        groupLabel={`${label}筛选`}
        values={uniqueFilterValues(rawLogRows, (row) => row.parsed[key])}
        selectedValues={rawLogColumnFilters[key] ?? []}
        onToggle={(value) => toggleRawLogColumnFilter(key, value)}
        onClear={() => clearRawLogColumnFilter(key)}
      />
    </div>
  );
  const moveMatch = (delta: number) => {
    if (matchLines.length === 0) {
      return;
    }
    onActiveMatchIndexChange((index) => Math.min(matchLines.length - 1, Math.max(0, index + delta)));
  };
  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      onSearchQueryChange("");
      event.currentTarget.blur();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveMatch(1);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveMatch(-1);
    }
  };

  return (
    <section className="rawlog-viewer" aria-label="原始日志">
      <SectionLabel icon={<FileText size={16} />} label="原始日志" />
      <div className="rawlog-toolbar">
        <SearchField
          ref={searchInputRef}
          value={searchQuery}
          onValueChange={onSearchQueryChange}
          onKeyDown={handleSearchKeyDown}
          placeholder="在日志中搜索..."
          ariaLabel="在日志中搜索"
        />
        <button aria-label="上一个匹配" disabled={matchLines.length === 0} type="button" onClick={() => moveMatch(-1)}>
          ↑
        </button>
        <button aria-label="下一个匹配" disabled={matchLines.length === 0} type="button" onClick={() => moveMatch(1)}>
          ↓
        </button>
        <output aria-live="polite">
          {searchQuery.trim() === "" ? "" : matchLines.length === 0 ? "无匹配。按 Esc 清空" : `${activeMatchIndex + 1} / ${matchLines.length} 匹配`}
        </output>
        <Button variant="outline" size="sm" aria-pressed={wrapLines} onClick={() => setWrapLines((value) => !value)}>自动换行</Button>
        {Object.values(rawLogColumnFilters).some((values) => values.length) ? <Button variant="outline" size="sm" onClick={() => setRawLogColumnFilters({})}>清空筛选</Button> : null}
      </div>
      <div className="rawlog-viewer__body" id="rawlog-content">
        <table className={classNames("rawlog-table", wrapLines && "rawlog-table--wrap")} role="grid">
          <thead>
            <tr>
              <th className="rawlog-table__th-num">#</th>
              {showTime ? <th className="rawlog-table__th-time">{renderRawLogHeader("time", "时间")}</th> : null}
              {showModule ? <th className="rawlog-table__th-module">{renderRawLogHeader("module", "模块")}</th> : null}
              <th className="rawlog-table__th-content">{renderRawLogHeader("content", "内容")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRawLogRows.map(({ line, lineNumber, parsed }) => {
              const evidence = evidenceByLine.get(lineNumber) ?? [];
              const isHoverAnchor = evidence.some((item) => item.id === hoveredEvidenceId);
              const isFocusAnchor = lineNumber === focusedSignalLine || evidence.some((item) => item.id === focusedEvidenceId);
              const isHoveredLine = hoveredLine === lineNumber && evidence.length > 0;
              const isMatch = matchLineSet.has(lineNumber);
              const isCurrentMatch = activeMatchLine === lineNumber;

              return (
                <tr
                  className={classNames(
                    "rawlog-line",
                    isHoverAnchor && "rawlog-line--anchor-hover",
                    isFocusAnchor && "rawlog-line--anchor-focus",
                    isHoveredLine && "rawlog-line--line-hover",
                    isMatch && "rawlog-line--match",
                    isCurrentMatch && "rawlog-line--match-current"
                  )}
                  data-testid={`rawlog-line-${lineNumber}`}
                  tabIndex={lineNumber === focusedSignalLine ? -1 : undefined}
                  key={`${lineNumber}-${line}`}
                >
                  <td>
                    <button
                      aria-label={evidence.length ? `跳转到第 ${lineNumber} 行对应证据` : undefined}
                      className="rawlog-line__num"
                      disabled={evidence.length === 0}
                      type="button"
                      onClick={() => onClickLine(lineNumber)}
                      onMouseEnter={() => onHoverLine(lineNumber)}
                      onMouseLeave={() => onHoverLine(null)}
                    >
                      {lineNumber}
                    </button>
                  </td>
                  {showTime ? <td className="rawlog-table__time"><code>{parsed.time}</code></td> : null}
                  {showModule ? <td className="rawlog-table__module"><code>{parsed.module}</code></td> : null}
                  <td className="rawlog-table__content"><code>{parsed.content}</code></td>
                </tr>
              );
            })}
            {visibleRawLogRows.length === 0 ? (
              <tr className="rawlog-line">
                <td colSpan={2 + Number(showTime) + Number(showModule)}>当前筛选条件下没有日志行。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EvidenceChainPanel({
  loadSourceExcerpt,
  evidence,
  rawFilePath,
  rawLines,
  focusedEvidenceId,
  hoveredLine,
  onHoverEvidence,
  onClickEvidence,
  onOpenFile
}: {
  loadSourceExcerpt?: (evidenceId: string) => Promise<import("@/features/log-skills/types").SourceExcerpt>;
  evidence: LogEvidence[];
  rawFilePath: string;
  rawLines: string[];
  focusedEvidenceId: string | null;
  hoveredLine: number | null;
  onHoverEvidence: (id: string | null) => void;
  onClickEvidence: (id: string) => void;
  onOpenFile: (file: string, lines: number[]) => void;
}) {
  return (
    <section className="evidence-chain" aria-label="日志分析证据链">
      <SectionLabel icon={<ListChecks size={16} />} label="日志分析证据链" />
      <div className="evidence-chain-list">
        {evidence.map((item, index) => {
          const focused = item.id === focusedEvidenceId;
          const relatedToHoveredLine = hoveredLine !== null && (!item.filePath || item.filePath === rawFilePath) && item.lineNumbers.includes(hoveredLine);

          return (
            <EvidenceCard
              loadSourceExcerpt={loadSourceExcerpt ? () => loadSourceExcerpt(item.id) : undefined}
              evidence={item}
              rawFilePath={rawFilePath}
              focused={focused || relatedToHoveredLine}
              index={index}
              key={item.id}
              rawLines={rawLines}
              onClick={() => onClickEvidence(item.id)}
              onHover={(id) => onHoverEvidence(id)}
              onOpenFile={onOpenFile}
            />
          );
        })}
      </div>
    </section>
  );
}

function EvidenceCard({
  loadSourceExcerpt,
  evidence,
  rawFilePath,
  index,
  rawLines,
  focused,
  onHover,
  onClick,
  onOpenFile
}: {
  loadSourceExcerpt?: () => Promise<import("@/features/log-skills/types").SourceExcerpt>;
  evidence: LogEvidence;
  rawFilePath: string;
  index: number;
  rawLines: string[];
  focused: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
  onOpenFile: (file: string, lines: number[]) => void;
}) {
  const title = `证据 ${String(index + 1).padStart(2, "0")}`;
  const hasSource = !!evidence.sourceLocation;
  const isGroup = !!evidence.filePath || hasSource || evidence.lineNumbers.length > 3;

  return (
    <div
      aria-label={`${title} ${STAGE_LABELS[evidence.stageId]}`}
      aria-pressed={isGroup ? undefined : focused}
      className={classNames("evidence-card", focused && "evidence-card--focused", `evidence-card--${evidence.stageId}`)}
      id={`evidence-card-${evidence.id}`}
      role={isGroup ? "group" : "button"}
      tabIndex={isGroup ? undefined : 0}
      onClick={(event) => {
        if (isGroup && (event.target as Element).closest("button, a, input, select, textarea, [role='button'], [role='link']")) return;
        onClick();
      }}
      onKeyDown={isGroup ? undefined : (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); }
      }}
      onMouseEnter={() => onHover(evidence.id)}
      onMouseLeave={() => onHover(null)}
    >
      <header>
        {isGroup ? <Button variant="link" size="sm" aria-pressed={focused} aria-label={`${title} ${STAGE_LABELS[evidence.stageId]}`} title="定位到原始日志" onClick={onClick}>{title}</Button> : <span>{title}</span>}
        <strong>{STAGE_LABELS[evidence.stageId]}</strong>
      </header>
      <div className="evidence-card__body">
        {evidence.lineNumbers.slice(0, 3).map((lineNumber) => <div key={lineNumber}>
          {evidence.filePath ? <button type="button" className="text-left text-primary underline underline-offset-2"
            onClick={() => onOpenFile(evidence.filePath!, [lineNumber, ...evidence.lineNumbers.filter((line) => line !== lineNumber)])}>
            <code>{evidence.filePath}:{lineNumber}</code>
          </button> : <code>{`#${lineNumber} ${rawLines[lineNumber - 1] ?? ""}`}</code>}
          <DecodedFields events={evidence.decodedFields?.filter((event) => event.line === lineNumber)} />
        </div>)}
        {evidence.lineNumbers.length > 3 ? <Button variant="outline" size="sm" onClick={() => onOpenFile(evidence.filePath ?? rawFilePath, evidence.lineNumbers)}>
          其余 {evidence.lineNumbers.length - 3} 行
        </Button> : null}
        <p>{evidence.inference}</p>
        <SourceEvidence key={`${evidence.id}:${evidence.sourceLocation?.snapshotId ?? ""}`} evidence={evidence} loadExcerpt={loadSourceExcerpt} />
      </div>
      <footer className="evidence-card__suggestion">
        <p>建议：{evidence.suggestedAction}</p>
      </footer>
    </div>
  );
}

function LogFilesTable({ log }: { log: LogRecord }) {
  if (!log.files?.length) return <EmptyState text="该历史记录暂无文件清单。" />;
  return <section className="analysis-card overflow-auto" aria-label="日志文件清单">
    <table className="w-full text-left text-sm">
      <thead><tr>{["路径", "角色", "大小", "行数", "编码", "状态"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
      <tbody>{log.files.map((file) => <tr key={file.path} className="border-t border-border">
        <td className="p-3 break-all">{file.path}</td><td className="p-3">{file.role ?? "—"}</td><td className="p-3">{formatBytes(file.sizeBytes)}</td>
        <td className="p-3">{file.lineCount}</td><td className="p-3">{file.encoding.toUpperCase()}{file.lossy ? " · 有损解码" : ""}</td>
        <td className="p-3">{file.status === "analyzed" ? "已分析" : `已跳过 · ${file.skipReason}`}{file.skillMatched === false ? " · 仅通用分析" : ""}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
