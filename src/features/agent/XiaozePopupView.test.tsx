import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XiaozePopupView } from "./XiaozePopupView";

const setModalOpen = vi.fn();
let isModalOpen = true;

vi.mock("@copilotkit/react-core/v2", () => ({
  useCopilotChatConfiguration: () => ({
    isModalOpen,
    setModalOpen,
    labels: { modalHeaderTitle: "小泽" }
  }),
  CopilotModalHeader: () => <div>header</div>,
  CopilotChatView: Object.assign(
    ({ className }: { className?: string }) => (
      <div data-testid="copilot-chat-view" className={className}>
        chat
      </div>
    ),
    { WelcomeScreen: () => null }
  )
}));

vi.mock("./XiaozeChatToggleButton", () => ({
  XiaozeChatToggleButton: () => <button type="button">toggle</button>
}));

describe("XiaozePopupView", () => {
  it("keeps visible motion on re-render while the popup stays open", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    isModalOpen = true;
    const { rerender } = render(<XiaozePopupView />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("xiaoze-popup-layer")).toHaveAttribute("data-motion", "visible");
    });

    rerender(<XiaozePopupView />);
    rerender(<XiaozePopupView />);

    expect(screen.getByTestId("xiaoze-popup-layer")).toHaveAttribute("data-motion", "visible");
  });
});
