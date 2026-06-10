import type { AgentContext, AgentMessageDto, AgentToolName } from "./types";
import type { AgentProviderEvidence } from "./providerEvidence";
import { sanitizeAgentProviderEvidence } from "./providerEvidence";

export type AgentToolRequest = {
  name: AgentToolName;
  label: string;
  payload: Record<string, unknown>;
};

export type AgentProviderInput = {
  context: AgentContext;
  message: string;
};

export type AgentProviderMetadata = {
  provider: "deterministic" | "live";
  model: string;
  promptVersion: string;
  evidence?: AgentProviderEvidence;
};

export type AgentProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
};

export type AgentProviderSafety = {
  status: "safe" | "unsafe" | "failed";
  reasons: string[];
};

export type AgentProviderHealth = {
  ok: boolean;
  status: "ready" | "failed";
  message?: string;
};

export type AgentProviderPlan = {
  assistantDraft: Pick<AgentMessageDto, "content" | "citations" | "confidence">;
  toolRequests: AgentToolRequest[];
  provider: "deterministic" | "live";
  model: string;
  promptVersion: string;
  latencyMs?: number;
  usage?: AgentProviderUsage;
  safety?: AgentProviderSafety;
  fallbackReason?: string;
};

export type AgentProvider = {
  metadata(): AgentProviderMetadata;
  planTurn(input: AgentProviderInput): Promise<AgentProviderPlan> | AgentProviderPlan;
  checkHealth?(): Promise<AgentProviderHealth> | AgentProviderHealth;
};

function includesAny(text: string, words: string[]) {
  const normalized = text.toLowerCase();
  return words.some((word) => normalized.includes(word.toLowerCase()));
}

export function createDeterministicAgentProvider(): AgentProvider {
  const metadata = {
    provider: "deterministic",
    model: "wiseeff-rules-m4",
    promptVersion: "m4-agent-v1",
    evidence: sanitizeAgentProviderEvidence({
      provider: "deterministic",
      format: "deterministic",
      model: "wiseeff-rules-m4",
      promptVersion: "m4-agent-v1"
    })
  } as const;

  return {
    metadata: () => metadata,
    planTurn(input: AgentProviderInput): AgentProviderPlan {
      const toolRequests: AgentToolRequest[] = [];
      const projectId = input.context.projectId;
      const pageKey = input.context.pageKey;

      if (pageKey.includes("parameter")) {
        toolRequests.push({
          name: "parameter.summarizeReviewQueue",
          label: "Summarize review queue",
          payload: { projectId }
        });
      }
      if (pageKey === "parameter-admin" || includesAny(input.message, ["闲置", "orphan", "cleanup"])) {
        toolRequests.push({
          name: "parameter.scanOrphans",
          label: "Scan orphan parameters",
          payload: { projectId }
        });
      }
      if (includesAny(input.message, ["草稿", "draft", "修改"])) {
        toolRequests.push({
          name: "parameter.submitChangeDraft",
          label: "Create parameter draft",
          payload: { projectId, reason: input.message }
        });
      }
      if (pageKey.includes("log")) {
        toolRequests.push({
          name: "log.explainRootCause",
          label: "Explain root cause",
          payload: { projectId }
        });
      }
      if (pageKey.includes("debugging")) {
        toolRequests.push({
          name: "debugging.recommendTargetValues",
          label: "Recommend target values",
          payload: { projectId }
        });
      }
      if (includesAny(input.message, ["审计", "audit", "治理"])) {
        toolRequests.push({
          name: "audit.summarizeRecentEvents",
          label: "Summarize recent audit events",
          payload: { projectId }
        });
      }

      return {
        assistantDraft: {
          content: "我会基于当前页面上下文调用受控工具，并把需要人工批准的动作单独列出。",
          citations: [],
          confidence: 0.78
        },
        toolRequests,
        ...metadata
      };
    }
  };
}
