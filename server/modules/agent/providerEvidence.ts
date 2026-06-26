export type AgentProviderFormat = "deterministic" | "wiseeff" | "openai" | "pi";

export type AgentProviderHealth = {
  ok: boolean;
  status: "ready" | "failed";
  message?: string;
};

export type AgentProvider = {
  metadata(): {
    provider: "deterministic" | "live";
    model: string;
    promptVersion: string;
    evidence?: AgentProviderEvidence;
  };
  planTurn(input: { context: unknown; message: string }): Promise<unknown> | unknown;
  checkHealth?(): Promise<AgentProviderHealth> | AgentProviderHealth;
};

export type AgentProviderEvidence = {

  provider: "deterministic" | "live";
  format: AgentProviderFormat;
  model: string;
  promptVersion: string;
  piProvider?: string;
};

const formats = new Set<AgentProviderFormat>(["deterministic", "wiseeff", "openai", "pi"]);

function readNonBlank(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function sanitizeAgentProviderEvidence(input: Partial<AgentProviderEvidence> | undefined): AgentProviderEvidence | undefined {
  if (!input) {
    return undefined;
  }

  if (input.provider !== "deterministic" && input.provider !== "live") {
    return undefined;
  }
  if (!formats.has(input.format as AgentProviderFormat)) {
    return undefined;
  }

  const model = readNonBlank(input.model);
  const promptVersion = readNonBlank(input.promptVersion);
  if (!model || !promptVersion) {
    return undefined;
  }

  const evidence: AgentProviderEvidence = {
    provider: input.provider,
    format: input.format as AgentProviderFormat,
    model,
    promptVersion
  };
  const piProvider = readNonBlank(input.piProvider);
  if (piProvider) {
    evidence.piProvider = piProvider;
  }

  return evidence;
}

export function toMetricLabels(evidence: AgentProviderEvidence) {
  return {
    provider: evidence.provider,
    format: evidence.format,
    ...(evidence.piProvider ? { piProvider: evidence.piProvider } : {})
  };
}
