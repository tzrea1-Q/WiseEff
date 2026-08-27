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
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    isModalOpen = false;
    pagePath = "/parameters";
    setModalOpen.mockReset();
  });

  it("keeps an explicitly opened popup open on first mount", () => {
    writeXiaozePopupOpenSession(true);
    isModalOpen = true;

    render(<XiaozePopupView />);

    expect(setModalOpen).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(XIAOZE_POPUP_OPEN_SESSION_KEY)).toBe("1");
  });

  it("keeps the popup open when the page path changes", () => {
    const { rerender } = render(<XiaozePopupView />);
    setModalOpen.mockClear();
    isModalOpen = true;
    pagePath = "/debugging";

    rerender(<XiaozePopupView />);

    expect(setModalOpen).not.toHaveBeenCalled();
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

  it("retains mobile scrim dismissal and restores toggle focus", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    isModalOpen = false;
    const { rerender } = render(<XiaozePopupView />);
    const toggle = screen.getByRole("button", { name: "toggle" });
    toggle.focus();
    isModalOpen = true;
    rerender(<XiaozePopupView />);
    setModalOpen.mockClear();

    const layer = screen.getByTestId("xiaoze-popup-layer");
    const scrim = layer.querySelector<HTMLButtonElement>(".xiaoze-popup-scrim");
    expect(scrim).not.toBeNull();
    fireEvent.pointerDown(scrim!);
    expect(setModalOpen).not.toHaveBeenCalled();

    // A real button pointer sequence focuses the scrim before dispatching click.
    scrim!.focus();
    expect(scrim).toHaveFocus();
    fireEvent.click(scrim!);
    expect(setModalOpen).toHaveBeenCalledWith(false);
    isModalOpen = false;
    rerender(<XiaozePopupView />);

    expect(layer).toHaveAttribute("data-motion", "leaving");
    expect(screen.queryByRole("dialog", { name: "小泽" })).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();

    act(() => {
      vi.advanceTimersByTime(359);
    });
    expect(layer).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("xiaoze-popup-layer")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("does not steal focus that moved outside the popup before it closed", () => {
    vi.useFakeTimers();

    isModalOpen = true;
    const { rerender } = render(<XiaozePopupView />);
    const externalControl = document.createElement("button");
    externalControl.textContent = "external action";
    document.body.appendChild(externalControl);
    externalControl.focus();

    isModalOpen = false;
    rerender(<XiaozePopupView />);

    expect(externalControl).toHaveFocus();
    expect(screen.getByTestId("xiaoze-popup-layer")).toHaveAttribute("data-motion", "leaving");

    act(() => {
      vi.advanceTimersByTime(360);
    });
    document.body.removeChild(externalControl);
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

  it("keeps the desktop popup open on a genuine outside pointer-down", () => {
    isModalOpen = true;
    render(<XiaozePopupView />);
    setModalOpen.mockClear();

    const outside = document.createElement("div");
    document.body.appendChild(outside);

    fireEvent.pointerDown(outside);

    expect(setModalOpen).not.toHaveBeenCalled();

    document.body.removeChild(outside);
  });

  it("uses modeless dialog semantics on desktop while leaving the page focusable", () => {
    isModalOpen = true;
    render(<XiaozePopupView />);

    const dialog = screen.getByRole("dialog", { name: "小泽" });
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("button", { name: "关闭小泽遮罩" })).not.toBeInTheDocument();

    const pageControl = document.createElement("button");
    document.body.appendChild(pageControl);
    pageControl.focus();
    expect(pageControl).toHaveFocus();
    pageControl.remove();
  });

  it("scopes desktop Escape handling to Xiaoze-owned focus", () => {
    isModalOpen = true;
    render(<XiaozePopupView />);
    setModalOpen.mockClear();

    const pageControl = document.createElement("button");
    document.body.appendChild(pageControl);
    pageControl.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(setModalOpen).not.toHaveBeenCalled();

    screen.getByRole("dialog", { name: "小泽" }).focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(setModalOpen).toHaveBeenCalledWith(false);
    pageControl.remove();
  });

  it("retains modal dialog semantics on the mobile full-screen breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    isModalOpen = true;
    render(<XiaozePopupView />);

    expect(screen.getByRole("dialog", { name: "小泽" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("xiaoze-popup-layer").querySelector(".xiaoze-popup-scrim")).not.toBeNull();
  });

  it("makes the mobile background inert and traps Tab inside the full-screen dialog", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    isModalOpen = true;
    render(<XiaozePopupView />);

    const dialog = screen.getByRole("dialog", { name: "小泽" });
    const toggle = screen.getByRole("button", { name: "toggle" });
    expect(toggle).toHaveAttribute("inert");

    const first = document.createElement("button");
    first.textContent = "first";
    const last = document.createElement("button");
    last.textContent = "last";
    dialog.append(first, last);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("moves focus into the dialog when crossing to mobile and restores it on close", () => {
    vi.useFakeTimers();
    isModalOpen = true;
    const { rerender } = render(<XiaozePopupView />);
    const pageControl = document.createElement("button");
    pageControl.textContent = "page action";
    document.body.appendChild(pageControl);
    pageControl.focus();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    act(() => window.dispatchEvent(new Event("resize")));

    const dialog = screen.getByRole("dialog", { name: "小泽" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();

    const first = document.createElement("button");
    first.textContent = "first";
    const last = document.createElement("button");
    last.textContent = "last";
    dialog.append(first, last);
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    isModalOpen = false;
    rerender(<XiaozePopupView />);
    expect(pageControl).toHaveFocus();

    act(() => vi.advanceTimersByTime(360));
    pageControl.remove();
    vi.useRealTimers();
  });
});
