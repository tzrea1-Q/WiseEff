import type { AgentToolMetadata } from "../toolMetadata";
import type { PerceptionToolDescriptor } from "./modelTypes";

export { getXiaozeToolLabel } from "../toolMetadata";

/**
 * Planning descriptors are a mechanical projection of the single tool
 * declaration (`toolMetadata.ts`) carried by each registered tool — there is
 * no name-keyed side table left to fall out of sync.
 */
export function buildXiaozePlanningToolDescriptors(tools: readonly AgentToolMetadata[]): PerceptionToolDescriptor[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
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
