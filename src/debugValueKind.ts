export const DEBUG_VALUE_KINDS = ["scalar", "complex"] as const;
export type DebugValueKind = (typeof DEBUG_VALUE_KINDS)[number];
export const DEBUG_VALUE_KIND_SCALAR: DebugValueKind = "scalar";
export const DEBUG_VALUE_KIND_COMPLEX: DebugValueKind = "complex";

export const DEBUG_VALUE_FORMATS = ["raw", "json", "dts", "line-list", "kv-list"] as const;
export type DebugValueFormat = (typeof DEBUG_VALUE_FORMATS)[number];
export const DEBUG_VALUE_FORMAT_RAW: DebugValueFormat = "raw";
export const DEBUG_VALUE_FORMAT_JSON: DebugValueFormat = "json";
export const DEBUG_VALUE_FORMAT_DTS: DebugValueFormat = "dts";
export const DEBUG_VALUE_FORMAT_LINE_LIST: DebugValueFormat = "line-list";
export const DEBUG_VALUE_FORMAT_KV_LIST: DebugValueFormat = "kv-list";

export const DEBUG_NORMALIZATION_MODES = [
  "exact",
  "trim",
  "line-ending-normalized",
  "json-canonical"
] as const;
export type DebugNormalizationMode = (typeof DEBUG_NORMALIZATION_MODES)[number];
export const DEBUG_NORMALIZATION_MODE_EXACT: DebugNormalizationMode = "exact";
export const DEBUG_NORMALIZATION_MODE_TRIM: DebugNormalizationMode = "trim";
export const DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED: DebugNormalizationMode =
  "line-ending-normalized";
export const DEBUG_NORMALIZATION_MODE_JSON_CANONICAL: DebugNormalizationMode = "json-canonical";

export type DebugValueMetadata = {
  valueKind: DebugValueKind;
  valueFormat: DebugValueFormat;
  normalizationMode: DebugNormalizationMode;
  maxValueBytes?: number | null;
};

export function resolveDebugValueMetadata(
  record: Partial<Pick<DebugValueMetadata, "valueKind" | "valueFormat" | "normalizationMode" | "maxValueBytes">>
): DebugValueMetadata {
  return {
    valueKind: record.valueKind ?? DEBUG_VALUE_KIND_SCALAR,
    valueFormat: record.valueFormat ?? DEBUG_VALUE_FORMAT_RAW,
    normalizationMode: record.normalizationMode ?? DEBUG_NORMALIZATION_MODE_TRIM,
    maxValueBytes: record.maxValueBytes ?? null
  };
}

export const TABLE_PREVIEW_MAX_CHARS = 80;
export const PREVIEW_MAX_CHARS = 240;

export function isComplexDebugParameter(parameter: { valueKind?: DebugValueKind }) {
  return parameter.valueKind === DEBUG_VALUE_KIND_COMPLEX;
}

export function buildValuePreview(raw: string, maxChars = PREVIEW_MAX_CHARS) {
  if (raw.length <= maxChars) {
    return raw;
  }

  return `${raw.slice(0, maxChars)}…`;
}

export function debugValuePreview(
  value: string,
  parameter: { valueKind?: DebugValueKind },
  maxChars = TABLE_PREVIEW_MAX_CHARS
) {
  if (!isComplexDebugParameter(parameter)) {
    return value;
  }

  return buildValuePreview(value, maxChars);
}

function getComplexValueLineCount(value: string) {
  return value ? value.split(/\r?\n/).length : 0;
}

export function debugValueEditorRows(value: string, minRows = 6) {
  return Math.min(Math.max(minRows, getComplexValueLineCount(value)), 16);
}

export function getDebugNormalizationModeLabel(mode?: DebugNormalizationMode) {
  switch (mode) {
    case DEBUG_NORMALIZATION_MODE_EXACT:
      return "精确匹配";
    case DEBUG_NORMALIZATION_MODE_TRIM:
      return "去除首尾空白";
    case DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED:
      return "统一换行符";
    case DEBUG_NORMALIZATION_MODE_JSON_CANONICAL:
      return "JSON 规范化";
    default:
      return "去除首尾空白";
  }
}

export function getDebugValueFormatLabel(parameter: {
  valueKind?: DebugValueKind;
  valueFormat?: DebugValueFormat;
}) {
  const metadata = resolveDebugValueMetadata(parameter);
  if (metadata.valueKind === DEBUG_VALUE_KIND_SCALAR) {
    return "标量";
  }

  switch (metadata.valueFormat) {
    case DEBUG_VALUE_FORMAT_JSON:
      return "JSON";
    case DEBUG_VALUE_FORMAT_DTS:
      return "DTS";
    case DEBUG_VALUE_FORMAT_LINE_LIST:
      return "行列表";
    case DEBUG_VALUE_FORMAT_KV_LIST:
      return "KV 列表";
    default:
      return "原始文本";
  }
}

export function canonicalizeJson(raw: string) {
  const parsed = JSON.parse(raw);
  return JSON.stringify(sortJsonValue(parsed));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = sortJsonValue(record[key]);
        return sorted;
      }, {});
  }

  return value;
}

export function normalizeDebugValue(raw: string, metadata: DebugValueMetadata) {
  switch (metadata.normalizationMode) {
    case DEBUG_NORMALIZATION_MODE_EXACT:
      return raw;
    case DEBUG_NORMALIZATION_MODE_TRIM:
      return raw.trim();
    case DEBUG_NORMALIZATION_MODE_LINE_ENDING_NORMALIZED:
      return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    case DEBUG_NORMALIZATION_MODE_JSON_CANONICAL:
      return canonicalizeJson(raw);
    default:
      return raw.trim();
  }
}

export function compareDebugValues(left: string, right: string, metadata: DebugValueMetadata) {
  return normalizeDebugValue(left, metadata) === normalizeDebugValue(right, metadata);
}

export function validateDebugJsonValue(raw: string): string | null {
  if (!raw.trim()) {
    return null;
  }

  try {
    JSON.parse(raw);
    return null;
  } catch {
    return "值必须是有效的 JSON。";
  }
}
