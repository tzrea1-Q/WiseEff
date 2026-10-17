import { useEffect, useState } from "react";

import type {
  ParameterFileCandidate,
  ParameterFileSourcePreview
} from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ReviewProvenance } from "@/features/parameter-review/ReviewProvenance";

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
            提交 <code>{activeCandidate?.fileName}</code> 的来源变更；审核通过后才更新当前配置。
          </p>
          <ReviewProvenance entries={[{ label: "候选版本", value: activeCandidate }, { label: "来源预览", value: sourcePreview }]} />
        </div>
      }
      confirmLabel="提交审核"
      pendingLabel="提交中…"
      pending={submitting}
      error={error}
      confirmDisabled={!trimmedReason}
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
