import { ChatOpenAI, ChatOpenAICompletions } from "@langchain/openai";

import type { KnowledgeEmbeddingClient } from "../../knowledge/indexing/embeddingClient";
import type { Database } from "../../../shared/database/client";
import type { AnalyzeLogInput, LogAnalysisAdapter } from "../analyzer";
import type { LogAnalysisProtocol } from "../logAnalysisProtocol";
import { createAgentLoopLogAnalyzer } from "./agentLoop";
import { createDeterministicLogAnalysisLoopModel, createDeterministicLogAnalysisModel, deterministicConclusionVerifier } from "./deterministicModel";
import { VERIFIER_MAX_OUTPUT_TOKENS } from "./conclusionVerifier";
import {
  createLlmLogAnalyzer,
  LogAnalysisProviderError,
  LOG_ANALYSIS_DETERMINISTIC_MODEL,
  type LogAnalysisNativeCall,
  type LogAnalysisChatModel,
  type LogAnalysisLlmTelemetry
} from "./llmAnalyzer";
import { createWorkerLogAnalysisToolBackends } from "./tools/workerToolBackends";
import type { LogAnalysisToolContext } from "./tools/toolContext";
import { hasPastConclusions, searchPastConclusions } from "../pastConclusionsRepository";
import { logCompletionLimit } from "./modelBudget";

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
  LOG_ANALYSIS_REPAIR_JSON?: boolean;
  LOG_ANALYSIS_SINGLE_SHOT_FALLBACK?: boolean;
  LOG_ANALYSIS_PAST_CONCLUSIONS?: boolean;
  LOG_ANALYSIS_PROTOCOL?: LogAnalysisProtocol;
  LOG_ANALYSIS_HYPOTHESIS_LEDGER?: boolean;
  LOG_ANALYSIS_PROCEDURE_CHECKLIST?: boolean;
  LOG_ANALYSIS_VERIFY_CONCLUSION?: boolean;
  LOG_ANALYSIS_VERIFIER_MODEL?: string;
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

/**
 * Reasoning models (for example MiniMax-M3, DeepSeek-R1, Qwen3) can put their
 * reasoning in the reply as a leading `<think>…</think>` block. It is neither
 * the answer nor history worth resending; an unclosed block means truncation.
 */
function stripLeadingReasoning(text: string) {
  const stripped = text.replace(/^\s*(?:<think>[\s\S]*?<\/think>\s*)+/, "");
  return /^\s*<think>/.test(stripped) ? "" : stripped;
}

