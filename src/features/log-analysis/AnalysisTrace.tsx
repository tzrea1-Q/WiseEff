import { useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCheck, FileText, ListRestart, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { formatBytes } from "@/domain/format/formatBytes";
import { formatLogDateTime } from "@/domain/format/formatDateTime";
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
const reasons: Record<string, string> = {
  "provider-error": "模型调用失败", "provider-unavailable": "模型服务不可用",
  "invalid-output": "模型返回结果无效", "token-budget-exhausted": "已达到模型用量上限",
  "tool-rejected": "工具调用被拒绝", "result-cap": "结果已达到显示上限",
  "trace-line-cap": "引用行数已达到上限", "line-cap": "引用行数已达到上限"
};
const tools: Record<string, string> = {
  locate_log_statement: "定位日志源码", search_source: "搜索源码", read_source_range: "读取源码",
  search_log_lines: "搜索日志", search_lines: "搜索日志", list_files: "查看文件列表",
  describe_event_schema: "查看事件结构", query_events: "查询事件", read_line_range: "读取日志行", read_lines: "读取日志行",
  get_signals: "查看信号", get_line_templates: "查看日志模板", get_timeline: "查看时间线",
  get_prefilter_findings: "查看规则发现", read_domain_knowledge: "查阅相关知识", get_related_parameter_context: "查看关联参数"
};
const argumentLabels: Record<string, string> = {
  file: "文件", pattern: "匹配内容", query: "查询内容", line: "日志行", anchorLine: "定位行", startLine: "起始行", endLine: "结束行",
  isRegex: "正则匹配", maxMatches: "最多匹配数", neighborhood: "上下文行数", offset: "起始位置", limit: "数量上限",
  kind: "类型", severity: "级别", time: "时间", before: "前文行数", after: "后文行数", extractor: "提取规则", where: "筛选条件", cursor: "分页位置"
};
const severityLabels: Record<string, string> = {
  CRITICAL: "严重", FATAL: "严重", ERROR: "错误", ERR: "错误", WARNING: "警告", WARN: "警告",
  INFO: "信息", DEBUG: "调试", TRACE: "跟踪"
};

function formatArgument(key: string, value: AnalysisTraceStep["arguments"][string]): string {
  if (value === "[redacted]") return "已隐藏";
  if (value === null) return "未指定";
  if (!Object.hasOwn(argumentLabels, key) || ["extractor", "cursor", "where", "kind"].includes(key)) return "已设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (key === "severity") {
    const level = String(value).toUpperCase();
    return Object.hasOwn(severityLabels, level) ? severityLabels[level] : "已设置";
  }
  if (key === "time") return typeof value === "string" && Number.isFinite(Date.parse(value)) ? formatLogDateTime(value) : "已设置";
  return String(value);
}

type OpenTraceLine = (file: string, line: number, lines?: number[]) => void;

