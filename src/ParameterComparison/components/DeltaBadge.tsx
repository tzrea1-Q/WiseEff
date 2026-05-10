import type { DeltaDescriptor } from "../utils/deltaCalc";

export type DeltaBadgeProps = {
  delta: DeltaDescriptor;
};

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatAmount(value: number) {
  return `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value.toString() : value.toFixed(1)}`;
}

export function DeltaBadge({ delta }: DeltaBadgeProps) {
  if (delta.kind === "synced") {
    return (
      <span className="delta-badge" data-tone="synced">
        已同步
      </span>
    );
  }
  if (delta.kind === "changed") {
    return (
      <span className="delta-badge" data-tone="changed">
        已变更
      </span>
    );
  }
  if (delta.kind === "new") {
    return (
      <span className="delta-badge" data-tone="new">
        新增
      </span>
    );
  }
  if (delta.kind === "missing") {
    return (
      <span className="delta-badge" data-tone="missing">
        缺失
      </span>
    );
  }
  if (delta.kind === "absolute") {
    return (
      <span className="delta-badge" data-tone={delta.direction === "down" ? "ease" : "warn"}>
        {formatAmount(delta.amount)} {delta.unit}
      </span>
    );
  }

  return (
    <span className="delta-badge" data-tone={delta.direction === "down" ? "ease" : "warn"}>
      {formatSigned(delta.percent)}%
    </span>
  );
}
