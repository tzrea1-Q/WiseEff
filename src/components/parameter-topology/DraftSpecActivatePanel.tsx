import { useMemo, useState } from "react";

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

function defaultConstraintsForShape(valueType: string): Record<string, unknown> {
  if (valueType === "cells" || valueType === "u32-array" || valueType === "phandle-list") {
    return { cells: 1 };
  }
  if (valueType === "bytes") {
    return { minLength: 1 };
  }
  return {};
}

function valueShapeFromDetail(detail: ParameterSpecDetailView): Record<string, unknown> {
  if (detail.valueType === "cells") {
    return { kind: "cells", bits: 32 };
  }
  if (detail.valueType === "string-list") {
    return { kind: "string-list" };
  }
  if (detail.valueType === "string") {
    return { kind: "string" };
  }
  if (detail.valueType === "bool") {
    return { kind: "bool" };
  }
  if (detail.valueType === "bytes") {
    return { kind: "bytes" };
  }
  return { kind: detail.valueType };
}

export function DraftSpecActivatePanel({ detail, onActivate, pending = false }: DraftSpecActivatePanelProps) {
  const [documentation, setDocumentation] = useState("");
  const [reason, setReason] = useState("");
  const [cells, setCells] = useState("1");

  const valueShape = useMemo(() => valueShapeFromDetail(detail), [detail]);
  const needsCells = detail.valueType === "cells" || detail.valueType === "u32-array" || detail.valueType === "phandle-list";
  const unsupported = detail.valueType === "unknown" || detail.valueType === "mixed";

  if (detail.reviewState !== "draft") {
    return null;
  }

  const canSubmit = Boolean(documentation.trim() && reason.trim()) && !unsupported && !pending;

  return (
    <section className="draft-spec-activate-panel" aria-label="激活草稿规格">
      <h4>激活草稿规格</h4>
      <p>补齐约束与说明后激活；仅 active 且约束完整的规格可用于审核批准。</p>
      {unsupported ? (
        <p className="form-error" role="alert">
          当前推断类型为「{detail.valueType}」，无法激活；请人工修订 occurrence 或改用库内规格。
        </p>
      ) : null}
      {needsCells ? (
        <label>
          单元格数量约束
          <input
            aria-label="单元格数量约束"
            type="number"
            min={1}
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
        onClick={() =>
          onActivate({
            specId: detail.id,
            valueShape,
            constraints: needsCells
              ? { ...defaultConstraintsForShape(detail.valueType), cells: Number(cells) || 1 }
              : defaultConstraintsForShape(detail.valueType),
            documentation: documentation.trim(),
            reason: reason.trim(),
          })
        }
      >
        {pending ? "激活中…" : "激活规格"}
      </button>
    </section>
  );
}
