import { useState } from "react";

export type ReviewProvenanceProps = {
  entries: readonly { label: string; value: unknown }[];
};

export function ReviewProvenance({ entries }: ReviewProvenanceProps) {
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const raw = expanded ? JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.label, entry.value])), null, 2) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setMessage("已复制完整技术数据");
    } catch {
      setMessage("复制失败，请选择内容手动复制。");
    }
  };
  return <details className="review-provenance__raw" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>溯源信息</summary>
    {expanded ? <>
      <button type="button" className="button subtle" onClick={() => void copy()}>复制完整技术数据</button>
      <pre aria-label="完整溯源数据" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete source metadata supports keyboard scrolling. */}>{raw}</pre>
    </> : null}
    {expanded && message ? <p role="status">{message}</p> : null}
  </details>;
}
