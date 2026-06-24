import { ApiError } from "../../../shared/http/errors";
import type { AgentCitation, AgentToolResult } from "../types";

export type XiaozeSuggestContext = {
  projectId?: string;
  projectName?: string;
  pageKey?: string;
  path?: string;
};

export type XiaozeSuggestionItem = {
  id: string;
  tone: "neutral" | "warning" | "danger";
  headline: string;
  meta?: string;
  citations: AgentCitation[];
};

export type XiaozeSuggestResult = {
  suggestions: XiaozeSuggestionItem[];
};

const PAGE_SUGGEST_TOOLS: Record<string, string> = {
  "parameter-review": "perception.getProjectOverview",
  parameters: "perception.getProjectOverview",
  logs: "perception.getRecentLogConclusions"
};

type LogInsightRow = {
  status?: string;
  conclusion?: string | null;
  severity?: string;
};

function isForbiddenError(error: unknown) {
  return error instanceof ApiError && error.code === "FORBIDDEN";
}

function formatProjectMeta(projectId: string, projectName?: string) {
  const trimmedName = projectName?.trim();
  if (trimmedName) {
    return `项目：${trimmedName}`;
  }
  return `项目 ID：${projectId}`;
}

function truncateText(value: string, maxLength = 48) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}…`;
}

function buildParameterSuggestion(options: {
  pageKey: string;
  projectId: string;
  projectName?: string;
  result: AgentToolResult;
}): XiaozeSuggestionItem | null {
  const overviewData = options.result.data as { open_change_requests?: number } | undefined;
  const openChangeRequests = overviewData?.open_change_requests ?? 0;
  if (openChangeRequests <= 0) {
    return null;
  }

  const headline =
    options.pageKey === "parameter-review"
      ? `当前有 ${openChangeRequests} 条参数变更待审阅`
      : `有 ${openChangeRequests} 条参数变更待审阅`;

  return {
    id: `suggest-${options.pageKey}-${options.projectId}`,
    tone: "warning",
    headline,
    meta: formatProjectMeta(options.projectId, options.projectName),
    citations: options.result.citations
  };
}

function buildLogSuggestion(options: {
  projectId: string;
  projectName?: string;
  result: AgentToolResult;
}): XiaozeSuggestionItem | null {
  const logs = ((options.result.data as { logs?: LogInsightRow[] } | undefined)?.logs ?? []).filter(Boolean);
  if (logs.length === 0) {
    return null;
  }

  const failedCount = logs.filter((row) => row.status === "Failed").length;
  if (failedCount > 0) {
    return {
      id: `suggest-logs-${options.projectId}`,
      tone: "danger",
      headline: `有 ${failedCount} 条日志分析失败，建议优先查看`,
      meta: formatProjectMeta(options.projectId, options.projectName),
      citations: options.result.citations
    };
  }

  const processingCount = logs.filter((row) => row.status === "Processing").length;
  if (processingCount > 0) {
    return {
      id: `suggest-logs-${options.projectId}`,
      tone: "warning",
      headline: `有 ${processingCount} 条日志仍在分析中，可稍后回来查看结论`,
      meta: formatProjectMeta(options.projectId, options.projectName),
      citations: options.result.citations
    };
  }

  const latestConclusion = logs.find((row) => row.conclusion?.trim())?.conclusion?.trim();
  if (!latestConclusion) {
    return null;
  }

  return {
    id: `suggest-logs-${options.projectId}`,
    tone: "neutral",
    headline: `最近日志结论：${truncateText(latestConclusion)}`,
    meta: formatProjectMeta(options.projectId, options.projectName),
    citations: options.result.citations
  };
}

function buildSuggestion(options: {
  pageKey: string;
  projectId: string;
  projectName?: string;
  result: AgentToolResult;
}): XiaozeSuggestionItem | null {
  if (options.pageKey === "logs") {
    return buildLogSuggestion(options);
  }
  if (options.pageKey === "parameters" || options.pageKey === "parameter-review") {
    return buildParameterSuggestion(options);
  }
  return null;
}

export async function runXiaozeSuggest(options: {
  context: XiaozeSuggestContext;
  runTool: (name: string, payload: Record<string, unknown>) => Promise<AgentToolResult>;
  listReadTools: () => string[];
}): Promise<XiaozeSuggestResult> {
  const readTools = options.listReadTools().filter((name) => name.startsWith("perception."));
  if (!readTools.length) {
    return { suggestions: [] };
  }

  const pageKey = options.context.pageKey ?? "";
  const preferredTool = PAGE_SUGGEST_TOOLS[pageKey];
  if (!preferredTool || !readTools.includes(preferredTool)) {
    return { suggestions: [] };
  }

  if (!options.context.projectId) {
    return { suggestions: [] };
  }

  try {
    const result = await options.runTool(preferredTool, { projectId: options.context.projectId });
    if (!result.summary?.trim()) {
      return { suggestions: [] };
    }

    const suggestion = buildSuggestion({
      pageKey,
      projectId: options.context.projectId,
      projectName: options.context.projectName,
      result
    });

    return { suggestions: suggestion ? [suggestion] : [] };
  } catch (error) {
    if (isForbiddenError(error)) {
      return { suggestions: [] };
    }
    throw error;
  }
}
