import type { LiveAgentFetch, LiveAgentTransport } from "./liveProvider";
import { createDeterministicAgentProvider } from "./provider";
import { createHttpLiveAgentTransport, createLiveAgentProvider, createOpenAiCompatibleAgentTransport } from "./liveProvider";
import type { AgentProvider } from "./provider";
import { createPiAgentProvider, type PiComplete, type PiModelResolver } from "./piProvider";

export type AgentProviderEnv = {
  NODE_ENV?: "development" | "test" | "production";
  AGENT_PROVIDER?: "deterministic" | "live";
  AGENT_API_FORMAT?: "wiseeff" | "openai" | "pi";
  AGENT_PI_PROVIDER?: string;
  AGENT_MODEL?: string;
  AGENT_API_KEY?: string;
  AGENT_API_BASE_URL?: string;
  AGENT_API_TIMEOUT_MS?: number;
  AGENT_PROMPT_VERSION?: string;
};

export function createAgentProviderFromEnv(
  env: AgentProviderEnv,
  options: {
    transport?: LiveAgentTransport;
    fetchImpl?: LiveAgentFetch;
    pi?: { resolveModel?: PiModelResolver; complete?: PiComplete };
  } = {}
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
  if (env.AGENT_API_FORMAT === "pi") {
    if (!env.AGENT_PI_PROVIDER?.trim()) {
      throw new Error("AGENT_PI_PROVIDER is required when AGENT_API_FORMAT=pi");
    }
    return createPiAgentProvider({
      piProvider: env.AGENT_PI_PROVIDER,
      model: env.AGENT_MODEL,
      apiKey: env.AGENT_API_KEY,
      promptVersion: env.AGENT_PROMPT_VERSION ?? "m7-pi-agent-v1",
      timeoutMs: env.AGENT_API_TIMEOUT_MS,
      resolveModel: options.pi?.resolveModel,
      complete: options.pi?.complete
    });
  }
  if (!env.AGENT_API_BASE_URL?.trim()) {
    throw new Error(`AGENT_API_BASE_URL is required when AGENT_API_FORMAT=${env.AGENT_API_FORMAT ?? "wiseeff"}`);
  }

  return createLiveAgentProvider({
    model: env.AGENT_MODEL,
    apiKey: env.AGENT_API_KEY,
    promptVersion: env.AGENT_PROMPT_VERSION ?? "m5-agent-v1",
    format: env.AGENT_API_FORMAT === "openai" ? "openai" : "wiseeff",
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
