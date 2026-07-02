import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XiaozeToggleHint } from "./XiaozeToggleHint";
import {
  readXiaozeToggleHintDismissed,
  resetXiaozeToggleHintPageState,
  XIAOZE_TOGGLE_HINT_DELAY_MS,
  markXiaozeToggleHintShown
} from "./xiaozeToggleHintStorage";

describe("XiaozeToggleHint", () => {
  beforeEach(() => {
    resetXiaozeToggleHintPageState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reveals after a delay", () => {
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

  it("also shows on pages with proactive insight banners", () => {
    render(<XiaozeToggleHint visible onOpen={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS);
    });

    expect(screen.getByTestId("xiaoze-toggle-hint")).toBeInTheDocument();
  });

  it("hides for the rest of the current page load after dismiss", () => {
    render(<XiaozeToggleHint visible onOpen={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS);
    });

    fireEvent.click(screen.getByLabelText("不再提示"));
    expect(readXiaozeToggleHintDismissed()).toBe(true);
    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
  });

  it("does not reappear on later page visits in the same page load", () => {
    markXiaozeToggleHintShown();

    render(<XiaozeToggleHint visible onOpen={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS + 100);
    });

    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
  });
});
