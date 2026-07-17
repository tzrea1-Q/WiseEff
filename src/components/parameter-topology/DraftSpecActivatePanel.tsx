import { useEffect, useMemo, useState } from "react";

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
        blockReason: `当前推断类型为「${kind}」，无法激活；请人工修订 occurrence 或改用库内规格。`,
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
    blockReason: "规格缺少完整 valueShape 字段；请从 occurrence 重新创建草稿后再激活。",
  };
}

export function DraftSpecActivatePanel({ detail, onActivate, pending = false }: DraftSpecActivatePanelProps) {
  const [documentation, setDocumentation] = useState("");
  const [reason, setReason] = useState("");
  const inferred = useMemo(() => valueShapeFromDetail(detail), [detail]);
  const shapeSignature = JSON.stringify(detail.valueShape ?? null);
  const valueShape = inferred.shape;
  const cellCount = valueShape ? inferredCellCount(valueShape) : null;
  const [cells, setCells] = useState(cellCount != null ? String(cellCount) : "");

  useEffect(() => {
    setCells(cellCount != null ? String(cellCount) : "");
    setDocumentation("");
    setReason("");
  }, [cellCount, detail.id, shapeSignature]);

  const needsCells =
    valueShape != null &&
    (valueShape.kind === "cells" || valueShape.kind === "u32-array" || valueShape.kind === "phandle-list");
  const unsupported = inferred.blockReason != null;

  if (detail.reviewState !== "draft") {
    return null;
  }

  const canSubmit =
    Boolean(documentation.trim() && reason.trim()) &&
    !unsupported &&
    valueShape != null &&
    (!needsCells || (Number.isInteger(Number(cells)) && Number(cells) > 0)) &&
    !pending;

  return (
    <section className="draft-spec-activate-panel" aria-label="激活草稿规格">
      <h4>激活草稿规格</h4>
      <p>补齐约束与说明后激活；仅 active 且约束完整的规格可用于审核批准。</p>
      {valueShape ? (
        <p aria-label="推断值形状摘要">
          推断值形状：{String(valueShape.kind)}
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
        规格说明
        <textarea
          aria-label="规格说明"
          rows={2}
          value={documentation}
          onChange={(event) => setDocumentation(event.target.value)}
          placeholder="描述属性语义、取值范围与使用注意"
        />
      </label>
      <label>
        激活原因
        <textarea
          aria-label="激活原因"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="说明审核依据"
        />
      </label>
      <button
        type="button"
        className="button primary"
        disabled={!canSubmit}
        onClick={() => {
          if (!valueShape) return;
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
            reason: reason.trim(),
          });
        }}
      >
        {pending ? "激活中…" : "激活规格"}
      </button>
    </section>
  );
}
