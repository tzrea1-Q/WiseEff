import { useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterImportBatchDto } from "@/application/ports/ParameterRepository";
import type { Project } from "@/mockData";
import { buildImportReviewMetadata } from "@/application/parameters/import/buildImportReviewMetadata";
import type { ReviewedImportRow } from "@/application/parameters/import/types";

export type StepConfirmApplyProps = {
  project?: Project;
  sourceName: string;
  previewBatch: ParameterImportBatchDto | null;
  selectedItemIds: Set<string>;
  reviewedRows: ReviewedImportRow[];
  parameterActions?: ParameterPageActions;
  dispatch: Dispatch<AppAction>;
  onBack: () => void;
  onApplied: () => void;
};

export function StepConfirmApply({
  project,
  sourceName,
  previewBatch,
  selectedItemIds,
  reviewedRows,
  parameterActions,
  dispatch,
  onBack,
  onApplied
}: StepConfirmApplyProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const handleApply = async () => {
    if (!previewBatch || !parameterActions) {
      setError("导入预览不可用，请返回上一步重新生成。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await parameterActions.applyImportBatch({
        batchId: previewBatch.id,
        selectedItemIds: Array.from(selectedItemIds),
        reviewMetadata: buildImportReviewMetadata(reviewedRows)
      });
      if (result && "notification" in result) {
        if (!result.alreadyNotified) {
          dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
        }
        setError(result.notification);
        return;
      }
      dispatch({ type: "ADD_NOTIFICATION", message: "批量导入已应用。" });
      onApplied();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "应用导入批次失败。");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="parameter-import-wizard-step" aria-label="确认应用">
      <dl className="parameter-import-wizard-summary">
        <div className="parameter-import-wizard-summary-item">
          <dt>目标项目</dt>
          <dd>{project ? `${project.name}（${project.code}）` : "—"}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>导入来源</dt>
          <dd>{sourceName || "手动粘贴"}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>新增</dt>
          <dd>{previewBatch?.summary.added ?? 0}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>更新</dt>
          <dd>{previewBatch?.summary.updated ?? 0}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>不变</dt>
          <dd>{previewBatch?.summary.unchanged ?? 0}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>冲突</dt>
          <dd>{previewBatch?.summary.conflict ?? 0}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>高风险</dt>
          <dd>{previewBatch?.summary.highRisk ?? 0}</dd>
        </div>
        <div className="parameter-import-wizard-summary-item">
          <dt>已选择</dt>
          <dd>{selectedItemIds.size}</dd>
        </div>
      </dl>

      {error ? (
        <p className="parameter-import-wizard-errors" role="alert">
          {error}
        </p>
      ) : null}

      <div className="dialog-actions">
        <button type="button" className="button subtle" onClick={onBack} disabled={pending}>
          上一步
        </button>
        <button type="button" className="button primary" disabled={pending || !previewBatch} onClick={handleApply}>
          确认应用
        </button>
      </div>
    </section>
  );
}
