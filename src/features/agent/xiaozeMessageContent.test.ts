import { describe, expect, it } from "vitest";
import { dedupeRepeatedAnswerText } from "./xiaozeMessageContent";

describe("dedupeRepeatedAnswerText", () => {
  it("removes a repeated Chinese answer body", () => {
    const intro = "我来帮您搜索参数。";
    const body =
      "在 aurora 项目中，搜索 charge 关键词共找到 4 个相关参数，分布在两个模块下。\n\n## Charging Policy\n\n表格内容省略。";
    const duplicate = `${intro}${body}\n\n${body}`;

    const result = dedupeRepeatedAnswerText(duplicate);
    expect(result).toContain("在 aurora 项目中");
    expect(result).not.toMatch(/在 aurora 项目中[\s\S]*在 aurora 项目中/);
    expect(result.length).toBeLessThan(duplicate.length);
  });
});
