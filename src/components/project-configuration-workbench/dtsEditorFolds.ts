export type DtsEditorFold = { from: number; to: number };

/** Comment/string-aware braces for folding, deliberately not a DTS validator. */
export function collectDtsEditorFolds(text: string): DtsEditorFold[] {
  const stack: number[] = [];
  const folds: DtsEditorFold[] = [];
  let comment = false;
  let lineComment = false;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) { if (char === "\n") lineComment = false; continue; }
    if (comment) { if (char === "*" && next === "/") { comment = false; index += 1; } continue; }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "/" && next === "/") { lineComment = true; index += 1; }
    else if (char === "/" && next === "*") { comment = true; index += 1; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === "{") stack.push(index + 1);
    else if (char === "}" && stack.length) folds.push({ from: stack.pop()!, to: index });
  }
  return folds.sort((left, right) => left.from - right.from);
}
