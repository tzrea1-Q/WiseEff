import { ArrowRight, X } from "lucide-react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import type { ParameterRecord } from "@/domain/parameters/types";
import {
  getComplexParameterLineCount,
  getComplexParameterKindLabel,
  shouldSummarizeComplexParameter
} from "@/parameterValueKind";
import { RiskBadge, riskLabels } from "../workbenchUi";

export type ParameterDraftDialogItem = {
  parameterId: string;
  targetValue: string;
  reason: string;
  parameter: ParameterRecord;
};

export type ParameterDraftDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  drafts: ParameterDraftDialogItem[];
  focusedParameterId: string | null;
  canEdit: boolean;
  onClose: () => void;
  onClearAll: () => void;
  onRemoveItem: (parameterId: string) => void;
  onUpdateDraft: (parameter: ParameterRecord, patch: Partial<{ targetValue: string; reason: string }>) => void;
  onSubmit: () => void;
  onViewSubmissions: () => void;
};

function parseRange(range: string) {
  const [min, max] = range.split("-").map((part) => Number.parseFloat(part.trim()));
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return { min, max };
}

function getRangeWarning(parameter: ParameterRecord, targetValue: string) {
  const numericValue = Number.parseFloat(targetValue);
  const parsedRange = parseRange(parameter.range);
  if (!parsedRange || !Number.isFinite(numericValue)) {
    return "";
  }
  if (numericValue < parsedRange.min || numericValue > parsedRange.max) {
    return `超出 ${parameter.range} ${parameter.unit}`.trim();
  }
  return "";
}

function getLineCount(value: string) {
  return getComplexParameterLineCount(value);
}

