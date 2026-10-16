import { useEffect, useId, useState } from "react";

import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { WorkbenchSheet } from "@/components/WorkbenchSheet";
import { hasMeaningfulDebugChange } from "@/domain/dtsReload/debugValue";
import {
  dtsReloadPurposeLabels,
  dtsReloadStatusLabels,
  type DtsReloadCandidate
} from "@/domain/dtsReload/types";
import { describeReloadValueShapeAuthoring } from "@/domain/dtsReload/valueShape";
import { DtsReloadCandidateMeaning } from "@/features/dts-reload/DtsReloadCandidateMeaning";

export type DtsReloadCandidateEditDialogProps = {
  candidate: DtsReloadCandidate;
  /** Current draft debug value (from the reload batch when already selected). */
  initialDebugValue: string;
  alreadyInBatch: boolean;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Persist debug value into the reload batch; return an error message to keep the sheet open. */
  onConfirm: (debugValue: string) => string | null;
  /** Open a past reload run from the candidate's last-reload projection. */
  onOpenHistoryRun?: (runId: string) => void;
};

export { hasMeaningfulDebugChange };

function constraintSummary(constraints: Record<string, unknown>): string {
  const parts: string[] = [];
  if (constraints.min != null || constraints.max != null) {
    parts.push(`范围 ${String(constraints.min ?? "…")} – ${String(constraints.max ?? "…")}`);
  }
  if (constraints.cells != null) parts.push(`cells=${String(constraints.cells)}`);
  if (parts.length === 0) {
    const keys = Object.keys(constraints);
    return keys.length > 0 ? keys.join(", ") : "无";
  }
  return parts.join(" · ");
}

function formatAttemptedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function DtsReloadCandidateEditDialog({
  candidate,
  initialDebugValue,
  alreadyInBatch,
  onClose,
  onDirtyChange,
  onConfirm,
  onOpenHistoryRun
}: DtsReloadCandidateEditDialogProps) {
  const fieldId = useId();
  const [debugValue, setDebugValue] = useState(initialDebugValue);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setDebugValue(initialDebugValue);
    setErrorMessage("");
    onDirtyChange(false);
  }, [candidate.bindingId, initialDebugValue, onDirtyChange]);

  const title = candidate.displayName || candidate.propertyKey;
  const description = [candidate.module.trim() || "未分类", candidate.nodePath ?? "无路径"]
    .filter(Boolean)
    .join(" · ");
  const sensitive =
    candidate.sensitiveMatch?.riskTier === "critical"
      ? "敏感 · critical"
      : candidate.sensitiveMatch
        ? "敏感 · high"
        : null;
  const canSubmit = hasMeaningfulDebugChange(debugValue, candidate.baselineValue, candidate.resolvedValueShape);
  const submitLabel = alreadyInBatch ? "更新本轮" : "加入本轮重载";
  const example = describeReloadValueShapeAuthoring(candidate.resolvedValueShape).placeholder;

  const submit = () => {
    if (!canSubmit) return;
    const error = onConfirm(debugValue);
    if (error) {
      setErrorMessage(error);
      return;
    }
    onClose();
  };

  return (
    <WorkbenchSheet
      open
      onClose={onClose}
      closeLabel="关闭参数编辑"
      title={title}
      description={description}
      footer={
        <div className="draft-sheet-footer">
          <span>加入本轮后保留修改；启动预检后，还需确认部署到设备。</span>
          <div className="draft-sheet-footer-actions">
            <button type="button" className="button subtle" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="button primary"
              onClick={submit}
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
              title={
                !debugValue.trim()
                  ? "请先输入调试值"
                  : !canSubmit
                    ? "调试值与库基线相同，无需加入本轮"
                    : undefined
              }
            >
              {submitLabel}
            </button>
          </div>
        </div>
      }
    >
      <div className="draft-sheet-stack dts-reload-candidate-edit">
        <div className="dts-reload-candidate-edit__value">
          {sensitive ? <p className="dts-reload-sensitive-badge">{sensitive} · 部署前请核对设备与节点</p> : null}
          <span className="field-label">库基线 → 调试值</span>
          <ParameterValueDiff baseValue={candidate.baselineValue ?? ""} targetValue={debugValue} />
          <label className="field-label" htmlFor={fieldId}>
            调试值{candidate.unit ? `（${candidate.unit}）` : ""}
            {debugValue !== initialDebugValue ? <small role="status"> · 尚未加入本轮</small> : null}
          </label>
          <textarea
            id={fieldId}
            aria-label={`${title} 调试值`}
            aria-describedby={`${fieldId}-format`}
            rows={2}
            value={debugValue}
            placeholder={example}
            onChange={(event) => {
              setDebugValue(event.target.value);
              setErrorMessage("");
              onDirtyChange(event.target.value !== initialDebugValue);
            }}
          />
          <p id={`${fieldId}-format`} className="dts-reload-run-tray__meta">
            {candidate.valueShapeKind ?? "DTS 值"} · {constraintSummary(candidate.constraints)}
            {example ? <> · 示例 <code>{example}</code></> : " · 空属性不需要赋值"}
          </p>
          {errorMessage ? <p role="alert" className="node-row-error">{errorMessage}</p> : null}
        </div>
        <details className="dts-reload-candidate-edit__details">
        <summary>参数说明与约束</summary>
        <div className="debug-detail-card">
          <div className="debug-detail-fields">
            <div className="debug-detail-row"><span>属性</span><code>{candidate.propertyKey}</code></div>
            <div className="debug-detail-row">
              <span>模块</span>
              <strong>{candidate.module.trim() || "未分类"}</strong>
            </div>
            <div className="debug-detail-row">
              <span>节点路径</span>
              <strong className="mono">{candidate.nodePath ?? "无路径"}</strong>
            </div>
            <div className="debug-detail-row">
              <span>值形态</span>
              <strong>{candidate.valueShapeKind ?? "—"}</strong>
            </div>
            <div className="debug-detail-row">
              <span>单位</span>
              <strong>{candidate.unit ?? "—"}</strong>
            </div>
            <div className="debug-detail-row">
              <span>约束</span>
              <strong>{constraintSummary(candidate.constraints)}</strong>
            </div>
          </div>
        </div>

        <DtsReloadCandidateMeaning
          meaning={candidate.description}
          headingId={`${fieldId}-meaning`}
        />
        </details>

        {candidate.lastReload ? <details className="dts-reload-candidate-edit__details">
        <summary>上次重载 · {dtsReloadStatusLabels[candidate.lastReload.outcome]}</summary>
        <section className="dts-reload-candidate-edit__history" aria-labelledby={`${fieldId}-history`}>
          <h3 id={`${fieldId}-history`}>上次重载</h3>
              <div className="debug-detail-fields">
                <div className="debug-detail-row">
                  <span>调试值</span>
                  <strong className="mono">{candidate.lastReload.debugValue}</strong>
                </div>
                <div className="debug-detail-row">
                  <span>结果</span>
                  <strong>
                    {dtsReloadStatusLabels[candidate.lastReload.outcome]}
                    {candidate.lastReload.purpose === "restore-baseline"
                      ? ` · ${dtsReloadPurposeLabels["restore-baseline"]}`
                      : ""}
                  </strong>
                </div>
                <div className="debug-detail-row">
                  <span>时间</span>
                  <strong>{formatAttemptedAt(candidate.lastReload.attemptedAt)}</strong>
                </div>
              </div>
              {onOpenHistoryRun ? (
                <button
                  type="button"
                  className="button subtle dts-reload-candidate-edit__history-open"
                  onClick={() => {
                    onOpenHistoryRun(candidate.lastReload!.runId);
                  }}
                >
                  查看该次运行详情
                </button>
              ) : null}
        </section>
        </details> : null}
      </div>
    </WorkbenchSheet>
  );
}
