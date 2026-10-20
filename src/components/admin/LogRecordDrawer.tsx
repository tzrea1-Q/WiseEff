import { Archive, ExternalLink, FileDown, RefreshCw, ThumbsUp, TriangleAlert } from "lucide-react";
import { DecodedFields } from "@/features/log-analysis/DecodedFields";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalDialog } from "@/components/common/ModalDialog";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatPercent, normalizePercentValue } from "@/domain/format/formatPercent";
import { classifyAnalysisDegradation } from "@/domain/logs/analysisProvenance";
import { AnalysisCaseDialog } from "@/features/log-skills/AnalysisCaseDialog";
import type { AnalysisCasePrefill, SkillWorkspaceRepository } from "@/features/log-skills/types";
import { formatBytes } from "@/domain/format/formatBytes";
import { STAGE_LABELS, type LogRecord } from "@/domain/prototype/types";
import { buildEvalCaseDraft } from "@/domain/logs/evalCaseDraft";

const deIdentificationChecklist = [
  "无个人姓名、电话、邮箱或账号标识",
  "无客户/公司名称、项目代号或合同标识",
  "无设备序列号、MAC、IMEI 或精确地理位置",
  "无可识别客户网络的 IP/主机名（替换为 host-anon-N）",
  "无凭据、令牌或内部 URL",
  "替换保持行号与技术语义稳定（行数不变、错误码不变）",
  "领域专家在脱敏后确认标注内容"
];

