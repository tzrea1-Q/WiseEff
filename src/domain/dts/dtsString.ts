/** Decode C-style escapes in a DTS string literal body. Alias-free: shared with server and scripts. */
export function decodeDtsString(value: string): string {
  const escapes: Record<string, string> = { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", '"': '"', "\\": "\\", "?": "?" };
  return value.replace(/\\(x[0-9A-Fa-f]{1,2}|[0-7]{1,3}|[\s\S])/g, (raw: string, token: string) => {
    if (token.startsWith("x") && token.length > 1) return String.fromCharCode(Number.parseInt(token.slice(1), 16));
    if (/^[0-7]+$/.test(token)) return String.fromCharCode(Number.parseInt(token, 8));
    return escapes[token] ?? raw;
  });
}
