import { ApiError } from "../../../shared/http/errors";
import type { AgentCitation, AgentToolResult } from "../types";

export type XiaozeSuggestContext = {
  projectId?: string;
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
  "log-analysis": "perception.getProjectOverview"
};

function isForbiddenError(error: unknown) {
  return error instanceof ApiError && error.code === "FORBIDDEN";
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

  const pageKey = options.context.pageKey ?? "parameters";
  const preferredTool = PAGE_SUGGEST_TOOLS[pageKey];
  const toolName = preferredTool && readTools.includes(preferredTool) ? preferredTool : readTools[0];
  if (!toolName || toolName.startsWith("action.")) {
    return { suggestions: [] };
  }

  if (!options.context.projectId) {
    return { suggestions: [] };
  }

  try {
    const result = await options.runTool(toolName, { projectId: options.context.projectId });
    if (!result.summary?.trim()) {
      return { suggestions: [] };
    }

    const overviewData = result.data as { open_change_requests?: number; parameter_count?: number } | undefined;
    let headline = result.summary;
    if (typeof overviewData?.open_change_requests === "number" && overviewData.open_change_requests > 0) {
      headline = `${overviewData.open_change_requests} open change requests pending review`;
    }

    const tone: XiaozeSuggestionItem["tone"] = /high-risk|pending review|warning/i.test(headline)
      ? "warning"
      : "neutral";

    return {
      suggestions: [
        {
          id: `suggest-${pageKey}-${options.context.projectId}`,
          tone,
          headline,
          meta: options.context.projectId ? `Project ${options.context.projectId}` : undefined,
          citations: result.citations
        }
      ]
    };
  } catch (error) {
    if (isForbiddenError(error)) {
      return { suggestions: [] };
    }
    throw error;
  }
}
