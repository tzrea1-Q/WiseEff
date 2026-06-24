import {
  complete as defaultComplete,
  getModel as defaultGetModel,
  Type,
  type AssistantMessage,
  type Context,
  type Model,
  type ProviderStreamOptions,
  type Tool
} from "@earendil-works/pi-ai";
import { ApiError } from "../../shared/http/errors";
import type { AgentCitation, AgentToolName } from "./types";
import type { AgentProvider, AgentProviderPlan, AgentProviderUsage, AgentToolRequest } from "./provider";
import { sanitizeAgentProviderEvidence } from "./providerEvidence";
import { LiveAgentProviderOutageError } from "./liveProvider";

export type PiAssistantMessage = Pick<
  AssistantMessage,
  "role" | "content" | "usage" | "provider" | "model" | "api" | "stopReason" | "timestamp"
>;
export type PiModelResolver = (provider: string, model: string) => Model<any> | undefined;
export type PiComplete = (
  model: Model<any>,
  context: Context,
  options?: ProviderStreamOptions
) => Promise<PiAssistantMessage>;

export type PiAgentProviderOptions = {
  piProvider: string;
  model: string;
  apiKey: string;
  promptVersion: string;
  timeoutMs?: number;
  resolveModel?: PiModelResolver;
  complete?: PiComplete;
};

type ToolMetadata = {
  label: string;
  writeAdjacent: boolean;
  mutating: boolean;
  normalize(args: Record<string, unknown>): Record<string, unknown>;
};

const DEFAULT_CONFIDENCE = 0.72;
const CITATION_BLOCK_PATTERN = /```wiseeff-citations\s*[\s\S]*?```/gi;

const SYSTEM_PROMPT = [
  "You are WiseEff's enterprise efficiency assistant.",
  "Reply with concise operator guidance.",
  "Use only the provided WiseEff tools.",
  "Do not claim that a tool action has executed.",
  "Approval-required work must be represented as a tool request, not as completed work."
].join(" ");

