import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { LogLineRange } from "@/application/ports/LogAnalysisRepository";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { presentError } from "@/infrastructure/http/presentError";

export function LogFileDrawer({ file, citedLines, readLines, onClose }: {
  file: string;
  citedLines: number[];
  readLines: (startLine: number, endLine: number) => Promise<LogLineRange>;
  onClose: () => void;
}) {
  const [window, setWindow] = useState(() => {
    const start = Math.max(1, (citedLines[0] ?? 1) - 50);
    return { start, end: start + 100, attempt: 0 };
  });
  const [result, setResult] = useState<{ window: typeof window | null; range: LogLineRange | null; error: string | null }>({ window: null, range: null, error: null });
  const { range } = result;
  const loading = result.window !== window;
  const error = loading ? null : result.error;
  const [copyMessage, setCopyMessage] = useState("");
  const firstCitationRef = useRef<HTMLLIElement | null>(null);
  const citationRevealed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    readLines(window.start, window.end).then((range) => {
      if (!cancelled) setResult({ window, range, error: null });
    }, (failure: unknown) => {
      if (!cancelled) setResult((previous) => ({ window, range: previous.range, error: presentError(failure, "日志行加载失败，请重试。") }));
    });
    return () => { cancelled = true; };
  }, [readLines, window]);

  useEffect(() => {
    if (!range || citationRevealed.current || !firstCitationRef.current) return;
    citationRevealed.current = true;
    firstCitationRef.current.scrollIntoView({ block: "center" });
    firstCitationRef.current.focus({ preventScroll: true });
  }, [range]);

  async function copyLine(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopyMessage("已复制日志行。");
    } catch {
      setCopyMessage("复制失败，请手动选择日志行复制。");
    }
  }

  return <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent side="right" className="log-file-drawer flex min-w-0 gap-0 p-0">
      <SheetHeader className="min-w-0 border-b border-border pr-12">
        <SheetTitle>日志文件</SheetTitle>
        <SheetDescription className="break-all font-mono">{file}</SheetDescription>
        {range ? <p className="text-xs text-muted-foreground">{range.totalLines ? `第 ${range.startLine}–${range.endLine} 行，共 ${range.totalLines} 行` : "共 0 行"}</p> : null}
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" aria-busy={loading}>
        {loading ? <p role="status" className="text-sm text-muted-foreground">正在加载日志行…</p> : null}
        {error ? <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>
          <Button variant="outline" size="sm" onClick={() => setWindow((current) => ({ ...current, attempt: current.attempt + 1 }))}>重试</Button>
        </div> : null}
        {range ? <>
          <Button variant="outline" size="sm" disabled={loading || range.startLine <= 1}
            onClick={() => {
              const start = Math.max(1, range.startLine - 100);
              setWindow({ start, end: Math.min(range.endLine, start + 399), attempt: 0 });
            }}>加载上方日志</Button>
          <ol className="m-0 list-none p-0 font-mono text-xs" aria-label="文件日志行">
            {range.lines.map((line) => {
              const highlighted = citedLines.includes(line.lineNumber);
              return <li key={line.lineNumber} tabIndex={highlighted ? -1 : undefined}
                ref={line.lineNumber === citedLines[0] ? firstCitationRef : undefined}
                data-line-number={line.lineNumber} data-highlighted={highlighted || undefined}
                aria-label={highlighted ? `引用日志第 ${line.lineNumber} 行` : undefined}
                className={`flex items-start gap-2 border-l-2 px-2 py-1 ${highlighted ? "border-primary bg-[var(--primary-soft)] text-[var(--text)]" : "border-transparent"}`}>
                <span className={`w-12 shrink-0 select-none text-right ${highlighted ? "text-inherit" : "text-muted-foreground"}`}>{line.lineNumber}</span>
                <code className="min-w-0 flex-1 whitespace-pre-wrap break-words">{line.content || "\u00a0"}</code>
                <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label={`复制第 ${line.lineNumber} 行`}
                  onClick={() => { void copyLine(line.content); }}><Copy aria-hidden="true" /></Button>
              </li>;
            })}
          </ol>
          {!range.lines.length ? <p className="text-sm text-muted-foreground">文件中没有日志行。</p> : null}
          <Button variant="outline" size="sm" disabled={loading || range.endLine >= range.totalLines}
            onClick={() => {
              const end = Math.min(range.totalLines, range.endLine + 100);
              setWindow({ start: Math.max(range.startLine, end - 399), end, attempt: 0 });
            }}>加载下方日志</Button>
        </> : null}
      </div>
      <p role="status" className="min-h-6 px-3 text-xs text-muted-foreground">{copyMessage}</p>
    </SheetContent>
  </Sheet>;
}
