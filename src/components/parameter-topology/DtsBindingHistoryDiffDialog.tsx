import { CircleX } from "lucide-react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { DiffCodeBlock } from "@/components/parameter-compare/ParameterDiffViews";
import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";
import { formatDtsValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type { DtsValue } from "@/domain/parameter-topology/types";
import { Button } from "@/components/ui/button";

export type BindingHistoryDiffEntry = {
  id: string;
  changedAt: string;
  actor?: string | null;
  reason?: string | null;
  fromRawValue?: string | null;
  toRawValue?: string | null;
  definitionRevisionId?: string;
  effectiveRevisionId?: string;
  currentValueId?: string | null;
  valueState?: "present" | "deleted";
  eventType?: string;
};

export type DtsBindingHistoryDiffDialogProps = {
  propertyKey: string;
  historyEntries: readonly BindingHistoryDiffEntry[];
  effectiveValue?: DtsValue;
  embedded?: boolean;
  onClose: () => void;
};

function historyRevisionLabel(
  entry: Pick<BindingHistoryDiffEntry, "definitionRevisionId" | "effectiveRevisionId">
): string | null {
  const definitionRevisionId = entry.definitionRevisionId?.trim() || null;
  const effectiveRevisionId = entry.effectiveRevisionId?.trim() || null;
  if (definitionRevisionId && effectiveRevisionId && definitionRevisionId === effectiveRevisionId) {
    return `修订 ${definitionRevisionId}`;
  }
  return [
    definitionRevisionId ? `值的固定修订 ${definitionRevisionId}` : null,
    effectiveRevisionId ? `事件有效修订 ${effectiveRevisionId}` : null
  ].filter(Boolean).join(" / ") || null;
}

function historyReason(reason: string | null | undefined): string {
  if (reason === "source-revision-propagation") return "同步来源修订";
  if (reason === "project-value-append") return "项目配置写入";
  return reason?.trim() || "未记录修改原因";
}

export function DtsBindingHistoryDiffDialog({
  propertyKey,
  historyEntries,
  effectiveValue,
  embedded = false,
  onClose
}: DtsBindingHistoryDiffDialogProps) {
  const content = <div className="parameter-history-diff-list">
    {historyEntries.length === 0 ? <p role="status">暂无参数变更记录</p> : null}
    {historyEntries.map((entry, index) => {
      const fromValue = entry.fromRawValue == null ? "尚未配置" : formatDtsValueForUi(entry.fromRawValue, effectiveValue);
      const toValue = formatDtsValueForUi(entry.toRawValue, effectiveValue, entry.valueState);
      return <article className="parameter-history-diff-card" key={entry.id} aria-label={`历史事件 ${index + 1} 历史差异`}>
        <div className="parameter-history-diff-card__head">
          <div>
            <strong>{entry.valueState === "deleted" ? "删除属性" : "配置变更"}</strong>
            <span><time dateTime={entry.changedAt}>{formatAuditAbsoluteTime(entry.changedAt)}</time>{entry.actor ? ` · ${entry.actor}` : ""}</span>
          </div>
        </div>
        <p>{historyReason(entry.reason)}</p>
        <DiffCodeBlock baseValue={fromValue} targetValue={toValue} />
        <details>
          <summary>技术信息</summary>
          <dl>
            <div><dt>事件标识</dt><dd><code>{entry.id}</code></dd></div>
            {historyRevisionLabel(entry) ? <div><dt>修订身份</dt><dd>{historyRevisionLabel(entry)}</dd></div> : null}
            {entry.currentValueId ? <div><dt>值标识</dt><dd><code>{entry.currentValueId}</code></dd></div> : null}
            {entry.eventType ? <div><dt>事件类型</dt><dd><code>{entry.eventType}</code></dd></div> : null}
          </dl>
        </details>
      </article>;
    })}
  </div>;
  if (embedded) return content;
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

        {content}

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
