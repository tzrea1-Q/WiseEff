import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/core";
import { XiaozeReasoningMessage } from "./XiaozeReasoningMessage";

vi.mock("@/infrastructure/http/runtimeMode", () => ({
  xiaozeReasoningDevExpanded: false
}));

const reasoning = { id: "r1", role: "reasoning" as const, content: "step one" };

function renderReasoning(
  props: {
    content?: string;
    isRunning?: boolean;
    messages?: Message[];
  } = {}
) {
  const message = { ...reasoning, content: props.content ?? reasoning.content };
  const messages =
    props.messages ??
    ([
      { id: "u1", role: "user" as const, content: "hello" },
      message,
      { id: "a1", role: "assistant" as const, content: "" }
    ] satisfies Message[]);

  return render(
    <XiaozeReasoningMessage message={message} messages={messages} isRunning={props.isRunning ?? true} />
  );
}

describe("XiaozeReasoningMessage", () => {
  it("streams thinking in the body when expanded during reasoning", () => {
    const { rerender } = renderReasoning({ content: "step" });

    expect(screen.getByRole("button", { name: "思考中…" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("step")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "思考中…" }));

    expect(screen.getByRole("button", { name: "思考中…" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("step")).toBeInTheDocument();

    rerender(
      <XiaozeReasoningMessage
        message={{ ...reasoning, content: "step one two" }}
        messages={[
          { id: "u1", role: "user", content: "hello" },
          { id: "r1", role: "reasoning", content: "step one two" },
          { id: "a1", role: "assistant", content: "" }
        ]}
        isRunning
      />
    );

    expect(screen.getByText("step one two")).toBeInTheDocument();
  });

  it("collapses when answer starts and keeps full thinking available on reopen", () => {
    const streamingMessages: Message[] = [
      { id: "u1", role: "user", content: "hello" },
      { id: "r1", role: "reasoning", content: "full thinking trace" },
      { id: "a1", role: "assistant", content: "" }
    ];

    const view = render(
      <XiaozeReasoningMessage
        message={{ id: "r1", role: "reasoning", content: "full thinking trace" }}
        messages={streamingMessages}
        isRunning
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "思考中…" }));
    expect(screen.getByText("full thinking trace")).toBeInTheDocument();

    view.rerender(
      <XiaozeReasoningMessage
        message={{ id: "r1", role: "reasoning", content: "full thinking trace" }}
        messages={[
          { id: "u1", role: "user", content: "hello" },
          { id: "r1", role: "reasoning", content: "full thinking trace" },
          { id: "a1", role: "assistant", content: "Hi there" }
        ]}
        isRunning
      />
    );

    expect(screen.getByRole("button", { name: /已思考/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("full thinking trace")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /已思考/ }));

    expect(screen.getByRole("button", { name: /已思考/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("full thinking trace")).toBeInTheDocument();
  });
});
