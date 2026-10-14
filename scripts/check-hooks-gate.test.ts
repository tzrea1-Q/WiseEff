import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("rules-of-hooks gate", () => {
  it("rejects conditional hooks as lint errors", async () => {
    const [result] = await new ESLint().lintText(
      'import { useRef } from "react"; export function Example({ enabled }: { enabled: boolean }) { if (enabled) useRef(null); return null; }',
      { filePath: "src/Example.tsx" }
    );
    expect(result.messages.filter((message) => message.ruleId === "react-hooks/rules-of-hooks")
      .map((message) => message.severity)).toEqual([2]);
  });

  it("keeps chat scroll modes free of conditional hooks", async () => {
    const filePath = "src/features/agent/XiaozeChatScrollView.tsx";
    const [result] = await new ESLint().lintText(readFileSync(filePath, "utf8"), { filePath });
    expect(result.messages.filter((message) => message.ruleId === "react-hooks/rules-of-hooks")).toEqual([]);
  });
});
