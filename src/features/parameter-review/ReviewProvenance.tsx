import { useState } from "react";

export type ReviewProvenanceProps = {
  entries: readonly { label: string; value: unknown }[];
};

export function ReviewProvenance({ entries }: ReviewProvenanceProps) {
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("已复制");
    } catch {
      setMessage("复制失败，请选择内容手动复制。");
    }
  };
  const rows = (label: string, value: unknown): { label: string; value: string }[] => {
    if (Array.isArray(value) && value.length) {
      return value.flatMap((item, index) => rows(`${label} · ${index + 1}`, item));
    }
    if (value && typeof value === "object" && Object.keys(value).length) {
      return Object.entries(value).flatMap(([key, item]) => rows(`${label} · ${key}`, item));
    }
    return [{ label, value: value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value) }];
  };
  return <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>溯源信息</summary>
    {expanded ? <dl>{entries.flatMap((entry) => rows(entry.label, entry.value)).map((entry, index) => <div key={index}>
      <dt>{entry.label}</dt><dd><code>{entry.value}</code>{entry.value !== "—" ? <button type="button"
        className="button subtle" aria-label={`复制 ${entry.label}`} onClick={() => void copy(entry.value)}>复制</button> : null}</dd>
    </div>)}</dl> : null}
    {expanded && message ? <p role="status">{message}</p> : null}
  </details>;
}
