import { describe, expect, it } from "vitest";
import { createAgentToolRegistry } from "../toolRegistry";
import {
  buildXiaozePlanningToolDescriptors,
  formatToolCatalogForSystemPrompt,
  toOpenAiToolDefinitions
} from "./toolCatalog";

describe("xiaoze toolCatalog", () => {
  it("lists perception and action tools with schemas for the model", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const tools = buildXiaozePlanningToolDescriptors(
      registry.list().filter((tool) => tool.name.startsWith("perception.") || tool.name.startsWith("action."))
    );

    expect(tools.map((tool) => tool.name)).toEqual([
      "perception.getProjectOverview",
      "perception.searchParameters",
      "perception.getNodeSnapshot",
      "perception.getRecentLogConclusions",
      "action.submitParameterChange"
    ]);
    expect(tools.find((tool) => tool.name === "action.submitParameterChange")?.requiresApproval).toBe(true);
    expect(toOpenAiToolDefinitions(tools)).toHaveLength(5);
  });

  it("formats a system prompt catalog so the model knows available tools", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const tools = buildXiaozePlanningToolDescriptors(
      registry.list().filter((tool) => tool.name.startsWith("perception.") || tool.name.startsWith("action."))
    );
    const catalog = formatToolCatalogForSystemPrompt(tools);

    expect(catalog).toContain("Available WiseEff tools");
    expect(catalog).toContain("perception.getProjectOverview");
    expect(catalog).toContain("action.submitParameterChange");
    expect(catalog).not.toContain("No WiseEff tools are currently registered");
  });
});