function createChatOpenAiModel(
  env: LogAnalyzerEnv, modelLabel: string, defaultMaxTokens: number
): LogAnalysisChatModel {
  const settings = {
    model: modelLabel,
    apiKey: env.LOG_ANALYSIS_API_KEY,
    temperature: 0,
    timeout: env.LOG_ANALYSIS_API_TIMEOUT_MS,
    maxRetries: 0,
    maxTokens: defaultMaxTokens,
    configuration: {
      baseURL: env.LOG_ANALYSIS_API_BASE_URL
    }
  };
  const chat = new ChatOpenAI(settings);
  const nativeChat = new ChatOpenAICompletions(settings);
  const readResponse = (response: Awaited<ReturnType<typeof chat.invoke>>) => ({
    content: stripLeadingReasoning(contentToText(response.content)),
    usage: {
      inputTokens: response.usage_metadata?.input_tokens,
      outputTokens: response.usage_metadata?.output_tokens
    }
  });

  return {
    async invoke(messages, options) {
      const maxTokens = Math.min(defaultMaxTokens, options?.maxOutputTokens ?? defaultMaxTokens);
      const client = maxTokens === defaultMaxTokens ? chat : new ChatOpenAI({ ...settings, maxTokens });
      const response = await client.invoke(messages.map((message) => ({ role: message.role, content: message.content })), { signal: options?.signal });
      return readResponse(response);
    },
    async invokeTools(messages, { tools, signal, maxOutputTokens }) {
      const maxTokens = Math.min(defaultMaxTokens, maxOutputTokens ?? defaultMaxTokens);
      const client = maxTokens === defaultMaxTokens ? nativeChat : new ChatOpenAICompletions({ ...settings, maxTokens });
      const response = await client.bindTools(tools).invoke(messages.map((message) => {
        const { role, content } = message;
        if (role === "assistant" && message.toolCalls) {
          return { role, content, additional_kwargs: { tool_calls: message.toolCalls.map(({ id, name, arguments: args }) =>
            ({ id, type: "function" as const, function: { name, arguments: args } })) } };
        }
        if (role === "tool") return { role, content, tool_call_id: message.toolCallId };
        return { role, content };
      }), { signal });
      // The raw list preserves provider order, including malformed argument strings.
      const toolCalls: LogAnalysisNativeCall[] = (response.additional_kwargs.tool_calls ?? []).map((call) =>
        call?.type === "function"
          ? { id: call.id, name: call.function?.name, arguments: call.function?.arguments }
          : { id: "", name: "", arguments: "" });
      return { ...readResponse(response), toolCalls };
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
  /** Scripted chat model for offline analyzer and eval runs. */
  model?: LogAnalysisChatModel;
  telemetry?: LogAnalysisLlmTelemetry;
  /**
   * Database handle for the loop kernel's organization-scoped tool backends
   * (`read_domain_knowledge`, `get_related_parameter_context`). Absent (offline
   * eval, unit tests) the two tools honestly report themselves unavailable.
   */
  db?: Database;
  /** Embedding client for hybrid domain-knowledge retrieval; absent = FTS-only. */
  embeddingClient?: KnowledgeEmbeddingClient;
  /** Offline eval fixture only. Database-backed runs always use the worker's scoped search. */
  bindOfflinePastConclusions?: (input: AnalyzeLogInput) => LogAnalysisToolContext["searchPastConclusions"];
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
  const verifiersByLabel = new Map<string, LogAnalysisChatModel>();

  function resolveVerifier(mainModelLabel: string) {
    if (!env.LOG_ANALYSIS_VERIFY_CONCLUSION) return undefined;
    const modelLabel = readNonBlank(env.LOG_ANALYSIS_VERIFIER_MODEL) ?? mainModelLabel;
    let model = verifiersByLabel.get(modelLabel);
    if (!model) {
      model = env.LOG_ANALYSIS_DETERMINISTIC ? deterministicConclusionVerifier
        : providerConfigured ? createChatOpenAiModel(env, modelLabel, VERIFIER_MAX_OUTPUT_TOKENS)
          : createUnconfiguredModel();
      verifiersByLabel.set(modelLabel, model);
    }
    return { model, modelLabel };
  }

  function resolveModel(modelLabel: string, tokenBudget: number, singleShotRetry = false): LogAnalysisChatModel {
    if (options.model) return options.model;
    const cacheKey = JSON.stringify([modelLabel, tokenBudget, singleShotRetry]);
    const cached = modelsByLabel.get(cacheKey);
    if (cached) {
      return cached;
    }
    const model = env.LOG_ANALYSIS_DETERMINISTIC
      ? useLoopKernel && !singleShotRetry
        ? createDeterministicLogAnalysisLoopModel(env.LOG_ANALYSIS_HYPOTHESIS_LEDGER)
        : createDeterministicLogAnalysisModel()
      : providerConfigured
        ? createChatOpenAiModel(env, modelLabel, logCompletionLimit(tokenBudget))
        : createUnconfiguredModel();
    modelsByLabel.set(cacheKey, model);
    return model;
  }

  function createKernel(modelLabel: string, stepBudget: number, tokenBudget: number,
    protocol: LogAnalysisProtocol): LogAnalysisAdapter {
    const singleShot = (retry: boolean) => createLlmLogAnalyzer({
      model: resolveModel(modelLabel, tokenBudget, retry),
      modelLabel,
      tokenBudget,
      repairJsonOutput: env.LOG_ANALYSIS_REPAIR_JSON,
      telemetry: options.telemetry
    });
    if (!useLoopKernel) return singleShot(false);

    const db = options.db;
    return createAgentLoopLogAnalyzer({
      model: resolveModel(modelLabel, tokenBudget),
      modelLabel,
      tokenBudget,
      maxSteps: stepBudget,
      protocol,
      hypothesisLedger: env.LOG_ANALYSIS_HYPOTHESIS_LEDGER,
      procedureChecklist: env.LOG_ANALYSIS_PROCEDURE_CHECKLIST,
      verifier: resolveVerifier(modelLabel),
      endpoint: providerConfigured && !env.LOG_ANALYSIS_DETERMINISTIC ? env.LOG_ANALYSIS_API_BASE_URL : undefined,
      repairJsonOutput: env.LOG_ANALYSIS_REPAIR_JSON,
      telemetry: options.telemetry,
      recoverInvalidModelOutput: env.LOG_ANALYSIS_SINGLE_SHOT_FALLBACK ? async (input, remainingTokens) => {
        try {
          const report = await singleShot(true).tryAnalyze(input, remainingTokens);
          return typeof report === "object" ? { ...report, analysisSource: "single-shot-fallback", confidence: Math.min(report.confidence, 0.5) } : report;
        } catch (error) {
          input.signal?.throwIfAborted();
          // Provider failure during recovery goes straight to rules, preserving the loop's reason.
          if (!(error instanceof LogAnalysisProviderError)) throw error;
          return undefined;
        }
      } : undefined,
      bindToolBackends: async (input) => {
        if (!db) return { searchPastConclusions: env.LOG_ANALYSIS_PAST_CONCLUSIONS ? options.bindOfflinePastConclusions?.(input) : undefined };
        if (!input.organizationId) return {};
        const scope = env.LOG_ANALYSIS_PAST_CONCLUSIONS && input.logDomainId && input.pastConclusionScope
          ? { ...input.pastConclusionScope, organizationId: input.organizationId, skillId: input.logDomainId } : undefined;
        const available = scope && await hasPastConclusions(db, scope).catch(() => false);
        input.signal?.throwIfAborted();
        return {
          ...createWorkerLogAnalysisToolBackends({
            db,
            organizationId: input.organizationId,
            logDomainId: input.logDomainId,
            knowledgeEntryIds: input.knowledgeEntryIds,
            onKnowledgeRetrieved: input.onKnowledgeRetrieved,
            relatedParameterId: input.relatedParameterId,
            relatedParameterSnapshot: input.relatedParameterSnapshot,
            sourceSnapshot: input.sourceSnapshot,
            embeddingClient: options.embeddingClient
          }),
          ...(scope && available ? {
            searchPastConclusions: (params) => searchPastConclusions(db, scope, params)
          } : {})
        };
      }
    });
  }

  return {
    async analyze(input) {
      const modelLabel = readNonBlank(input.logDomain?.modelOverride) ?? globalModelLabel;
      const stepBudget = Math.min(input.logDomain?.stepBudget ?? env.LOG_ANALYSIS_MAX_STEPS, env.LOG_ANALYSIS_MAX_STEPS);
      const tokenBudget = Math.min(input.logDomain?.tokenBudget ?? env.LOG_ANALYSIS_TOKEN_BUDGET, env.LOG_ANALYSIS_TOKEN_BUDGET);
      const platform = env.LOG_ANALYSIS_PROTOCOL ?? "auto";
      const override = input.logDomain?.protocolOverride;
      const protocol = platform === "auto" || override === "json" ? override ?? platform : platform;
      return createKernel(modelLabel, stepBudget, tokenBudget, protocol).analyze(input);
    }
  };
}
