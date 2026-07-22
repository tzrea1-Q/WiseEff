export type DiffLineKind = "equal" | "add" | "remove";

export type DiffLine = {
  kind: DiffLineKind;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  value: string;
};

function splitDiffLines(value: string) {
  const lines = value.split("\n");
  return lines.length === 0 ? [""] : lines;
}

export function buildDiffLines(baseValue: string, targetValue: string): DiffLine[] {
  const baseLines = splitDiffLines(baseValue);
  const targetLines = splitDiffLines(targetValue);
  const lineCount = Math.max(baseLines.length, targetLines.length);
  const diffLines: DiffLine[] = [];

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

export function DiffCodeBlock({
  baseValue,
  targetValue
}: {
  baseValue: string;
  targetValue: string;
}) {
  const diffLines = buildDiffLines(baseValue, targetValue);

  return (
    <div className="parameter-diff-code" role="list">
      {diffLines.map((line, index) => (
        <div
          className="parameter-diff-code-row"
          data-kind={line.kind}
          key={`${line.kind}-${line.leftLineNumber ?? "-"}-${line.rightLineNumber ?? "-"}-${index}`}
          role="listitem"
        >
          <span className="parameter-diff-code-row__marker" aria-hidden="true">
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          </span>
          <span className="parameter-diff-code-row__line-number">{line.leftLineNumber ?? ""}</span>
          <span className="parameter-diff-code-row__line-number">{line.rightLineNumber ?? ""}</span>
          <code>{line.value || " "}</code>
        </div>
      ))}
    </div>
  );
}

export function DiffSection({
  baseValue,
  targetValue,
  title
}: {
  baseValue: string;
  targetValue: string;
  title: string;
}) {
  const changed = baseValue !== targetValue;

  return (
    <section className="parameter-diff-section" aria-label={title}>
      <div className="parameter-diff-section__head">
        <h4>{title}</h4>
        <span data-changed={changed}>{changed ? "存在差异" : "值相同"}</span>
      </div>
      <DiffCodeBlock baseValue={baseValue} targetValue={targetValue} />
    </section>
  );
}
