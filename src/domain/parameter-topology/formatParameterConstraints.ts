export function formatParameterConstraints(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "none" || Object.keys(record).length === 0) return null;
  return [
    record.min != null || record.max != null ? `范围 ${record.min ?? "不限"} – ${record.max ?? "不限"}` : null,
    record.cells != null ? `每组 ${record.cells} 项` : null,
    record.minItems != null || record.maxItems != null ? `项数 ${record.minItems ?? "不限"} – ${record.maxItems ?? "不限"}` : null,
    Array.isArray(record.enum) ? `可选值 ${record.enum.join(" / ")}` : null
  ].filter(Boolean).join(" · ") || JSON.stringify(value);
}
