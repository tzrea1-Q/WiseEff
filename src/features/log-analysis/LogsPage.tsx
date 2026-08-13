import { ColumnFilter } from "@/components/ColumnFilter";
import { useTopBarActions } from "@/components/layout";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "@/components/tableFilterUtils";
import { type PageProps } from "@/app/routes";
import { ModalDialog } from "@/components/common/ModalDialog";
import type { LogDomain } from "@/domain/logs/types";
import { formatPercent, normalizePercentValue } from "@/domain/format/formatPercent";
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
  Search,
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

type LogsAuxTab = "history" | "metadata" | "related";
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
  const [selectedLogId, setSelectedLogId] = useState(state.logs[0]?.id ?? "");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadLogDomains, setUploadLogDomains] = useState<LogDomain[]>([]);
  const [distilPending, setDistilPending] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ fileName: string; previousLogIds: Set<string> } | null>(null);
  const [feedbackLogId, setFeedbackLogId] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [auxTab, setAuxTab] = useState<LogsAuxTab>("history");
  const [hoveredEvidenceId, setHoveredEvidenceId] = useState<string | null>(null);
  const [focusedEvidenceId, setFocusedEvidenceId] = useState<string | null>(null);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [liveMessage, setLiveMessage] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const prevLogCount = useRef(state.logs.length);
  const emptyLogRecord = useMemo(() => createEmptyLogRecord(), []);
  const selectedLog = state.logs.find((log) => log.id === selectedLogId) ?? state.logs[0];
  const hasActiveLog = Boolean(selectedLog);
  const activeLog = selectedLog ?? emptyLogRecord;
  const evidenceByLine = useMemo(() => {
    const map = new Map<number, LogEvidence[]>();

    for (const evidence of activeLog.evidence) {
      for (const lineNumber of evidence.lineNumbers) {
        map.set(lineNumber, [...(map.get(lineNumber) ?? []), evidence]);
      }
    }

    return map;
  }, [activeLog]);
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
  }, [activeLog.id]);

  useEffect(() => {
    setLiveMessage(`已切换到 ${activeLog.fileName}，${logStatusLabels[activeLog.status]}，置信度 ${formatPercent(activeLog.confidence)}`);
  }, [activeLog.confidence, activeLog.fileName, activeLog.id, activeLog.status]);

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
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
    if (!firstLine) {
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

    if (activeLog.relatedParameterId) {
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
        ...evidence.lineNumbers.map((lineNumber) => `> \`${activeLog.rawLines[lineNumber - 1] ?? ""}\``),
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
    async (file: File, supported: boolean, question?: string, logDomainId?: string) => {
      if (!logActions) {
        dispatch({ type: "SIMULATE_LOG_UPLOAD", fileName: file.name, supported, question });
        setUploadDialogOpen(false);
        return;
      }

      const beforeLogIds = new Set(state.logs.map((log) => log.id));
      setPendingUpload({ fileName: file.name, previousLogIds: beforeLogIds });

      try {
        await logActions.upload({ file, analysisQuestion: question, logDomainId });
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
      <div className="logs-v2-main">
        <LogsPageHeader onNavigate={onNavigate} onUpload={openUploadDialog} />
        <LogConclusionCard
          log={activeLog}
          onAskAgent={onAskAgent}
          onCopyLink={onCopyLink}
          onDistil={canDistil ? onDistil : undefined}
          distilPending={distilPending}
          onExport={onExport}
          onFeedback={() => setFeedbackLogId(activeLog.id)}
          onPrimary={onPrimary}
          onRetry={handleRetryLog}
        />
        <LogStageTimeline stage={activeLog.stage} status={activeLog.status} />
        <section className="analysis-card logs-v2-analysis" aria-label="分析结果">
          <PanelHeader title="分析结果" meta={logStatusLabels[activeLog.status]} />
          <div className="logs-v2-split">
            <RawLogViewer
              activeMatchIndex={activeMatchIndex}
              evidenceByLine={evidenceByLine}
              focusedEvidenceId={focusedEvidenceId}
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
              evidence={activeLog.evidence}
              focusedEvidenceId={focusedEvidenceId}
              hoveredLine={hoveredLine}
              rawLines={activeLog.rawLines}
              onClickEvidence={focusEvidence}
              onHoverEvidence={setHoveredEvidenceId}
            />
          </div>
        </section>
      </div>
      <LogsAuxPanel
        activeLog={activeLog}
        auxTab={auxTab}
        logs={state.logs}
        onSelectLog={setSelectedLogId}
        onTabChange={setAuxTab}
      />
      {uploadDialogOpen ? (
        <UploadLogDialog
          accept={logActions ? null : ".log,.txt,.json"}
          archivesSupported={!!logActions}
          domains={uploadLogDomains}
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
    </div>
  );
}

function isSupportedLogFile(fileName: string, archivesSupported = false) {
  // API mode also accepts .csv text plus .gz / single-entry .zip archives
  // (unpacked server-side); mock mode keeps its original .log/.txt/.json set.
  return archivesSupported ? /\.(log|txt|csv|json|gz|zip)$/i.test(fileName) : /\.(log|txt|json)$/i.test(fileName);
}

const UNCATEGORIZED_LOG_DOMAIN_VALUE = "";

function UploadLogDialog({
  accept = ".log,.txt,.json",
  archivesSupported = false,
  domains = [],
  onClose,
  onUpload
}: {
  accept?: string | null;
  archivesSupported?: boolean;
  domains?: LogDomain[];
  onClose: () => void;
  onUpload: (file: File, supported: boolean, question?: string, logDomainId?: string) => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<UploadDialogPhase>("idle");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [question, setQuestion] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState<string>(UNCATEGORIZED_LOG_DOMAIN_VALUE);
  const [supported, setSupported] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const resolvedDomainId = selectedDomainId === UNCATEGORIZED_LOG_DOMAIN_VALUE ? undefined : selectedDomainId;

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const validateFile = (file: File) => {
    const nextSupported = isSupportedLogFile(file.name, archivesSupported);

    setSelectedFile(file);
    setSelectedFileName(file.name);
    setSupported(nextSupported);
    setPhase("validating");

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setPhase(nextSupported ? "confirm" : "unsupported");
      timerRef.current = null;
    }, 200);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setSelectedFile(null);
      setSelectedFileName("");
      setSupported(false);
      setPhase("idle");
      return;
    }
    if (files.length > 1) {
      for (let i = 0; i < files.length; i++) {
        void Promise.resolve(onUpload(files[i], isSupportedLogFile(files[i].name, archivesSupported), question, resolvedDomainId)).catch(() => undefined);
      }
      return;
    }
    validateFile(files[0]);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      for (let i = 0; i < files.length; i++) {
        void Promise.resolve(onUpload(files[i], isSupportedLogFile(files[i].name, archivesSupported), question, resolvedDomainId)).catch(() => undefined);
      }
      return;
    }
    validateFile(files[0]);
  };

  const resetSelection = () => {
    setPhase("idle");
    setSelectedFile(null);
    setSelectedFileName("");
    setSupported(false);
    setQuestion("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.focus();
    }
  };

  const uploadSelected = () => {
    if (!selectedFile || uploading) {
      return;
    }
    setUploading(true);
    void Promise.resolve(onUpload(selectedFile, supported, question, resolvedDomainId))
      .catch(() => undefined)
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
                ? "选择 .log / .txt / .csv 文本日志，或单文件 .gz、单条目 .zip 压缩包（服务端解压后分析）。"
                : "选择 .log、.txt 或 .json 文本日志，雷泽会模拟创建分析任务。"}
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
        <label className="upload-question-field" htmlFor="upload-log-domain">
          <span>业务域（可选）</span>
          <select
            id="upload-log-domain"
            value={selectedDomainId}
            onChange={(event) => setSelectedDomainId(event.target.value)}
          >
            <option value={UNCATEGORIZED_LOG_DOMAIN_VALUE}>未分类（通用分析）</option>
            {domains.map((domain) => (
              <option key={domain.id} value={domain.id}>
                {domain.name}
              </option>
            ))}
          </select>
        </label>
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
            <p><strong>{selectedFileName}</strong> 已通过格式检查，可以进入分析队列。</p>
          ) : (
            <p>
              <strong>{selectedFileName}</strong> 格式不支持。
              {archivesSupported
                ? "请优先上传 .log / .txt / .csv 文本日志，或单文件 .gz、单条目 .zip 压缩包。"
                : "请优先上传 .log / .txt / .json 文本日志。"}
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
            <button className="button primary" type="button" aria-busy={uploading ? "true" : undefined} disabled={uploading} onClick={uploadSelected}>
              确认上传
            </button>
          ) : null}
          {phase === "unsupported" ? (
            <button className="button danger" type="button" aria-busy={uploading ? "true" : undefined} disabled={uploading} onClick={uploadSelected}>
              仍然上传
            </button>
          ) : null}
        </div>
        </>
      )}
    </ModalDialog>
  );
}

