import type { LiveAgentFetch, LiveAgentTransport } from "./liveProvider";
import { createDeterministicAgentProvider } from "./provider";
import { createHttpLiveAgentTransport, createLiveAgentProvider, createOpenAiCompatibleAgentTransport } from "./liveProvider";
import type { AgentProvider } from "./provider";

export type AgentProviderEnv = {
  NODE_ENV?: "development" | "test" | "production";
  AGENT_PROVIDER?: "deterministic" | "live";
  AGENT_API_FORMAT?: "wiseeff" | "openai";
  AGENT_MODEL?: string;
  AGENT_API_KEY?: string;
  AGENT_API_BASE_URL?: string;
  AGENT_API_TIMEOUT_MS?: number;
  AGENT_PROMPT_VERSION?: string;
};

export function createAgentProviderFromEnv(
  env: AgentProviderEnv,
  options: { transport?: LiveAgentTransport; fetchImpl?: LiveAgentFetch } = {}
): AgentProvider {
  const providerMode = env.AGENT_PROVIDER ?? "deterministic";

  if (env.NODE_ENV === "production" && providerMode !== "live") {
    throw new Error("AGENT_PROVIDER=live is required in production.");
  }

  if (providerMode === "deterministic") {
    return createDeterministicAgentProvider();
  }

  if (!env.AGENT_MODEL?.trim()) {
    throw new Error("AGENT_MODEL is required when AGENT_PROVIDER=live");
  }
  if (!env.AGENT_API_KEY?.trim()) {
    throw new Error("AGENT_API_KEY is required when AGENT_PROVIDER=live");
  }
  if (!env.AGENT_API_BASE_URL?.trim()) {
    throw new Error("AGENT_API_BASE_URL is required when AGENT_PROVIDER=live");
  }

  return createLiveAgentProvider({
    model: env.AGENT_MODEL,
    apiKey: env.AGENT_API_KEY,
    promptVersion: env.AGENT_PROMPT_VERSION ?? "m5-agent-v1",
    transport:
      options.transport ??
      (env.AGENT_API_FORMAT === "openai" ? createOpenAiCompatibleAgentTransport : createHttpLiveAgentTransport)({
        baseUrl: env.AGENT_API_BASE_URL,
        apiKey: env.AGENT_API_KEY,
        model: env.AGENT_MODEL,
        promptVersion: env.AGENT_PROMPT_VERSION ?? "m5-agent-v1",
        timeoutMs: env.AGENT_API_TIMEOUT_MS,
        fetchImpl: options.fetchImpl
      })
  });
}
