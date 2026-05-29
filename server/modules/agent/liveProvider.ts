import { ApiError } from "../../shared/http/errors";
import type { AgentCitation, AgentContext, AgentToolName } from "./types";
import type {
  AgentProvider,
  AgentProviderHealth,
  AgentProviderInput,
  AgentProviderPlan,
  AgentProviderSafety,
  AgentProviderUsage,
  AgentToolRequest
} from "./provider";

export type LiveAgentTransportPlanResult = {
  content: string;
  toolRequests?: AgentToolRequest[];
  citations?: AgentCitation[];
  confidence?: number;
  usage?: AgentProviderUsage;
  latencyMs?: number;
  safety?: AgentProviderSafety;
};

export type LiveAgentTransport = {
  planTurn(input: {
    model: string;
    promptVersion: string;
    apiKey: string;
    context: AgentContext;
    message: string;
  }): Promise<LiveAgentTransportPlanResult> | LiveAgentTransportPlanResult;
  checkHealth?(): Promise<AgentProviderHealth> | AgentProviderHealth;
};

export type LiveAgentFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class LiveAgentProviderOutageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveAgentProviderOutageError";
  }
}

export class LiveAgentProviderContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveAgentProviderContractError";
  }
}

const KNOWN_TOOL_NAMES = new Set<AgentToolName>([
  "parameter.scanOrphans",
  "parameter.draftCleanupPlan",
  "parameter.summarizeReviewQueue",
  "parameter.submitChangeDraft",
  "log.explainRootCause",
  "log.generateChecklist",
  "debugging.recommendTargetValues",
  "debugging.prepareRollback",
  "audit.summarizeRecentEvents"
]);

const MUTATING_TOOL_NAMES = new Set<AgentToolName>(["parameter.submitChangeDraft"]);
const WRITE_ADJACENT_TOOL_NAMES = new Set<AgentToolName>([
  "parameter.draftCleanupPlan",
  "parameter.submitChangeDraft",
  "log.generateChecklist",
  "debugging.prepareRollback"
]);

function normalizeCitations(citations: AgentCitation[] | undefined) {
  return citations ?? [];
}

function normalizeToolRequests(toolRequests: AgentToolRequest[] | undefined) {
  return toolRequests ?? [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contractError(message: string) {
  return new LiveAgentProviderContractError(message);
}

function readString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw contractError(`Live Agent provider returned invalid ${field}.`);
  }
  return value;
}

function readOptionalFiniteNumber(
  value: unknown,
  field: string,
  options: { integer?: boolean; minimum?: number } = {}
) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw contractError(`Live Agent provider returned invalid ${field}.`);
  }
  const numeric = value;
  if (!Number.isFinite(numeric) || (options.integer && !Number.isInteger(numeric)) || numeric < (options.minimum ?? 0)) {
    throw contractError(`Live Agent provider returned invalid ${field}.`);
  }
  return numeric;
}

function readCitation(value: unknown, index: number): AgentCitation {
  if (!isPlainObject(value)) {
    throw contractError(`Live Agent provider returned invalid citations[${index}].`);
  }
  return {
    type: readString(value.type, `citations[${index}].type`) as AgentCitation["type"],
    id: readString(value.id, `citations[${index}].id`),
    label: readString(value.label, `citations[${index}].label`)
  };
}

function readToolRequest(value: unknown, index: number): AgentToolRequest {
  if (!isPlainObject(value)) {
    throw contractError(`Live Agent provider returned invalid toolRequests[${index}].`);
  }
  return {
    name: readString(value.name, `toolRequests[${index}].name`) as AgentToolRequest["name"],
    label: readString(value.label, `toolRequests[${index}].label`),
    payload: isPlainObject(value.payload) ? value.payload : {}
  };
}

function readSafety(value: unknown): AgentProviderSafety {
  if (value === undefined) {
    throw contractError("Live Agent provider returned invalid safety.");
  }
  if (!isPlainObject(value)) {
    throw contractError("Live Agent provider returned invalid safety.");
  }

  const status = value.status;
  if (status !== "safe" && status !== "unsafe" && status !== "failed") {
    throw contractError("Live Agent provider returned invalid safety.status.");
  }

  const reasonsValue = value.reasons;
  if (!Array.isArray(reasonsValue) || reasonsValue.some((reason) => typeof reason !== "string" || !reason.trim())) {
    throw contractError("Live Agent provider returned invalid safety.reasons.");
  }

  return {
    status,
    reasons: reasonsValue
  };
}

