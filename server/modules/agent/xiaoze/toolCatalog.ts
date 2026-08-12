import type { AgentToolDefinition } from "../toolRegistry";
import type { PerceptionToolDescriptor } from "./perceptionAgent";

const TOOL_LABELS_ZH: Record<string, string> = {
  "perception.getProjectOverview": "查询项目概览",
  "perception.searchParameters": "搜索参数定义",
  "perception.getNodeSnapshot": "读取节点快照",
  "perception.getRecentLogConclusions": "查看日志结论",
  "knowledge.search": "检索知识库",
  "knowledge.getDocument": "读取知识条目",
  "action.submitParameterChange": "提交参数变更"
};

const TOOL_DESCRIPTIONS: Record<string, string> = {
  "perception.getProjectOverview":
    "Read a project overview: parameter count and open change requests. Use when summarizing project status.",
  "perception.searchParameters":
    "Search parameter definitions by keyword within a project. Returns name, description, explanation, module, range, unit, current/recommended values, and risk. Use when the user asks what a parameter does or how it is configured.",
  "perception.getNodeSnapshot":
    "Read debugging node bindings and current/target values. Use on debugging pages or node-related questions.",
  "perception.getRecentLogConclusions":
    "Read recent log analysis conclusions and severity. Use on logs pages or log-related questions.",
  "knowledge.search":
    "Search the organization's published knowledge base (tuning experience, fault cases, hardware manuals, process norms). Returns entries with citation-ready excerpts. Use when the user asks about documented experience or best practices; cite the returned sources in the answer.",
  "knowledge.getDocument":
    "Read the full content of one published knowledge entry by entryId (use ids returned by knowledge.search). Returns markdown or extracted file text plus citation metadata. Drafts and archived entries are never readable.",
  "action.submitParameterChange":
    "Submit a parameter change request for human review. Never executes immediately; requires explicit user approval. Pass the binding id from perception.searchParameters as parameterId, and write targetValue as DTS source text in the same format as the parameter's current value (for example <3600> for cells or \"fast\" for strings)."
};

const TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
  "perception.getProjectOverview": {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Target project id; defaults to the current page project when omitted." }
    },
    additionalProperties: false
  },
  "perception.searchParameters": {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Scope search to a project; defaults to the current page project when omitted." },
      query: { type: "string", description: "Keyword to match against parameter names." }
    },
    additionalProperties: false
  },
  "perception.getNodeSnapshot": {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Filter debugging nodes by project; defaults to the current page project when omitted." }
    },
    additionalProperties: false
  },
  "perception.getRecentLogConclusions": {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Filter logs by project; defaults to the current page project when omitted." }
    },
    additionalProperties: false
  },
  "knowledge.search": {
    type: "object",
    properties: {
      query: { type: "string", description: "Search keywords for the published knowledge base (Chinese or English)." },
      limit: { type: "number", description: "Maximum entries to return (1-10, default 5)." }
    },
    required: ["query"],
    additionalProperties: false
  },
  "knowledge.getDocument": {
    type: "object",
    properties: {
      entryId: {
        type: "string",
        description: "Knowledge entry id to read — use an entryId returned by knowledge.search."
      }
    },
    required: ["entryId"],
    additionalProperties: false
  },
  "action.submitParameterChange": {
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
};

export function getXiaozeToolLabel(toolName: string) {
  return TOOL_LABELS_ZH[toolName] ?? toolName;
}

export function buildXiaozePlanningToolDescriptors(tools: AgentToolDefinition[]): PerceptionToolDescriptor[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: TOOL_DESCRIPTIONS[tool.name] ?? tool.label,
    schema: TOOL_SCHEMAS[tool.name] ?? { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: tool.requiresApproval
  }));
}

export function formatToolCatalogForSystemPrompt(tools: PerceptionToolDescriptor[]): string {
  if (tools.length === 0) {
    return "No WiseEff tools are currently registered for this session.";
  }

  const readTools = tools.filter((tool) => !tool.requiresApproval);
  const mutatingTools = tools.filter((tool) => tool.requiresApproval);

  const formatEntry = (tool: PerceptionToolDescriptor) =>
    `- ${tool.name}: ${tool.description}`;

  return [
    "## Available WiseEff tools",
    "These tools are bound for function calling in this session. Read tools execute automatically; mutating tools pause for explicit user approval before any write.",
    "",
    "### Perception (read-only)",
    ...readTools.map(formatEntry),
    "",
    "### Action (approval required)",
    ...(mutatingTools.length > 0 ? mutatingTools.map(formatEntry) : ["- (none registered)"]),
    "",
    "When the user asks what you can do, summarize these capabilities in their language. Prefer calling read tools to ground factual answers."
  ].join("\n");
}

export function toOpenAiToolDefinitions(tools: PerceptionToolDescriptor[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema
    }
  }));
}
