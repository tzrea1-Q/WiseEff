import { CircleX } from "lucide-react";

import { DiffCodeBlock } from "@/components/parameter-compare/ParameterDiffViews";
import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

export type BindingHistoryDiffEntry = {
  id: string;
  changedAt: string;
  actor?: string | null;
  fromRawValue?: string | null;
  toRawValue?: string | null;
};

export type DtsBindingHistoryDiffDialogProps = {
  propertyKey: string;
  historyEntries: readonly BindingHistoryDiffEntry[];
  onClose: () => void;
};

function displayRaw(value: string | null | undefined) {
  if (value == null || value.trim() === "") return "∅";
  return formatDtsRawValueForUi(value) || "∅";
}

export function DtsBindingHistoryDiffDialog({
  propertyKey,
  historyEntries,
  onClose
}: DtsBindingHistoryDiffDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-label={`${propertyKey} 历史差异`}
        className="dts-binding-history-diff-dialog max-h-[calc(100vh-2rem)] w-full gap-3 sm:max-w-5xl overflow-y-auto z-[61]"
        overlayClassName="dts-binding-history-diff-dialog__overlay z-[60]"
        showCloseButton={false}
      >
        <DialogHeader className="dts-binding-detail-dialog__header flex-row items-start justify-between gap-2">
          <div className="grid gap-1">
            <DialogTitle>{propertyKey} 历史差异</DialogTitle>
            <DialogDescription>
              按提交顺序查看历史修订带来的参数值变化。
            </DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭历史差异" onClick={onClose}>
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </DialogHeader>

        <div className="parameter-history-diff-list">
          {historyEntries.map((entry, index) => {
            const versionLabel = `R${historyEntries.length - index}`;
            return (
              <article
                className="parameter-history-diff-card"
                key={entry.id}
                aria-label={`${versionLabel} 历史差异`}
              >
                <div className="parameter-history-diff-card__head">
                  <div>
                    <strong>
                      {displayRaw(entry.fromRawValue)} → {displayRaw(entry.toRawValue)}
                    </strong>
                    <span>
                      <time dateTime={entry.changedAt}>{formatAuditAbsoluteTime(entry.changedAt)}</time>
                      {entry.actor ? ` / ${entry.actor}` : ""}
                    </span>
                  </div>
                  <em>{versionLabel}</em>
                </div>
                <DiffCodeBlock
                  baseValue={displayRaw(entry.fromRawValue)}
                  targetValue={displayRaw(entry.toRawValue)}
                />
              </article>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
