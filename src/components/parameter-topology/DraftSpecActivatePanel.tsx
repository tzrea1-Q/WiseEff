import { CircleX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ModalDialog } from "@/components/common/ModalDialog";
import type { ParameterSpecDetailView } from "./ParameterSpecDetail";

export type ActivateDraftSpecInput = {
  specId: string;
  valueShape: Record<string, unknown>;
  constraints: Record<string, unknown>;
  documentation: string;
  reason: string;
};

type DraftSpecActivatePanelProps = {
  detail: ParameterSpecDetailView;
  onActivate: (input: ActivateDraftSpecInput) => void;
  pending?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function inferredCellCount(shape: Record<string, unknown>): number | null {
  if (
    typeof shape.cellsPerGroup === "number" &&
    Number.isInteger(shape.cellsPerGroup) &&
    shape.cellsPerGroup > 0
  ) {
    return shape.cellsPerGroup;
  }
  if (typeof shape.cells === "number" && Number.isInteger(shape.cells) && shape.cells > 0) {
    return shape.cells;
  }
  return null;
}

function defaultConstraintsForShape(shape: Record<string, unknown>): Record<string, unknown> {
  const kind = String(shape.kind ?? "");
  if (kind === "cells" || kind === "u32-array" || kind === "phandle-list") {
    const cells = inferredCellCount(shape);
    return cells == null ? {} : { cells };
  }
  if (kind === "bytes") {
    if (typeof shape.length === "number" && Number.isFinite(shape.length)) {
      return { minLength: shape.length, maxLength: shape.length };
    }
    return {};
  }
  return {};
}

function valueShapeFromDetail(detail: ParameterSpecDetailView): {
  shape: Record<string, unknown> | null;
  blockReason: string | null;
} {
  const fromDetail = asRecord(detail.valueShape);
  if (fromDetail && typeof fromDetail.kind === "string") {
    const kind = fromDetail.kind;
    if (kind === "unknown" || kind === "mixed") {
      return {
        shape: fromDetail,
        blockReason: `当前推断类型为「${kind}」，无法激活；请人工修订 occurrence 或改用库内参数定义。`,
      };
    }
    if (
      (kind === "cells" || kind === "phandle-list" || kind === "u32-array") &&
      inferredCellCount(fromDetail) == null
    ) {
      return {
        shape: fromDetail,
        blockReason: "单元格分组信息不完整（缺少 cellsPerGroup/cells），无法激活。",
      };
    }
    if (
      (kind === "cells" || kind === "phandle-list" || kind === "u32-array") &&
      (typeof fromDetail.bits !== "number" ||
        typeof fromDetail.groups !== "number" ||
        !Number.isInteger(fromDetail.groups) ||
        fromDetail.groups < 1)
    ) {
      return {
        shape: fromDetail,
        blockReason: "单元格分组信息不完整（缺少有效 bits 或 groups），无法激活。",
      };
    }
    if (
      kind === "bytes" &&
      (typeof fromDetail.length !== "number" ||
        !Number.isInteger(fromDetail.length) ||
        fromDetail.length < 0)
    ) {
      return {
        shape: fromDetail,
        blockReason: "字节数组缺少明确 length，无法激活。",
      };
    }
    return { shape: { ...fromDetail }, blockReason: null };
  }

  // Legacy rows that only expose valueType — refuse to guess cells=1.
  if (detail.valueType === "unknown" || detail.valueType === "mixed" || !detail.valueType) {
    return {
      shape: null,
      blockReason: `缺少完整 valueShape（当前类型「${detail.valueType || "缺失"}」），无法激活。`,
    };
  }
  return {
    shape: null,
    blockReason: "参数定义缺少完整 valueShape 字段；请从 occurrence 重新创建草稿后再激活。",
  };
}

export function DraftSpecActivatePanel({ detail, onActivate, pending = false }: DraftSpecActivatePanelProps) {
  const [documentation, setDocumentation] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const inferred = useMemo(() => valueShapeFromDetail(detail), [detail]);
  const shapeSignature = JSON.stringify(detail.valueShape ?? null);
  const valueShape = inferred.shape;
  const cellCount = valueShape ? inferredCellCount(valueShape) : null;
  const [cells, setCells] = useState(cellCount != null ? String(cellCount) : "");

  useEffect(() => {
    setCells(cellCount != null ? String(cellCount) : "");
    setDocumentation("");
    setConfirmOpen(false);
    setReason("");
    setConfirmError(null);
  }, [cellCount, detail.id, shapeSignature]);

  const needsCells =
    valueShape != null &&
    (valueShape.kind === "cells" || valueShape.kind === "u32-array" || valueShape.kind === "phandle-list");
  const unsupported = inferred.blockReason != null;

  if (detail.reviewState !== "draft") {
    return null;
  }

  const canOpenConfirm =
    Boolean(documentation.trim()) &&
    !unsupported &&
    valueShape != null &&
    (!needsCells || (Number.isInteger(Number(cells)) && Number(cells) > 0)) &&
    !pending;

  const submitActivate = () => {
    if (!valueShape) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setConfirmError("请填写激活原因。");
      return;
    }
    const nextShape = { ...valueShape };
    const nextConstraints = {
      ...defaultConstraintsForShape(valueShape),
      ...(needsCells ? { cells: Number(cells) } : {}),
    };
    onActivate({
      specId: detail.id,
      valueShape: nextShape,
      constraints: nextConstraints,
      documentation: documentation.trim(),
      reason: trimmed,
    });
    setConfirmOpen(false);
    setReason("");
    setConfirmError(null);
  };

  return (
    <>
      <section className="shared-definition-panel draft-spec-activate-panel" aria-label="激活草稿定义">
        <form className="param-def-form" onSubmit={(event) => event.preventDefault()}>
          <fieldset className="def-group">
            <legend>激活草稿定义</legend>
            <div className="def-group-fields def-group-fields--stack">
              <p className="form-hint">
                补齐约束与说明后激活；仅已启用且约束完整的定义可用于审核批准。
              </p>
              {valueShape ? (
                <p className="form-hint" aria-label="自动识别的取值形态摘要">
                  自动识别的取值形态：{String(valueShape.kind)}
                  {typeof valueShape.bits === "number" ? ` · bits=${valueShape.bits}` : ""}
                  {typeof valueShape.groups === "number" ? ` · groups=${valueShape.groups}` : ""}
                  {cellCount != null ? ` · cellsPerGroup=${cellCount}` : ""}
                  {typeof valueShape.length === "number" ? ` · length=${valueShape.length}` : ""}
                </p>
              ) : null}
              {unsupported ? (
                <p className="form-error" role="alert">
                  {inferred.blockReason}
                </p>
              ) : null}
              {needsCells ? (
                <label>
                  单元格数量约束
                  <input
                    aria-label="单元格数量约束"
                    type="number"
                    min={1}
                    step={1}
                    value={cells}
                    onChange={(event) => setCells(event.target.value)}
                  />
                </label>
              ) : null}
              <label>
                参数说明
                <textarea
                  aria-label="参数说明"
                  rows={2}
                  value={documentation}
                  onChange={(event) => setDocumentation(event.target.value)}
                  placeholder="描述属性语义、取值范围与使用注意"
                />
              </label>
              <div className="dialog-actions" style={{ padding: 0, border: 0, justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="button primary"
                  disabled={!canOpenConfirm}
                  onClick={() => {
                    setReason("");
                    setConfirmError(null);
                    setConfirmOpen(true);
                  }}
                >
                  {pending ? "激活中…" : "激活定义"}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </section>
      {confirmOpen ? (
        <ModalDialog
          open
          onDismiss={
            pending
              ? undefined
              : () => {
                  setConfirmOpen(false);
                  setReason("");
                  setConfirmError(null);
                }
          }
          className="submission-dialog param-admin-confirm-dialog"
        >
          {({ titleId }) => (
            <>
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">参数定义库</span>
                <h2 id={titleId}>确认激活</h2>
                <p>将激活「{detail.propertyKey}」；请填写激活原因以便审计留痕。</p>
              </div>
              <button
                type="button"
                className="audit-dialog-close-icon"
                aria-label="关闭"
                disabled={pending}
                onClick={() => {
                  setConfirmOpen(false);
                  setReason("");
                  setConfirmError(null);
                }}
              >
                <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="param-admin-confirm-dialog-body">
              <label className="param-admin-confirm-field">
                <span>激活原因</span>
                <textarea
                  aria-label="激活原因"
                  value={reason}
                  rows={4}
                  placeholder="必填，写入审计"
                  autoFocus
                  onChange={(event) => {
                    setReason(event.target.value);
                    setConfirmError(null);
                  }}
                />
              </label>
              {confirmError ? (
                <p className="form-error" role="alert">
                  {confirmError}
                </p>
              ) : null}
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="button subtle"
                disabled={pending}
                onClick={() => {
                  setConfirmOpen(false);
                  setReason("");
                  setConfirmError(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="button primary"
                disabled={pending}
                onClick={submitActivate}
              >
                {pending ? "激活中…" : "确认激活"}
              </button>
            </div>
            </>
          )}
        </ModalDialog>
      ) : null}
    </>
  );
}