function normalizeProviderHealth(value: unknown): AgentProviderHealth {
  if (!isPlainObject(value)) {
    throw contractError("Live Agent provider returned invalid health.");
  }
  if (typeof value.ok !== "boolean") {
    throw contractError("Live Agent provider returned invalid health.ok.");
  }
  if (value.status !== "ready" && value.status !== "failed") {
    throw contractError("Live Agent provider returned invalid health.status.");
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    throw contractError("Live Agent provider returned invalid health.message.");
  }

  return {
    ok: value.ok,
    status: value.status,
    message: value.message
  };
}

type NormalizedLiveAgentTransportResult = Required<
  Pick<LiveAgentTransportPlanResult, "content" | "toolRequests" | "citations" | "safety">
> &
  Pick<LiveAgentTransportPlanResult, "confidence" | "usage" | "latencyMs">;

function normalizeTransportResult(result: unknown): NormalizedLiveAgentTransportResult {
  if (!isPlainObject(result)) {
    throw contractError("Live Agent provider returned an invalid response.");
  }

  const content = readString(result.content, "content");
  const toolRequestsValue = result.toolRequests;
  if (toolRequestsValue !== undefined && !Array.isArray(toolRequestsValue)) {
    throw contractError("Live Agent provider returned malformed toolRequests.");
  }
  const citationsValue = result.citations;
  if (citationsValue !== undefined && !Array.isArray(citationsValue)) {
    throw contractError("Live Agent provider returned invalid citations.");
  }

  const normalizedToolRequests = (toolRequestsValue ?? []).map((toolRequest, index) => readToolRequest(toolRequest, index));
  const normalizedCitations = (citationsValue ?? []).map((citation, index) => readCitation(citation, index));
  const confidence = readOptionalFiniteNumber(result.confidence, "confidence", { minimum: 0 });
  const usageValue = result.usage;
  let usage: AgentProviderUsage | undefined;
  if (usageValue !== undefined) {
    if (!isPlainObject(usageValue)) {
      throw contractError("Live Agent provider returned invalid usage.");
    }
    usage = {
      inputTokens: readOptionalFiniteNumber(usageValue.inputTokens, "usage.inputTokens", { integer: true, minimum: 0 }),
      outputTokens: readOptionalFiniteNumber(usageValue.outputTokens, "usage.outputTokens", { integer: true, minimum: 0 }),
      estimatedCostUsd: readOptionalFiniteNumber(usageValue.estimatedCostUsd, "usage.estimatedCostUsd", { minimum: 0 })
    };
  }

  return {
    content,
    toolRequests: normalizedToolRequests,
    citations: normalizedCitations,
    confidence,
    usage,
    latencyMs: readOptionalFiniteNumber(result.latencyMs, "latencyMs", { integer: true, minimum: 0 }),
    safety: readSafety(result.safety)
  };
}

function isWriteAdjacentPlan(result: LiveAgentTransportPlanResult) {
  const toolRequests = normalizeToolRequests(result.toolRequests);
  return toolRequests.some((request) => WRITE_ADJACENT_TOOL_NAMES.has(request.name));
}

function isGroundedPlan(result: LiveAgentTransportPlanResult) {
  const toolRequests = normalizeToolRequests(result.toolRequests);
  const hasMutatingRequest = toolRequests.some((request) => MUTATING_TOOL_NAMES.has(request.name));
  if (!hasMutatingRequest) {
    return true;
  }

  const hasCitations = normalizeCitations(result.citations).length > 0;
  return hasCitations && result.safety?.status === "safe";
}

function validateToolRequests(toolRequests: AgentToolRequest[]) {
  for (const request of toolRequests) {
    if (!KNOWN_TOOL_NAMES.has(request.name)) {
      throw new Error(`Live Agent provider returned an unknown tool name: ${request.name}.`);
    }
  }
}

export function createUnavailableLiveAgentTransport(message = "Live Agent provider transport is not configured."): LiveAgentTransport {
  return {
    planTurn: async () => {
      throw new LiveAgentProviderOutageError(message);
    },
    checkHealth: async () => ({
      ok: false,
      status: "failed",
      message
    })
  };
}

function createRequestTimeoutController(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear() {
      clearTimeout(timeout);
    }
  };
}

async function readJsonResponse<T>(response: Response, errorPrefix: string): Promise<T> {
  const text = await response.text().catch(() => "");
  const message = `${errorPrefix} ${response.status} ${response.statusText}`.trim();

  if (!response.ok) {
    if (response.status >= 500) {
      throw new LiveAgentProviderOutageError(message);
    }
    throw contractError(message);
  }

  if (!text.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw contractError(`${errorPrefix} returned malformed JSON.`);
  }
}

