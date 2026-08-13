import { ChatOpenAI } from "@langchain/openai";

import type { KnowledgeEmbeddingClient } from "../../knowledge/indexing/embeddingClient";
import type { Queryable } from "../../../shared/database/client";
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
import { createDbLogAnalysisToolBackends } from "./tools/dbToolBackends";

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

function createChatOpenAiModel(env: LogAnalyzerEnv, modelLabel: string): LogAnalysisChatModel {
  const chat = new ChatOpenAI({
    model: modelLabel,
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

export type CreateLogAnalyzerFromEnvOptions = {
  telemetry?: LogAnalysisLlmTelemetry;
  /**
   * Database handle for the loop kernel's organization-scoped tool backends
   * (`read_domain_knowledge`, `get_related_parameter_context`). Absent (offline
   * eval, unit tests) the two tools honestly report themselves unavailable.
   */
  db?: Queryable;
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
 * Per-domain model override (P3b): when the analyzed record's log domain carries
 * `modelOverride`, ONLY the model name is swapped — endpoint, API key, timeout,
 * and token budget stay global. The effective label flows into the report's
 * `model` provenance and the `model`-labelled metrics unchanged. In
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

  function resolveModel(modelLabel: string): LogAnalysisChatModel {
    const cached = modelsByLabel.get(modelLabel);
    if (cached) {
      return cached;
    }
    const model = env.LOG_ANALYSIS_DETERMINISTIC
      ? useLoopKernel
        ? createDeterministicLogAnalysisLoopModel()
        : createDeterministicLogAnalysisModel()
      : providerConfigured
        ? createChatOpenAiModel(env, modelLabel)
        : createUnconfiguredModel();
    modelsByLabel.set(modelLabel, model);
    return model;
  }

  function createKernel(modelLabel: string): LogAnalysisAdapter {
    const model = resolveModel(modelLabel);
    if (!useLoopKernel) {
      return createLlmLogAnalyzer({
        model,
        modelLabel,
        tokenBudget: env.LOG_ANALYSIS_TOKEN_BUDGET,
        telemetry: options.telemetry
      });
    }

    const db = options.db;
    return createAgentLoopLogAnalyzer({
      model,
      modelLabel,
      tokenBudget: env.LOG_ANALYSIS_TOKEN_BUDGET,
      maxSteps: env.LOG_ANALYSIS_MAX_STEPS,
      telemetry: options.telemetry,
      bindToolBackends: (input) =>
        db && input.organizationId
          ? createDbLogAnalysisToolBackends({
              db,
              organizationId: input.organizationId,
              logDomainId: input.logDomainId,
              relatedParameterId: input.relatedParameterId,
              embeddingClient: options.embeddingClient
            })
          : {}
    });
  }

  return {
    async analyze(input) {
      const modelLabel = readNonBlank(input.logDomain?.modelOverride) ?? globalModelLabel;
      return createKernel(modelLabel).analyze(input);
    }
  };
}
