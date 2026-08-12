import { z } from "zod";

import type { LogAnalysisToolContext, LogAnalysisToolOutcome } from "./toolContext";

/**
 * The five read-only tools of the log analysis agent (ADR-0022). Every tool
 * validates its arguments with zod, truncates its result to a stated bound so a
 * single call can never blow the token budget, and never writes anything.
 */
export const LOG_ANALYSIS_TOOL_NAMES = [
  "search_log_lines",
  "read_line_range",
  "get_prefilter_findings",
  "read_domain_knowledge",
  "get_related_parameter_context"
] as const;

export type LogAnalysisToolName = (typeof LOG_ANALYSIS_TOOL_NAMES)[number];

const MAX_MATCHES_HARD_CAP = 20;
const MAX_RANGE_LINES = 40;
const MAX_LINE_CHARS = 400;
const MAX_KNOWLEDGE_ITEMS = 5;
const MAX_KNOWLEDGE_EXCERPT_CHARS = 400;
const MAX_PREFILTER_LINE_REFS = 30;

function clipLine(content: string) {
  return content.length > MAX_LINE_CHARS ? `${content.slice(0, MAX_LINE_CHARS)}…` : content;
}

export const searchLogLinesParamsSchema = z.object({
  pattern: z.string().min(1).max(200),
  isRegex: z.boolean().optional().default(false),
  maxMatches: z.number().int().min(1).max(MAX_MATCHES_HARD_CAP).optional().default(8),
  neighborhood: z.number().int().min(0).max(3).optional().default(1)
});