export function createHttpLiveAgentTransport(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  promptVersion: string;
  timeoutMs?: number;
  fetchImpl?: LiveAgentFetch;
}): LiveAgentTransport {
  const baseUrl = new URL(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 5000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const authorization = `Bearer ${options.apiKey}`;

  async function requestJson<T>(
    path: string,
    init: RequestInit & { body?: string } = {}
  ): Promise<T> {
    const { controller, clear } = createRequestTimeoutController(timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        ...init,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization,
          "content-type": "application/json",
          "x-wiseeff-agent-model": options.model,
          "x-wiseeff-agent-prompt-version": options.promptVersion,
          ...(init.headers ?? {})
        }
      });
      return await readJsonResponse<T>(response, `Live Agent provider request failed for ${path}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Live Agent provider request timed out after ${timeoutMs}ms.`);
      }
      throw error instanceof Error ? error : new Error("Live Agent provider request failed.");
    } finally {
      clear();
    }
  }

  return {
    async planTurn(input) {
      return requestJson<LiveAgentTransportPlanResult>("/agent/plan-turn", {
        method: "POST",
        body: JSON.stringify({
          model: options.model,
          promptVersion: options.promptVersion,
          context: input.context,
          message: input.message
        })
      });
    },
    async checkHealth() {
      try {
        const health = await requestJson<unknown>("/agent/health", { method: "GET" });
        return normalizeProviderHealth(health);
      } catch (error) {
        if (error instanceof LiveAgentProviderContractError) {
          throw error;
        }
        return {
          ok: false,
          status: "failed",
          message: error instanceof Error ? error.message : "Live Agent provider health check failed."
        };
      }
    }
  };
}

export function createLiveAgentProvider(options: {
  model: string;
  apiKey: string;
  promptVersion: string;
  transport: LiveAgentTransport;
}): AgentProvider {
  const metadata = {
    provider: "live",
    model: options.model,
    promptVersion: options.promptVersion
  } as const;

  return {
    metadata: () => metadata,
    async checkHealth() {
      if (!options.transport.checkHealth) {
        return {
          ok: false,
          status: "failed",
          message: "Live Agent provider transport health check is not configured."
        };
      }

      try {
        const result = await options.transport.checkHealth();
        return normalizeProviderHealth(result);
      } catch (error) {
        if (error instanceof LiveAgentProviderContractError) {
          throw error;
        }
        return {
          ok: false,
          status: "failed",
          message: error instanceof Error ? error.message : "Live Agent provider health check failed."
        };
      }
    },
    async planTurn(input: AgentProviderInput): Promise<AgentProviderPlan> {
      let result: LiveAgentTransportPlanResult;
      try {
        result = await options.transport.planTurn({
          model: options.model,
          promptVersion: options.promptVersion,
          apiKey: options.apiKey,
          context: input.context,
          message: input.message
        });
      } catch (error) {
        if (error instanceof LiveAgentProviderOutageError) {
          throw error;
        }
        if (error instanceof LiveAgentProviderContractError) {
          throw error;
        }
        throw new LiveAgentProviderOutageError(error instanceof Error ? error.message : "Live Agent provider failed.");
      }

      const normalizedResult = normalizeTransportResult(result);
      const toolRequests = normalizedResult.toolRequests;
      validateToolRequests(toolRequests);

      const hasWriteAdjacentRequest = isWriteAdjacentPlan({ ...normalizedResult, toolRequests });
      const hasCitations = normalizedResult.citations.length > 0;
      const safetyStatus = normalizedResult.safety.status;

      if (hasWriteAdjacentRequest && (!hasCitations || safetyStatus !== "safe")) {
        throw new ApiError(
          "VALIDATION_FAILED",
          hasWriteAdjacentRequest && toolRequests.some((request) => MUTATING_TOOL_NAMES.has(request.name))
            ? "Live Agent provider returned an unsafe ungrounded mutating request."
            : "Live Agent provider returned an unsafe ungrounded write-adjacent request.",
          400,
          {
            toolRequests: toolRequests.map((request) => request.name),
            citations: normalizedResult.citations.map((citation) => citation.id)
          }
        );
      }

      if (!isGroundedPlan({ ...normalizedResult, toolRequests }) && safetyStatus !== "safe") {
        throw new ApiError("VALIDATION_FAILED", "Live Agent provider returned an unsafe ungrounded request.", 400, {
          toolRequests: toolRequests.map((request) => request.name),
          citations: normalizedResult.citations.map((citation) => citation.id)
        });
      }

      return {
        assistantDraft: {
          content: normalizedResult.content,
          citations: normalizedResult.citations,
          confidence: normalizedResult.confidence
        },
        toolRequests,
        ...metadata,
        latencyMs: normalizedResult.latencyMs,
        usage: normalizedResult.usage,
        safety: normalizedResult.safety
      };
    }
  };
}
