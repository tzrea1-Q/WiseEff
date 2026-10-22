export type DiffLine = { marker: " " | "+" | "-"; text: string };

export function diffLines(left: string[], right: string[]): { lines: DiffLine[]; bounded: boolean } {
  const trace: Map<number, number>[] = [];
  let frontier = new Map([[1, 0]]);
  let work = 0;
  for (let depth = 0; depth <= left.length + right.length; depth += 1) {
    const next = new Map<number, number>();
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      // ponytail: cap Myers trace work at 1M steps for unrelated large files; use
      // linear-space Myers if minimal hunks beyond this ceiling become necessary.
      if (++work > 1_000_000) return { bounded: true, lines: [
        ...left.map((text): DiffLine => ({ marker: "-", text })),
        ...right.map((text): DiffLine => ({ marker: "+", text }))
      ] };
      let x = diagonal === -depth || (diagonal !== depth &&
        (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) { x += 1; y += 1; }
      next.set(diagonal, x);
      if (x < left.length || y < right.length) continue;
      trace.push(next);
      const result: DiffLine[] = [];
      for (let step = trace.length - 1; step > 0; step -= 1) {
        const previous = trace[step - 1]!;
        const k = x - y;
        const previousK = k === -step || (k !== step &&
          (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0;
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
          result.push({ marker: " ", text: left[--x]! }); y -= 1;
        }
        if (x === previousX) result.push({ marker: "+", text: right[--y]! });
        else result.push({ marker: "-", text: left[--x]! });
      }
      while (x > 0 && y > 0) { result.push({ marker: " ", text: left[--x]! }); y -= 1; }
      return { lines: result.reverse(), bounded: false };
    }
    trace.push(next);
    frontier = next;
  }
  return { lines: [], bounded: false };
}

const splitLines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
type Edit = { start: number; end: number; text: string; side: "local" | "latest" };

function edits(base: string[], target: string, side: Edit["side"]): Edit[] {
  const lines = splitLines(target);
  let prefix = 0;
  let suffix = 0;
  while (prefix < Math.min(base.length, lines.length) && base[prefix] === lines[prefix]) prefix += 1;
  while (suffix < Math.min(base.length, lines.length) - prefix && base[base.length - suffix - 1] === lines[lines.length - suffix - 1]) suffix += 1;
  const diff = diffLines(base.slice(prefix, base.length - suffix), lines.slice(prefix, lines.length - suffix));
  const result: Edit[] = [];
  let cursor = prefix;
  let edit: Edit | undefined;
  for (const line of diff.lines) {
    if (line.marker === " ") { edit = undefined; cursor += 1; continue; }
    if (!edit) { edit = { start: cursor, end: cursor, text: "", side }; result.push(edit); }
    if (line.marker === "-") { cursor += 1; edit.end = cursor; }
    else edit.text += line.text;
  }
  return result;
}

export const hasSourceMergeConflicts = (text: string): boolean => /^(?:<<<<<<< 本地草稿|\|\|\|\|\|\|\| 原始基线|=======|>>>>>>> 最新来源)\r?$/m.test(text);

/** Line-based diff3. Overlapping edits retain all three texts for manual resolution. */
export function mergeSourceText(baseText: string, localText: string, latestText: string): { text: string; conflicts: boolean } {
  if (localText === latestText || baseText === latestText) return { text: localText, conflicts: false };
  if (baseText === localText) return { text: latestText, conflicts: false };
  const base = splitLines(baseText);
  const changes = [...edits(base, localText, "local"), ...edits(base, latestText, "latest")].sort((a, b) => a.start - b.start || a.end - b.end);
  let text = "";
  let cursor = 0;
  let conflicts = false;
  const newline = latestText.includes("\r\n") ? "\r\n" : "\n";
  const block = (value: string) => value && !value.endsWith("\n") ? value + newline : value;
  for (let index = 0; index < changes.length;) {
    const first = changes[index++]!;
    const group = [first];
    let end = first.end;
    while (index < changes.length) {
      const next = changes[index]!;
      if (!(next.start < end || (next.start === first.start && (end === first.start || next.end === next.start)))) break;
      group.push(next); end = Math.max(end, next.end); index += 1;
    }
    text += base.slice(cursor, first.start).join("");
    const original = base.slice(first.start, end).join("");
    const render = (side: Edit["side"]) => {
      let value = "", position = first.start;
      for (const edit of group.filter((item) => item.side === side)) {
        value += base.slice(position, edit.start).join("") + edit.text; position = edit.end;
      }
      return value + base.slice(position, end).join("");
    };
    const local = render("local"), latest = render("latest");
    if (local === latest || latest === original) text += local;
    else if (local === original) text += latest;
    else {
      conflicts = true;
      text += `<<<<<<< 本地草稿${newline}${block(local)}||||||| 原始基线${newline}${block(original)}=======${newline}${block(latest)}>>>>>>> 最新来源${newline}`;
    }
    cursor = end;
  }
  return { text: text + base.slice(cursor).join(""), conflicts };
}
