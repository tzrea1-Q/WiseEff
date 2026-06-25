import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozeAssistantMarkdown } from "./XiaozeAssistantMarkdown";

vi.mock("streamdown", () => ({
  Streamdown: ({
    children,
    className,
    mode
  }: {
    children?: string;
    className?: string;
    mode?: string;
  }) => (
    <div data-testid={`streamdown-${mode ?? "default"}`} className={className}>
      {children}
    </div>
  )
}));

describe("XiaozeAssistantMarkdown", () => {
  it("renders Streamdown in streaming mode while the assistant is running", () => {
    render(<XiaozeAssistantMarkdown content="你好，我是小泽。" isStreaming />);

    expect(screen.getByTestId("streamdown-streaming")).toHaveTextContent("你好，我是小泽。");
    expect(screen.getByTestId("streamdown-streaming")).toHaveClass("xiaoze-md-root");
    expect(document.querySelector(".xiaoze-streaming-markdown__cursor")).toBeInTheDocument();
  });

  it("renders Streamdown in static mode after streaming completes", () => {
    render(<XiaozeAssistantMarkdown content="## 标题" isStreaming={false} />);

    expect(screen.getByTestId("streamdown-static")).toHaveTextContent("## 标题");
    expect(document.querySelector(".xiaoze-streaming-markdown__cursor")).not.toBeInTheDocument();
  });
});
