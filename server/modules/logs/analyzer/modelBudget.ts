import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import type { LogAnalysisChatMessage, LogAnalysisNativeTool } from "./llmAnalyzer";

export const MIN_LOG_ANALYSIS_OUTPUT_TOKENS = 128;

export function estimateLogTokens(text: string) {
  return Math.ceil(Buffer.byteLength(text) / 4);
}

export function estimateLogPromptTokens(messages: LogAnalysisChatMessage[], toolTokens = 0) {
  // ponytail: endpoint tokenizers vary. Use UTF-8 size plus message overhead for
  // admission, then reconcile with provider usage. Use exact token counts if an endpoint exposes them.
  return 8 + toolTokens + messages.reduce((total, message) => total + 4 + estimateLogTokens(message.content)
    + (message.role === "assistant" && message.toolCalls ? estimateLogTokens(JSON.stringify(message.toolCalls)) : 0)
    + (message.role === "tool" ? estimateLogTokens(message.toolCallId) : 0), 0);
}

export function estimateLogToolTokens(tools: LogAnalysisNativeTool[]) {
  return estimateLogTokens(JSON.stringify(tools.map((tool) => convertToOpenAITool(tool))));
}

/** Reasoning models spend output on thinking before a report, so large budgets allow 4,096 output tokens. */
export function logCompletionLimit(tokenBudget: number) {
  return Math.min(4096, Math.max(256, Math.floor(tokenBudget / 4)));
}
