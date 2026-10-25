/** Strip DTS block and line comments; keep comment-like text inside string literals. */
export function stripDtsComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  let inString = false;

  while (i < source.length) {
    const ch = source[i];

    if (inString) {
      out.push(ch);
      if (ch === "\\" && i + 1 < source.length) {
        out.push(source[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      out.push("  ");
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          out.push("  ");
          i += 2;
          break;
        }
        out.push(source[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      out.push("  ");
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out.join("");
}
