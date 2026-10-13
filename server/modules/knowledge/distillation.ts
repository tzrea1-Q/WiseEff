import type { LogRecordDto } from "../logs/types";

/**
 * Knowledge distillation prefill (design D15): a completed log-analysis record
 * becomes a pre-filled markdown draft. This builder couples ONLY to the stable
 * analysis-record DTO (what is stored per analysis) — never to analyzer
 * internals or rule ids (`ruleHit` is deliberately omitted), so the parallel
 * log-analysis kernel rewrite behind `LogAnalysisAdapter` cannot break it.
 */

export const LOG_DISTILLATION_TAG = "日志分析";

export const LOG_SEVERITY_TAGS: Record<LogRecordDto["severity"], string> = {
  Critical: "严重",
  Warning: "警告",
  Info: "提示"
};

const MAX_TITLE_CHARS = 200;

const degradedReasonLabels: Record<NonNullable<LogRecordDto["degradedReason"]>, string> = {
  "provider-unavailable": "AI 分析服务不可用，本结论由规则引擎回退生成",
  "token-budget-exhausted": "预算内未能得到有效接地结论，本结论由规则引擎回退生成"
};

export type LogDistillationDraft = {
  title: string;
  tags: string[];
  contentMarkdown: string;
};

function evidenceLineQuotes(log: LogRecordDto, lineNumbers: number[]): string[] {
  return lineNumbers.map((lineNumber) => {
    const raw = log.rawLines[lineNumber - 1];
    return raw === undefined ? `> \`#${lineNumber}\`（原始日志行不可用）` : `> \`#${lineNumber} ${raw}\``;
  });
}

export function buildLogAnalysisProvenanceNotice(
  log: Pick<LogRecordDto, "analysisSource" | "degradedReason">
): string {
  const isFallback = log.analysisSource === "rules-fallback";
  const isEarlyConverged = log.analysisSource === "agent" && log.degradedReason !== undefined;
  if (!isFallback && !isEarlyConverged) {
    return "";
  }
  const label = isFallback ? "降级分析 · 规则回退" : "降级分析 · 提前收敛";
  const reason = isFallback
    ? log.degradedReason ? degradedReasonLabels[log.degradedReason] : "本结论由规则引擎回退生成"
    : "分析步数或 token 预算耗尽，Agent 基于已读证据提前收敛为低置信结论";
  return `> ${label}\n> ${reason}\n> 依赖结论前请复核证据。`;
}

export function buildLogDistillationDraft(log: LogRecordDto): LogDistillationDraft {
  const conclusion = log.conclusion.trim();
  const title = (conclusion || `日志分析:${log.fileName}`).slice(0, MAX_TITLE_CHARS);
  const severityLabel = LOG_SEVERITY_TAGS[log.severity];
  const notice = buildLogAnalysisProvenanceNotice(log);
  const confidenceCaption = log.analysisSource === "rules-fallback" ? "规则评分"
    : log.analysisSource === "agent" ? "模型自估" : "置信度";

  const lines: string[] = [
    ...(notice ? [notice, ""] : []),
    `> 由日志分析记录沉淀。来源文件:\`${log.fileName}\`${log.reportId ? `(报告 ${log.reportId})` : ""},采集时间 ${log.capturedAt}。`,
    ""
  ];

  if (log.analysisQuestion?.trim()) {
    lines.push("## 分析问题", "", log.analysisQuestion.trim(), "");
  }

  lines.push("## 结论", "", conclusion || "(分析结论为空)", "");
  lines.push("## 影响", "", log.impact.trim() || "(未记录影响)", "");
  lines.push("## 严重度", "", `${severityLabel}(${log.severity})· ${confidenceCaption} ${log.confidence}%`, "");

  if (log.evidence.length > 0) {
    lines.push("## 证据(行引用)", "");
    log.evidence.forEach((evidence, index) => {
      lines.push(`### 证据 ${String(index + 1).padStart(2, "0")} · 行 ${evidence.lineNumbers.join(", ")}`, "");
      lines.push(...evidenceLineQuotes(log, evidence.lineNumbers), "");
      lines.push(`**推断**:${evidence.inference}`, "");
      lines.push(`**处置**:${evidence.suggestedAction}`, "");
    });
  }

  if (log.suggestedActions.length > 0) {
    lines.push("## 建议处置", "");
    lines.push(...log.suggestedActions.map((action) => `- ${action}`), "");
  }

  return {
    title,
    tags: [LOG_DISTILLATION_TAG, severityLabel],
    contentMarkdown: `${lines.join("\n").trimEnd()}\n`
  };
}
