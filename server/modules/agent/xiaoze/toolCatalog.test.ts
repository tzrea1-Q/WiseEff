import { describe, expect, it } from "vitest";
import { createAgentToolRegistry } from "../toolRegistry";
import {
  buildXiaozePlanningToolDescriptors,
  formatToolCatalogForSystemPrompt,
  toOpenAiToolDefinitions
} from "./toolCatalog";

describe("xiaoze toolCatalog", () => {
  it("lists perception, knowledge, and action tools with schemas for the model", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const tools = buildXiaozePlanningToolDescriptors(registry.list());

    expect(tools.map((tool) => tool.name)).toEqual([
      "perception.getProjectOverview",
      "perception.searchParameters",
      "perception.getNodeSnapshot",
      "perception.getRecentLogConclusions",
      "knowledge.search",
      "knowledge.getDocument",
      "action.submitParameterChange",
      "action.createKnowledgeDraft"
    ]);
    expect(tools.find((tool) => tool.name === "action.submitParameterChange")?.requiresApproval).toBe(true);
    expect(tools.find((tool) => tool.name === "action.createKnowledgeDraft")?.requiresApproval).toBe(true);
    expect(tools.find((tool) => tool.name === "knowledge.search")?.requiresApproval).toBeFalsy();
    expect(toOpenAiToolDefinitions(tools)).toHaveLength(8);
  });

  it("describes the knowledge draft action as draft-only with the required schema fields", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const tools = buildXiaozePlanningToolDescriptors(registry.list());

    const draft = tools.find((tool) => tool.name === "action.createKnowledgeDraft");
    expect(draft?.description).toContain("draft");
    expect(draft?.description).toContain("never modifies existing entries");
    expect(draft?.schema).toMatchObject({ required: ["title", "contentMarkdown"] });
  });

  it("describes knowledge tools with dedicated schemas and descriptions", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const tools = buildXiaozePlanningToolDescriptors(registry.list());

    const search = tools.find((tool) => tool.name === "knowledge.search");
    expect(search?.description).toContain("published knowledge base");
    expect(search?.schema).toMatchObject({ required: ["query"] });

    const getDocument = tools.find((tool) => tool.name === "knowledge.getDocument");
    expect(getDocument?.description).toContain("published knowledge entry");
    expect(getDocument?.schema).toMatchObject({ required: ["entryId"] });
  });

  it("formats a system prompt catalog so the model knows available tools", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });
    const tools = buildXiaozePlanningToolDescriptors(registry.list());
    const catalog = formatToolCatalogForSystemPrompt(tools);

    expect(catalog).toContain("Available WiseEff tools");
    expect(catalog).toContain("perception.getProjectOverview");
    expect(catalog).toContain("knowledge.search");
    expect(catalog).toContain("action.submitParameterChange");
    expect(catalog).not.toContain("No WiseEff tools are currently registered");
  });
});
