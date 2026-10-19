import { useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCheck, ListRestart, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { formatBytes } from "@/domain/format/formatBytes";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { AnalysisTraceStep } from "@/features/log-skills/types";
import type { LogRecord } from "@/domain/logs/types";

const kinds = {
  "tool-call": { label: "工具调用", icon: Wrench },
  "model-turn": { label: "模型轮次", icon: Bot },
  "early-convergence": { label: "提前收敛", icon: CheckCheck },
  "rule-fallback": { label: "规则回退", icon: ListRestart },
  degradation: { label: "降级", icon: AlertTriangle }
};
const outcomes = { ok: "成功", error: "错误", truncated: "已截断" };

export function AnalysisTrace({ steps, analysis, onOpenLine }: {
  steps: AnalysisTraceStep[];
  analysis?: Pick<LogRecord, "analysisSource" | "degradedReason">;
  onOpenLine?: (file: string, line: number) => void;
}) {
  if (!steps.length) return <SectionEmpty message="暂无分析轨迹。" />;
  const toolCalls = steps.filter((step) => step.kind === "tool-call").length;
  const hasTokens = steps.some((step) => step.inputTokens != null || step.outputTokens != null);
  const inputTokens = steps.reduce((sum, step) => sum + (step.inputTokens ?? 0), 0);
  const outputTokens = steps.reduce((sum, step) => sum + (step.outputTokens ?? 0), 0);
  const degraded = analysis?.analysisSource === "rules-fallback" || steps.some((step) => step.kind === "degradation" || step.kind === "rule-fallback");
  const earlyConvergence = (analysis?.analysisSource === "agent" && analysis.degradedReason != null) || steps.some((step) => step.kind === "early-convergence");
  return <>
    <p className="mb-3 text-sm text-muted-foreground" aria-label="分析轨迹摘要">{steps.length} 步 · {toolCalls} 次工具调用
      {hasTokens ? ` · 输入 ${inputTokens.toLocaleString("zh-CN")} / 输出 ${outputTokens.toLocaleString("zh-CN")} tokens` : ""}
      {degraded ? " · 已降级" : ""}{earlyConvergence ? " · 提前收敛" : ""}</p>
    <ol className="m-0 list-none space-y-3 p-0" aria-label="分析轨迹步骤">
    {steps.map((step) => {
      const kind = kinds[step.kind];
      const Icon = kind.icon;
      return <li key={step.index} className="min-w-0 space-y-2 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Icon size={16} aria-hidden="true" /><strong>步骤 {step.index} · {kind.label}</strong>
          {step.tool ? <code className="break-all">{step.tool}</code> : null}
          <span className={step.outcome === "error" ? "text-destructive" : "text-muted-foreground"}>{outcomes[step.outcome]}</span>
        </div>
        {Object.keys(step.arguments).length ? <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-xs">
          {Object.entries(step.arguments).map(([key, value]) => <div key={key} className="contents">
            <dt className="break-all font-mono text-muted-foreground">{key}</dt><dd className="m-0 break-all font-mono">{String(value)}</dd>
          </div>)}
        </dl> : null}
        <p className="text-xs text-muted-foreground">返回大小：{formatBytes(step.resultBytes)}
          {step.inputTokens != null ? ` · 输入 ${step.inputTokens} tokens` : ""}
          {step.outputTokens != null ? ` · 输出 ${step.outputTokens} tokens` : ""}</p>
        {step.reason ? <p className="break-words text-xs text-muted-foreground">{step.reason}</p> : null}
        {step.lines.length ? <div className="flex flex-wrap gap-1" role="group" aria-label={`步骤 ${step.index} 引用行`}>
          {step.lines.map(({ file, line, snapshotId }) => snapshotId || !onOpenLine
            ? <span key={`${snapshotId ?? "log"}:${file}:${line}`} className="max-w-full break-all rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground" title={snapshotId}>{snapshotId ? "源码 " : ""}{file}:{line}</span>
            : <Button key={`${file}:${line}`} variant="outline" size="sm" className="max-w-full break-all font-mono text-xs whitespace-normal"
              onClick={() => onOpenLine(file, line)}>{file}:{line}</Button>)}
        </div> : null}
      </li>;
    })}
    </ol>
  </>;
}

export function LogTraceTab({ logId, analysis, repository, onOpenLine }: {
  logId: string;
  analysis?: Pick<LogRecord, "analysisSource" | "degradedReason">;
  repository?: Pick<LogAnalysisRepository, "getLogTrace">;
  onOpenLine: (file: string, line: number) => void;
}) {
  const [steps, setSteps] = useState<AnalysisTraceStep[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const load = repository?.getLogTrace?.(logId) ?? Promise.resolve([]);
    void load.then((steps) => { if (active) setSteps(steps); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [logId, repository, attempt]);
  return <section className="min-w-0 p-3" aria-label="分析轨迹">
    <h2 className="mb-3 text-base font-medium">分析轨迹</h2>
    {failed ? <SectionError message="无法加载分析轨迹" onRetry={() => { setFailed(false); setSteps(null); setAttempt((value) => value + 1); }} />
      : steps ? <AnalysisTrace steps={steps} analysis={analysis} onOpenLine={onOpenLine} /> : <SectionSkeleton label="正在加载分析轨迹" />}
  </section>;
}
