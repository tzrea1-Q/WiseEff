const IDENTIFIER_SEPARATORS = /[\s_\-/:@.]+/g;

export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

export function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(IDENTIFIER_SEPARATORS, "");
}

export function tokenizeFieldText(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return [];
  }
  return normalized.split(IDENTIFIER_SEPARATORS).filter(Boolean);
}

export function tokenizeQuery(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

export function isIdentifierToken(token: string): boolean {
  return /^[a-z0-9]+$/.test(compactSearchText(token));
}

export function flattenSearchValues(
  values: ReadonlyArray<string | number | null | undefined | readonly (string | number | null | undefined)[]>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | number | null | undefined) => {
    if (value == null) {
      return;
    }
    const text = typeof value === "number" ? String(value) : value;
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    out.push(trimmed);
  };
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        push(item);
      }
    } else {
      push(value as string | number | null | undefined);
    }
  }
  return out;
}
