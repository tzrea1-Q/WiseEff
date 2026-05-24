import type { ParameterRecord } from "@/domain/parameters/types";

export type ComparisonProject = {
  id: string;
  code: string;
  name: string;
};

export type SingleParameterComparisonRow = {
  projectId: string;
  projectCode: string;
  projectName: string;
  parameter: ParameterRecord | null;
  status: "configured" | "missing";
  currentValue: string;
  recommendedValue: string;
  risk: ParameterRecord["risk"] | "Missing";
  updatedAt: string;
  unit: string;
  unitMismatch: boolean;
  isBase: boolean;
  isTarget: boolean;
};

export type SingleParameterDelta =
  | { kind: "numeric"; direction: "up" | "down" | "same"; amount: number; percent: number | null; unit: string; label: string }
  | { kind: "text"; status: "changed" | "same"; label: string }
  | { kind: "missing"; label: string }
  | { kind: "unit-mismatch"; label: string };

export type SingleParameterProjectComparison = {
  rows: SingleParameterComparisonRow[];
  baseRow: SingleParameterComparisonRow | null;
  targetRow: SingleParameterComparisonRow | null;
  delta: SingleParameterDelta;
  coverage: { configured: number; missing: number; total: number };
  missingProjectIds: string[];
};

export type BuildSingleParameterProjectComparisonInput = {
  parameters: ParameterRecord[];
  projects: ComparisonProject[];
  parameterName: string;
  baseProjectId: string;
  targetProjectId: string;
};

function isBlank(value: string | null | undefined) {
  return !value || value.trim() === "";
}

function formatValue(value: string | null | undefined, unit: string) {
  if (isBlank(value)) {
    return "未配置";
  }

  if (needsCompactTextDelta(value ?? "")) {
    return value ?? "";
  }

  return `${value} ${unit}`.trim();
}

function parseNumeric(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  const parsed = Number.parseFloat(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function needsCompactTextDelta(value: string) {
  return value.includes("\n") || value.length > 80;
}

function buildDelta(baseRow: SingleParameterComparisonRow | null, targetRow: SingleParameterComparisonRow | null): SingleParameterDelta {
  if (!targetRow || targetRow.status === "missing") {
    return { kind: "missing", label: "目标项目尚未配置该参数" };
  }

  if (!baseRow || baseRow.status === "missing") {
    return { kind: "missing", label: "基准项目尚未配置该参数" };
  }

  if (baseRow.unitMismatch || targetRow.unitMismatch || baseRow.unit !== targetRow.unit) {
    return { kind: "unit-mismatch", label: `单位不一致：${baseRow.unit || "无"} vs ${targetRow.unit || "无"}` };
  }

  if (isBlank(baseRow.parameter?.currentValue) || isBlank(targetRow.parameter?.currentValue)) {
    return { kind: "missing", label: "对比值不可用" };
  }

  const baseNumeric = parseNumeric(baseRow.parameter?.currentValue);
  const targetNumeric = parseNumeric(targetRow.parameter?.currentValue);

  if (baseNumeric !== null && targetNumeric !== null) {
    const signedAmount = targetNumeric - baseNumeric;
    const roundedAmount = roundOne(signedAmount);
    const direction = roundedAmount > 0 ? "up" : roundedAmount < 0 ? "down" : "same";
    const percent = baseNumeric === 0 ? null : roundOne((signedAmount / Math.abs(baseNumeric)) * 100);
    const amountLabel = `${roundedAmount > 0 ? "+" : ""}${roundedAmount} ${baseRow.unit}`.trim();
    const percentLabel = percent === null ? "" : ` (${percent > 0 ? "+" : ""}${percent.toFixed(1)}%)`;

    return {
      kind: "numeric",
      direction,
      amount: Math.abs(roundedAmount),
      percent,
      unit: baseRow.unit,
      label: `${amountLabel}${percentLabel}`
    };
  }

  const baseValue = baseRow.parameter?.currentValue ?? "";
  const targetValue = targetRow.parameter?.currentValue ?? "";

  if (baseValue === targetValue) {
    return { kind: "text", status: "same", label: "值相同" };
  }

  if (needsCompactTextDelta(baseValue) || needsCompactTextDelta(targetValue)) {
    return { kind: "text", status: "changed", label: "配置存在差异，查看下方 diff" };
  }

  return { kind: "text", status: "changed", label: `${baseValue} -> ${targetValue}` };
}

export function buildSingleParameterProjectComparison({
  parameters,
  projects,
  parameterName,
  baseProjectId,
  targetProjectId
}: BuildSingleParameterProjectComparisonInput): SingleParameterProjectComparison {
  const matchingParameters = parameters.filter((parameter) => parameter.name === parameterName);
  const byProjectId = new Map(matchingParameters.map((parameter) => [parameter.projectId, parameter]));
  const baseParameter = byProjectId.get(baseProjectId) ?? null;
  const comparisonUnit = baseParameter?.unit ?? "";

  const rows = projects.map((project) => {
    const parameter = byProjectId.get(project.id) ?? null;
    const status = parameter ? "configured" : "missing";
    const unit = parameter?.unit ?? comparisonUnit;

    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      parameter,
      status,
      currentValue: parameter ? formatValue(parameter.currentValue, parameter.unit) : "未配置",
      recommendedValue: parameter ? formatValue(parameter.recommendedValue, parameter.unit) : "未配置",
      risk: parameter?.risk ?? "Missing",
      updatedAt: parameter?.updatedAt ?? "-",
      unit,
      unitMismatch: Boolean(parameter && comparisonUnit && parameter.unit !== comparisonUnit),
      isBase: project.id === baseProjectId,
      isTarget: project.id === targetProjectId
    } satisfies SingleParameterComparisonRow;
  });

  const baseRow = rows.find((row) => row.projectId === baseProjectId) ?? null;
  const targetRow = rows.find((row) => row.projectId === targetProjectId) ?? null;
  const configured = rows.filter((row) => row.status === "configured").length;
  const missingProjectIds = rows.filter((row) => row.status === "missing").map((row) => row.projectId);

  return {
    rows,
    baseRow,
    targetRow,
    delta: buildDelta(baseRow, targetRow),
    coverage: {
      configured,
      missing: rows.length - configured,
      total: rows.length
    },
    missingProjectIds
  };
}
