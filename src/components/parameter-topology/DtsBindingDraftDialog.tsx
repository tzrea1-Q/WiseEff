import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleX } from "lucide-react";

import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import {
  complexEditorRows,
  getComplexParameterKindLabel,
  getComplexParameterLineCount,
  shouldSummarizeComplexParameter
} from "@/parameterValueKind";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { BindingEditValidation } from "./BindingDetailPanel";

export type LocalBindingDraft = {
  rawValue: string;
  reason: string;
};

export type LocalBindingDraftBag = Record<string, LocalBindingDraft>;

export type DtsBindingDraftDialogProps = {
  rowsByBindingId: ReadonlyMap<string, DtsParameterWorkbenchRow>;
  draftBag: LocalBindingDraftBag;
  focusedBindingId: string | null;
  canEdit: boolean;
  onClose: () => void;
  onUpdateDraft: (bindingId: string, patch: Partial<LocalBindingDraft>) => void;
  onRemoveDraft: (bindingId: string) => void;
  onClearAll: () => void;
  onCreateDraft: (input: {
    bindingId: string;
    rawValue: string;
    reason: string;
  }) => Promise<BindingEditValidation>;
};

type CardSubmissionState = "idle" | "pending" | "success" | "failure";
type CardDiagnostics = {
  state: CardSubmissionState;
  message: string;
  diagnostics: BindingEditValidation["diagnostics"];
};

function importanceLabel(importance: DtsParameterWorkbenchRow["importance"]): string {
  if (importance === "high") return "高";
  if (importance === "low") return "低";
  return "中";
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "服务端暂时无法创建草稿，请稍后重试。";
}

function dtsContext(row: DtsParameterWorkbenchRow): string {
  return [row.topologyPath, row.compatible].filter(Boolean).join(" · ") || "DTS 位置不可用";
}

function bindingDraftKindHint(row: DtsParameterWorkbenchRow) {
  return {
    configFormat: `DTS ${row.valueShapeSummary || row.propertyKey}`
  };
}

function displayRaw(value: string) {
  return formatDtsRawValueForUi(value) || value;
}