export function AnalysisTrace({ steps, analysis, onOpenLine }: {
  steps: AnalysisTraceStep[];
  analysis?: Pick<LogRecord, "analysisSource" | "degradedReason">;
  onOpenLine?: OpenTraceLine;
}) {
  if (!steps.length) return <SectionEmpty icon={<FileText aria-hidden size={20} />} message="暂无分析轨迹。" />;
  const toolCalls = steps.filter((step) => step.kind === "tool-call").length;
  const hasTokens = steps.some((step) => step.inputTokens != null || step.outputTokens != null);
  const inputTokens = steps.reduce((sum, step) => sum + (step.inputTokens ?? 0), 0);
  const outputTokens = steps.reduce((sum, step) => sum + (step.outputTokens ?? 0), 0);
  const degraded = analysis?.analysisSource === "rules-fallback" || steps.some((step) => step.kind === "degradation" || step.kind === "rule-fallback");
  const earlyConvergence = (analysis?.analysisSource === "agent" && analysis.degradedReason != null) || steps.some((step) => step.kind === "early-convergence");
  return <>
    <p className="mb-3 text-sm text-muted-foreground" aria-label="分析轨迹摘要">{steps.length} 步 · {toolCalls} 次工具调用
      {hasTokens ? ` · 输入 ${inputTokens.toLocaleString("zh-CN")} / 输出 ${outputTokens.toLocaleString("zh-CN")} 词元` : ""}
      {degraded ? " · 已降级" : ""}{earlyConvergence ? " · 提前收敛" : ""}</p>
    <ol className="m-0 list-none space-y-3 p-0" aria-label="分析轨迹步骤">
    {steps.map((step) => {
      const kind = kinds[step.kind];
      const Icon = kind.icon;
      const metrics = [
        step.resultBytes > 0 ? `返回大小：${formatBytes(step.resultBytes)}` : null,
        step.inputTokens != null ? `输入 ${step.inputTokens} 词元` : null,
        step.outputTokens != null ? `输出 ${step.outputTokens} 词元` : null
      ].filter(Boolean);
      const lineGroups = new Map<string, AnalysisTraceStep["lines"]>();
      for (const location of step.lines) {
        const key = JSON.stringify([location.snapshotId ?? null, location.file]);
        const group = lineGroups.get(key) ?? [];
        if (!group.some(({ line }) => line === location.line)) group.push(location);
        lineGroups.set(key, group);
      }
      const renderLocation = ({ file, line, snapshotId }: AnalysisTraceStep["lines"][number]) => snapshotId || !onOpenLine
        ? <span key={line} className="max-w-full break-all rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground">{snapshotId ? "源码 " : ""}{file}:{line}</span>
        : <Button key={line} variant="outline" size="sm" className="h-auto max-w-full break-all font-mono text-xs whitespace-normal"
          onClick={() => onOpenLine(file, line)}>{file}:{line}</Button>;
      return <li key={step.index} className="min-w-0 space-y-2 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Icon size={16} aria-hidden="true" /><strong>步骤 {step.index} · {kind.label}</strong>
          {step.tool ? <span>{Object.hasOwn(tools, step.tool) ? tools[step.tool] : "其他工具"}</span> : null}
          <span className={step.outcome === "error" ? "text-destructive" : "text-muted-foreground"}>{outcomes[step.outcome]}</span>
        </div>
        {Object.keys(step.arguments).length ? <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-xs">
          {Object.entries(step.arguments).map(([key, value]) => <div key={key} className="contents">
            <dt className="break-all text-muted-foreground">{Object.hasOwn(argumentLabels, key) ? argumentLabels[key] : "其他条件"}</dt><dd className="m-0 break-all font-mono">{formatArgument(key, value)}</dd>
          </div>)}
        </dl> : null}
        {metrics.length ? <p className="text-xs text-muted-foreground">{metrics.join(" · ")}</p> : null}
        {step.reason ? <p className="break-words text-xs text-muted-foreground">{Object.hasOwn(reasons, step.reason) ? reasons[step.reason] : "其他错误"}</p> : null}
        {step.lines.length ? <div className="flex flex-wrap gap-1" role="group" aria-label={`步骤 ${step.index} 引用行`}>
          {[...lineGroups].map(([key, locations]) => <div key={key} className="flex min-w-0 max-w-full flex-wrap gap-1" role="group" aria-label={`${locations[0].snapshotId ? "源码" : "日志"}文件 ${locations[0].file} 引用行`}>
            {locations.slice(0, 3).map(renderLocation)}
            {locations.length > 3 ? locations[0].snapshotId || !onOpenLine
              ? <details className="min-w-0 max-w-full"><summary className="cursor-pointer rounded-md border border-border px-2 py-1 text-xs">其余 {locations.length - 3} 行</summary>
                <div className="mt-1 flex flex-wrap gap-1">{locations.slice(3).map(renderLocation)}</div>
              </details>
              : <Button variant="outline" size="sm" onClick={() => onOpenLine(locations[0].file, locations[0].line, locations.map(({ line }) => line))}>其余 {locations.length - 3} 行</Button>
              : null}
          </div>)}
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
  onOpenLine: OpenTraceLine;
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
