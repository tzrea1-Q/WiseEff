import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/core";
import { XiaozeTurnBlock } from "./XiaozeTurnBlock";
import * as RunStepsContext from "./XiaozeRunStepsContext";
import { XiaozeRunStepsProvider } from "./XiaozeRunStepsContext";
import { XiaozeTurnReplyProvider } from "./XiaozeTurnReplyContext";
import { XiaozeTurnStateProvider } from "./XiaozeTurnStateContext";
import { XiaozeRunTimingProvider } from "./XiaozeRunTimingContext";

const promptDebugSnapshot = {
  threadId: "thread-1",
  userMessage: "charge 参数有哪些？",
  context: { pageKey: "debugging" },
  system: {
    policy: "You are Xiaoze.",
    toolCatalog: "- perception.searchParameters: search"
  },
  llmMessages: [{ role: "user", content: "charge 参数有哪些？" }],
  tools: [{ name: "perception.searchParameters", description: "search", schema: { type: "object" } }]
};

vi.mock("@/infrastructure/http/runtimeMode", () => ({
  xiaozeReasoningDevExpanded: false,
  xiaozePromptDebugEnabled: true
}));

vi.mock("./XiaozePromptDebugContext", () => ({
  useXiaozePromptDebugSnapshotForTurn: (userMessage: string) =>
    userMessage.includes("charge") ? promptDebugSnapshot : undefined
}));

vi.mock("./XiaozeUserMessage", () => ({
  XiaozeUserMessage: ({ message }: { message: { content: string } }) => <div>{message.content}</div>
}));

function renderTurn(messages: Message[], isRunning = true) {
  const turn = {
    id: "u1",
    user: { id: "u1", role: "user" as const, content: "charge 参数有哪些？" },
    reasoning: messages.find((entry) => entry.role === "reasoning") as
      | { id: string; role: "reasoning"; content: string }
      | undefined,
    assistants: messages.filter((entry) => entry.role === "assistant") as Array<{
      id: string;
      role: "assistant";
      content: string;
    }>,
    tail: []
  };

  return render(
    <XiaozeRunTimingProvider>
      <XiaozeTurnReplyProvider>
        <XiaozeTurnStateProvider>
          <XiaozeRunStepsProvider>
            <XiaozeTurnBlock turn={turn} messages={messages} isLatest isRunning={isRunning} />
          </XiaozeRunStepsProvider>
        </XiaozeTurnStateProvider>
      </XiaozeTurnReplyProvider>
    </XiaozeRunTimingProvider>
  );
}

describe("XiaozeTurnBlock", () => {
  it("shows per-turn prompt debug collapsed under the user question", () => {
    renderTurn([{ id: "u1", role: "user", content: "charge 参数有哪些？" }]);

    expect(screen.getByRole("button", { name: "完整提示词" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "完整提示词" }));
    expect(screen.getByText("You are Xiaoze.")).toBeInTheDocument();
  });

  it("shows expandable thinking and hides reasoning until expanded after completion", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: "charge 参数有哪些？" },
      { id: "r1", role: "reasoning", content: "The user is asking about charge parameters." },
      { id: "a1", role: "assistant", content: "在 aurora 项目中找到 4 个 charge 相关参数。" }
    ];
    const turn = {
      id: "u1",
      user: { id: "u1", role: "user" as const, content: "charge 参数有哪些？" },
      reasoning: { id: "r1", role: "reasoning" as const, content: "The user is asking about charge parameters." },
      assistants: [{ id: "a1", role: "assistant" as const, content: "在 aurora 项目中找到 4 个 charge 相关参数。" }],
      tail: []
    };

    render(
      <XiaozeRunTimingProvider>
        <XiaozeTurnReplyProvider>
          <XiaozeTurnStateProvider>
            <XiaozeRunStepsProvider>
              <XiaozeTurnBlock turn={turn} messages={messages} isLatest isRunning={false} />
            </XiaozeRunStepsProvider>
          </XiaozeTurnStateProvider>
        </XiaozeTurnReplyProvider>
      </XiaozeRunTimingProvider>
    );

    expect(screen.getByRole("button", { name: /已思考/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/4 个 charge 相关参数/)).toBeInTheDocument();
    expect(screen.queryByText(/The user is asking/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /已思考/ }));
    expect(screen.getByText(/The user is asking/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /已思考/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("hides partial streamed answer while tool steps are still running", () => {
    vi.spyOn(RunStepsContext, "useXiaozeLiveRunSteps").mockReturnValue([
      {
        id: "step-1",
        kind: "tool",
        label: "搜索参数定义",
        toolName: "perception.searchParameters",
        status: "running",
        startedAtMs: Date.now()
      }
    ]);

    renderTurn([
      { id: "u1", role: "user", content: "charge 参数有哪些？" },
      {
        id: "a1",
        role: "assistant",
        content: "在 aurora 项目里，我找到 4 个与 charge 相关的参数，按模块归类如下：\n\n| 参数名 |"
      }
    ]);

    expect(screen.queryByText(/按模块归类/)).not.toBeInTheDocument();
    expect(screen.getByText("搜索参数定义")).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
