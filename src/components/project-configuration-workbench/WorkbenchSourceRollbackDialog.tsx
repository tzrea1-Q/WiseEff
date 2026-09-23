import { useEffect, useState } from "react";

import type { ProjectParameterFileVersion } from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

export type WorkbenchSourceRollbackDialogProps = {
  open: boolean;
  version: ProjectParameterFileVersion | null;
  currentVersionId?: string;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export function WorkbenchSourceRollbackDialog({
  open,
  version,
  currentVersionId,
  pending,
  error,
  onCancel,
  onConfirm
}: WorkbenchSourceRollbackDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open, version?.id]);

  const trimmedReason = reason.trim();
  return (
    <ConfirmDialog
      open={open && Boolean(version)}
      title="提交来源回滚审核"
      description={
        <div>
          <p>
            版本 <code>{version?.versionNumber}</code> 将通过来源审核流程申请回滚；审核通过前不会改变活跃版本。
          </p>
          <p>
            当前版本：<code className="mono">{currentVersionId ?? "缺失"}</code>
          </p>
        </div>
      }
      confirmLabel="提交审核"
      pendingLabel="提交中…"
      pending={pending}
      error={error || (!trimmedReason ? "请填写来源回滚原因。" : "")}
      extra={
        <label className="configuration-workbench__source-review-reason">
          <span>回滚原因（必填）</span>
          <textarea
            aria-label="来源回滚原因"
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            placeholder="说明回滚原因与影响范围。"
          />
        </label>
      }
      onCancel={onCancel}
      onConfirm={() => {
        if (trimmedReason) onConfirm(trimmedReason);
      }}
    />
  );
}
