import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { DiffCodeBlock } from "@/components/parameter-compare/ParameterDiffViews";
import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { Button } from "@/components/ui/button";

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
    <ModalDialog
      open
      onDismiss={onClose}
      className="parameter-history-diff-dialog dts-binding-history-diff-dialog"
      backdropClassName="dts-binding-history-diff-dialog__overlay"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
        <header className="parameter-history-diff-dialog__head">
          <div className="grid gap-1">
            <h2 id={titleId}>{propertyKey} 历史差异</h2>
            <p id={descriptionId}>
              按提交顺序查看历史修订带来的参数值变化。
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭历史差异" onClick={onClose}>
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </header>

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

        <footer className="parameter-history-diff-dialog__footer">
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
        </footer>
        </>
      )}
    </ModalDialog>
  );
}
