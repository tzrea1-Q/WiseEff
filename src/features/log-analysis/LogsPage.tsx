import { SelectControl } from "@/components/common/SelectControl";
import { DecodedFields } from "./DecodedFields";
import { SourceEvidence } from "./SourceEvidence";
import { Button } from "@/components/ui/button";
import { SignalsTab } from "./SignalsTab";
import { LogFileDrawer } from "./LogFileDrawer";
import { ColumnFilter } from "@/components/ColumnFilter";
import { useTopBarActions } from "@/components/layout";
import { NavigatorWorkbench } from "@/components/layout/NavigatorWorkbench";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "@/components/tableFilterUtils";
import { type PageProps } from "@/app/routes";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SearchField } from "@/components/common/SearchField";
import { ViewSwitch } from "@/components/ui/view-switch";
import { RelatedKnowledgeSection } from "@/features/log-analysis/RelatedKnowledgeSection";
import type { LogRelatedParameterPin } from "@/application/ports/LogAnalysisRepository";
import type { ParameterRepository, ProjectSummary } from "@/application/ports/ParameterRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogProtectedProjectBindingListResponse } from "@/infrastructure/http/parameterCatalogDtos";
import type { LogDomain } from "@/domain/logs/types";
import { isSupportedLogUploadFileName, mockLogUploadAccept, supportedTextLogExtensions } from "@/domain/logs/uploadExtensions";
import { formatPercent, normalizePercentValue } from "@/domain/format/formatPercent";
import { formatBytes } from "@/domain/format/formatBytes";
import { classifyAnalysisDegradation } from "@/domain/logs/analysisProvenance";
import { confidenceCaption } from "@/domain/logs/confidenceProvenance";
import { SEVERITY_LABELS, STAGE_LABELS, type LogEvidence, type LogRecord, type LogStageId } from "@/domain/prototype/types";
import { presentError, presentErrorMessage } from "@/infrastructure/http/presentError";
import { EmptyState, PanelHeader, SectionLabel } from "@/workbenchUi";
import {
  AlertTriangle,
  BookPlus,
  Bot,
  Check,
  Copy,
  Download,
  FileText,
  ListChecks,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  Upload,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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

type LogsAuxTab = "report" | "files" | "signals" | "metadata" | "related";
type UploadDialogPhase = "idle" | "validating" | "confirm" | "unsupported";

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

export function LogsPage({ state, dispatch, onNavigate, logActions, runtime, knowledgeCapability }: PageProps) {
  const knowledgeRepository = runtime?.knowledgeRepository;
  const logRepository = runtime?.logAnalysisRepository;
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
  const [pendingUpload, setPendingUpload] = useState<{ fileName: string; previousLogIds: Set<string> } | null>(null);
  const [feedbackLogId, setFeedbackLogId] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [auxTab, setAuxTab] = useState<LogsAuxTab>("report");
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
    setLiveMessage(hasActiveLog ? `已切换到 ${activeLog.fileName}，${logStatusLabels[activeLog.status]}，置信度 ${formatPercent(activeLog.confidence)}` : "暂无日志记录，请上传日志。");
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
      `- 采集时间：${activeLog.capturedAt}`,
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
  const openUploadDialog = useCallback(() => setUploadDialogOpen(true), []);

  useEffect(() => {
    if (!uploadDialogOpen || !logActions) {
      return;
    }

    let cancelled = false;
    void logActions.listLogDomains().then((domains) => {
      if (!cancelled) {
        setUploadLogDomains(domains);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [logActions, uploadDialogOpen]);

  const handleUploadLog = useCallback(
    async (files: File[], supported: boolean, question?: string, logDomainId?: string, relatedParameterPin?: LogRelatedParameterPin) => {
      const file = files[0];
      if (!logActions) {
        dispatch({ type: "SIMULATE_LOG_UPLOAD", fileName: file.name, supported, question });
        setUploadDialogOpen(false);
        return;
      }

      const beforeLogIds = new Set(state.logs.map((log) => log.id));
      setPendingUpload({ fileName: file.name, previousLogIds: beforeLogIds });

      try {
        await logActions.upload({ file, files, analysisQuestion: question, skillId: logDomainId,
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
      <LogsPageHeader onNavigate={onNavigate} />
      <NavigatorWorkbench
        pageKey="logs"
        navigatorLabel="模块导航"
        taskLabel="日志任务区"
        taskState={!hasActiveLog ? { kind: "empty", message: "暂无日志记录，请上传日志。" } : undefined}
        panelId={`logs-aux-${auxTab}`}
        tabId={`logs-aux-tab-${auxTab}`}
        toolbar={<ViewSwitch variant="tabs" ariaLabel="日志辅助信息" value={auxTab}
          onValueChange={(value) => setAuxTab(value as LogsAuxTab)}
          items={([["report", "报告"], ["files", "文件"], ["signals", "信号"], ["metadata", "元数据"], ["related", "相关"]] as const)
            .map(([value, label]) => ({ value, label, id: `logs-aux-tab-${value}`, panelId: `logs-aux-${value}` }))} />}
        primaryAction={<button className="button primary" type="button" onClick={openUploadDialog}>
          <Upload size={16} />上传新日志
        </button>}
        navigator={<aside className="logs-aux-panel" aria-label="历史日志记录">
          <div className="history-panel">
            {state.logs.length ? state.logs.map((log) => (
              <button aria-pressed={log.id === activeLog.id} className={log.id === activeLog.id ? "history-item active" : "history-item"}
                key={log.id} type="button" onClick={() => setSelectedLogId(log.id)}>
                <strong title={log.fileName}>{log.fileName}</strong>
                <span className="logs-history-status">{logStatusLabels[log.status]} · {formatPercent(log.confidence)}</span>
              </button>
            )) : <EmptyState text="暂无日志记录，请上传日志。" />}
          </div>
        </aside>}
      >
      {auxTab === "signals" ? <SignalsTab summary={activeLog.signalSummary} rawFilePath={rawFilePath} rawLineCount={activeLog.rawLines.length}
        allFilesAvailable={Boolean(logRepository?.getLogLines)}
        onAnchor={(anchor) => {
          if (logRepository?.getLogLines) { setViewer({ file: anchor.file, lines: [anchor.line] }); return; }
          setSearchQuery(""); setFocusedSignalLine(anchor.line); setAuxTab("report");
        }} />
        : auxTab === "files" ? <LogFilesTable log={activeLog} /> : auxTab !== "metadata" ? <div className="logs-v2-main">
        {auxTab === "report" || activeLog.status === "Complete" ? <LogConclusionCard
          log={activeLog}
          onAskAgent={onAskAgent}
          onCopyLink={onCopyLink}
          onDistil={canDistil ? onDistil : undefined}
          distilPending={distilPending}
          onExport={onExport}
          onFeedback={() => setFeedbackLogId(activeLog.id)}
          onPrimary={onPrimary}
          relatedParameterLocated={Boolean(logActions && activeLog.relatedParameterId && activeLog.relatedParameterProjectId)}
          relatedParameterUnlocated={relatedParameterUnlocated}
          onRetry={activeLog.status === "Failed" ? openUploadDialog : handleRetryLog}
        /> : null}
        {auxTab === "report" ? (activeLog.status !== "Failed" || !hasActiveLog ? (
          <>
            <LogStageTimeline stage={activeLog.stage} status={activeLog.status} />
            <section className="analysis-card logs-v2-analysis" aria-label="分析结果">
              <PanelHeader title="分析结果" meta={logStatusLabels[activeLog.status]} />
              {(activeLog.files?.filter((file) => file.status === "analyzed").length ?? 0) > 1
                ? <p className="px-3 text-sm text-muted-foreground">当前原始日志：{rawFilePath}；证据按各自文件与行号定位。</p> : null}
              {rawFile && activeLog.rawLines.length < rawFile.lineCount
                ? <p className="px-3 text-sm text-muted-foreground">原始日志预览：前 {activeLog.rawLines.length} 行，共 {rawFile.lineCount} 行。点击证据或信号查看更多上下文。</p> : null}
              <div className="logs-v2-split">
                <RawLogViewer
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
          </>
        ) : null) : <EmptyState text="没有找到关联日志。" />}
        {hasActiveLog && activeLog.status === "Complete" && knowledgeRepository && knowledgeCapability?.canView ? (
          <RelatedKnowledgeSection logId={activeLog.id} repository={knowledgeRepository} onNavigate={onNavigate} />
        ) : null}
      </div> : <LogMetadata log={activeLog} />}
      </NavigatorWorkbench>
      {uploadDialogOpen ? (
        <UploadLogDialog
          accept={logActions ? null : mockLogUploadAccept}
          archivesSupported={!!logActions}
          domains={uploadLogDomains}
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
          onSubmit={(confidence, issue) => {
            const feedbackLog = selectedFeedbackLog;
            if (!logActions) {
              // Mock mode keeps the local acknowledgement through the global toast layer.
              dispatch({
                type: "ADD_NOTIFICATION",
                message: `已记录 ${feedbackLog.reportId} 的分析反馈：${confidence}${issue ? `，${issue}` : ""}`
              });
              setFeedbackLogId(null);
              return;
            }
            setFeedbackPending(true);
            setFeedbackError(null);
            void logActions
              .submitFeedback({
                logId: feedbackLog.id,
                rating: confidence === "high" ? "helpful" : "not_helpful",
                ...(issue ? { note: issue } : {})
              })
              .then(() => {
                setFeedbackLogId(null);
                dispatch({
                  type: "ADD_NOTIFICATION",
                  message: `已提交 ${feedbackLog.reportId} 的分析反馈`
                });
              })
              .catch((error: unknown) => {
                setFeedbackError(presentError(error, "反馈提交失败，请重试。"));
              })
              .finally(() => {
                setFeedbackPending(false);
              });
          }}
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

function UploadLogDialog({
  accept = mockLogUploadAccept,
  archivesSupported = false,
  domains = [],
  parameterRepository,
  parameterCatalogRepository,
  onClose,
  onUpload
}: {
  accept?: string | null;
  archivesSupported?: boolean;
  domains?: LogDomain[];
  parameterRepository?: Pick<ParameterRepository, "listProjects">;
  parameterCatalogRepository?: Pick<ParameterCatalogRepository, "listProtectedProjectBindings">;
  onClose: () => void;
  onUpload: (files: File[], supported: boolean, question?: string, logDomainId?: string,
    relatedParameterPin?: LogRelatedParameterPin) => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<UploadDialogPhase>("idle");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [question, setQuestion] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState<string>(UNCATEGORIZED_LOG_DOMAIN_VALUE);
  const [supported, setSupported] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState("");
  const [bindings, setBindings] = useState<CatalogProtectedProjectBindingListResponse["items"]>([]);
  const [bindingId, setBindingId] = useState("");
  const [bindingLoading, setBindingLoading] = useState(false);
  const [bindingError, setBindingError] = useState("");
  const [bindingRefresh, setBindingRefresh] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const resolvedDomainId = selectedDomainId === UNCATEGORIZED_LOG_DOMAIN_VALUE ? undefined : selectedDomainId;
  const binding = bindings.find((item) => item.projectId === projectId && item.id === bindingId);
  const relatedParameterPin: LogRelatedParameterPin | undefined = binding ? {
    kind: "canonical-pin", projectId, bindingId: binding.id,
    definitionRevisionId: binding.effectiveRevisionId!
  } : undefined;
  const associationReady = !projectId || Boolean(!bindingLoading && !bindingError && relatedParameterPin);

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

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const selectFiles = (files: File[]) => {
    setSelectedFiles(files);
    setSelectedFileName(files.map((file) => file.name).join("、"));
    const limitError = files.length > 2000 ? "文件数超过默认 2000 个上限，实际以服务端配置为准。"
      : files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024 ? "上传总大小超过默认 100 MiB 上限，实际以服务端配置为准。"
      : files.length > 1 && files.some((file) => /\.(gz|tgz|zip|tar)$/i.test(file.name)) ? "请选择多个文本文件或一个压缩包。"
      : new Set(files.map((file) => file.name)).size !== files.length ? "不能上传同名文件。" : "";
    setUploadError(limitError);
    const nextSupported = !limitError && ((archivesSupported && files.length > 1)
      || files.every((file) => isSupportedLogFile(file.name, archivesSupported)));
    setSupported(nextSupported);
    setPhase(files.length ? "validating" : "idle");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { setPhase(files.length ? nextSupported ? "confirm" : "unsupported" : "idle"); timerRef.current = null; }, 200);
  };
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => selectFiles(Array.from(event.target.files ?? []));
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault(); setDragging(false); selectFiles(Array.from(event.dataTransfer.files));
  };

  const resetSelection = () => {
    setPhase("idle");
    setSelectedFiles([]);
    setUploadError("");
    setSelectedFileName("");
    setSupported(false);
    setQuestion("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.focus();
    }
  };

  const uploadSelected = () => {
    if (!selectedFiles.length || uploading || !associationReady) {
      return;
    }
    setUploading(true);
    void Promise.resolve(onUpload(selectedFiles, supported, question, resolvedDomainId, relatedParameterPin))
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
            <p>
              {archivesSupported
                ? "选择多个 .log / .txt / .csv / .json 文本日志，或一个 .tar / .tar.gz / .tgz / .zip / .gz 压缩包。"
                : "选择 .log、.txt、.csv 或 .json 文本日志，雷泽会模拟创建分析任务。"}
            </p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭上传日志" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label
          className={classNames("upload-file-field", dragging && "upload-file-field--dragging")}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span>选择日志文件（支持拖放多份）</span>
          <input aria-label="选择日志文件" ref={fileInputRef} type="file" accept={accept ?? undefined} multiple onChange={handleFileChange} />
        </label>
        {selectedFiles.length ? <ul aria-label="已选文件" className="space-y-2">
          {selectedFiles.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 break-all">{file.name} · {formatBytes(file.size)}</span>
            <button className="button subtle" type="button" disabled={uploading} aria-label={`移除 ${file.name}`}
              onClick={() => selectFiles(selectedFiles.filter((_, at) => at !== index))}>移除</button>
          </li>)}
        </ul> : null}
        {uploadError ? <p role="alert">{uploadError}</p> : null}
        <label className="upload-question-field" htmlFor="upload-log-domain">
          <span>分析技能（可选）</span>
          <SelectControl
            id="upload-log-domain"
            ariaLabel="分析技能（可选）"
            value={selectedDomainId}
            onValueChange={setSelectedDomainId}
            options={[{ value: UNCATEGORIZED_LOG_DOMAIN_VALUE, label: "通用分析" }, ...domains.map((domain) => ({ value: domain.id, label: domain.name }))]}
          />
        </label>
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
                  options={[{ value: "", label: bindingLoading ? "正在加载参数…" : "请选择项目参数" }, ...bindings.map((item) => ({ value: item.id, label: `${item.displayName ?? item.propertyKey} · ${item.locator || item.driverModule} · ${item.id}` }))]} />
                {!bindingLoading && !bindingError && !bindings.length ? <span>该项目暂无可关联的当前参数。</span> : null}
              </label>
            ) : null}
            {bindingError ? <p role="alert">{bindingError}{" "}
              <button type="button" className="button subtle" disabled={uploading || bindingLoading}
                onClick={() => setBindingRefresh((value) => value + 1)}>重试加载关联参数</button>
            </p> : null}
          </>
        ) : null}
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
        <div className={classNames("upload-dialog__state", phase === "unsupported" && "upload-dialog__state--error")}>
          {phase === "idle" ? (
            <p>等待选择日志文件。</p>
          ) : phase === "validating" ? (
            <p>正在读取 {selectedFileName}...</p>
          ) : phase === "confirm" ? (
            <p><strong>{selectedFileName}</strong> 已选择，确认后由服务端校验并分析。</p>
          ) : uploadError ? (
            <p><strong>{selectedFileName}</strong> 请核对以上提示，服务端将执行完整校验。</p>
          ) : (
            <p>
              <strong>{selectedFileName}</strong> 格式不支持。
              {archivesSupported
                ? "请上传文本日志或 .tar / .tar.gz / .tgz / .zip / .gz 压缩包。"
                : "请优先上传 .log / .txt / .csv / .json 文本日志。"}
            </p>
          )}
        </div>
        <div className="upload-dialog__actions">
          {phase === "unsupported" ? (
            <button className="button subtle" type="button" onClick={resetSelection}>
              知道了
            </button>
          ) : (
            <button className="button subtle" type="button" disabled={uploading} onClick={onClose}>
              取消
            </button>
          )}
          {phase === "confirm" ? (
            <button className="button primary" type="button" aria-busy={uploading ? "true" : undefined} disabled={uploading || !associationReady} onClick={uploadSelected}>
              确认上传
            </button>
          ) : null}
          {phase === "unsupported" ? (
            <button className="button danger" type="button" aria-busy={uploading ? "true" : undefined} disabled={uploading || !associationReady} onClick={uploadSelected}>
              仍然上传
            </button>
          ) : null}
        </div>
        </>
      )}
    </ModalDialog>
  );
}

function LogsPageHeader({ onNavigate }: { onNavigate: (path: string) => void }) {
  useTopBarActions(
    <>
      <button className="button subtle" type="button" onClick={() => onNavigate("/")}>
        首页
      </button>
    </>,
    [onNavigate]
  );

  return null;
}

function SeverityBadge({ severity, processing }: { severity: LogRecord["severity"]; processing: boolean }) {
  return (
    <span className={classNames("severity-badge", `severity-badge--${severity.toLowerCase()}`, processing && "severity-badge--processing")}>
      {processing ? "分析中" : SEVERITY_LABELS[severity]}
    </span>
  );
}

function ConfidenceBar({
  value,
  status,
  analysisSource
}: {
  value: number;
  status: LogRecord["status"];
  analysisSource: LogRecord["analysisSource"];
}) {
  const percent = normalizePercentValue(value);
  const tone = status === "Processing" ? "indeterminate" : percent >= 90 ? "high" : percent >= 70 ? "mid" : "low";

  return (
    <div className={classNames("confidence-bar", `confidence-bar--${tone}`)}>
      <div>
        <span>{confidenceCaption(analysisSource, "AI置信度")}</span>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div aria-label="分析置信度" aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} role="progressbar">
        <i style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

function AnalysisProvenanceBadges({ log }: { log: LogRecord }) {
  const degraded = classifyAnalysisDegradation(log);
  if (!degraded && log.analysisSource !== "agent" && !log.logDomainName) {
    return null;
  }

  return (
    <div className="analysis-provenance" data-testid="analysis-provenance">
      <div className="analysis-provenance__badges">
        {degraded ? (
          <span className="analysis-provenance__badge analysis-provenance__badge--degraded" role="status">
            <AlertTriangle size={13} />
            {degraded.label}
          </span>
        ) : log.analysisSource === "agent" ? (
          <span className="analysis-provenance__badge analysis-provenance__badge--agent">
            <Sparkles size={13} />
            Agent 分析
          </span>
        ) : null}
        {log.logDomainName ? (
          <span className="analysis-provenance__badge analysis-provenance__badge--domain">技能 {log.logDomainName}{log.skillRevision ? ` · v${log.skillRevision.number}` : ""}</span>
        ) : null}
      </div>
      {degraded ? (
        <p className="analysis-provenance__reason">{degraded.reason}</p>
      ) : null}
    </div>
  );
}

function LogConclusionCard({
  log,
  onAskAgent,
  onPrimary,
  relatedParameterLocated = false,
  relatedParameterUnlocated = false,
  onExport,
  onCopyLink,
  onDistil,
  distilPending = false,
  onFeedback,
  onRetry
}: {
  log: LogRecord;
  onAskAgent: () => void;
  onPrimary: () => void;
  relatedParameterLocated?: boolean;
  relatedParameterUnlocated?: boolean;
  onExport: () => void;
  onCopyLink: () => void;
  /** Present only when the user holds knowledge:edit (distil-to-knowledge). */
  onDistil?: () => void;
  distilPending?: boolean;
  onFeedback: () => void;
  onRetry: () => void;
}) {
  if (log.status === "Failed") {
    return <LogErrorAlert log={log} onRetry={onRetry} />;
  }

  return (
    <section className="logs-conclusion-card" aria-labelledby="log-conclusion-title">
      <div className="logs-conclusion-head">
        <SeverityBadge severity={log.severity} processing={log.status === "Processing"} />
        <div>
          <h2 id="log-conclusion-title" className={log.status === "Processing" ? "logs-analyzing-anim" : undefined}>{log.status === "Processing" ? "AI 正在分析..." : log.conclusion}</h2>
          <p>{log.status === "Complete" ? log.impact : log.conclusion}</p>
        </div>
      </div>
      {log.status !== "Processing" ? <AnalysisProvenanceBadges log={log} /> : null}
      {log.analysisQuestion ? (
        <div className="logs-analysis-question">
          <strong>用户问题</strong>
          <span>{log.analysisQuestion}</span>
        </div>
      ) : null}
      <ConfidenceBar value={log.confidence} status={log.status} analysisSource={log.analysisSource} />
      <div className="logs-conclusion-actions">
        <button className="button primary" disabled={log.status !== "Complete" || relatedParameterUnlocated} type="button" onClick={onPrimary}>
          <Sparkles size={16} />
          {relatedParameterLocated ? "查看关联参数" : "生成参数修改请求"}
        </button>
        {relatedParameterUnlocated ? <p role="status">旧参数关联缺少可验证的项目与 Binding 定位，无法作为当前参数发起修改。</p> : null}
        <button className="button subtle" disabled={log.status !== "Complete"} type="button" onClick={onExport}>
          <Download size={16} />
          导出报告
        </button>
        {onDistil ? (
          <button
            className="button subtle"
            disabled={log.status !== "Complete" || distilPending}
            aria-busy={distilPending || undefined}
            type="button"
            onClick={onDistil}
          >
            <BookPlus size={16} />
            沉淀为知识
          </button>
        ) : null}
        <button className="button danger" disabled={log.status !== "Complete"} type="button" onClick={onRetry}>
          <RotateCcw size={16} />
          重新分析
        </button>
        <button className="button subtle" type="button" onClick={onCopyLink}>
          <Copy size={16} />
          复制链接
        </button>
        <button className="button subtle" type="button" onClick={onAskAgent}>
          <Bot size={16} />
          问 Agent 关于此结论
        </button>
        <button className="button subtle" type="button" onClick={onFeedback}>
          <MessageSquareText size={16} />
          反馈分析质量
        </button>
      </div>
    </section>
  );
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
  onSubmit: (confidence: string, issue: string) => void;
}) {
  const [confidence, setConfidence] = useState("medium");
  const [issue, setIssue] = useState("");

  const submitFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    onSubmit(confidence, issue.trim());
  };

  return (
    <ModalDialog open onDismiss={onClose} className="confirm-dialog log-feedback-dialog">
      {({ titleId }) => (
      <form className="modal-form-contents" onSubmit={submitFeedback}>
        <div className="upload-dialog__header">
          <div>
            <h2 id={titleId}>
              <strong>反馈分析质量</strong>
            </h2>
            <p>{log.fileName}</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭反馈分析质量" disabled={pending} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="upload-question-field" htmlFor="log-feedback-confidence">
          <span>置信度反馈</span>
          <SelectControl id="log-feedback-confidence" ariaLabel="置信度反馈" value={confidence} disabled={pending} onValueChange={setConfidence}
            options={[{ value: "high", label: "高：判断可信" }, { value: "medium", label: "中：需要复核" }, { value: "low", label: "低：可能误判" }]} />
        </label>
        <label className="upload-question-field" htmlFor="log-feedback-issue">
          <span>可能存在的问题</span>
          <textarea
            id="log-feedback-issue"
            value={issue}
            placeholder="例如：证据链不足、根因误判、缺少关键日志片段"
            rows={4}
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
  const supportedFormats = supportedTextLogExtensions.map((extension) => `.${extension}`).join(" / ");
  return (
    <section className="log-error-alert" role="alert">
      <AlertTriangle size={22} />
      <div>
        <strong>日志处理失败</strong>
        <p>在 {STAGE_LABELS[log.stage]} 阶段失败 · <span>{reason}</span>
          {!isSupportedLogUploadFileName(log.fileName, true) && !reason.includes(supportedFormats)
            ? ` 支持格式：${supportedFormats}`
            : null}
        </p>
        <dl className="logs-metadata-list">
          <div><dt>文件名</dt><dd>{log.fileName}</dd></div>
          <div><dt>文件大小</dt><dd>{log.fileSizeMB} MB</dd></div>
          <div><dt>上传时间</dt><dd>{log.capturedAt}</dd></div>
          <div><dt>上传者</dt><dd>{log.submittedBy}</dd></div>
        </dl>
        <button className="button danger" type="button" onClick={onRetry}>
          重新上传
        </button>
      </div>
    </section>
  );
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
      </div>
      <div className="rawlog-viewer__body" id="rawlog-content">
        <table className="rawlog-table" role="grid">
          <thead>
            <tr>
              <th className="rawlog-table__th-num">#</th>
              <th className="rawlog-table__th-time">{renderRawLogHeader("time", "时间")}</th>
              <th className="rawlog-table__th-module">{renderRawLogHeader("module", "模块")}</th>
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
                  <td className="rawlog-table__time"><code>{parsed.time}</code></td>
                  <td className="rawlog-table__module"><code>{parsed.module}</code></td>
                  <td className="rawlog-table__content"><code>{parsed.content}</code></td>
                </tr>
              );
            })}
            {visibleRawLogRows.length === 0 ? (
              <tr className="rawlog-line">
                <td colSpan={4}>当前筛选条件下没有日志行。</td>
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
  index,
  rawLines,
  focused,
  onHover,
  onClick,
  onOpenFile
}: {
  loadSourceExcerpt?: () => Promise<import("@/features/log-skills/types").SourceExcerpt>;
  evidence: LogEvidence;
  index: number;
  rawLines: string[];
  focused: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
  onOpenFile: (file: string, lines: number[]) => void;
}) {
  const title = `证据 ${String(index + 1).padStart(2, "0")}`;
  const hasSource = !!evidence.sourceLocation;
  const isGroup = !!evidence.filePath || hasSource;

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
        {evidence.lineNumbers.map((lineNumber) => <div key={lineNumber}>
          {evidence.filePath ? <button type="button" className="text-left text-primary underline underline-offset-2"
            onClick={() => onOpenFile(evidence.filePath!, [lineNumber, ...evidence.lineNumbers.filter((line) => line !== lineNumber)])}>
            <code>{evidence.filePath}:{lineNumber}</code>
          </button> : <code>{`#${lineNumber} ${rawLines[lineNumber - 1] ?? ""}`}</code>}
          <DecodedFields events={evidence.decodedFields?.filter((event) => event.line === lineNumber)} />
        </div>)}
        <p>{evidence.inference}</p>
        {evidence.ruleHit ? <small>命中规则：{evidence.ruleHit}</small> : null}
        <SourceEvidence key={`${evidence.id}:${evidence.sourceLocation?.snapshotId ?? ""}`} evidence={evidence} loadExcerpt={loadSourceExcerpt} />
      </div>
      <footer>
        <small>建议处置</small>
        <p>关联处置：{evidence.suggestedAction}</p>
      </footer>
    </div>
  );
}

function LogMetadata({ log }: { log: LogRecord }) {
  return (
    <dl className="logs-metadata-list">
      <div><dt>文件名</dt><dd>{log.fileName}</dd></div>
      <div><dt>设备</dt><dd>{log.device ?? "未记录"}</dd></div>
      <div><dt>采集时间</dt><dd>{log.capturedAt}</dd></div>
    </dl>
  );
}

function LogFilesTable({ log }: { log: LogRecord }) {
  if (!log.files?.length) return <EmptyState text="该历史记录暂无文件清单。" />;
  return <section className="analysis-card overflow-auto" aria-label="日志文件清单">
    <table className="w-full text-left text-sm">
      <thead><tr>{["路径", "大小", "行数", "编码", "状态"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead>
      <tbody>{log.files.map((file) => <tr key={file.path} className="border-t border-border">
        <td className="p-3 break-all">{file.path}</td><td className="p-3">{formatBytes(file.sizeBytes)}</td>
        <td className="p-3">{file.lineCount}</td><td className="p-3">{file.encoding.toUpperCase()}{file.lossy ? " · 有损解码" : ""}</td>
        <td className="p-3">{file.status === "analyzed" ? "已分析" : `已跳过 · ${file.skipReason}`}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
