export type TextDiffLineKind = "equal" | "remove" | "add";

export type TextDiffLine = {
  kind: TextDiffLineKind;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  value: string;
};

function splitDiffLines(value: string) {
  const lines = value.split(/\r?\n/);
  return lines.length === 0 ? [""] : lines;
}

export function buildTextDiffLines(baseValue: string, targetValue: string): TextDiffLine[] {
  const baseLines = splitDiffLines(baseValue);
  const targetLines = splitDiffLines(targetValue);
  const lineCount = Math.max(baseLines.length, targetLines.length);
  const diffLines: TextDiffLine[] = [];

  for (let index = 0; index < lineCount; index += 1) {
    const baseLine = baseLines[index];
    const targetLine = targetLines[index];
    const baseLineNumber = baseLine === undefined ? null : index + 1;
    const targetLineNumber = targetLine === undefined ? null : index + 1;

    if (baseLine === targetLine) {
      diffLines.push({
        kind: "equal",
        leftLineNumber: baseLineNumber,
        rightLineNumber: targetLineNumber,
        value: baseLine ?? ""
      });
      continue;
    }

    if (baseLine !== undefined) {
      diffLines.push({
        kind: "remove",
        leftLineNumber: baseLineNumber,
        rightLineNumber: null,
        value: baseLine
      });
    }

    if (targetLine !== undefined) {
      diffLines.push({
        kind: "add",
        leftLineNumber: null,
        rightLineNumber: targetLineNumber,
        value: targetLine
      });
    }
  }

  return diffLines;
}
