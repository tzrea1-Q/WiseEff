import { parseDtsValue } from "./parseDtsValue";

/**
 * Compare two DTS value texts by meaning rather than layout: whitespace, comments
 * and integer spelling (0x10 vs 16) do not count as differences. Texts that do not
 * parse fall back to trimmed text equality.
 */
export function dtsValuesEquivalent(left: string, right: string): boolean {
  if (left === right) return true;
  const leftKey = semanticKey(left);
  return leftKey !== null && leftKey === semanticKey(right);
}

function semanticKey(text: string): string | null {
  try {
    const { value } = parseDtsValue("", text);
    return JSON.stringify(value, (key, entry: unknown) => (key === "raw" || key === "items" ? undefined : entry));
  } catch {
    return text.trim() ? null : "";
  }
}
