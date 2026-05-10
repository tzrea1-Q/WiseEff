export type ValidationLevel = "error" | "warning" | null;

export type ValidationResult = {
  level: ValidationLevel;
  message: string | null;
};

const OK: ValidationResult = { level: null, message: null };

const RANGE_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*[-\u2013]\s*(-?\d+(?:\.\d+)?)\s*$/;

export function validateKey(key: string, existingKeys: string[], selfKey?: string): ValidationResult {
  if (!key.trim()) {
    return { level: "error", message: "参数 key 不能为空" };
  }

  const duplicateExists = existingKeys.some(
    (existing) => existing === key && existing !== selfKey
  );
  if (duplicateExists) {
    return { level: "error", message: `参数 key "${key}" 已被使用，请换一个唯一标识` };
  }

  if (/\s/.test(key)) {
    return { level: "warning", message: "参数 key 不建议包含空格，建议使用 snake_case 或 dot.notation" };
  }

  if (/[A-Z]/.test(key)) {
    return { level: "warning", message: "参数 key 不建议包含大写字母，建议使用 snake_case 或 dot.notation" };
  }

  return OK;
}

export function parseRange(rangeString: string): { min: number; max: number } | null {
  const match = rangeString.match(RANGE_PATTERN);
  if (!match) {
    return null;
  }

  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}

export function validateRange(value: string, rangeString: string): ValidationResult {
  if (!value.trim()) {
    return OK;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return OK;
  }

  const range = parseRange(rangeString);
  if (!range) {
    return OK;
  }

  if (numericValue < range.min || numericValue > range.max) {
    return {
      level: "warning",
      message: `值 ${value} 超出有效区间 ${range.min} - ${range.max}`
    };
  }

  return OK;
}
