import type { TextDiffLine } from "@/domain/parameters/textDiff";

function contextualLines(before: string, after: string): Array<TextDiffLine | null> {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  let start = 0;
  let end = 0;
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start++;
  while (end < Math.min(left.length, right.length) - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  const contextStart = Math.max(0, start - 2);
  const contextEnd = Math.max(0, end - 2);
  const rows: TextDiffLine[] = [];
  let a = contextStart;
  let b = contextStart;
  while (a < left.length - contextEnd || b < right.length - contextEnd) {
    if (a < left.length - contextEnd && b < right.length - contextEnd && left[a] === right[b]) {
      rows.push({ kind: "equal", leftLineNumber: a + 1, rightLineNumber: b + 1, value: left[a] });
      a++; b++;
      continue;
    }
    // ponytail: resync within 80 lines keeps large files linear; distant moved blocks remain remove/add, with exact full source below.
    const nextLeft = b < right.length - contextEnd ? left.slice(a + 1, Math.min(a + 81, left.length - contextEnd)).indexOf(right[b]) : -1;
    const nextRight = a < left.length - contextEnd ? right.slice(b + 1, Math.min(b + 81, right.length - contextEnd)).indexOf(left[a]) : -1;
    if (a < left.length - contextEnd && (nextRight === -1 || nextLeft !== -1 && nextLeft <= nextRight)) {
      rows.push({ kind: "remove", leftLineNumber: a + 1, rightLineNumber: null, value: left[a++] });
    } else if (b < right.length - contextEnd) {
      rows.push({ kind: "add", leftLineNumber: null, rightLineNumber: b + 1, value: right[b++] });
    }
  }
  const changed = rows.flatMap((line, index) => line.kind === "equal" ? [] : [index]);
  const visible = new Set(changed.flatMap((index) => [index - 2, index - 1, index, index + 1, index + 2]));
  return [
    ...(contextStart ? [null] : []),
    ...rows.filter((line, index) => line.kind !== "equal" || visible.has(index) || !changed.length)
      .flatMap((line, index, selected) => index && line.leftLineNumber !== null && selected[index - 1].leftLineNumber !== null
        && line.leftLineNumber > selected[index - 1].leftLineNumber! + 1 ? [null, line] : [line]),
    ...(contextEnd ? [null] : [])
  ];
}

/** Keep original frozen source available, while the default view focuses on changed lines. */
export function ReviewSourceDiff({ before, after, label = "固定源", uploadAfter }: {
  before: string; after: string; label?: string; uploadAfter?: string;
}) {
  const rows = before === after ? [] : contextualLines(before, after);
  return <div className="review-source-diff">
    {rows.length ? <div className="review-source-diff__rows submission-preview-diff" role="region" aria-label={`${label}修改片段`}
      tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Scrollable source comparison supports keyboard scrolling. */}>
      <div className="review-source-diff__legend" aria-hidden="true"><span /> <span>原行</span><span>新行</span><span>提交快照</span></div>
      {rows.map((line, index) => line ? <div className="submission-preview-diff-row" data-kind={line.kind} key={index}>
        <span className="submission-preview-diff-row__marker"><span aria-hidden="true">{line.kind === "remove" ? "−" : line.kind === "add" ? "+" : " "}</span>
          <span className="sr-only">{line.kind === "remove" ? "删除行" : line.kind === "add" ? "新增行" : "上下文"}</span></span>
        <span className="submission-preview-diff-row__line-number">{line.leftLineNumber ?? ""}</span>
        <span className="submission-preview-diff-row__line-number">{line.rightLineNumber ?? ""}</span>
        <code>{line.value || " "}</code>
      </div> : <p className="review-source-diff__gap" key={index}><span aria-hidden="true">⋯</span><span className="sr-only">未变更内容已折叠</span></p>)}
    </div> : <p role="note">源文件内容没有变化。</p>}
    <details className="review-source-diff__full">
      <summary>查看完整源文件</summary>
      <div className="canonical-project-value-review__diff">
        <div><p>变更前</p><pre className="canonical-project-value-review__diff-text" aria-label={`${label}变更前`}
          tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Overflowing original source supports keyboard scrolling. */}>{before}</pre></div>
        {uploadAfter ? <div><p>原上传候选</p><pre className="canonical-project-value-review__diff-text" aria-label="批量原上传来源"
          tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Overflowing original source supports keyboard scrolling. */}>{uploadAfter}</pre></div> : null}
        <div><p>变更后</p><pre className="canonical-project-value-review__diff-text" aria-label={`${label}变更后`}
          tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Overflowing original source supports keyboard scrolling. */}>{after}</pre></div>
      </div>
    </details>
  </div>;
}

export function reviewLocator(locator: unknown): string {
  if (typeof locator === "string") {
    if (!locator.trim().startsWith("{")) return locator;
    try { return reviewLocator(JSON.parse(locator)); } catch { return "参数路径待核对"; }
  }
  if (!locator || typeof locator !== "object") return "参数路径待核对";
  const value = locator as Record<string, unknown>;
  return [value.pointer ?? value.nodePath ?? value.path, value.propertyName ?? value.property]
    .filter((part) => typeof part === "string" && part.length).join(" · ") || "参数路径待核对";
}
