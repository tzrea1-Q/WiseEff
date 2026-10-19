import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { LogEvidence } from "@/domain/logs/types";
import type { SourceExcerpt } from "@/features/log-skills/types";
import { presentError } from "@/infrastructure/http/presentError";

export function SourceEvidence({ evidence, loadExcerpt }: { evidence: LogEvidence; loadExcerpt?: () => Promise<SourceExcerpt> }) {
  const [open, setOpen] = useState(false);
  const [excerpt, setExcerpt] = useState<SourceExcerpt | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const location = evidence.sourceLocation;
  if (!location) return null;
  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (excerpt || !loadExcerpt) return;
    setPending(true); setError("");
    try { setExcerpt(await loadExcerpt()); }
    catch (cause) { setError(presentError(cause, "源码摘录加载失败，请收起后重试。")); }
    finally { setPending(false); }
  }
  return <section className="grid gap-2" aria-label="源码证据">
    <p className="break-all">源码：{location.path}:{location.line} · {evidence.sourceVersionLabel ?? excerpt?.versionLabel ?? location.snapshotId}</p>
    <div><Button variant="outline" size="sm" aria-expanded={open} disabled={pending || !loadExcerpt} onClick={() => void toggle()}>{open ? "收起源码摘录" : "展开源码摘录"}</Button></div>
    {open ? <div aria-live="polite">{pending ? <p role="status">正在加载源码摘录…</p> : error ? <p role="alert">{error}</p> : excerpt ?
      <pre className="overflow-auto whitespace-pre-wrap break-all font-mono text-xs" aria-label="已引用源码摘录">{excerpt.excerpt.split("\n").map((line, index) => {
        const lineNumber = excerpt.startLine + index;
        const cited = lineNumber === location.line;
        return <span key={lineNumber} aria-label={cited ? `已引用源码行 ${lineNumber}` : undefined} className={cited ? "bg-[var(--accent-soft)] font-semibold" : undefined}>{cited ? "> " : "  "}{lineNumber}: {line}{"\n"}</span>;
      })}</pre> : null}</div> : null}
  </section>;
}
