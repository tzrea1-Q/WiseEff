import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createAgentProviderFromEnv } from "../server/modules/agent/providerRegistry";
import type { AgentProvider, AgentProviderMetadata, AgentProviderPlan } from "../server/modules/agent/provider";
import { sanitizeAgentProviderEvidence } from "../server/modules/agent/providerEvidence";
import { loadEnvContent } from "./run-m5-smoke.shared";

type RuntimeEnv = Record<string, string | undefined>;

export type PiAgentSmokeProvider = Pick<AgentProvider, "metadata" | "checkHealth" | "planTurn">;

export type ResolvedPiAgentSmokeEnv = {
  allowDeterministic: boolean;
  env: {
    AGENT_PROVIDER: "deterministic" | "live";
    AGENT_API_FORMAT: "pi";
    AGENT_PI_PROVIDER: string;
    AGENT_MODEL: string;
    AGENT_API_KEY: string;
    AGENT_API_TIMEOUT_MS: number;
    AGENT_PROMPT_VERSION: string;
  };
};

export type PiAgentSmokeEvidence = {
  ok: boolean;
  provider: AgentProviderMetadata["provider"];
  format: string;
  piProvider?: string;
  model: string;
  promptVersion: string;
  healthStatus: string;
  latencyMs?: number;
  usage?: AgentProviderPlan["usage"];
  toolRequests: number;
};

function requireValue(env: RuntimeEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required for Pi Agent smoke.`);
  }
  return value;
}

export function resolvePiAgentSmokeEnv(env: RuntimeEnv, argv: readonly string[] = []): ResolvedPiAgentSmokeEnv {
  const provider = env.AGENT_PROVIDER?.trim() || "deterministic";
  const allowDeterministic = argv.includes("--allow-deterministic");

  if (allowDeterministic) {
    return {
      allowDeterministic: true,
      env: {
        AGENT_PROVIDER: "deterministic",
        AGENT_API_FORMAT: "pi",
        AGENT_PI_PROVIDER: "deterministic",
        AGENT_MODEL: "deterministic",
        AGENT_API_KEY: "redacted",
        AGENT_API_TIMEOUT_MS: 30000,
        AGENT_PROMPT_VERSION: "m7-pi-agent-v1"
      }
    };
  }

  if (provider !== "live") {
    throw new Error("AGENT_PROVIDER=live is required for Pi Agent smoke.");
  }
  if ((env.AGENT_API_FORMAT?.trim() || "wiseeff") !== "pi") {
    throw new Error("AGENT_API_FORMAT=pi is required for Pi Agent smoke.");
  }

  return {
    allowDeterministic: false,
    env: {
      AGENT_PROVIDER: "live",
      AGENT_API_FORMAT: "pi",
      AGENT_PI_PROVIDER: requireValue(env, "AGENT_PI_PROVIDER"),
      AGENT_MODEL: requireValue(env, "AGENT_MODEL"),
      AGENT_API_KEY: requireValue(env, "AGENT_API_KEY"),
      AGENT_API_TIMEOUT_MS: Number.parseInt(env.AGENT_API_TIMEOUT_MS?.trim() || "30000", 10),
      AGENT_PROMPT_VERSION: env.AGENT_PROMPT_VERSION?.trim() || "m7-pi-agent-v1"
    }
  };
}

export function createPiAgentSmokeEvidence(input: PiAgentSmokeEvidence): PiAgentSmokeEvidence {
  return {
    ok: input.ok,
    provider: input.provider,
    format: input.format,
    ...(input.piProvider ? { piProvider: input.piProvider } : {}),
    model: input.model,
    promptVersion: input.promptVersion,
    healthStatus: input.healthStatus,
    ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
    ...(input.usage ? { usage: input.usage } : {}),
    toolRequests: input.toolRequests
  };
}

export function redactPiAgentSmokeEvidence(evidence: PiAgentSmokeEvidence) {
  return JSON.stringify(evidence, null, 2);
}

export async function runPiAgentSmoke(provider: PiAgentSmokeProvider): Promise<PiAgentSmokeEvidence> {
  if (!provider.checkHealth) {
    throw new Error("Pi Agent smoke requires provider health check support.");
  }

  const metadata = provider.metadata();
  const evidence = sanitizeAgentProviderEvidence(metadata.evidence);
  if (!evidence || evidence.format !== "pi") {
    throw new Error("Pi Agent smoke requires AGENT_API_FORMAT=pi provider evidence.");
  }

  const health = await provider.checkHealth();
  if (!health.ok) {
    throw new Error(health.message ?? "Pi Agent provider health check failed.");
  }

  const plan = await provider.planTurn({
    context: {
      path: "/agent-provider-smoke",
      pageKey: "agent-provider-smoke",
      projectId: "smoke",
      roleId: "admin"
    },
    message: "Reply with a one sentence readiness confirmation. Do not call tools."
  });

  if (plan.toolRequests.length !== 0) {
    throw new Error("Pi Agent smoke expected zero tool requests.");
  }

  return createPiAgentSmokeEvidence({
    ok: true,
    provider: metadata.provider,
    format: evidence.format,
    piProvider: evidence.piProvider,
    model: metadata.model,
    promptVersion: metadata.promptVersion,
    healthStatus: health.status,
    latencyMs: plan.latencyMs,
    usage: plan.usage,
    toolRequests: plan.toolRequests.length
  });
}

function loadRuntimeEnv(): RuntimeEnv {
  return existsSync(".env") ? loadEnvContent(readFileSync(".env", "utf8"), process.env) : process.env;
}

async function main() {
  const resolved = resolvePiAgentSmokeEnv(loadRuntimeEnv(), process.argv.slice(2));
  if (resolved.allowDeterministic) {
    console.log(
      redactPiAgentSmokeEvidence({
        ok: true,
        provider: "deterministic",
        format: "pi",
        piProvider: "deterministic",
        model: "deterministic",
        promptVersion: "m7-pi-agent-v1",
        healthStatus: "ready",
        toolRequests: 0
      })
    );
    return;
  }

  const provider = createAgentProviderFromEnv({
    NODE_ENV: (process.env.NODE_ENV as "development" | "test" | "production" | undefined) ?? "development",
    AGENT_PROVIDER: resolved.env.AGENT_PROVIDER,
    AGENT_API_FORMAT: resolved.env.AGENT_API_FORMAT,
    AGENT_PI_PROVIDER: resolved.env.AGENT_PI_PROVIDER,
    AGENT_MODEL: resolved.env.AGENT_MODEL,
    AGENT_API_KEY: resolved.env.AGENT_API_KEY,
    AGENT_API_TIMEOUT_MS: resolved.env.AGENT_API_TIMEOUT_MS,
    AGENT_PROMPT_VERSION: resolved.env.AGENT_PROMPT_VERSION
  });

  console.log(redactPiAgentSmokeEvidence(await runPiAgentSmoke(provider)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
