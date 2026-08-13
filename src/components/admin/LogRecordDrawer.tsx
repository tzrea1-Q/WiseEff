import { Archive, ExternalLink, FileDown, RefreshCw, Sparkles, ThumbsUp, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatPercent, normalizePercentValue } from "@/domain/format/formatPercent";
import { buildEvalCaseDraft } from "@/domain/logs/evalCaseDraft";
import { STAGE_LABELS, type LogRecord } from "@/domain/prototype/types";

const drawerDegradedReasonLabels: Record<NonNullable<LogRecord["degradedReason"]>, string> = {
  "provider-unavailable": "AI 分析服务不可用，本结论由规则引擎回退生成",
  "token-budget-exhausted": "预算内未能得到有效接地结论，本结论由规则引擎回退生成"
};

function DrawerProvenanceBadges({ record }: { record: LogRecord }) {
  const isFallback = record.analysisSource === "rules-fallback";
  // P2 loop kernel: an exhausted budget converges early into a marked low-confidence
  // agent conclusion — still degraded analysis, never presented as a full analysis.
  const isEarlyConverged = record.analysisSource === "agent" && record.degradedReason !== undefined;
  const degraded = isFallback || isEarlyConverged;
  if (!degraded && record.analysisSource !== "agent" && !record.logDomainName) {
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
            {isFallback ? "降级分析 · 规则回退" : "降级分析 · 提前收敛"}
          </span>
        ) : record.analysisSource === "agent" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
            <Sparkles className="size-3" />
            Agent 分析
          </span>
        ) : null}
        {record.logDomainName ? (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            业务域 · {record.logDomainName}
          </span>
        ) : null}
      </div>
      {degraded ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900">
          {isFallback
            ? record.degradedReason
              ? drawerDegradedReasonLabels[record.degradedReason]
              : "本结论由规则引擎回退生成"
            : "分析步数或 token 预算耗尽，Agent 基于已读证据提前收敛为低置信结论"}
        </p>
      ) : null}
    </div>
  );
}

function downloadTextFile(fileName: string, content: string) {
  try {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    if (!navigator.userAgent.toLowerCase().includes("jsdom")) {
      anchor.click();
    }
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } catch {
    // jsdom and locked-down browser contexts may not support synthetic downloads.
  }
}

/** Key points of the de-identification checklist in eval-cases/logs/README.md. */
const deIdentificationChecklist = [
  "无个人姓名、电话、邮箱或账号标识",
  "无客户/公司名称、项目代号或合同标识",
  "无设备序列号、MAC、IMEI 或精确地理位置",
  "无可识别客户网络的 IP/主机名（替换为 host-anon-N）",
  "无凭据、令牌或内部 URL",
  "替换保持行号与技术语义稳定（行数不变、错误码不变）",
  "领域专家在脱敏后确认标注内容"
];

/**
 * Annotation-draft intake for the golden case set: assembles the current record
 * into a case.yaml draft (deIdentified: false, rootCauseCategory: TODO) plus
 * log.txt for manual de-identification. Deliberately NO auto-commit and no
 * repository write — a human must de-identify, fill the category, and flip
 * deIdentified to true before the case may enter eval-cases/logs.
 */
function ExportEvalCaseDraftDialog({
  record,
  open,
  onClose
}: {
  record: LogRecord;
  open: boolean;
  onClose: () => void;
}) {
  const draft = useMemo(() => (open ? buildEvalCaseDraft(record) : null), [open, record]);
  if (!draft) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg" data-testid="export-eval-case-draft-dialog">
        <DialogHeader>
          <DialogTitle>导出评测案例草稿</DialogTitle>
          <DialogDescription>
            将本记录组装为金标准集草稿（case.yaml + log.txt），建议放入
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              eval-cases/logs/{draft.domainSlug}/{draft.caseId}/
            </code>
            。根因要点、证据行号与建议动作已从当前分析结论预填，仅是草稿。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3" role="note" aria-label="脱敏清单提醒">
          <p className="text-xs font-semibold text-amber-900">入库前必须逐项通过脱敏清单（README 要点）：</p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-900">
            {deIdentificationChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-xs font-semibold text-amber-900">
            草稿固定 deIdentified: false、rootCauseCategory: TODO——只有人工完成脱敏并把 deIdentified 改为 true、填入根因枚举后才可入库；无法完全脱敏的案例不得进入仓库。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadTextFile(`${draft.caseId}-log.txt`, draft.logText)}
          >
            <FileDown data-icon="inline-start" />
            下载 log.txt
          </Button>
          <Button size="sm" onClick={() => downloadTextFile(`${draft.caseId}-case.yaml`, draft.caseYaml)}>
            <FileDown data-icon="inline-start" />
            下载 case.yaml 草稿
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type LogRecordDrawerProps = {
  record: LogRecord | null;
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
};

export function LogRecordDrawer({
  record,
  open,
  onClose,
  onNavigateToWorkbench,
  onReanalyze,
  onArchive,
  onSubmitHelpfulFeedback,
  canAct,
  reanalyzePending = false,
  archivePending = false,
  feedbackPending = false
}: LogRecordDrawerProps) {
  const [exportDraftOpen, setExportDraftOpen] = useState(false);
  if (!record) {
    return null;
  }

  const confidencePercent = normalizePercentValue(record.confidence);
  const draftExportable = record.status === "Complete" && record.rawLines.length > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="flex w-full gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="gap-1 border-b border-border p-4">
          <span className="font-mono text-xs text-primary">{record.reportId}</span>
          <SheetTitle className="truncate text-base">{record.fileName}</SheetTitle>
          <SheetDescription className="text-xs">
            来源 <span className="text-foreground">{record.source}</span>
            <span className="mx-1">·</span>
            {record.fileSizeMB.toFixed(1)}MB
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">AI 摘要</h4>
            <p className="mt-2 text-sm text-foreground">{record.conclusion}</p>
            <DrawerProvenanceBadges record={record} />
            <div className="mt-3 flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">置信度</span>
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
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">证据链（{record.evidence.length}）</h4>
            <ul className="mt-2 space-y-1.5 rounded-lg bg-muted/40 p-3">
              {record.evidence.map((evidence) => (
                <li key={evidence.id} className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                  <div className="flex items-center justify-between gap-2 font-mono">
                    <span className="text-foreground">{STAGE_LABELS[evidence.stageId]}</span>
                    <span>L{evidence.lineNumbers.join(", L")}</span>
                  </div>
                  <p>{evidence.inference}</p>
                  <p className="text-foreground">{evidence.suggestedAction}</p>
                </li>
              ))}
            </ul>
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
            跳转到 /logs
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canAct || reanalyzePending}
            aria-busy={reanalyzePending || undefined}
            title={canAct ? undefined : "需要 Editor 或 Admin 权限"}
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
            title={canAct ? undefined : "需要 Editor 或 Admin 权限"}
            onClick={() => onSubmitHelpfulFeedback?.(record.id)}
          >
            <ThumbsUp data-icon="inline-start" />
            有帮助
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!draftExportable}
            title={draftExportable ? undefined : "仅已完成分析且包含原始日志的记录可导出"}
            onClick={() => setExportDraftOpen(true)}
          >
            <FileDown data-icon="inline-start" />
            导出评测案例草稿
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canAct || archivePending}
            aria-busy={archivePending || undefined}
            title={canAct ? undefined : "需要 Editor 或 Admin 权限"}
            onClick={() => onArchive(record.id)}
          >
            <Archive data-icon="inline-start" />
            归档
          </Button>
        </div>

        <ExportEvalCaseDraftDialog record={record} open={exportDraftOpen} onClose={() => setExportDraftOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
