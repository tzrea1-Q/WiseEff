import { act, fireEvent, render, screen } from "@testing-library/react";
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
  XiaozeChatToggleButton: () => (
    <button type="button" data-slot="chat-toggle-button">
      toggle
    </button>
  )
}));

vi.mock("./xiaozePageContext", () => ({
  useXiaozePageContextValue: () => ({ path: pagePath, pageKey: "parameters" })
}));

describe("XiaozePopupView", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
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
    isModalOpen = true;
    const { rerender } = render(<XiaozePopupView />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("xiaoze-popup-layer")).toHaveAttribute("data-motion", "visible");
    });

    rerender(<XiaozePopupView />);
    rerender(<XiaozePopupView />);

    expect(screen.getByTestId("xiaoze-popup-layer")).toHaveAttribute("data-motion", "visible");
  });

  it("keeps the leaving animation without exposing an active modal", () => {
    vi.useFakeTimers();

    isModalOpen = true;
    const { rerender } = render(<XiaozePopupView />);
    setModalOpen.mockClear();

    const activeDialog = screen.getByRole("dialog", { name: "小泽" });
    activeDialog.focus();
    expect(activeDialog).toHaveFocus();

    isModalOpen = false;
    rerender(<XiaozePopupView />);

    const leavingLayer = screen.getByTestId("xiaoze-popup-layer");
    expect(leavingLayer).toHaveAttribute("data-motion", "leaving");
    expect(screen.queryByRole("dialog", { name: "小泽" })).not.toBeInTheDocument();
    expect(screen.getByTestId("copilot-popup")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("copilot-popup")).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "toggle" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(setModalOpen).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(359);
    });
    expect(leavingLayer).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("xiaoze-popup-layer")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("does not close the popup when a pointer-down lands inside the approval card", () => {
    isModalOpen = true;
    render(<XiaozePopupView />);
    setModalOpen.mockClear();

    // Approval card portals to <body>, outside the popup container.
    const approvalContent = document.createElement("div");
    approvalContent.setAttribute("data-slot", "alert-dialog-content");
    const approveButton = document.createElement("button");
    approveButton.textContent = "Approve";
    approvalContent.appendChild(approveButton);
    document.body.appendChild(approvalContent);

    fireEvent.pointerDown(approveButton);

    expect(setModalOpen).not.toHaveBeenCalled();

    document.body.removeChild(approvalContent);
  });

  it("does not close the popup when the approval overlay is clicked as a scrim", () => {
    isModalOpen = true;
    render(<XiaozePopupView />);
    setModalOpen.mockClear();

    const overlay = document.createElement("div");
    overlay.setAttribute("data-slot", "alert-dialog-overlay");
    document.body.appendChild(overlay);

    fireEvent.pointerDown(overlay);

    expect(setModalOpen).not.toHaveBeenCalled();

    document.body.removeChild(overlay);
  });

  it("still closes the popup on a genuine outside pointer-down", () => {
    isModalOpen = true;
    render(<XiaozePopupView />);
    setModalOpen.mockClear();

    const outside = document.createElement("div");
    document.body.appendChild(outside);

    fireEvent.pointerDown(outside);

    expect(setModalOpen).toHaveBeenCalledWith(false);

    document.body.removeChild(outside);
  });
});
