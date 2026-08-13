import type { BackendPermission } from "../auth/types";

export type AgentToolKind = "read" | "preparation" | "mutating";

export type AgentToolMetadata = {
  name: string;
  /** User-facing Chinese label: run steps, tool-result frames, audits, approvals. */
  label: string;
  kind: AgentToolKind;
  permission: BackendPermission;
  requiresApproval: boolean;
  /**
   * Project-scoped tools (default) require an effective project or a global
   * admin; organization-scoped tools (e.g. knowledge) rely on their
   * permission plus the org isolation their services already enforce.
   */
  scope?: "project" | "organization";
  /** Model-facing description: the planning descriptor, OpenAI definition, and system prompt derive from it. */
  description: string;
  /** JSON schema for the tool arguments, served verbatim to the model. */
  schema: Record<string, unknown>;
};

/**
 * The single declaration point for every agent tool. The name union, the
 * registry definitions, the planning descriptors, the OpenAI function
 * definitions, the system-prompt catalog, and the user-facing labels are all
 * derived from this table — adding a tool means adding one entry here and its
 * `run` implementation in `tools/*`.
 */
export const AGENT_TOOL_METADATA = [
  {
    name: "perception.getProjectOverview",
    label: "查询项目概览",
    kind: "read",
    permission: "parameter:view",
    requiresApproval: false,
    description:
      "Read a project overview: parameter count and open change requests. Use when summarizing project status.",
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Target project id; defaults to the current page project when omitted." }
      },
      additionalProperties: false
    }
  },
  {
    name: "perception.searchParameters",
    label: "搜索参数定义",
    kind: "read",
    permission: "parameter:view",
    requiresApproval: false,
    description:
      "Search parameter definitions by keyword within a project. Returns name, description, explanation, module, range, unit, current/recommended values, and risk. Use when the user asks what a parameter does or how it is configured.",
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Scope search to a project; defaults to the current page project when omitted." },
        query: { type: "string", description: "Keyword to match against parameter names." }
      },
      additionalProperties: false
    }
  },
  {
    name: "perception.getNodeSnapshot",
    label: "读取节点快照",
    kind: "read",
    permission: "debugging:view",
    requiresApproval: false,
    description:
      "Read debugging node bindings and current/target values. Use on debugging pages or node-related questions.",
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Filter debugging nodes by project; defaults to the current page project when omitted." }
      },
      additionalProperties: false
    }
  },
  {
    name: "perception.getRecentLogConclusions",
    label: "查看日志结论",
    kind: "read",
    permission: "logs:view",
    requiresApproval: false,
    description:
      "Read recent log analysis conclusions and severity. Use on logs pages or log-related questions.",
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Filter logs by project; defaults to the current page project when omitted." }
      },
      additionalProperties: false
    }
  },
  {
    name: "knowledge.search",
    label: "检索知识库",
    kind: "read",
    permission: "knowledge:view",
    requiresApproval: false,
    scope: "organization",
    description:
      "Search the organization's published knowledge base (tuning experience, fault cases, hardware manuals, process norms). Returns entries with citation-ready excerpts. Use when the user asks about documented experience or best practices; cite the returned sources in the answer.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords for the published knowledge base (Chinese or English)." },
        limit: { type: "number", description: "Maximum entries to return (1-10, default 5)." }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "knowledge.getDocument",
    label: "读取知识条目",
    kind: "read",
    permission: "knowledge:view",
    requiresApproval: false,
    scope: "organization",
    description:
      "Read the full content of one published knowledge entry by entryId (use ids returned by knowledge.search). Returns markdown or extracted file text plus citation metadata. Drafts and archived entries are never readable.",
    schema: {
      type: "object",
      properties: {
        entryId: {
          type: "string",
          description: "Knowledge entry id to read — use an entryId returned by knowledge.search."
        }
      },
      required: ["entryId"],
      additionalProperties: false
    }
  },
  {
    name: "action.submitParameterChange",
    label: "提交参数变更",
    kind: "mutating",
    permission: "parameter:edit",
    requiresApproval: true,
    description:
      "Submit a parameter change request for human review. Never executes immediately; requires explicit user approval. Pass the binding id from perception.searchParameters as parameterId, and write targetValue as DTS source text in the same format as the parameter's current value (for example <3600> for cells or \"fast\" for strings).",
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project that owns the parameter." },
        parameterId: {
          type: "string",
          description: "Parameter binding id to change — use the id returned by perception.searchParameters."
        },
        targetValue: {
          type: "string",
          description:
            'Requested new value as DTS source text, matching the format of the current value: cells like <3600>, strings like "fast", bytes like [01 02].'
        },
        reason: { type: "string", description: "Human-readable reason for the change." }
      },
      required: ["projectId", "parameterId", "targetValue", "reason"],
      additionalProperties: false
    }
  },
  {
    name: "action.createKnowledgeDraft",
    label: "创建知识草稿",
    kind: "mutating",
    permission: "knowledge:edit",
    requiresApproval: true,
    scope: "organization",
    description:
      "Distil the current conversation's conclusions into a NEW knowledge base draft for human review. Never executes immediately; requires explicit user approval. Creates a draft only — it never modifies existing entries and stays out of retrieval until a human publishes it. Use when the user wants to save tuning experience, a fault case, or process knowledge; write contentMarkdown as well-structured markdown and pass the log-analysis record id as sourceLogId when the knowledge comes from a log analysis.",
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Draft title (at most 200 characters), e.g. the distilled conclusion." },
        contentMarkdown: {
          type: "string",
          description: "Draft body as markdown: conclusion, evidence, and suggested actions distilled from the conversation."
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Knowledge tags (at most 20), e.g. project or topic labels."
        },
        sourceLogId: {
          type: "string",
          description: "Optional log-analysis record id this draft was distilled from (use ids from perception.getRecentLogConclusions)."
        }
      },
      required: ["title", "contentMarkdown"],
      additionalProperties: false
    }
  }
] as const satisfies readonly AgentToolMetadata[];

export type AgentToolName = (typeof AGENT_TOOL_METADATA)[number]["name"];

const metadataByName = new Map<string, AgentToolMetadata>(AGENT_TOOL_METADATA.map((tool) => [tool.name, tool]));

export function requireAgentToolMetadata<Name extends AgentToolName>(name: Name): AgentToolMetadata & { name: Name } {
  const metadata = metadataByName.get(name);
  if (!metadata) {
    throw new Error(`Agent tool metadata is missing for ${name}.`);
  }
  return metadata as AgentToolMetadata & { name: Name };
}

export function getXiaozeToolLabel(toolName: string) {
  return metadataByName.get(toolName)?.label ?? toolName;
}
