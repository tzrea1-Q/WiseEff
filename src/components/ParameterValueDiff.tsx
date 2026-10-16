import { buildTextDiffLines } from "@/domain/parameters/textDiff";

function isSingleLineValue(value: string) {
  return !/[\r\n]/.test(value);
}

function displayValue(value: string) {
  return value.length > 0 ? value : "—";
}

export function ParameterValueDiff({ baseValue, targetValue }: { baseValue: string; targetValue: string }) {
  if (baseValue === targetValue) {
    return (
      <div className="submission-preview-diff submission-preview-diff--scalar" data-kind="equal" role="list" aria-label="值未改变">
        <div className="submission-preview-diff-row" data-kind="context" role="listitem">
          <span className="submission-preview-diff-row__marker" aria-hidden="true" />
          <code>{displayValue(baseValue)}</code>
        </div>
      </div>
    );
  }

  // Single-line changes need no line-number columns.
  if (isSingleLineValue(baseValue) && isSingleLineValue(targetValue)) {
    return (
      <div
        className="submission-preview-diff submission-preview-diff--scalar"
        data-kind="changed"
        role="list"
      >
        <div className="submission-preview-diff-row" data-kind="remove" role="listitem">
          <span className="submission-preview-diff-row__marker" aria-hidden="true">
            -
          </span>
          <code>{displayValue(baseValue)}</code>
        </div>
        <div className="submission-preview-diff-row" data-kind="add" role="listitem">
          <span className="submission-preview-diff-row__marker" aria-hidden="true">
            +
          </span>
          <code>{displayValue(targetValue)}</code>
        </div>
      </div>
    );
  }

  const diffLines = buildTextDiffLines(baseValue, targetValue);

  return (
    <div className="submission-preview-diff" role="list">
      {diffLines.map((line, index) => (
        <div
          className="submission-preview-diff-row"
          data-kind={line.kind}
          key={`${line.kind}-${line.leftLineNumber ?? "-"}-${line.rightLineNumber ?? "-"}-${index}`}
          role="listitem"
        >
          <span className="submission-preview-diff-row__marker" aria-hidden="true">
            {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
          </span>
          <span className="submission-preview-diff-row__line-number">{line.leftLineNumber ?? ""}</span>
          <span className="submission-preview-diff-row__line-number">{line.rightLineNumber ?? ""}</span>
          <code>{line.value || " "}</code>
        </div>
      ))}
    </div>
  );
}
