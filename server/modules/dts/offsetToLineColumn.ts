export type LineColumn = {
  line: number;
  column: number;
};

/** Convert a 0-based source offset to 1-based line/column. */
export function offsetToLineColumn(source: string, offset: number): LineColumn {
  let line = 1;
  let column = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let i = 0; i < end; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}