export function searchLogLines(
  context: LogAnalysisToolContext,
  params: z.infer<typeof searchLogLinesParamsSchema>
): LogAnalysisToolOutcome {
  let matcher: (line: string) => boolean;
  if (params.isRegex) {
    let regex: RegExp;
    try {
      regex = new RegExp(params.pattern, "i");
    } catch (error) {
      return { ok: false, error: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}` };
    }
    matcher = (line) => regex.test(line);
  } else {
    const needle = params.pattern.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(needle);
  }

  const rawLines = context.parsed.rawLines;
  const matchedLineNumbers: number[] = [];
  for (let lineNumber = 1; lineNumber <= rawLines.length; lineNumber += 1) {
    if (matcher(rawLines[lineNumber - 1])) {
      matchedLineNumbers.push(lineNumber);
    }
  }

  const kept = matchedLineNumbers.slice(0, params.maxMatches);
  const included = new Set<number>();
  for (const lineNumber of kept) {
    for (let offset = -params.neighborhood; offset <= params.neighborhood; offset += 1) {
      const neighbor = lineNumber + offset;
      if (neighbor >= 1 && neighbor <= rawLines.length) {
        included.add(neighbor);
      }
    }
  }
  const matchedSet = new Set(kept);

  return {
    ok: true,
    result: {
      totalMatches: matchedLineNumbers.length,
      returnedMatches: kept.length,
      truncated: matchedLineNumbers.length > kept.length,
      lines: [...included]
        .sort((left, right) => left - right)
        .map((lineNumber) => ({
          lineNumber,
          isMatch: matchedSet.has(lineNumber),
          content: clipLine(rawLines[lineNumber - 1])
        }))
    }
  };
}

export const readLineRangeParamsSchema = z.object({
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1)
});

export function readLineRange(
  context: LogAnalysisToolContext,
  params: z.infer<typeof readLineRangeParamsSchema>
): LogAnalysisToolOutcome {
  if (params.endLine < params.startLine) {
    return { ok: false, error: "endLine must be greater than or equal to startLine." };
  }
  const totalLines = context.parsed.rawLines.length;
  if (params.startLine > totalLines) {
    return { ok: false, error: `startLine ${params.startLine} is beyond the end of the log (${totalLines} lines).` };
  }

  const clampedEnd = Math.min(params.endLine, totalLines);
  const cappedEnd = Math.min(clampedEnd, params.startLine + MAX_RANGE_LINES - 1);
  const lines: Array<{ lineNumber: number; content: string }> = [];
  for (let lineNumber = params.startLine; lineNumber <= cappedEnd; lineNumber += 1) {
    lines.push({ lineNumber, content: clipLine(context.parsed.rawLines[lineNumber - 1]) });
  }

  return {
    ok: true,
    result: {
      startLine: params.startLine,
      endLine: cappedEnd,
      totalLines,
      truncated: cappedEnd < clampedEnd,
      lines
    }
  };
}

export const getPrefilterFindingsParamsSchema = z.object({}).strict();

export function getPrefilterFindings(context: LogAnalysisToolContext): LogAnalysisToolOutcome {
  const findings = context.prefilter;
  return {
    ok: true,
    result: {
      ruleHits: findings.ruleHits,
      evidence: findings.evidence.map((item) => ({
        ruleHit: item.ruleHit,
        inference: item.inference,
        lineNumbers: item.lineNumbers.slice(0, MAX_PREFILTER_LINE_REFS)
      })),
      errorCodeStats: findings.errorCodeStats.map((stat) => ({
        code: stat.code,
        count: stat.count,
        lineNumbers: stat.lineNumbers.slice(0, MAX_PREFILTER_LINE_REFS)
      })),
      severityCounts: findings.severityCounts,
      anomalyLineNumbers: findings.anomalyLineNumbers.slice(0, 50)
    }
  };
}

export const readDomainKnowledgeParamsSchema = z.object({
  query: z.string().min(1).max(200)
});

export async function readDomainKnowledge(
  context: LogAnalysisToolContext,
  params: z.infer<typeof readDomainKnowledgeParamsSchema>
): Promise<LogAnalysisToolOutcome> {
  if (!context.searchDomainKnowledge) {
    return {
      ok: true,
      result: {
        available: false,
        note: "Knowledge retrieval is not available in this run; proceed from the log content alone.",
        items: []
      }
    };
  }

  const search = await context.searchDomainKnowledge(params.query);
  return {
    ok: true,
    result: {
      available: true,
      // organization-generic mirrors the uncategorized-log-domain semantics and is stated explicitly.
      scope: search.scope,
      scopeNote:
        search.scope === "domain-linked"
          ? "Results are restricted to the knowledge entries linked to this log domain."
          : "No knowledge entries are linked to this log domain; results come from organization-wide generic retrieval.",
      retrievalMode: search.retrievalMode,
      items: search.items.slice(0, MAX_KNOWLEDGE_ITEMS).map((item) => ({
        entryId: item.entryId,
        title: item.title,
        excerpt:
          item.excerpt.length > MAX_KNOWLEDGE_EXCERPT_CHARS
            ? `${item.excerpt.slice(0, MAX_KNOWLEDGE_EXCERPT_CHARS)}…`
            : item.excerpt
      }))
    }
  };
}

export const getRelatedParameterContextParamsSchema = z.object({}).strict();

export async function getRelatedParameterContext(context: LogAnalysisToolContext): Promise<LogAnalysisToolOutcome> {
  if (!context.loadRelatedParameterContext) {
    return {
      ok: true,
      result: { available: false, note: "This log was uploaded without a related parameter." }
    };
  }

  const parameter = await context.loadRelatedParameterContext();
  if (!parameter) {
    return {
      ok: true,
      result: { available: false, note: "The related parameter could not be found in this organization." }
    };
  }

  return {
    ok: true,
    result: {
      available: true,
      parameter: {
        ...parameter,
        recentChanges: parameter.recentChanges.slice(0, 5)
      }
    }
  };
}

type ToolDefinition = {
  description: string;
  paramsSchema: z.ZodTypeAny;
  execute: (context: LogAnalysisToolContext, params: unknown) => Promise<LogAnalysisToolOutcome> | LogAnalysisToolOutcome;
};

export const logAnalysisToolCatalog: Record<LogAnalysisToolName, ToolDefinition> = {
  search_log_lines: {
    description:
      'Search raw log lines by keyword or regex. Args: {"pattern": string, "isRegex"?: boolean, "maxMatches"?: 1-20, "neighborhood"?: 0-3}. Returns matching lines with neighborhood context.',
    paramsSchema: searchLogLinesParamsSchema,
    execute: (context, params) => searchLogLines(context, params as z.infer<typeof searchLogLinesParamsSchema>)
  },
  read_line_range: {
    description:
      'Read a contiguous line range (max 40 lines per call). Args: {"startLine": number, "endLine": number}.',
    paramsSchema: readLineRangeParamsSchema,
    execute: (context, params) => readLineRange(context, params as z.infer<typeof readLineRangeParamsSchema>)
  },
  get_prefilter_findings: {
    description: "Get the deterministic prefilter findings (rule hits, error-code stats, severity counts). Args: {}.",
    paramsSchema: getPrefilterFindingsParamsSchema,
    execute: (context) => getPrefilterFindings(context)
  },
  read_domain_knowledge: {
    description:
      'Retrieve published domain knowledge linked to this log domain (falls back to organization-wide retrieval when the domain has no linked entries). Args: {"query": string}.',
    paramsSchema: readDomainKnowledgeParamsSchema,
    execute: (context, params) => readDomainKnowledge(context, params as z.infer<typeof readDomainKnowledgeParamsSchema>)
  },
  get_related_parameter_context: {
    description:
      "Get the definition and recent changes of the parameter this log was uploaded against, when one was provided. Args: {}.",
    paramsSchema: getRelatedParameterContextParamsSchema,
    execute: (context) => getRelatedParameterContext(context)
  }
};

export function isLogAnalysisToolName(name: string): name is LogAnalysisToolName {
  return (LOG_ANALYSIS_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Single dispatch point for the loop kernel: unknown tool names and invalid
 * arguments come back as `ok: false` so the kernel can prompt the model to
 * correct itself (and count the strike toward its illegal-call threshold).
 */
export async function executeLogAnalysisTool(
  name: string,
  args: unknown,
  context: LogAnalysisToolContext
): Promise<LogAnalysisToolOutcome> {
  if (!isLogAnalysisToolName(name)) {
    return { ok: false, error: `Unknown tool "${name}". Available tools: ${LOG_ANALYSIS_TOOL_NAMES.join(", ")}.` };
  }
  const definition = logAnalysisToolCatalog[name];
  const parsed = definition.paramsSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    return { ok: false, error: `Invalid arguments for tool "${name}": ${issues}` };
  }
  try {
    return await definition.execute(context, parsed.data);
  } catch (error) {
    return { ok: false, error: `Tool "${name}" failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
