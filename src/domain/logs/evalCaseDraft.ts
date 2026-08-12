/**
 * Annotation-draft assembly for the golden case set (eval-cases/logs).
 *
 * Turns a completed log record into a case.yaml DRAFT plus the raw log.txt so
 * a domain expert can promote a live case into an annotation without hand-copying
 * fields. Deliberate draft invariants:
 * - `deIdentified` starts as `false` — the case must NOT enter git until a human
 *   completed the de-identification checklist and flipped it to `true`.
 * - `rootCauseCategory` stays a TODO placeholder; the loader's schema validation
 *   rejects it, so an unfinished draft can never silently count as a golden case.
 */

/** Minimal record shape shared by the prototype and domain LogRecord types. */
export type EvalCaseDraftSource = {
  id: string;
  reportId: string;
  fileName: string;
  conclusion: string;
  suggestedActions: string[];
  rawLines: string[];
  analysisQuestion?: string;
  logDomainName?: string;
  evidence: Array<{ lineNumbers: number[] }>;
};

export type EvalCaseDraft = {
  /** Suggested log-domain directory slug; `uncategorized` when the record has no domain. */
  domainSlug: string;
  /** Suggested case directory name under eval-cases/logs/<domainSlug>/. */
  caseId: string;
  /** case.yaml draft content. */
  caseYaml: string;
  /** log.txt content (raw lines exactly as analyzed, 1-based line numbers preserved). */
  logText: string;
};

const maxRootCausePoints = 6;
const maxSummaryLength = 120;

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "uncategorized";
}

/** Double-quoted JSON strings are valid YAML scalars, so escaping stays correct. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function splitConclusionIntoPoints(conclusion: string): string[] {
  return conclusion
    .split(/[。；;\n]+|(?<=[.!?])\s+/)
    .map((part) => part.trim().replace(/[，,]$/, ""))
    .filter((part) => part.length > 0)
    .slice(0, maxRootCausePoints);
}

export function evalCaseDomainSlug(record: Pick<EvalCaseDraftSource, "logDomainName">): string {
  return record.logDomainName ? slugify(record.logDomainName) : "uncategorized";
}

export function evalCaseId(record: Pick<EvalCaseDraftSource, "fileName" | "id">): string {
  const stem = record.fileName.replace(/\.[^.]*$/, "");
  return `${slugify(stem)}-${slugify(record.id).slice(0, 8)}`;
}

export function buildEvalCaseDraft(record: EvalCaseDraftSource, exportedAt: Date = new Date()): EvalCaseDraft {
  const domainSlug = evalCaseDomainSlug(record);
  const caseId = evalCaseId(record);
  const rootCausePoints = splitConclusionIntoPoints(record.conclusion);
  const keyEvidenceLines = [...new Set(record.evidence.flatMap((item) => item.lineNumbers))].sort((a, b) => a - b);
  const summarySource = rootCausePoints[0] ?? record.fileName;
  const summary = `TODO(一句话场景描述): ${summarySource.slice(0, maxSummaryLength)}`;

  const lines: string[] = [
    `# 评测案例草稿 — 由 /log-admin 记录 ${record.reportId || record.id} 导出（${exportedAt.toISOString()}）。`,
    `# 建议目录：eval-cases/logs/${domainSlug}/${caseId}/（case.yaml + log.txt）。`,
    "# 入库前必须完成（详见 eval-cases/logs/README.zh-CN.md 的脱敏清单与标注指南）：",
    "# 1. 人工脱敏 log.txt 与本文件：替换人名/客户名/序列号/IP/凭据等，保持行号与技术语义稳定；",
    "# 2. 把 rootCauseCategory 的 TODO 换成评测枚举值（thermal-protection / communication-failure / ...）；",
    "# 3. 领域专家复核 rootCausePoints / keyEvidenceLines / expectedActions（预填值仅是分析结论的草稿）；",
    "# 4. 全部完成后把 deIdentified 改为 true —— 未脱敏的案例绝不允许进入仓库。",
    `domain: ${domainSlug}`,
    `summary: ${yamlString(summary)}`,
    "realLog: true",
    "# 人工脱敏完成前必须保持 false；loader 会拒绝 deIdentified: false 的真实案例。",
    "deIdentified: false",
    "# TODO：替换为评测专用根因枚举值（见 eval-cases/logs/README.md）。",
    "rootCauseCategory: TODO",
    "rootCausePoints:"
  ];

  if (rootCausePoints.length > 0) {
    for (const point of rootCausePoints) {
      lines.push(`  - ${yamlString(point)}`);
    }
  } else {
    lines.push(`  - ${yamlString("TODO：补充专家确认的根因要点")}`);
  }

  lines.push(`keyEvidenceLines: [${keyEvidenceLines.join(", ")}]`);
  lines.push("expectedActions:");
  if (record.suggestedActions.length > 0) {
    for (const action of record.suggestedActions) {
      lines.push(`  - ${yamlString(action)}`);
    }
  } else {
    lines.push(`  - ${yamlString("TODO：补充专家期望的处置动作")}`);
  }

  if (record.analysisQuestion) {
    lines.push(`analysisQuestion: ${yamlString(record.analysisQuestion)}`);
  }

  return {
    domainSlug,
    caseId,
    caseYaml: `${lines.join("\n")}\n`,
    logText: record.rawLines.length > 0 ? `${record.rawLines.join("\n")}\n` : ""
  };
}
