import { ChatOpenAI } from "@langchain/openai";

import type { KnowledgeEmbeddingClient } from "../../knowledge/indexing/embeddingClient";
import type { Database } from "../../../shared/database/client";
import type { LogAnalysisAdapter } from "../analyzer";
import { createAgentLoopLogAnalyzer } from "./agentLoop";
import { createDeterministicLogAnalysisLoopModel, createDeterministicLogAnalysisModel } from "./deterministicModel";
import {
  createLlmLogAnalyzer,
  LogAnalysisProviderError,
  LOG_ANALYSIS_DETERMINISTIC_MODEL,
  type LogAnalysisChatModel,
  type LogAnalysisLlmTelemetry
} from "./llmAnalyzer";
import { createWorkerLogAnalysisToolBackends } from "./tools/workerToolBackends";

export type LogAnalyzerEnv = {
  LOG_ANALYSIS_API_BASE_URL?: string;
  LOG_ANALYSIS_MODEL?: string;
  LOG_ANALYSIS_API_KEY?: string;
  LOG_ANALYSIS_API_TIMEOUT_MS: number;
  LOG_ANALYSIS_TOKEN_BUDGET: number;
  LOG_ANALYSIS_DETERMINISTIC: boolean;
  /** P2: "loop" (default, multi-step agent) or "single-shot" (P1 kernel kept as a config fallback). */
  LOG_ANALYSIS_KERNEL: "loop" | "single-shot";
  LOG_ANALYSIS_MAX_STEPS: number;
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

function createChatOpenAiModel(env: LogAnalyzerEnv, modelLabel: string, tokenBudget: number): LogAnalysisChatModel {
  const chat = new ChatOpenAI({
    model: modelLabel,
    apiKey: env.LOG_ANALYSIS_API_KEY,
    temperature: 0,
    timeout: env.LOG_ANALYSIS_API_TIMEOUT_MS,
    maxTokens: Math.min(tokenBudget, 2048, Math.max(256, Math.floor(tokenBudget / 4))),
    configuration: {
      baseURL: env.LOG_ANALYSIS_API_BASE_URL
    }
  });

  return {
    async invoke(messages, options) {
      const response = await chat.invoke(messages.map((message) => ({ role: message.role, content: message.content })), options);
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

export type CreateLogAnalyzerFromEnvOptions = {
  telemetry?: LogAnalysisLlmTelemetry;
  /**
   * Database handle for the loop kernel's organization-scoped tool backends
   * (`read_domain_knowledge`, `get_related_parameter_context`). Absent (offline
   * eval, unit tests) the two tools honestly report themselves unavailable.
   */
  db?: Database;
  /** Embedding client for hybrid domain-knowledge retrieval; absent = FTS-only. */
  embeddingClient?: KnowledgeEmbeddingClient;
};

/**
 * Builds the default `LogAnalysisAdapter` for the worker. P2 default is the
 * bounded agent loop (`LOG_ANALYSIS_KERNEL=loop`); the P1 single-shot analyzer
 * stays available as a config fallback (`LOG_ANALYSIS_KERNEL=single-shot`).
 * Both share the rule engine as their degradation fallback, and an unconfigured
 * provider behaves like an unavailable one — retries, then an honestly marked
 * rules-fallback report.
 *
 * Pinned skill revisions may override the model name and reduce the platform
 * step/token budgets. Endpoint, API key and timeout stay global, and a platform
 * cap lowered after publication still bounds an older revision. The label flows
 * into the report's `model` provenance and the `model`-labelled metrics unchanged. In
 * deterministic mode the stub model still answers, but the label reflects the
 * override so behavior eval can assert the override is actually applied.
 */
export function createLogAnalyzerFromEnv(
  env: LogAnalyzerEnv,
  options: CreateLogAnalyzerFromEnvOptions = {}
): LogAnalysisAdapter {
  const globalModelLabel = resolveLogAnalysisModelLabel(env);
  const useLoopKernel = env.LOG_ANALYSIS_KERNEL === "loop";
  const providerConfigured = Boolean(readNonBlank(env.LOG_ANALYSIS_API_BASE_URL) && readNonBlank(env.LOG_ANALYSIS_API_KEY));
  const modelsByLabel = new Map<string, LogAnalysisChatModel>();

  function resolveModel(modelLabel: string, tokenBudget: number): LogAnalysisChatModel {
    const cacheKey = JSON.stringify([modelLabel, tokenBudget]);
    const cached = modelsByLabel.get(cacheKey);
    if (cached) {
      return cached;
    }
    const model = env.LOG_ANALYSIS_DETERMINISTIC
      ? useLoopKernel
        ? createDeterministicLogAnalysisLoopModel()
        : createDeterministicLogAnalysisModel()
      : providerConfigured
        ? createChatOpenAiModel(env, modelLabel, tokenBudget)
        : createUnconfiguredModel();
    modelsByLabel.set(cacheKey, model);
    return model;
  }

  function createKernel(modelLabel: string, stepBudget: number, tokenBudget: number, hasTokenBudgetOverride: boolean): LogAnalysisAdapter {
    const model = resolveModel(modelLabel, tokenBudget);
    if (!useLoopKernel) {
      return createLlmLogAnalyzer({
        model,
        modelLabel,
        tokenBudget,
        telemetry: options.telemetry
      });
    }

    const db = options.db;
    return createAgentLoopLogAnalyzer({
      model,
      modelLabel,
      tokenBudget,
      maxSteps: stepBudget,
      // Unset revision budgets retain the pre-skill global convergence behavior.
      enforceTokenBudgetBeforeCall: hasTokenBudgetOverride,
      telemetry: options.telemetry,
      bindToolBackends: (input) =>
        db && input.organizationId
          ? createWorkerLogAnalysisToolBackends({
              db,
              organizationId: input.organizationId,
              logDomainId: input.logDomainId,
              knowledgeEntryIds: input.knowledgeEntryIds,
              onKnowledgeRetrieved: input.onKnowledgeRetrieved,
              relatedParameterId: input.relatedParameterId,
              relatedParameterSnapshot: input.relatedParameterSnapshot,
              sourceSnapshot: input.sourceSnapshot,
              embeddingClient: options.embeddingClient
            })
          : {}
    });
  }

  return {
    async analyze(input) {
      const modelLabel = readNonBlank(input.logDomain?.modelOverride) ?? globalModelLabel;
      const stepBudget = Math.min(input.logDomain?.stepBudget ?? env.LOG_ANALYSIS_MAX_STEPS, env.LOG_ANALYSIS_MAX_STEPS);
      const tokenBudget = Math.min(input.logDomain?.tokenBudget ?? env.LOG_ANALYSIS_TOKEN_BUDGET, env.LOG_ANALYSIS_TOKEN_BUDGET);
      return createKernel(modelLabel, stepBudget, tokenBudget, input.logDomain?.tokenBudget !== undefined).analyze(input);
    }
  };
}