function ExportAnalysisCaseDraftDialog({ record, onClose }: { record: LogRecord; onClose: () => void }) {
  const draft = buildEvalCaseDraft(record);
  const download = (suffix: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${draft.caseId}-${suffix}`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  return <ModalDialog open describedBy onDismiss={onClose} className="skill-authoring-dialog modal-card--md">
    {({ titleId, descriptionId }) => <div className="grid gap-4" data-testid="export-eval-case-draft-dialog">
      <h2 id={titleId}>导出分析用例草稿</h2>
      <p id={descriptionId}>将当前记录的结论、证据行号与建议动作导出为草稿，人工脱敏并复核后才可入库。</p>
      <p className="break-all text-sm text-muted-foreground">建议目录：eval-cases/logs/{draft.domainSlug}/{draft.caseId}/</p>
      <section className="grid gap-2 rounded-md border border-border bg-muted p-3" aria-label="脱敏清单提醒">
        <p className="text-sm font-medium">入库前必须逐项通过脱敏清单：</p>
        <ul className="list-disc space-y-1 pl-4 text-sm">{deIdentificationChecklist.map((item) => <li key={item}>{item}</li>)}</ul>
        <p className="text-sm">草稿固定 deIdentified: false、rootCauseCategory: TODO。只有人工完成脱敏并把 deIdentified 改为 true、填入根因枚举后才可入库；无法完全脱敏的案例不得进入仓库。</p>
      </section>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onClose}>关闭</Button>
        <Button variant="outline" onClick={() => download("log.txt", draft.logText)}>下载 log.txt</Button>
        <Button onClick={() => download("case.yaml", draft.caseYaml)}>下载 case.yaml 草稿</Button>
      </div>
    </div>}
  </ModalDialog>;
}

function DrawerProvenanceBadges({ record }: { record: LogRecord }) {
  const degraded = classifyAnalysisDegradation(record);
  if (!degraded && !record.logDomainName) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1.5" data-testid="drawer-analysis-provenance">
      <div className="flex flex-wrap items-center gap-1.5">
        {degraded ? (
          <span
            role="status"
            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
          >
            <TriangleAlert className="size-3" />
            {degraded.label}
          </span>
        ) : null}
        {record.logDomainName ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            技能 {record.logDomainName}{record.skillRevision ? ` · v${record.skillRevision.number}` : ""}
          </span>
        ) : null}
      </div>
      {degraded ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900">
          {degraded.reason}
        </p>
      ) : null}
    </div>
  );
}

export type LogRecordDrawerProps = {
  record: LogRecord | null;
  loadRecord?: (id: string) => Promise<LogRecord | null>;
  open: boolean;
  onClose: () => void;
  onNavigateToWorkbench: (recordId: string) => void;
  onReanalyze: (recordId: string) => void;
  onArchive: (recordId: string) => void;
  onSubmitHelpfulFeedback?: (recordId: string) => void;
  canAct: boolean;
  reanalyzePending?: boolean;
  archivePending?: boolean;
  feedbackPending?: boolean;
  skillRepository?: Partial<SkillWorkspaceRepository>;
};

export function LogRecordDrawer({
  record: summaryRecord,
  loadRecord,
  open,
  onClose,
  onNavigateToWorkbench,
  onReanalyze,
  onArchive,
  onSubmitHelpfulFeedback,
  canAct,
  reanalyzePending = false,
  archivePending = false,
  feedbackPending = false,
  skillRepository
}: LogRecordDrawerProps) {
  const [casePrefill, setCasePrefill] = useState<(AnalysisCasePrefill & { sourceRecordId: string }) | null>(null);
  const [casePending, setCasePending] = useState(false);
  const [caseError, setCaseError] = useState("");
  const [exportDraftOpen, setExportDraftOpen] = useState(false);
  const [detail, setDetail] = useState<{ id: string; record?: LogRecord; failed?: boolean } | null>(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const recordId = summaryRecord?.id;

  useEffect(() => {
    if (!open || !recordId || !loadRecord) return;
    let active = true;
    setDetail(null);
    void loadRecord(recordId).then((record) => {
      if (active) setDetail(record ? { id: recordId, record } : { id: recordId, failed: true });
    }).catch(() => {
      if (active) setDetail({ id: recordId, failed: true });
    });
    return () => { active = false; };
  }, [detailAttempt, loadRecord, open, recordId]);

  const currentDetail = detail?.id === recordId ? detail : null;
  const detailPending = Boolean(loadRecord && !currentDetail);
  const detailFailed = Boolean(loadRecord && currentDetail?.failed);
  const record = currentDetail?.record ?? summaryRecord;
  if (!record) {
    return null;
  }

  const confidencePercent = normalizePercentValue(record.confidence);
  const caseDisabledReason = !canAct ? "需要管理员权限才能保存分析用例。"
    : detailPending ? "详情加载完成后可保存。"
    : detailFailed ? "请先重试加载详情。"
    : record.status !== "Complete" ? "分析完成后可保存为分析用例。"
    : !skillRepository?.getAnalysisCasePrefill || !skillRepository.createAnalysisCase ? "分析用例服务暂不可用。"
    : casePending ? "正在加载分析用例…" : undefined;
  const sizeBytes = record.files?.length ? record.files.reduce((total, file) => total + file.sizeBytes, 0) : record.fileSizeMB * 1024 ** 2;

  return (
    <>
    <Sheet
      open={open && !casePrefill && !exportDraftOpen}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="flex w-full gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="gap-1 border-b border-border p-4">
          <SheetTitle className="truncate text-base">{record.fileName}</SheetTitle>
          <span className="font-mono text-xs text-muted-foreground">报告 ID：{record.reportId}</span>
          <SheetDescription className="text-xs">
            {formatBytes(sizeBytes)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">结论</h4>
            <p className="mt-2 text-sm text-foreground">{record.conclusion}</p>
            <DrawerProvenanceBadges record={record} />
            <div className="mt-3 flex items-center gap-3 text-xs">
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                置信度
              </span>
              {record.analysisSource ? <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                {record.analysisSource === "agent" ? "AI 分析" : "规则回退"}
              </span> : null}
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full transition-all",
                    confidencePercent >= 85
                      ? "bg-emerald-500"
                      : confidencePercent >= 60
                        ? "bg-amber-500"
                        : confidencePercent > 0
                          ? "bg-destructive"
                          : "bg-muted"
                  )}
                  style={{ width: `${Math.min(confidencePercent, 100)}%` }}
                />
              </div>
              <span className="font-mono text-foreground">{formatPercent(record.confidence)}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              影响范围：<span className="text-foreground">{record.impact || "暂无"}</span>
            </p>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">证据链{!detailPending && !detailFailed ? `（${record.evidence.length}）` : ""}</h4>
            {detailPending ? <p role="status" className="mt-2 text-sm text-muted-foreground">正在加载详情…</p>
              : detailFailed ? <div className="mt-2 flex items-center gap-2">
                <p role="alert" className="text-sm text-destructive">无法加载详情，请重试。</p>
                <Button variant="outline" size="sm" onClick={() => setDetailAttempt((attempt) => attempt + 1)}>重试</Button>
              </div> : <ul aria-label="证据条目" className="mt-2 rounded-lg bg-muted/40 px-3">
              {record.evidence.map((evidence) => (
                <li key={evidence.id} className="flex flex-col items-start gap-2 border-t border-border py-3 text-xs leading-relaxed text-muted-foreground first:border-t-0">
                  <span className="inline-flex rounded-md border border-border bg-muted px-1.5 py-0.5 font-medium text-foreground">{STAGE_LABELS[evidence.stageId]}</span>
                  <p className="w-full break-words text-foreground">{evidence.inference}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono">
                    {evidence.lineNumbers.slice(0, 3).map((line, index) => <span className="break-all" key={index}>{evidence.filePath ? `${evidence.filePath}:${line}` : `L${line}`}</span>)}
                    {evidence.lineNumbers.length > 3 ? <span className="font-sans">其余 {evidence.lineNumbers.length - 3} 行</span> : null}
                  </div>
                  <DecodedFields events={evidence.decodedFields} />
                  <p className="w-full break-words text-foreground">建议：{evidence.suggestedAction}</p>
                </li>
              ))}
            </ul>}
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">推荐动作</h4>
            <ul className="mt-2 space-y-1.5">
              {record.suggestedActions.map((action) => (
                <li key={action} className="flex items-start gap-2 text-sm text-foreground">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border p-4">
          <Button variant="outline" size="sm" onClick={() => onNavigateToWorkbench(record.id)}>
            <ExternalLink data-icon="inline-start" />
            打开报告
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canAct || reanalyzePending}
            aria-busy={reanalyzePending || undefined}
            title={canAct ? undefined : "需要编辑者或管理员权限"}
            onClick={() => onReanalyze(record.id)}
          >
            <RefreshCw data-icon="inline-start" />
            重新分析
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canAct || feedbackPending}
            aria-busy={feedbackPending || undefined}
            title={canAct ? undefined : "需要编辑者或管理员权限"}
            onClick={() => onSubmitHelpfulFeedback?.(record.id)}
          >
            <ThumbsUp data-icon="inline-start" />
            有帮助
          </Button>
          {record.logDomainId ? <div className="flex max-w-full flex-col items-start gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(caseDisabledReason)}
            aria-busy={casePending || undefined}
            aria-describedby={caseDisabledReason ? "drawer-save-case-reason" : undefined}
            onClick={() => {
              setCasePending(true);
              setCaseError("");
              void skillRepository!.getAnalysisCasePrefill!(record.id)
                .then((prefill) => setCasePrefill({ ...prefill, sourceRecordId: record.id }))
                .catch(() => setCaseError("无法加载分析用例，请重试。"))
                .finally(() => setCasePending(false));
            }}
          >
            <FileDown data-icon="inline-start" />
            存为分析用例
          </Button>
          {caseDisabledReason ? <p id="drawer-save-case-reason" className="text-xs text-muted-foreground">{caseDisabledReason}</p> : null}
          </div> : null}
          <Button
            variant="destructive"
            size="sm"
            disabled={!canAct || archivePending}
            aria-busy={archivePending || undefined}
            title={canAct ? undefined : "需要编辑者或管理员权限"}
            onClick={() => onArchive(record.id)}
          >
            <Archive data-icon="inline-start" />
            归档
          </Button>
          <RowActionMenu label={record.fileName} items={[{
            id: "export-analysis-case-draft", label: "导出分析用例草稿",
            disabled: detailPending || detailFailed || record.status !== "Complete" || record.rawLines.length === 0,
            title: "导出已完成分析及原始日志，人工脱敏后可加入分析用例库。",
            onSelect: () => setExportDraftOpen(true)
          }]} />
        </div>

        {caseError ? <p role="alert" className="px-4 pb-4 text-sm text-destructive">{caseError}</p> : null}
      </SheetContent>
    </Sheet>
    {exportDraftOpen ? <ExportAnalysisCaseDraftDialog record={record} onClose={() => setExportDraftOpen(false)} /> : null}
    {casePrefill ? <AnalysisCaseDialog title="存为分析用例" initial={casePrefill} availableFiles={casePrefill.files}
      originalUploads={casePrefill.originalUploads} sourceDegradation={casePrefill.sourceDegradation} onClose={() => setCasePrefill(null)} onSave={async (input) => {
        await skillRepository!.createAnalysisCase!(casePrefill.skillId, { ...input, sourceRecordId: casePrefill.sourceRecordId });
      }} /> : null}
    </>
  );
}
