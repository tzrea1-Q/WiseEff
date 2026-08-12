import { ChatOpenAI } from "@langchain/openai";

import type { LogAnalysisAdapter } from "../analyzer";
import { createDeterministicLogAnalysisModel } from "./deterministicModel";
import {
  createLlmLogAnalyzer,
  LogAnalysisProviderError,
  LOG_ANALYSIS_DETERMINISTIC_MODEL,
  type LogAnalysisChatModel,
  type LogAnalysisLlmTelemetry
} from "./llmAnalyzer";

export type LogAnalyzerEnv = {
  LOG_ANALYSIS_API_BASE_URL?: string;
  LOG_ANALYSIS_MODEL?: string;
  LOG_ANALYSIS_API_KEY?: string;
  LOG_ANALYSIS_API_TIMEOUT_MS: number;
  LOG_ANALYSIS_TOKEN_BUDGET: number;
  LOG_ANALYSIS_DETERMINISTIC: boolean;
};

function readNonBlank(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function resolveLogAnalysisModelLabel(env: Pick<LogAnalyzerEnv, "LOG_ANALYSIS_MODEL" | "LOG_ANALYSIS_DETERMINISTIC">) {
  if (env.LOG_ANALYSIS_DETERMINISTIC) {
    return LOG_ANALYSIS_DETERMINISTIC_MODEL;
  }
  return readNonBlank(env.LOG_ANALYSIS_MODEL) ?? "gpt-4o-mini";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return String(content ?? "");
}

function createChatOpenAiModel(env: LogAnalyzerEnv): LogAnalysisChatModel {
  const chat = new ChatOpenAI({
    model: resolveLogAnalysisModelLabel(env),
    apiKey: env.LOG_ANALYSIS_API_KEY,
    temperature: 0,
    timeout: env.LOG_ANALYSIS_API_TIMEOUT_MS,
    maxTokens: Math.min(2048, Math.max(256, Math.floor(env.LOG_ANALYSIS_TOKEN_BUDGET / 4))),
    configuration: {
      baseURL: env.LOG_ANALYSIS_API_BASE_URL
    }
  });

  return {
    async invoke(messages) {
      const response = await chat.invoke(messages.map((message) => ({ role: message.role, content: message.content })));
      return {
        content: contentToText(response.content),
        usage: {
          inputTokens: response.usage_metadata?.input_tokens,
          outputTokens: response.usage_metadata?.output_tokens
        }
      };
    }
  };
}

function createUnconfiguredModel(): LogAnalysisChatModel {
  return {
    async invoke() {
      throw new LogAnalysisProviderError(
        "Log analysis LLM is not configured. Set LOG_ANALYSIS_API_BASE_URL and LOG_ANALYSIS_API_KEY, or LOG_ANALYSIS_DETERMINISTIC=true for offline mode."
      );
    }
  };
}

/**
 * Builds the default `LogAnalysisAdapter` for the worker: the single-shot LLM analyzer
 * with the rule engine as its degradation fallback. An unconfigured provider behaves
 * like an unavailable one — retries, then an honestly marked rules-fallback report.
 */
export function createLogAnalyzerFromEnv(
  env: LogAnalyzerEnv,
  options: { telemetry?: LogAnalysisLlmTelemetry } = {}
): LogAnalysisAdapter {
  const modelLabel = resolveLogAnalysisModelLabel(env);
  const model = env.LOG_ANALYSIS_DETERMINISTIC
    ? createDeterministicLogAnalysisModel()
    : readNonBlank(env.LOG_ANALYSIS_API_BASE_URL) && readNonBlank(env.LOG_ANALYSIS_API_KEY)
      ? createChatOpenAiModel(env)
      : createUnconfiguredModel();

  return createLlmLogAnalyzer({
    model,
    modelLabel,
    tokenBudget: env.LOG_ANALYSIS_TOKEN_BUDGET,
    telemetry: options.telemetry
  });
}