const TOOL_METADATA: Record<AgentToolName, ToolMetadata> = {
  "parameter.scanOrphans": {
    label: "Scan orphan parameters",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "parameter.draftCleanupPlan": {
    label: "Draft cleanup plan",
    writeAdjacent: true,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "parameter.summarizeReviewQueue": {
    label: "Summarize review queue",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "parameter.submitChangeDraft": {
    label: "Submit change draft",
    writeAdjacent: true,
    mutating: true,
    normalize(args) {
      const projectId = readOptionalString(args.projectId);
      const parameterId = readOptionalString(args.parameterId);
      const targetValue = readOptionalString(args.targetValue);
      const reason = readRequiredString(args.reason);

      return dropUndefined({ projectId, parameterId, targetValue, reason });
    }
  },
  "log.explainRootCause": {
    label: "Explain root cause",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "log.generateChecklist": {
    label: "Generate log checklist",
    writeAdjacent: true,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "debugging.recommendTargetValues": {
    label: "Recommend target values",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "debugging.prepareRollback": {
    label: "Prepare rollback",
    writeAdjacent: true,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "audit.summarizeRecentEvents": {
    label: "Summarize recent audit events",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "perception.getProjectOverview": {
    label: "Get project overview",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "perception.searchParameters": {
    label: "Search parameters",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "perception.getNodeSnapshot": {
    label: "Get node snapshot",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  },
  "perception.getRecentLogConclusions": {
    label: "Get recent log conclusions",
    writeAdjacent: false,
    mutating: false,
    normalize: optionalProjectPayload
  }
};

const KNOWN_TOOL_NAMES = new Set<AgentToolName>(Object.keys(TOOL_METADATA) as AgentToolName[]);

export function createPiAgentProvider(options: PiAgentProviderOptions): AgentProvider {
  const resolveModel =
    options.resolveModel ??
    ((provider, model) => {
      try {
        return defaultGetModel(provider as never, model as never) as Model<any>;
      } catch {
        return undefined;
      }
    });
  const complete = options.complete ?? defaultComplete;
  const timeoutMs = options.timeoutMs ?? 5000;

  function metadata() {
    return {
      provider: "live" as const,
      model: options.model,
      promptVersion: options.promptVersion,
      evidence: sanitizeAgentProviderEvidence({
        provider: "live",
        format: "pi",
        piProvider: options.piProvider,
        model: options.model,
        promptVersion: options.promptVersion
      })
    };
  }

  async function runCompletion(input: { context: Context; healthCheck?: boolean }): Promise<PiAssistantMessage> {
    const model = resolveModel(options.piProvider, options.model);
    if (!model) {
      throw new Error(`Pi Agent provider model was not found: ${options.piProvider}/${options.model}`);
    }

    return complete(model, input.context, {
      apiKey: options.apiKey,
      timeoutMs,
      maxRetries: input.healthCheck ? 0 : undefined
    });
  }

  return {
    metadata,
    async checkHealth() {
      try {
        await runCompletion({
          healthCheck: true,
          context: {
            systemPrompt: "Reply with the single word ready.",
            messages: [{ role: "user", content: "ready", timestamp: Date.now() }]
          }
        });
        return { ok: true, status: "ready" as const };
      } catch (error) {
        return {
          ok: false,
          status: "failed" as const,
          message: error instanceof Error ? error.message : "Pi Agent provider health check failed."
        };
      }
    },
    async planTurn(input): Promise<AgentProviderPlan> {
      const startedAt = Date.now();
      let assistant: PiAssistantMessage;
      try {
        assistant = await runCompletion({
          context: buildContext({
            promptVersion: options.promptVersion,
            context: input.context,
            message: input.message
          })
        });
      } catch (error) {
        throw new LiveAgentProviderOutageError(error instanceof Error ? error.message : "Pi Agent provider failed.");
      }

      const content = extractText(assistant);
      const citations = extractCitations(assistant);
      const toolRequests = extractToolRequests(assistant);
      validateGrounding(toolRequests, citations);

      return {
        assistantDraft: {
          content: content || "WiseAgent prepared a tool plan.",
          citations,
          confidence: DEFAULT_CONFIDENCE
        },
        toolRequests,
        provider: "live",
        model: options.model,
        promptVersion: options.promptVersion,
        latencyMs: Date.now() - startedAt,
        usage: mapUsage(assistant),
        safety: { status: "safe", reasons: [] }
      };
    }
  };
}

function buildContext(input: { promptVersion: string; context: unknown; message: string }): Context {
  return {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          promptVersion: input.promptVersion,
          context: input.context,
          message: input.message
        }),
        timestamp: Date.now()
      }
    ],
    tools: createPiTools()
  };
}

function createPiTools(): Tool[] {
  return [
    {
      name: "parameter.scanOrphans",
      description: "Find parameter definitions with no usage or no recent project value.",
      parameters: optionalProjectSchema()
    },
    {
      name: "parameter.draftCleanupPlan",
      description: "Prepare a cleanup review plan. This does not delete parameters.",
      parameters: optionalProjectSchema()
    },
    {
      name: "parameter.summarizeReviewQueue",
      description: "Summarize recent parameter change requests awaiting review.",
      parameters: optionalProjectSchema()
    },
    {
      name: "parameter.submitChangeDraft",
      description: "Create a parameter draft for human review. This requires WiseEff approval before execution.",
      parameters: Type.Object({
        projectId: Type.String({ minLength: 1 }),
        reason: Type.String({ minLength: 1 }),
        parameterId: Type.Optional(Type.String({ minLength: 1 })),
        targetValue: Type.Optional(Type.String({ minLength: 1 }))
      })
    },
    {
      name: "log.explainRootCause",
      description: "Explain likely root cause from log analysis records.",
      parameters: optionalProjectSchema()
    },
    {
      name: "log.generateChecklist",
      description: "Generate a follow-up checklist from log analysis records.",
      parameters: optionalProjectSchema()
    },
    {
      name: "debugging.recommendTargetValues",
      description: "Recommend writable debugging target value candidates.",
      parameters: optionalProjectSchema()
    },
    {
      name: "debugging.prepareRollback",
      description: "Prepare a rollback plan from debugging snapshots. This does not execute rollback.",
      parameters: optionalProjectSchema()
    },
    {
      name: "audit.summarizeRecentEvents",
      description: "Summarize recent WiseEff audit events.",
      parameters: optionalProjectSchema()
    }
  ];
}

function optionalProjectSchema() {
  return Type.Object({
    projectId: Type.Optional(Type.String({ minLength: 1 }))
  });
}

function extractText(message: PiAssistantMessage) {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text.replace(CITATION_BLOCK_PATTERN, "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function extractCitations(message: PiAssistantMessage): AgentCitation[] {
  const text = message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
  const citationMatch = text.match(/```wiseeff-citations\s*([\s\S]*?)```/i);
  if (!citationMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(citationMatch[1]) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((item) => (isCitation(item) ? [item] : []));
  } catch {
    return [];
  }
}

function extractToolRequests(message: PiAssistantMessage): AgentToolRequest[] {
  return message.content.flatMap((block) => {
    if (block.type !== "toolCall") {
      return [];
    }
    if (!KNOWN_TOOL_NAMES.has(block.name as AgentToolName)) {
      throw new Error(`Pi Agent provider returned an unknown tool name: ${block.name}.`);
    }
    const name = block.name as AgentToolName;
    const metadata = TOOL_METADATA[name];

    try {
      return [
        {
          name,
          label: metadata.label,
          payload: metadata.normalize(block.arguments ?? {})
        }
      ];
    } catch (error) {
      throw new Error(`Pi Agent provider returned invalid arguments for ${name}.`, { cause: error });
    }
  });
}

function validateGrounding(toolRequests: AgentToolRequest[], citations: AgentCitation[]) {
  const hasWriteAdjacent = toolRequests.some((request) => TOOL_METADATA[request.name].writeAdjacent);
  if (!hasWriteAdjacent) {
    return;
  }

  if (citations.length === 0) {
    const hasMutating = toolRequests.some((request) => TOOL_METADATA[request.name].mutating);
    throw new ApiError(
      "VALIDATION_FAILED",
      hasMutating
        ? "Pi Agent provider returned an ungrounded mutating request."
        : "Pi Agent provider returned an ungrounded write-adjacent request.",
      400,
      { toolRequests: toolRequests.map((request) => request.name) }
    );
  }
}

function mapUsage(message: PiAssistantMessage): AgentProviderUsage {
  return {
    inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
    outputTokens: message.usage.output,
    estimatedCostUsd: message.usage.cost.total
  };
}

function optionalProjectPayload(args: Record<string, unknown>) {
  return dropUndefined({ projectId: readOptionalString(args.projectId) });
}

function readOptionalString(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Expected a non-empty string.");
  }
  return value;
}

function readRequiredString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Expected a non-empty string.");
  }
  return value;
}

function dropUndefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function isCitation(value: unknown): value is AgentCitation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    (item.type === "parameter" || item.type === "log" || item.type === "audit" || item.type === "debugging") &&
    typeof item.id === "string" &&
    item.id.trim().length > 0 &&
    typeof item.label === "string" &&
    item.label.trim().length > 0
  );
}
