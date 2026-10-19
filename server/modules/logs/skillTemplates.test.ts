import { describe, expect, it } from "vitest";
import { compileLogPattern } from "./adminPattern";
import { logSkillSpecSchema } from "./skillSpec";
import { logSkillTemplates } from "./skillTemplates";

describe("skill starting templates", () => {
  it.each(logSkillTemplates)("validates $id and compiles its signal patterns with RE2", (template) => {
    expect(logSkillSpecSchema.parse(template.spec)).toEqual(template.spec);
    for (const heading of ["适用场景", "先检查什么", "根因判定", "常见误判", "建议动作"])
      expect(template.spec.procedure).toContain(`## ${heading}\n`);
    for (const rule of template.spec.signalRules!.rules) for (const condition of rule.anyOf)
      if (condition.type === "text") expect(() => compileLogPattern(condition.pattern, condition.flags)).not.toThrow();
  });
  it("trims procedures and enforces the additive field's limit", () => {
    expect(logSkillSpecSchema.parse({ schemaVersion: "skill/v1", procedure: "  ## Steps  " }).procedure).toBe("## Steps");
    expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", procedure: "x".repeat(20001) }).success).toBe(false);
    expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1" }).success).toBe(true);
  });
});
