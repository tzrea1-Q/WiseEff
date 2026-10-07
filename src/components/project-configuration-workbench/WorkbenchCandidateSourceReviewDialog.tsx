import { useEffect, useState } from "react";

import type {
  ParameterFileCandidate,
  ParameterFileSourcePreview
} from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

export type WorkbenchCandidateSourceReviewDialogProps = {
  open: boolean;
  activeCandidate: ParameterFileCandidate | null;
  sourcePreview: ParameterFileSourcePreview | null;
  submitting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export function WorkbenchCandidateSourceReviewDialog({
  open,
  activeCandidate,
  sourcePreview,
  submitting,
  error,
  onCancel,
  onConfirm
}: WorkbenchCandidateSourceReviewDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const trimmedReason = reason.trim();
  return (
    <ConfirmDialog
      open={open && sourcePreview?.kind === "canonical"}
      title="提交来源变更审核"
      description={
        <div>
          <p>
            候选 <code>{activeCandidate?.fileName}</code> 将依据服务端来源快照进入既有审核流程，审核通过前不会成为活跃版本。
          </p>
          <ul>
            <li>来源绑定：<code className="mono">{sourcePreview?.bindingId ?? "缺失"}</code></li>
            <li>来源 pin：<code className="mono">{sourcePreview?.sourcePinId ?? "缺失"}</code></li>
            <li>对照基版本：<code className="mono">{sourcePreview?.baseVersionId ?? "缺失"}</code></li>
          </ul>
        </div>
      }
      confirmLabel="提交审核"
      pendingLabel="提交中…"
      pending={submitting}
      error={error || (!trimmedReason ? "请填写来源变更原因。" : "")}
      extra={
        <label className="configuration-workbench__source-review-reason">
          <span>变更原因（必填）</span>
          <textarea
            aria-label="来源变更原因"
            value={reason}
            disabled={submitting}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            placeholder="说明来源变更的原因与影响范围。"
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
