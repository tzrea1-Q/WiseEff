import { ArrowRight, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ParameterRecord } from "@/domain/parameters/types";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
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

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
      ].join(",")
    )
  ).filter((element) => !element.hasAttribute("disabled") && !element.hasAttribute("hidden") && element.tabIndex >= 0);
}

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

function isComplexDraftValue(value: string) {
  return value.includes("\n") || value.length > 80;
}

function getLineCount(value: string) {
  return value ? value.split(/\r?\n/).length : 0;
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
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      const opener = openerRef.current;
      if (opener && opener.isConnected) {
        opener.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = activeElement ? focusableElements.indexOf(activeElement) : -1;
      const current = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = event.shiftKey
        ? (current - 1 + focusableElements.length) % focusableElements.length
        : (current + 1) % focusableElements.length;

      event.preventDefault();
      focusableElements[nextIndex]?.focus();
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => dialog.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useBodyScrollLock(open);

  if (!open) {
    return null;
  }

  const draftCount = drafts.length;
  const allDraftsHaveTargets = drafts.length > 0 && drafts.every((item) => item.targetValue.trim());
  const hasComplexDraft = drafts.some(
    (item) =>
      isComplexDraftValue(item.parameter.currentValue) ||
      isComplexDraftValue(item.targetValue) ||
      isComplexDraftValue(item.parameter.configFormat)
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div
        ref={dialogRef}
        className={["parameter-detail-dialog", "parameter-draft-dialog", hasComplexDraft ? "parameter-draft-dialog--wide" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <header className="parameter-detail-dialog__header">
          <div>
            <span className="eyebrow">修改草稿</span>
            {description ? <p className="parameter-draft-dialog__description">{description}</p> : null}
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" aria-label="关闭草稿" onClick={onClose}>
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
              const isComplexCard =
                isComplexDraftValue(item.parameter.currentValue) ||
                isComplexDraftValue(item.targetValue) ||
                isComplexDraftValue(item.parameter.configFormat);

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
                        <span>{item.parameter.configFormat.startsWith("DTS") ? "DTS" : "多行参数"}</span>
                      </div>
                      <div className="parameter-draft-code-grid">
                        <section className="parameter-draft-code-panel" aria-label={`${item.parameter.name} 当前配置`}>
                          <strong>当前配置</strong>
                          <pre className="parameter-draft-code">{item.parameter.currentValue || "-"}</pre>
                        </section>
                        <section className="parameter-draft-code-panel" aria-label={`${item.parameter.name} 目标配置`}>
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
                        </section>
                      </div>
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
            <button className="button primary" type="button" disabled={!canEdit || !allDraftsHaveTargets} onClick={onSubmit}>
              提交参数
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
