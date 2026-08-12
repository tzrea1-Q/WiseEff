import { SEVERITY_LABELS, type LogRecord } from "@/domain/prototype/types";

/**
 * Mock-runtime mirror of the server-side distillation prefill
 * (`server/modules/knowledge/distillation.ts`): same title/tags/markdown shape,
 * built from the frontend log record so mock mode keeps the same port
 * behavior. Rule ids (`ruleHit`) stay out of the draft on both sides.
 */

export const LOG_DISTILLATION_TAG = "日志分析";

const MAX_TITLE_CHARS = 200;

export type LogDistillationDraft = {
  title: string;
  tags: string[];
  contentMarkdown: string;
};

function evidenceLineQuotes(log: LogRecord, lineNumbers: number[]): string[] {
  return lineNumbers.map((lineNumber) => {
    const raw = log.rawLines[lineNumber - 1];
    return raw === undefined ? `> \`#${lineNumber}\`（原始日志行不可用）` : `> \`#${lineNumber} ${raw}\``;
  });
}

export function buildLogDistillationDraft(log: LogRecord): LogDistillationDraft {
  const conclusion = log.conclusion.trim();
  const title = (conclusion || `日志分析:${log.fileName}`).slice(0, MAX_TITLE_CHARS);
  const severityLabel = SEVERITY_LABELS[log.severity];

  const lines: string[] = [
    `> 由日志分析记录沉淀。来源文件:\`${log.fileName}\`${log.reportId ? `(报告 ${log.reportId})` : ""},采集时间 ${log.capturedAt}。`,
    ""
  ];

  if (log.analysisQuestion?.trim()) {
    lines.push("## 分析问题", "", log.analysisQuestion.trim(), "");
  }

  lines.push("## 结论", "", conclusion || "(分析结论为空)", "");
  lines.push("## 影响", "", log.impact.trim() || "(未记录影响)", "");
  lines.push("## 严重度", "", `${severityLabel}(${log.severity})· 置信度 ${log.confidence}%`, "");

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
