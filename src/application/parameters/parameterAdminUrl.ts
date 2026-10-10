/** Parse comma-separated query values; treat missing/"all" as inactive []. */
export function parseCsvQueryParam(raw: string | null): string[] {
  if (!raw || raw === "all") return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    )
  );
}

export function formatCsvQueryParam(values: readonly string[]): string | null {
  const cleaned = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return cleaned.length > 0 ? cleaned.join(",") : null;
}
