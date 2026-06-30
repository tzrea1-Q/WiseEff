import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XiaozePopupView } from "./XiaozePopupView";
import { XIAOZE_POPUP_OPEN_SESSION_KEY, writeXiaozePopupOpenSession } from "./xiaozePopupOpenState";

const setModalOpen = vi.fn();
let isModalOpen = false;
let pagePath = "/parameters";

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

vi.mock("./xiaozePageContext", () => ({
  useXiaozePageContextValue: () => ({ path: pagePath, pageKey: "parameters" })
}));

describe("XiaozePopupView", () => {
  beforeEach(() => {
    sessionStorage.clear();
    isModalOpen = false;
    pagePath = "/parameters";
    setModalOpen.mockReset();
  });

  it("closes on first mount even when session storage says open", () => {
    writeXiaozePopupOpenSession(true);
    isModalOpen = true;

    render(<XiaozePopupView />);

    expect(setModalOpen).toHaveBeenCalledWith(false);
    expect(sessionStorage.getItem(XIAOZE_POPUP_OPEN_SESSION_KEY)).toBeNull();
  });

  it("closes when the page path changes", () => {
    const { rerender } = render(<XiaozePopupView />);
    setModalOpen.mockClear();
    isModalOpen = true;
    pagePath = "/debugging";

    rerender(<XiaozePopupView />);

    expect(setModalOpen).toHaveBeenCalledWith(false);
    expect(sessionStorage.getItem(XIAOZE_POPUP_OPEN_SESSION_KEY)).toBeNull();
  });

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
