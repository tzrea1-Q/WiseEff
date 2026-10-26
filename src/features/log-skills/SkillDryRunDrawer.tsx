import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AnalysisTrace } from "@/features/log-analysis/AnalysisTrace";
import { LogFileDrawer } from "@/features/log-analysis/LogFileDrawer";
import { presentError } from "@/infrastructure/http/presentError";
import type { AnalysisTraceStep, SkillDryRun, SkillWorkspaceRepository } from "./types";
import "@/features/log-analysis/log-analysis.css";

export function SkillDryRunDrawer({ skillId, run, repository, open, onClose, onRunChange, onRetry, retryDisabled }: {
  skillId: string;
  run: SkillDryRun;
  repository: Partial<SkillWorkspaceRepository>;
  open: boolean;
  onClose: () => void;
  onRunChange: (run: SkillDryRun) => void;
  onRetry?: () => Promise<SkillDryRun>;
  retryDisabled?: boolean;
}) {
  const [steps, setSteps] = useState<AnalysisTraceStep[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [viewer, setViewer] = useState<{ file: string; lines: number[] } | null>(null);
  const openLine = repository.getSkillDryRunLines ? (file: string, line: number, lines?: number[]) => setViewer({ file, lines: [line, ...(lines ?? []).filter((item) => item !== line)] }) : undefined;
  const readLines = useCallback((start: number, end: number) => repository.getSkillDryRunLines!(skillId, run.id, viewer!.file, start, end), [repository, skillId, run.id, viewer]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const detail = await repository.getSkillDryRun!(skillId, run.id);
        if (!active) return;
        setSteps(detail.steps); onRunChange(detail.run);
        if (detail.run.status === "processing") timer = setTimeout(() => void poll(), 1000);
      } catch (cause) { if (active) setError(presentError(cause, "无法读取试运行进度，请重试。")); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [skillId, run.id, repository, onRunChange, attempt]);
  const retry = async () => {
    setError("");
    if (run.status !== "failed") { setAttempt((value) => value + 1); return; }
    setStarting(true);
    try {
      const started = onRetry ? await onRetry() : await repository.startSkillDryRun!(skillId);
      setSteps([]); onRunChange(started);
    } catch (cause) { setError(presentError(cause, "无法开始试运行，请重试。")); }
    finally { setStarting(false); }
  };
  const report = run.report;
  return <><Sheet open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <SheetContent side="right" className="log-file-drawer flex min-w-0 gap-0 p-0">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>试运行</SheetTitle>
          <SheetDescription>使用草稿和已保存的样例日志；结果不会加入日志列表。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div role="status" aria-live="polite" className="space-y-2 text-sm">
            <p>{run.status === "processing" ? `正在分析… ${run.progress}%` : run.status === "complete" ? "试运行完成" : "试运行失败"}</p>
            {run.status === "processing" ? <progress aria-label="试运行进度" value={run.progress} max={100} className="w-full accent-primary" /> : null}
          </div>
          {error ? <p role="alert" className="text-destructive">{error}</p> : null}
          {run.error ? <p role="alert" className="text-destructive">{run.error === "服务重启，试运行已中断" ? run.error : run.error === "Dry run timed out." ? "试运行超时，请重试。" : "试运行失败，请重试。"}</p> : null}
          {error || run.status === "failed" ? <Button variant="outline" size="sm" disabled={starting || (run.status === "failed" && (retryDisabled || (!onRetry && !repository.startSkillDryRun)))}
            onClick={() => void retry()}>{starting ? "正在重试…" : "重试"}</Button> : null}
          {report ? <>
            <section aria-label="试运行结论" className="space-y-2"><h2 className="text-base font-medium">结论</h2>
              <p className="break-words">{report.conclusion}</p><p className="break-words text-sm text-muted-foreground">{report.impact}</p>
              {report.analysisSource === "rules-fallback" ? <p className="text-sm text-muted-foreground">本次分析已降级为规则回退。</p>
                : report.degradedReason ? <p className="text-sm text-muted-foreground">本次分析已提前收敛。</p> : null}
              {report.suggestedActions.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{report.suggestedActions.map((action, index) => <li key={index}>{action}</li>)}</ul> : null}
            </section>
            <section aria-label="试运行证据" className="space-y-2"><h2 className="text-base font-medium">证据</h2>
              {report.evidence.length ? <ol className="list-none space-y-3 p-0">{report.evidence.map((evidence, index) => <li key={index} className="space-y-2 rounded-md border border-border p-3 text-sm">
                <p className="break-words">{evidence.inference}</p><p className="break-words text-muted-foreground">{evidence.suggestedAction}</p>
                {evidence.filePath ? <div className="flex flex-wrap gap-1">{evidence.lineNumbers.map((line) => <Button key={line} variant="outline" size="sm"
                  disabled={!openLine} className="h-auto max-w-full break-all whitespace-normal font-mono text-xs"
                  onClick={() => openLine?.(evidence.filePath!, line, evidence.lineNumbers)}>{evidence.filePath}:{line}</Button>)}</div> : null}
              </li>)}</ol> : <p className="text-sm text-muted-foreground">暂无证据。</p>}
            </section>
          </> : null}
          <section aria-label="试运行分析轨迹" className="space-y-2"><h2 className="text-base font-medium">分析轨迹</h2>
            <AnalysisTrace steps={steps} analysis={report ?? undefined} onOpenLine={openLine} />
          </section>
        </div>
      </SheetContent>
    </Sheet>
    {open && viewer ? <LogFileDrawer key={`${run.id}:${viewer.file}:${viewer.lines.join(",")}`} file={viewer.file} citedLines={viewer.lines} readLines={readLines} onClose={() => setViewer(null)} /> : null}</>;
}
