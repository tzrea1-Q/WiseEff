import { useEffect, useId, useState } from "react";

import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { WorkbenchSheet } from "@/components/WorkbenchSheet";
import { hasMeaningfulDebugChange, validateDebugValue } from "@/domain/dtsReload/debugValue";
import {
  dtsReloadBlockReasonLabels,
  dtsReloadPurposeLabels,
  dtsReloadStatusLabels,
  type DtsReloadCandidate
} from "@/domain/dtsReload/types";
import { describeReloadValueShapeAuthoring } from "@/domain/dtsReload/valueShape";
import { DtsReloadCandidateMeaning } from "@/features/dts-reload/DtsReloadCandidateMeaning";
import { formatAttemptedAt } from "@/features/dts-reload/dtsReloadPresentation";

export type DtsReloadCandidateEditDialogProps = {
  candidate: DtsReloadCandidate;
  /** Current draft debug value (from the reload batch when already selected). */
  initialDebugValue: string;
  alreadyInBatch: boolean;
  canEdit?: boolean;
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
  if (constraints.cells != null) parts.push(`元素数量 ${String(constraints.cells)}`);
  Object.keys(constraints).filter((key) => !["min", "max", "cells"].includes(key)).forEach((key) => parts.push(`${key}：${JSON.stringify(constraints[key])}`));
  return parts.join(" · ") || "未声明额外约束，请结合参数含义核对";
}

export function DtsReloadCandidateEditDialog({
  candidate,
  initialDebugValue,
  alreadyInBatch,
  canEdit = true,
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
      ? "敏感 · 关键风险"
      : candidate.sensitiveMatch
        ? "敏感 · 高风险"
        : null;
  const editable = canEdit && candidate.debuggable;
  const validationError = editable && debugValue !== initialDebugValue ? validateDebugValue(debugValue, candidate) : null;
  const canSubmit = editable && hasMeaningfulDebugChange(debugValue, candidate.baselineValue, candidate.resolvedValueShape);
  const submitLabel = alreadyInBatch ? "更新本轮" : "加入本轮重载";
  const example = candidate.baselineValue?.trim() || describeReloadValueShapeAuthoring(candidate.resolvedValueShape).placeholder;

  const submit = () => {
    if (!canSubmit) return;
    const validation = validateDebugValue(debugValue, candidate);
    if (validation) {
      setErrorMessage(validation);
      return;
    }
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
      closeLabel={editable ? "关闭参数编辑" : "关闭参数详情"}
      title={title}
      description={description}
      footer={
        <div className="draft-sheet-footer">
          <span>{editable ? "加入本轮后保留修改；启动预检后，还需确认部署到设备。" : "参数详情仅供查看。"}</span>
          <div className="draft-sheet-footer-actions">
            <button type="button" className="button subtle" onClick={onClose}>
              {editable ? "取消" : "关闭"}
            </button>
            {editable ? <button
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
            </button> : null}
          </div>
        </div>
      }
    >
      <div className="draft-sheet-stack dts-reload-candidate-edit">
        <DtsReloadCandidateMeaning meaning={candidate.description} headingId={`${fieldId}-meaning`} />
        <div className="debug-detail-fields">
          <div className="debug-detail-row"><span>单位</span><strong>{candidate.unit || "未声明"}</strong></div>
          <div className="debug-detail-row"><span>约束</span><strong>{constraintSummary(candidate.constraints)}</strong></div>
        </div>
        {!editable ? <p role="status" className="text-sm text-muted-foreground">
          {candidate.debuggable ? "当前状态下仅可查看参数详情。" : dtsReloadBlockReasonLabels[candidate.blockReason ?? "unsupported-value-shape"]}
        </p> : null}
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
            aria-describedby={`${fieldId}-format${errorMessage || validationError ? ` ${fieldId}-error` : ""}`}
            rows={2}
            value={debugValue}
            readOnly={!editable}
            aria-invalid={Boolean(errorMessage || validationError)}
            placeholder={example}
            onChange={(event) => {
              setDebugValue(event.target.value);
              setErrorMessage("");
              onDirtyChange(event.target.value !== initialDebugValue);
            }}
          />
          <div id={`${fieldId}-format`} className="dts-reload-run-tray__meta">
            {example ? <><p>语法参照（仅供格式参考，不是业务取值建议）</p><pre className="parameter-value-content" role="region" aria-label="语法参照" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- This overflowing value scrollport must support keyboard scrolling. */}>{example}</pre></> : "空属性不需要赋值；可输入 /delete-property/ 删除该属性。"}
          </div>
          {errorMessage || validationError ? <p id={`${fieldId}-error`} role="alert" className="node-row-error">{errorMessage || validationError}</p> : null}
        </div>
        <details className="dts-reload-candidate-edit__details">
        <summary>技术信息</summary>
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
          </div>
        </div>

        </details>

        {candidate.lastReload ? <details className="dts-reload-candidate-edit__details">
        <summary>上次重载 · {dtsReloadStatusLabels[candidate.lastReload.outcome]}</summary>
        <section className="dts-reload-candidate-edit__history" aria-labelledby={`${fieldId}-history`}>
          <h3 id={`${fieldId}-history`}>上次重载</h3>
              <div className="debug-detail-fields">
                <div>
                  <span className="field-label">调试值</span>
                  <pre className="parameter-value-content" role="region" aria-label="上次重载调试值" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- This overflowing value scrollport must support keyboard scrolling. */}>{candidate.lastReload.debugValue}</pre>
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
