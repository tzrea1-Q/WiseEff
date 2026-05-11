import { Archive, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, type LogRecord } from "@/mockData";

export type LogRecordDrawerProps = {
  record: LogRecord | null;
  open: boolean;
  onClose: () => void;
  onNavigateToWorkbench: (recordId: string) => void;
  onReanalyze: (recordId: string) => void;
  onArchive: (recordId: string) => void;
  canAct: boolean;
};

export function LogRecordDrawer({
  record,
  open,
  onClose,
  onNavigateToWorkbench,
  onReanalyze,
  onArchive,
  canAct
}: LogRecordDrawerProps) {
  if (!record) {
    return null;
  }

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
            项目 <span className="text-foreground">{record.projectId}</span>
            <span className="mx-1">·</span>
            来源 <span className="text-foreground">{record.source}</span>
            <span className="mx-1">·</span>
            {record.fileSizeMB.toFixed(1)}MB
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">AI 摘要</h4>
            <p className="mt-2 text-sm text-foreground">{record.conclusion}</p>
            <div className="mt-3 flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">置信度</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full transition-all",
                    record.confidence >= 85
                      ? "bg-emerald-500"
                      : record.confidence >= 60
                        ? "bg-amber-500"
                        : record.confidence > 0
                          ? "bg-destructive"
                          : "bg-muted"
                  )}
                  style={{ width: `${record.confidence}%` }}
                />
              </div>
              <span className="font-mono text-foreground">{record.confidence}%</span>
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
            disabled={!canAct}
            title={canAct ? undefined : "需要 Editor 或 Admin 权限"}
            onClick={() => onReanalyze(record.id)}
          >
            <RefreshCw data-icon="inline-start" />
            重新分析
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canAct}
            title={canAct ? undefined : "需要 Editor 或 Admin 权限"}
            onClick={() => onArchive(record.id)}
          >
            <Archive data-icon="inline-start" />
            归档
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