function LogsPageHeader({ onNavigate, onUpload }: { onNavigate: (path: string) => void; onUpload: () => void }) {
  useTopBarActions(
    <>
      <button className="button subtle" type="button" onClick={() => onNavigate("/")}>
        首页
      </button>
      <button className="button primary" type="button" onClick={onUpload}>
        <Upload size={16} />
        上传新日志
      </button>
    </>,
    [onNavigate, onUpload]
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

function ConfidenceBar({ value, status }: { value: number; status: LogRecord["status"] }) {
  const percent = normalizePercentValue(value);
  const tone = status === "Processing" ? "indeterminate" : percent >= 90 ? "high" : percent >= 70 ? "mid" : "low";

  return (
    <div className={classNames("confidence-bar", `confidence-bar--${tone}`)}>
      <div>
        <span>AI置信度</span>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div aria-label="分析置信度" aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} role="progressbar">
        <i style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

const degradedReasonLabels: Record<NonNullable<LogRecord["degradedReason"]>, string> = {
  "provider-unavailable": "AI 分析服务不可用，本结论由规则引擎回退生成",
  "token-budget-exhausted": "预算内未能得到有效接地结论，本结论由规则引擎回退生成"
};

function AnalysisProvenanceBadges({ log }: { log: LogRecord }) {
  const isFallback = log.analysisSource === "rules-fallback";
  // P2 loop kernel: an exhausted budget converges early into a marked low-confidence
  // agent conclusion — still degraded analysis, never presented as a full analysis.
  const isEarlyConverged = log.analysisSource === "agent" && log.degradedReason !== undefined;
  const degraded = isFallback || isEarlyConverged;
  if (!degraded && log.analysisSource !== "agent" && !log.logDomainName) {
    return null;
  }

  return (
    <div className="analysis-provenance" data-testid="analysis-provenance">
      <div className="analysis-provenance__badges">
        {degraded ? (
          <span className="analysis-provenance__badge analysis-provenance__badge--degraded" role="status">
            <AlertTriangle size={13} />
            {isFallback ? "降级分析 · 规则回退" : "降级分析 · 提前收敛"}
          </span>
        ) : log.analysisSource === "agent" ? (
          <span className="analysis-provenance__badge analysis-provenance__badge--agent">
            <Sparkles size={13} />
            Agent 分析
          </span>
        ) : null}
        {log.logDomainName ? (
          <span className="analysis-provenance__badge analysis-provenance__badge--domain">业务域 · {log.logDomainName}</span>
        ) : null}
      </div>
      {degraded ? (
        <p className="analysis-provenance__reason">
          {isFallback
            ? log.degradedReason
              ? degradedReasonLabels[log.degradedReason]
              : "本结论由规则引擎回退生成"
            : "分析步数或 token 预算耗尽，Agent 基于已读证据提前收敛为低置信结论"}
        </p>
      ) : null}
    </div>
  );
}

function LogConclusionCard({
  log,
  onAskAgent,
  onPrimary,
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
      <ConfidenceBar value={log.confidence} status={log.status} />
      <div className="logs-conclusion-actions">
        <button className="button primary" disabled={log.status !== "Complete"} type="button" onClick={onPrimary}>
          <Sparkles size={16} />
          生成参数修改请求
        </button>
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
          <select id="log-feedback-confidence" value={confidence} disabled={pending} onChange={(event) => setConfidence(event.target.value)}>
            <option value="high">高：判断可信</option>
            <option value="medium">中：需要复核</option>
            <option value="low">低：可能误判</option>
          </select>
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
  return (
    <section className="log-error-alert" role="alert">
      <AlertTriangle size={22} />
      <div>
        <strong>日志处理失败</strong>
        <p>{reason}</p>
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
          <li aria-current={current ? "step" : undefined} aria-disabled={aborted || undefined} className={className} key={id}>
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
        <label>
          <Search size={15} />
          <input
            aria-controls="rawlog-content"
            aria-label="在日志中搜索"
            onChange={(event: ChangeEvent<HTMLInputElement>) => onSearchQueryChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="在日志中搜索..."
            ref={searchInputRef}
            type="search"
            value={searchQuery}
          />
        </label>
        <button aria-label="上一个匹配" disabled={matchLines.length === 0} type="button" onClick={() => moveMatch(-1)}>
          ↑
        </button>
        <button aria-label="下一个匹配" disabled={matchLines.length === 0} type="button" onClick={() => moveMatch(1)}>
          ↓
        </button>
        <output aria-live="polite" role="status">
          {searchQuery.trim() === "" ? "" : matchLines.length === 0 ? "无匹配。按 Esc 清空" : `${activeMatchIndex + 1} / ${matchLines.length} 匹配`}
        </output>
        {searchQuery ? (
          <button aria-label="清空搜索" type="button" onClick={() => onSearchQueryChange("")}>
            <X size={15} />
          </button>
        ) : null}
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
              const isFocusAnchor = evidence.some((item) => item.id === focusedEvidenceId);
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
  evidence,
  rawLines,
  focusedEvidenceId,
  hoveredLine,
  onHoverEvidence,
  onClickEvidence
}: {
  evidence: LogEvidence[];
  rawLines: string[];
  focusedEvidenceId: string | null;
  hoveredLine: number | null;
  onHoverEvidence: (id: string | null) => void;
  onClickEvidence: (id: string) => void;
}) {
  return (
    <section className="evidence-chain" aria-label="日志分析证据链">
      <SectionLabel icon={<ListChecks size={16} />} label="日志分析证据链" />
      <div className="evidence-chain-list">
        {evidence.map((item, index) => {
          const focused = item.id === focusedEvidenceId;
          const relatedToHoveredLine = hoveredLine !== null && item.lineNumbers.includes(hoveredLine);

          return (
            <EvidenceCard
              evidence={item}
              focused={focused || relatedToHoveredLine}
              index={index}
              key={item.id}
              rawLines={rawLines}
              onClick={() => onClickEvidence(item.id)}
              onHover={(id) => onHoverEvidence(id)}
            />
          );
        })}
      </div>
    </section>
  );
}

function EvidenceCard({
  evidence,
  index,
  rawLines,
  focused,
  onHover,
  onClick
}: {
  evidence: LogEvidence;
  index: number;
  rawLines: string[];
  focused: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
}) {
  const title = `证据 ${String(index + 1).padStart(2, "0")}`;

  return (
    <article
      aria-label={`${title} ${STAGE_LABELS[evidence.stageId]}`}
      aria-pressed={focused}
      className={classNames("evidence-card", focused && "evidence-card--focused", `evidence-card--${evidence.stageId}`)}
      id={`evidence-card-${evidence.id}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => onHover(evidence.id)}
      onMouseLeave={() => onHover(null)}
    >
      <header>
        <span>{title}</span>
        <strong>{STAGE_LABELS[evidence.stageId]}</strong>
      </header>
      <div className="evidence-card__body">
        <code>{evidence.lineNumbers.map((lineNumber) => `#${lineNumber} ${rawLines[lineNumber - 1] ?? ""}`).join("\n")}</code>
        <p>{evidence.inference}</p>
        {evidence.ruleHit ? <small>命中规则：{evidence.ruleHit}</small> : null}
      </div>
      <footer>
        <small>建议处置</small>
        <p>关联处置：{evidence.suggestedAction}</p>
      </footer>
    </article>
  );
}

function LogsAuxPanel({
  logs,
  activeLog,
  auxTab,
  onTabChange,
  onSelectLog
}: {
  logs: LogRecord[];
  activeLog: LogRecord;
  auxTab: LogsAuxTab;
  onTabChange: (tab: LogsAuxTab) => void;
  onSelectLog: (id: string) => void;
}) {
  const tabs: Array<[LogsAuxTab, string]> = [
    ["history", "历史"],
    ["metadata", "元数据"],
    ["related", "相关"]
  ];

  return (
    <aside className="logs-aux-panel" aria-label="历史日志记录">
      <div className="logs-aux-tabs" role="tablist" aria-label="日志辅助信息">
        {tabs.map(([id, label]) => (
          <button
            aria-controls={`logs-aux-${id}`}
            aria-selected={auxTab === id}
            id={`logs-aux-tab-${id}`}
            key={id}
            role="tab"
            type="button"
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div aria-labelledby={`logs-aux-tab-${auxTab}`} className="logs-aux-panel__body" id={`logs-aux-${auxTab}`} role="tabpanel">
        {auxTab === "history" ? (
          <div className="history-panel">
            {logs.map((log) => (
              <button
                aria-pressed={log.id === activeLog.id}
                className={log.id === activeLog.id ? "history-item active" : "history-item"}
                key={log.id}
                type="button"
                onClick={() => onSelectLog(log.id)}
              >
                <strong>{log.fileName}</strong>
                <span>{logStatusLabels[log.status]} · {formatPercent(log.confidence)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {auxTab === "metadata" ? (
          <dl className="logs-metadata-list">
            <div>
              <dt>文件名</dt>
              <dd>{activeLog.fileName}</dd>
            </div>
            <div>
              <dt>设备</dt>
              <dd>{activeLog.device ?? "未记录"}</dd>
            </div>
            <div>
              <dt>采集时间</dt>
              <dd>{activeLog.capturedAt}</dd>
            </div>
          </dl>
        ) : null}
        {auxTab === "related" ? <EmptyState text="没有找到关联日志。" /> : null}
      </div>
    </aside>
  );
}
