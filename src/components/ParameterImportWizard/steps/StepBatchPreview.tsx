import { useEffect, useRef, useState, type Dispatch } from "react";
import type { AppAction } from "@/App";
import type { ParameterPageActions } from "@/app/routes";
import type { ParameterImportBatchDto, ParameterImportBatchItem } from "@/application/ports/ParameterRepository";
import { isEligibleImportItem } from "@/application/parameters/import/isEligibleImportItem";
import { toSourceItems } from "@/application/parameters/import/toSourceItems";
import { buildImportReviewMetadata } from "@/application/parameters/import/buildImportReviewMetadata";
import type { ReviewedImportRow } from "@/application/parameters/import/types";

export type StepBatchPreviewProps = {
  targetProjectId: string;
  sourceName: string;
  reviewedRows: ReviewedImportRow[];
  parameterActions?: ParameterPageActions;
  dispatch: Dispatch<AppAction>;
  previewBatch: ParameterImportBatchDto | null;
  selectedItemIds: Set<string>;
  onPreviewBatchChange: (batch: ParameterImportBatchDto | null) => void;
  onSelectedItemIdsChange: (ids: Set<string>) => void;
  onBack: () => void;
  onNext: () => void;
};

const CLASSIFICATION_LABEL: Record<ParameterImportBatchItem["classification"], string> = {
  added: "新增",
  updated: "更新",
  unchanged: "不变",
  conflict: "冲突"
};

const RISK_LABEL: Record<ParameterImportBatchItem["risk"], string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

function formatPreviewValue(item: ParameterImportBatchItem): string {
  const current = item.currentValue?.trim();
  const recommended = item.recommendedValue?.trim();

  if (current && recommended && current !== recommended) {
    return `${current} → ${recommended}`;
  }

  return recommended || current || "—";
}

export function StepBatchPreview({
  targetProjectId,
  sourceName,
  reviewedRows,
  parameterActions,
  dispatch,
  previewBatch,
  selectedItemIds,
  onPreviewBatchChange,
  onSelectedItemIdsChange,
  onBack,
  onNext
}: StepBatchPreviewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const previewRequestRef = useRef<ReturnType<ParameterPageActions["createImportPreview"]> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (!parameterActions) {
        setError("当前环境不支持创建导入预览。");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const items = toSourceItems(reviewedRows);
        if (items.length === 0) {
          setError("没有可预览的导入项。请在上一步至少通过或确认一条记录。");
          return;
        }

        previewRequestRef.current ??= parameterActions.createImportPreview({
          projectId: targetProjectId,
          sourceName: sourceName || "手动粘贴",
          items,
          reviewMetadata: buildImportReviewMetadata(reviewedRows)
        });
        const result = await previewRequestRef.current;
        if (cancelled) {
          return;
        }
        if ("notification" in result) {
          if (!result.alreadyNotified) {
            dispatch({ type: "ADD_NOTIFICATION", message: result.notification });
          }
          setError(result.notification);
          return;
        }
        onPreviewBatchChange(result);
        onSelectedItemIdsChange(new Set(result.items.filter(isEligibleImportItem).map((item) => item.id)));
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : "创建导入预览失败。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once when this step is entered
  }, []);

  const toggleItem = (itemId: string, checked: boolean) => {
    const next = new Set(selectedItemIds);
    if (checked) {
      next.add(itemId);
    } else {
      next.delete(itemId);
    }
    onSelectedItemIdsChange(next);
  };

  const hasEligibleSelection = Boolean(
    previewBatch?.items.some((item) => isEligibleImportItem(item) && selectedItemIds.has(item.id))
  );

  const eligibleItems = previewBatch?.items.filter(isEligibleImportItem) ?? [];
  const allEligibleSelected =
    eligibleItems.length > 0 && eligibleItems.every((item) => selectedItemIds.has(item.id));

  const toggleAllEligible = (checked: boolean) => {
    if (!previewBatch) {
      return;
    }
    if (checked) {
      onSelectedItemIdsChange(new Set(eligibleItems.map((item) => item.id)));
      return;
    }
    onSelectedItemIdsChange(new Set());
  };

  return (
    <section className="parameter-import-wizard-step" aria-label="批次预览">
      {loading ? <p className="parameter-import-wizard-empty-hint">正在生成导入预览…</p> : null}

      {error ? (
        <p className="parameter-import-wizard-errors" role="alert">
          {error}
        </p>
      ) : null}

      {previewBatch ? (
        <>
          <dl className="parameter-import-wizard-summary">
            <div className="parameter-import-wizard-summary-item">
              <dt>新增</dt>
              <dd>{previewBatch.summary.added}</dd>
            </div>
            <div className="parameter-import-wizard-summary-item">
              <dt>更新</dt>
              <dd>{previewBatch.summary.updated}</dd>
            </div>
            <div className="parameter-import-wizard-summary-item">
              <dt>不变</dt>
              <dd>{previewBatch.summary.unchanged}</dd>
            </div>
            <div className="parameter-import-wizard-summary-item">
              <dt>冲突</dt>
              <dd>{previewBatch.summary.conflict}</dd>
            </div>
            <div className="parameter-import-wizard-summary-item">
              <dt>高风险</dt>
              <dd>{previewBatch.summary.highRisk}</dd>
            </div>
          </dl>

          <div className="parameter-import-preview-table-wrap">
            <table className="import-review-diff-table parameter-import-preview-table" aria-label="预览条目">
              <thead>
                <tr>
                  <th scope="col" className="parameter-import-preview-table__select">
                    <input
                      type="checkbox"
                      aria-label="全选可应用条目"
                      checked={allEligibleSelected}
                      disabled={eligibleItems.length === 0}
                      onChange={(event) => toggleAllEligible(event.target.checked)}
                    />
                  </th>
                  <th scope="col">参数名</th>
                  <th scope="col">模块</th>
                  <th scope="col">导入值</th>
                  <th scope="col">变更类型</th>
                  <th scope="col">风险</th>
                </tr>
              </thead>
              <tbody>
                {previewBatch.items.map((item) => {
                  const eligible = isEligibleImportItem(item);
                  return (
                    <tr
                      key={item.id}
                      className={eligible ? "parameter-import-preview-row" : "parameter-import-preview-row parameter-import-preview-row--disabled"}
                    >
                      <td className="parameter-import-preview-table__select">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${item.name}`}
                          checked={selectedItemIds.has(item.id)}
                          disabled={!eligible}
                          onChange={(event) => toggleItem(item.id, event.target.checked)}
                        />
                      </td>
                      <td>
                        <strong className="parameter-import-preview-table__name">{item.name}</strong>
                      </td>
                      <td>{item.module || "—"}</td>
                      <td className="parameter-import-preview-table__value">{formatPreviewValue(item)}</td>
                      <td>
                        <span className="import-review-status-badge">{CLASSIFICATION_LABEL[item.classification]}</span>
                      </td>
                      <td>
                        <span className="parameter-import-preview-table__risk">{RISK_LABEL[item.risk]}</span>
                        {item.riskFlag ? <span className="import-review-badge-new">高风险</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <div className="dialog-actions">
        <button type="button" className="button subtle" onClick={onBack}>
          上一步
        </button>
        <button type="button" className="button primary" disabled={!hasEligibleSelection} onClick={onNext}>
          下一步
        </button>
      </div>
    </section>
  );
}
