import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import {
  isXiaozeReasoningStreaming,
  shouldShowXiaozeReasoningTimeline,
  shouldShowXiaozeThinkingFallback
} from "./xiaozeThinkingState";

describe("xiaozeThinkingState", () => {
  it("keeps reasoning streaming until assistant content arrives", () => {
    const reasoning = { id: "r1", role: "reasoning" as const, content: "step one" };
    const messages = [
      { id: "u1", role: "user" as const, content: "hello" },
      reasoning,
      { id: "a1", role: "assistant" as const, content: "" }
    ];

    expect(isXiaozeReasoningStreaming(reasoning, messages, true)).toBe(true);

    messages[2] = { id: "a1", role: "assistant", content: "Hi there" };
    expect(isXiaozeReasoningStreaming(reasoning, messages, true)).toBe(false);
  });

  it("shows fallback thinking while running before reasoning or assistant output", () => {
    const messages = [{ id: "u1", role: "user" as const, content: "hello" }];
    expect(shouldShowXiaozeThinkingFallback(messages, true)).toBe(true);
    expect(shouldShowXiaozeThinkingFallback([...messages, { id: "r1", role: "reasoning", content: "" }], true)).toBe(false);
    expect(shouldShowXiaozeThinkingFallback(messages, false)).toBe(false);
  });

  it("keeps reasoning timeline visible when assistant shell exists but is still empty", () => {
    const reasoning = { id: "r1", role: "reasoning" as const, content: "planning" };
    const messages: Message[] = [
      { id: "u1", role: "user" as const, content: "hello" },
      reasoning,
      { id: "a1", role: "assistant" as const, content: "" }
    ];
    expect(shouldShowXiaozeReasoningTimeline(reasoning, messages, true)).toBe(true);
    messages[2] = {
      id: "a1",
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc1", type: "function", function: { name: "x", arguments: "{}" } }]
    };
    expect(shouldShowXiaozeReasoningTimeline(reasoning, messages, true)).toBe(false);
  });
});
