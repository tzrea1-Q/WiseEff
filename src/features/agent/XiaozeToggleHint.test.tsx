import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XiaozeToggleHint } from "./XiaozeToggleHint";
import { XIAOZE_TOGGLE_HINT_DELAY_MS, XIAOZE_TOGGLE_HINT_STORAGE_KEY } from "./xiaozeToggleHintStorage";

const useXiaozePageContextValue = vi.fn();

vi.mock("./xiaozePageContext", () => ({
  useXiaozePageContextValue: () => useXiaozePageContextValue()
}));

describe("XiaozeToggleHint", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    useXiaozePageContextValue.mockReturnValue({ path: "/debugging", pageKey: "debugging" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reveals after a delay on pages without proactive insights", () => {
    const onOpen = vi.fn();

    render(<XiaozeToggleHint visible onOpen={onOpen} />);

    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS);
    });

    expect(screen.getByTestId("xiaoze-toggle-hint")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "有问题？点这里问小泽" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not show on pages that already have proactive insight banners", () => {
    useXiaozePageContextValue.mockReturnValue({
      path: "/parameters",
      pageKey: "parameters",
      projectId: "aurora"
    });

    render(<XiaozeToggleHint visible onOpen={vi.fn()} />);

    vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS + 100);

    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
  });

  it("persists dismissal", () => {
    render(<XiaozeToggleHint visible onOpen={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS);
    });

    fireEvent.click(screen.getByLabelText("不再提示"));
    expect(localStorage.getItem(XIAOZE_TOGGLE_HINT_STORAGE_KEY)).toBe("1");
    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
  });
});
