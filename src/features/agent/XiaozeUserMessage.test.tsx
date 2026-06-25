import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozeUserMessage } from "./XiaozeUserMessage";

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotChatUserMessage: ({ message }: { message: { content: string } }) => (
    <div data-testid="copilot-user">{message.content}</div>
  )
}));

vi.mock("@/infrastructure/http/runtimeMode", () => ({
  xiaozePromptDebugEnabled: true
}));

vi.mock("./XiaozePromptDebugContext", () => ({
  useXiaozePromptDebugSnapshotForTurn: () => ({
    threadId: "t1",
    userMessage: "hello",
    context: {},
    system: { policy: "p", toolCatalog: "c" },
    llmMessages: [],
    tools: []
  })
}));

describe("XiaozeUserMessage", () => {
  it("does not render prompt debug inside the user message block", () => {
    render(<XiaozeUserMessage message={{ id: "u1", role: "user", content: "hello" }} />);

    expect(screen.getByTestId("copilot-user")).toHaveTextContent("hello");
    expect(screen.queryByRole("button", { name: "完整提示词" })).not.toBeInTheDocument();
  });
});