export function DtsBindingDraftDialog({
  rowsByBindingId,
  draftBag,
  focusedBindingId,
  canEdit,
  onClose,
  onUpdateDraft,
  onRemoveDraft,
  onClearAll,
  onCreateDraft
}: DtsBindingDraftDialogProps) {
  const mountedRef = useRef(true);
  const requestGenerationRef = useRef(0);
  const [batchPending, setBatchPending] = useState(false);
  const [cardDiagnostics, setCardDiagnostics] = useState<Record<string, CardDiagnostics>>({});
  const focusTargetRef = useRef<HTMLTextAreaElement | null>(null);

  const bindingIds = useMemo(() => {
    const ids = Object.keys(draftBag);
    if (!focusedBindingId) return ids;
    return [
      focusedBindingId,
      ...ids.filter((id) => id !== focusedBindingId)
    ];
  }, [draftBag, focusedBindingId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  const submittableBindingIds = bindingIds.filter((bindingId) => {
    const draft = draftBag[bindingId];
    return Boolean(draft?.rawValue.trim() && draft.reason.trim());
  });

  const submitDrafts = async () => {
    if (!canEdit || batchPending || submittableBindingIds.length === 0) return;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setBatchPending(true);

    for (const bindingId of submittableBindingIds) {
      if (!mountedRef.current || requestGenerationRef.current !== requestGeneration) break;
      const draft = draftBag[bindingId];
      if (!draft?.rawValue.trim() || !draft.reason.trim()) continue;

      setCardDiagnostics((current) => ({
        ...current,
        [bindingId]: { state: "pending", message: "", diagnostics: [] }
      }));

      try {
        const result = await onCreateDraft({
          bindingId,
          rawValue: draft.rawValue,
          reason: draft.reason.trim()
        });
        if (!mountedRef.current || requestGenerationRef.current !== requestGeneration) break;

        if (result.valid) {
          setCardDiagnostics((current) => {
            const next = { ...current };
            delete next[bindingId];
            return next;
          });
          onRemoveDraft(bindingId);
        } else {
          setCardDiagnostics((current) => ({
            ...current,
            [bindingId]: {
              state: "failure",
              message: "服务端校验未通过",
              diagnostics: result.diagnostics
            }
          }));
        }
      } catch (error) {
        if (!mountedRef.current || requestGenerationRef.current !== requestGeneration) break;
        setCardDiagnostics((current) => ({
          ...current,
          [bindingId]: {
            state: "failure",
            message: readableError(error),
            diagnostics: []
          }
        }));
      }
    }

    if (mountedRef.current && requestGenerationRef.current === requestGeneration) {
      setBatchPending(false);
    }
  };

  const clearCardDiagnostics = (bindingId: string) => {
    setCardDiagnostics((current) => {
      if (!current[bindingId]) return current;
      const next = { ...current };
      delete next[bindingId];
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent
        aria-label="修改草稿"
        className="dts-binding-draft-dialog max-h-[calc(100vh-2rem)] w-full sm:max-w-5xl overflow-y-auto"
        overlayClassName="dts-binding-draft-dialog__overlay"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusTargetRef.current?.focus();
        }}
      >
        <DialogHeader className="dts-binding-draft-dialog__header flex-row items-start justify-between">
          <div>
            <DialogTitle>修改草稿</DialogTitle>
            <DialogDescription>
              编辑会加入本轮草稿；校验通过后进入下方「本轮已修改」托盘。
            </DialogDescription>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭草稿" onClick={onClose}>
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </Button>
        </DialogHeader>

        <div className="dts-binding-draft-dialog__content grid gap-4">
          <div className="dts-binding-draft-dialog__summary" aria-label="本轮草稿汇总">
            <div>
              <strong>本轮草稿 {bindingIds.length} 项</strong>
              <span>可先收集多个参数，再统一校验并加入本轮。</span>
            </div>
            <Button type="button" variant="outline" disabled={bindingIds.length === 0} onClick={onClearAll}>
              全部清空
            </Button>
          </div>

          <div className="dts-binding-draft-dialog__cards">
            {bindingIds.map((bindingId) => {
              const row = rowsByBindingId.get(bindingId);
              const draft = draftBag[bindingId];
              if (!row || !draft) return null;
              const isFocused = bindingId === focusedBindingId;
              const diagnostics = cardDiagnostics[bindingId];
              const isPending = diagnostics?.state === "pending";
              const targetInputId = `dts-draft-raw-${bindingId}`;
              const reasonInputId = `dts-draft-reason-${bindingId}`;
              const currentDisplay = displayRaw(row.rawValue);
              const targetDisplay = displayRaw(draft.rawValue);
              const kindHint = bindingDraftKindHint(row);
              const isComplexCard = shouldSummarizeComplexParameter(
                kindHint,
                currentDisplay,
                targetDisplay
              );
              const editorRows = isComplexCard
                ? complexEditorRows(targetDisplay || currentDisplay, 8)
                : 4;

              return (
                <article
                  key={bindingId}
                  className={[
                    "dts-binding-draft-card",
                    isFocused ? "is-focused" : "",
                    isComplexCard ? "dts-binding-draft-card--complex" : "dts-binding-draft-card--simple"
                  ].filter(Boolean).join(" ")}
                  aria-label={`${row.propertyKey} 草稿`}
                >
                  <div className="dts-binding-draft-card__head">
                    <div>
                      <strong>{row.propertyKey}</strong>
                      <small>
                        {row.moduleName} · {row.instanceName ?? "器件实例不可用"} · {importanceLabel(row.importance)}
                      </small>
                    </div>
                  </div>
                  <p className="dts-binding-draft-card__context">
                    <code>{dtsContext(row)}</code>
                  </p>

                  {isComplexCard ? (
                    <>
                      <div className="parameter-draft-meta-row" aria-label={`${row.propertyKey} 草稿摘要`}>
                        <span className="parameter-draft-meta-pill">复杂配置</span>
                        <span>当前 {getComplexParameterLineCount(currentDisplay)} 行</span>
                        <span>目标 {getComplexParameterLineCount(targetDisplay)} 行</span>
                        <span>{getComplexParameterKindLabel(kindHint)}</span>
                      </div>
                      <section
                        className="parameter-draft-diff-panel"
                        aria-label={`${row.propertyKey} 变更 diff`}
                      >
                        <strong>变更 diff</strong>
                        <ParameterValueDiff baseValue={currentDisplay} targetValue={targetDisplay || "—"} />
                      </section>
                    </>
                  ) : (
                    <div className="dts-binding-draft-card__preview" aria-label={`${row.propertyKey} 当前到目标预览`}>
                      <code>{currentDisplay}</code>
                      <ArrowRight size={15} aria-hidden="true" />
                      <strong><code>{targetDisplay || "—"}</code></strong>
                    </div>
                  )}

                  <Label htmlFor={targetInputId}>目标值</Label>
                  <Textarea
                    id={targetInputId}
                    ref={isFocused ? focusTargetRef : undefined}
                    value={draft.rawValue}
                    rows={editorRows}
                    wrap={isComplexCard ? "off" : undefined}
                    className={isComplexCard ? "dts-binding-draft-card__code-editor" : undefined}
                    disabled={!canEdit || batchPending || isPending}
                    aria-label={isFocused ? "目标值" : `目标值 ${row.propertyKey}`}
                    onChange={(event) => {
                      onUpdateDraft(bindingId, { rawValue: event.target.value });
                      clearCardDiagnostics(bindingId);
                    }}
                  />
                  <Label htmlFor={reasonInputId}>修改原因</Label>
                  <Textarea
                    id={reasonInputId}
                    value={draft.reason}
                    disabled={!canEdit || batchPending || isPending}
                    aria-label={isFocused ? "修改原因" : `修改原因 ${row.propertyKey}`}
                    placeholder={`说明为什么要将 ${row.propertyKey} 改为\n${draft.rawValue || "新值"}`}
                    onChange={(event) => {
                      onUpdateDraft(bindingId, { reason: event.target.value });
                      clearCardDiagnostics(bindingId);
                    }}
                  />
                  {diagnostics?.state === "failure" ? (
                    <p role="alert">{diagnostics.message}</p>
                  ) : null}
                  {diagnostics?.diagnostics && diagnostics.diagnostics.length > 0 ? (
                    <ul aria-label="编辑诊断">
                      {diagnostics.diagnostics.map((item) => (
                        <li key={`${item.code ?? "diagnostic"}:${item.message}`}>
                          {item.code ? `${item.code}: ` : null}{item.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={batchPending || isPending}
                    onClick={() => onRemoveDraft(bindingId)}
                  >
                    移除本项
                  </Button>
                </article>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
          <Button
            type="button"
            disabled={!canEdit || batchPending || submittableBindingIds.length === 0}
            onClick={() => void submitDrafts()}
          >
            {batchPending ? "校验中…" : "校验并加入本轮"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
