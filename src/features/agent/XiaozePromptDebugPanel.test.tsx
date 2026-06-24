import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozePromptDebugPanel } from "./XiaozePromptDebugPanel";

const snapshot = {
  threadId: "thread-1",
  userMessage: "请告诉我本平台有什么能力",
  context: { pageKey: "home" },
  system: {
    policy: "You are Xiaoze.",
    toolCatalog: "- perception.getProjectOverview: overview"
  },
  llmMessages: [
    { role: "system", content: "You are Xiaoze." },
    { role: "user", content: "请告诉我本平台有什么能力" },
    { role: "assistant", tool_calls: [{ id: "tc-1", function: { name: "perception.getProjectOverview", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "tc-1", content: "{\"summary\":\"ok\"}" }
  ],
  tools: [{ name: "perception.getProjectOverview", description: "overview", schema: { type: "object" } }],
  model: "MiniMax-M3"
};

describe("XiaozePromptDebugPanel", () => {
  it("renders collapsed by default and expands structured prompt sections", () => {
    render(<XiaozePromptDebugPanel snapshot={snapshot} />);

    expect(screen.getByRole("button", { name: "完整提示词" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Tool catalog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "完整提示词" }));

    expect(screen.getByRole("button", { name: "完整提示词" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("MiniMax-M3")).toBeInTheDocument();
    expect(screen.getAllByText("You are Xiaoze.").length).toBeGreaterThan(0);
    expect(screen.getByText("- perception.getProjectOverview: overview")).toBeInTheDocument();
    expect(screen.getByText("LLM 交互 (4 条)")).toBeInTheDocument();
    expect(screen.getByText("assistant")).toBeInTheDocument();
  });

  it("copies the full prompt payload", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    render(<XiaozePromptDebugPanel snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "复制完整提示词" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]?.[0])).toContain("=== LLM 交互 (4 条) ===");
    expect(String(writeText.mock.calls[0]?.[0])).toContain("[4] tool");

    writeText.mockRestore();
  });
});
