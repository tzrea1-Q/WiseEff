export function stripLoneSurrogates(text: string) {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += text[index] + text[index + 1];
        index += 1;
      } else {
        result += "\uFFFD";
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      result += "\uFFFD";
      continue;
    }
    result += text[index];
  }
  return result;
}

export function sanitizeForJson(value: unknown): unknown {
  if (typeof value === "string") {
    return stripLoneSurrogates(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeForJson(entry)])
    );
  }
  return value;
}

export function serializePostgresJsonb(value: unknown, fallback: "object" | "array" = "object") {
  const json = JSON.stringify(sanitizeForJson(value));
  if (json === undefined) {
    return fallback === "array" ? "[]" : "{}";
  }
  return json;
}
