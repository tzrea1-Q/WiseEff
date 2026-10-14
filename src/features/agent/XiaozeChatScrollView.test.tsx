import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozeChatScrollView } from "./XiaozeChatScrollView";

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotChatView: {
    ScrollView: ({ children, autoScroll }: { children?: React.ReactNode; autoScroll?: string | boolean }) => (
      <div data-testid="copilot-scroll-view" data-auto-scroll={String(autoScroll ?? "default")}>
        {children}
      </div>
    ),
    ScrollToBottomButton: ({ onClick }: { onClick?: () => void }) => (
      <button type="button" data-testid="scroll-to-bottom" onClick={onClick}>
        Bottom
      </button>
    ),
    Feather: () => <div data-testid="scroll-feather" />
  }
}));

describe("XiaozeChatScrollView", () => {
  it("switches auto-scroll modes without breaking hook order", () => {
    const { rerender } = render(<XiaozeChatScrollView>messages</XiaozeChatScrollView>);
    for (const autoScroll of ["none", "pin-to-send", "pin-to-bottom"] as const) {
      rerender(<XiaozeChatScrollView autoScroll={autoScroll}>messages</XiaozeChatScrollView>);
      expect(screen.getByText("messages")).toBeInTheDocument();
      expect(screen.queryByTestId("copilot-scroll-view") !== null).toBe(autoScroll !== "pin-to-bottom");
    }
  });

  it("uses the custom auto-scroll container for pin-to-bottom mode", () => {
    render(
      <XiaozeChatScrollView>
        <div>messages</div>
      </XiaozeChatScrollView>
    );

    expect(screen.getByText("messages")).toBeInTheDocument();
    expect(document.querySelector(".xiaoze-chat-scroll")).toBeInTheDocument();
    expect(screen.queryByTestId("copilot-scroll-view")).not.toBeInTheDocument();
  });

  it("delegates non pin-to-bottom modes to CopilotKit scroll view", () => {
    render(
      <XiaozeChatScrollView autoScroll="none">
        <div>manual scroll</div>
      </XiaozeChatScrollView>
    );

    expect(screen.getByTestId("copilot-scroll-view")).toHaveAttribute("data-auto-scroll", "none");
    expect(document.querySelector(".xiaoze-chat-scroll")).not.toBeInTheDocument();
  });
});
