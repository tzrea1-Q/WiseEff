import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_TOAST_AUTO_DISMISS_MS, AppToastLayer } from "./AppToastLayer";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AppToastLayer", () => {
  it("renders the newest notification inside a polite live region", () => {
    render(<AppToastLayer notifications={["最新通知", "旧通知"]} onDismiss={() => {}} />);

    const layer = screen.getByTestId("app-toast-layer");
    expect(layer).toHaveAttribute("role", "status");
    expect(layer).toHaveAttribute("aria-live", "polite");
    expect(screen.getByTestId("app-toast")).toHaveTextContent("最新通知");
    expect(screen.getByTestId("app-toast")).not.toHaveTextContent("旧通知");
  });

  it("renders no toast card when the queue is empty", () => {
    render(<AppToastLayer notifications={[]} onDismiss={() => {}} />);

    expect(screen.queryByTestId("app-toast")).not.toBeInTheDocument();
  });

  it("requests dismissal after the auto-dismiss window", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<AppToastLayer notifications={["操作成功"]} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(APP_TOAST_AUTO_DISMISS_MS - 1);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("re-arms the auto-dismiss window when a new notification arrives", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const view = render(<AppToastLayer notifications={["第一条"]} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(APP_TOAST_AUTO_DISMISS_MS - 500);
    view.rerender(<AppToastLayer notifications={["第二条", "第一条"]} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(500);
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(APP_TOAST_AUTO_DISMISS_MS - 500);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on the close button without waiting for the timer", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<AppToastLayer notifications={["需要手动关闭"]} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
