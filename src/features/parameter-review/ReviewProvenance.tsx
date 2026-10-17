import { useState } from "react";

export type ReviewProvenanceProps = {
  entries: readonly { label: string; value: unknown }[];
};

export function ReviewProvenance({ entries }: ReviewProvenanceProps) {
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`已复制${label}`);
    } catch {
      setMessage("复制失败，请选择内容手动复制。");
    }
  };
  const raw = JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.label, entry.value])), null, 2);
  const summary = entries.filter((entry) => typeof entry.value === "string" && entry.value.trim()
    && /ID$|版本|摘要/.test(entry.label)).slice(0, 8);
  return <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>溯源信息</summary>
    {expanded ? <><dl>{summary.map((entry, index) => <div key={index}>
      <dt>{entry.label}</dt><dd><code>{String(entry.value)}</code><button type="button"
        className="button subtle" aria-label={`复制 ${entry.label}`} onClick={() => void copy(String(entry.value), entry.label)}>复制</button></dd>
    </div>)}</dl><details className="review-provenance__raw"><summary>完整技术数据</summary>
      <button type="button" className="button subtle" onClick={() => void copy(raw, "完整技术数据")}>复制完整技术数据</button>
      <pre aria-label="完整溯源数据" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete source metadata supports keyboard scrolling. */}>{raw}</pre>
    </details></> : null}
    {expanded && message ? <p role="status">{message}</p> : null}
  </details>;
}
