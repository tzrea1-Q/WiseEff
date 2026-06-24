import type { AgentToolDefinition } from "../toolRegistry";
import type { PerceptionToolDescriptor } from "./perceptionAgent";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  "perception.getProjectOverview":
    "Read a project overview: parameter count and open change requests. Use when summarizing project status.",
  "perception.searchParameters":
    "Search parameter definitions by keyword within a project. Returns name, description, explanation, module, range, unit, current/recommended values, and risk. Use when the user asks what a parameter does or how it is configured.",
  "perception.getNodeSnapshot":
    "Read debugging node bindings and current/target values. Use on debugging pages or node-related questions.",
  "perception.getRecentLogConclusions":
    "Read recent log analysis conclusions and severity. Use on logs pages or log-related questions.",
  "action.submitParameterChange":
    "Submit a parameter change request for human review. Never executes immediately; requires explicit user approval."
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
  "action.submitParameterChange": {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Project that owns the parameter." },
      parameterId: { type: "string", description: "Parameter definition id to change." },
      targetValue: { type: "string", description: "Requested new value." },
      reason: { type: "string", description: "Human-readable reason for the change." }
    },
    required: ["projectId", "parameterId", "targetValue", "reason"],
    additionalProperties: false
  }
};

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