export function ParameterDraftDialog({
  open,
  title,
  description,
  drafts,
  focusedParameterId,
  canEdit,
  onClose,
  onClearAll,
  onRemoveItem,
  onUpdateDraft,
  onSubmit,
  onViewSubmissions
}: ParameterDraftDialogProps) {
  const draftCount = drafts.length;
  const allDraftsAreSubmittable = drafts.length > 0 && drafts.every((item) => item.targetValue.trim() && item.reason.trim());
  const hasComplexDraft = drafts.some((item) =>
    shouldSummarizeComplexParameter(item.parameter, item.parameter.currentValue, item.targetValue)
  );

  return (
    <ModalDialog
      open={open}
      onDismiss={onClose}
      className={["parameter-detail-dialog", "parameter-draft-dialog", hasComplexDraft ? "parameter-draft-dialog--wide" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {({ titleId }) => (
        <>
        <header className="parameter-detail-dialog__header">
          <div>
            <span className="eyebrow" id={titleId}>{title}</span>
            {description ? <p className="parameter-draft-dialog__description">{description}</p> : null}
          </div>
          <button className="icon-button" type="button" aria-label="关闭草稿" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="parameter-draft-dialog__body">
          <div className="round-draft-panel" aria-label="本轮提交草稿">
            <div>
              <strong>本轮提交 {draftCount} 项</strong>
              <span>可先收集多个参数，再统一提交审阅。</span>
            </div>
            <button className="button subtle" type="button" onClick={onClearAll}>
              全部清空
            </button>
          </div>

          <div className="draft-card-list">
            {drafts.map((item) => {
              const targetInputId = `target-value-${item.parameterId}`;
              const reasonInputId = `reason-${item.parameterId}`;
              const warning = getRangeWarning(item.parameter, item.targetValue);
              const warningId = `target-warning-${item.parameterId}`;
              const isFocusedCard = focusedParameterId === item.parameterId;
              const isComplexCard = shouldSummarizeComplexParameter(
                item.parameter,
                item.parameter.currentValue,
                item.targetValue
              );

              return (
                <article
                  className={[
                    "draft-card",
                    "parameter-draft-card",
                    isComplexCard ? "parameter-draft-card--complex" : "parameter-draft-card--simple"
                  ].join(" ")}
                  key={item.parameterId}
                >
                  <div className="draft-card-head">
                    <div>
                      <strong>{item.parameter.name}</strong>
                      <small>
                        {item.parameter.module} · {riskLabels[item.parameter.risk]}
                      </small>
                    </div>
                    <RiskBadge risk={item.parameter.risk} />
                  </div>
                  {isComplexCard ? (
                    <>
                      <div className="parameter-draft-meta-row" aria-label={`${item.parameter.name} 草稿摘要`}>
                        <span className="parameter-draft-meta-pill">复杂配置</span>
                        <span>当前 {getLineCount(item.parameter.currentValue)} 行</span>
                        <span>目标 {getLineCount(item.targetValue)} 行</span>
                        <span>{getComplexParameterKindLabel(item.parameter)}</span>
                      </div>
                      <section className="parameter-draft-diff-panel" aria-label={`${item.parameter.name} 变更 diff`}>
                        <strong>变更 diff</strong>
                        <ParameterValueDiff baseValue={item.parameter.currentValue} targetValue={item.targetValue} />
                      </section>
                      <label className="field-label" htmlFor={targetInputId}>
                        目标配置
                      </label>
                      <textarea
                        id={targetInputId}
                        aria-label={isFocusedCard ? "目标值" : `目标值 ${item.parameter.name}`}
                        className="parameter-target-editor parameter-draft-code-editor"
                        value={item.targetValue}
                        rows={8}
                        wrap="off"
                        aria-describedby={warning ? warningId : undefined}
                        aria-invalid={warning ? true : undefined}
                        disabled={!canEdit}
                        onChange={(event) => {
                          onUpdateDraft(item.parameter, { targetValue: event.target.value });
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <div className="draft-diff">
                        <span>
                          {item.parameter.currentValue}
                          {item.parameter.unit}
                        </span>
                        <ArrowRight size={15} aria-hidden="true" />
                        <strong>
                          {item.targetValue}
                          {item.parameter.unit}
                        </strong>
                      </div>
                      <p className="draft-drift-note">
                        Agent 建议调整到推荐值，当前偏差 {item.parameter.currentValue} → {item.parameter.recommendedValue}
                        {item.parameter.unit}
                      </p>
                      <label className="field-label" htmlFor={targetInputId}>
                        {isFocusedCard ? "目标值" : `目标值 ${item.parameter.name}`}
                      </label>
                      <textarea
                        id={targetInputId}
                        aria-label={isFocusedCard ? "目标值" : `目标值 ${item.parameter.name}`}
                        className="parameter-target-editor"
                        value={item.targetValue}
                        rows={6}
                        aria-describedby={warning ? warningId : undefined}
                        aria-invalid={warning ? true : undefined}
                        disabled={!canEdit}
                        onChange={(event) => {
                          onUpdateDraft(item.parameter, { targetValue: event.target.value });
                        }}
                      />
                    </>
                  )}
                  {warning ? (
                    <p className="field-warning" id={warningId}>
                      {warning}
                    </p>
                  ) : null}
                  <label className="field-label" htmlFor={reasonInputId}>
                    {isFocusedCard ? "修改原因" : `修改原因 ${item.parameter.name}`}
                  </label>
                  <textarea
                    id={reasonInputId}
                    aria-label={isFocusedCard ? "修改原因" : `修改原因 ${item.parameter.name}`}
                    value={item.reason}
                    disabled={!canEdit}
                    onChange={(event) => {
                      onUpdateDraft(item.parameter, { reason: event.target.value });
                    }}
                    placeholder={`说明为什么要将 ${item.parameter.name} 改为 ${item.targetValue}`}
                    rows={3}
                  />
                  <button className="button subtle" type="button" onClick={() => onRemoveItem(item.parameterId)}>
                    移除本项
                  </button>
                </article>
              );
            })}
          </div>
        </div>

        <footer className="parameter-detail-dialog__footer">
          <span className="parameter-detail-footer-status">
            <button className="button subtle parameter-draft-dialog__submit-link" type="button" onClick={onViewSubmissions}>
              查看我的提交
            </button>
          </span>
          <div className="parameter-detail-dialog__actions">
            <button className="button subtle" type="button" onClick={onClose}>
              关闭
            </button>
            <button className="button primary" type="button" disabled={!canEdit || !allDraftsAreSubmittable} onClick={onSubmit}>
              提交参数
            </button>
          </div>
        </footer>
        </>
      )}
    </ModalDialog>
  );
}
