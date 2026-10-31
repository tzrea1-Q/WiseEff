import { describe, expect, it } from "vitest";
import { XIAOZE_PROMPT_VERSION, XIAOZE_SYSTEM_PROMPT } from "./xiaozePrompt";
import { DEFINITION_IMPORT_TEMPLATE } from "../../../../src/domain/parameter-catalog/definitionImportTemplate";

describe("xiaozePrompt", () => {
  it("exports a versioned system prompt", () => {
    expect(XIAOZE_PROMPT_VERSION).toBe("2026-10-30.2");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("Xiaoze");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("Never claim a write occurred");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("FORBIDDEN");
  });

  it("uses the downloadable definition import template and explains the human boundary", () => {
    expect(XIAOZE_SYSTEM_PROMPT).toContain(DEFINITION_IMPORT_TEMPLATE);
    expect(XIAOZE_SYSTEM_PROMPT).toContain("openDefinitionImport");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("诊断");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("预览和发布由人完成");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("只有用户明确给出业务分类时才填写业务分类");
  });
});
