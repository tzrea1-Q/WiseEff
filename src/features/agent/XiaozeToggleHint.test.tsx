import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { XiaozeToggleHint } from "./XiaozeToggleHint";
import { XiaozePageContext } from "./xiaozePageContext";
import {
  readXiaozeToggleHintDismissed,
  resetXiaozeToggleHintPageState,
  XIAOZE_TOGGLE_HINT_DELAY_MS,
  markXiaozeToggleHintShown
} from "./xiaozeToggleHintStorage";

describe("XiaozeToggleHint", () => {
  beforeEach(() => {
    localStorage.clear();
    resetXiaozeToggleHintPageState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["parameter-review", "parameter-submissions"])("suppresses promotion on %s without consuming another page's introduction", (pageKey) => {
    const hint = render(<XiaozePageContext.Provider value={{ path: `/${pageKey}`, pageKey }}>
      <XiaozeToggleHint visible onOpen={vi.fn()} />
    </XiaozePageContext.Provider>);
    act(() => vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS));
    expect(screen.getByTestId("xiaoze-toggle-hint-readiness")).toHaveAttribute("data-state", "suppressed");
    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
    hint.rerender(<XiaozePageContext.Provider value={{ path: "/parameters", pageKey: "parameters" }}>
      <XiaozeToggleHint visible onOpen={vi.fn()} />
    </XiaozePageContext.Provider>);
    act(() => vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS));
    expect(screen.getByTestId("xiaoze-toggle-hint")).toBeInTheDocument();
  });

  it("reveals after a delay", () => {
    const onOpen = vi.fn();

    render(<XiaozeToggleHint visible onOpen={onOpen} />);

    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("xiaoze-toggle-hint-readiness")).toHaveAttribute("data-state", "pending");

    act(() => {
      vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS - 1);
    });
    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("xiaoze-toggle-hint-readiness")).toHaveAttribute("data-state", "pending");
    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByTestId("xiaoze-toggle-hint")).toBeInTheDocument();
    expect(screen.getByTestId("xiaoze-toggle-hint-readiness")).toHaveAttribute("data-state", "revealed");

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
    expect(screen.getByTestId("xiaoze-toggle-hint-readiness")).toHaveAttribute("data-state", "suppressed");
  });

  it("does not reappear on later page visits in the same page load", () => {
    markXiaozeToggleHintShown();

    render(<XiaozeToggleHint visible onOpen={vi.fn()} />);

    expect(screen.getByTestId("xiaoze-toggle-hint-readiness")).toHaveAttribute("data-state", "suppressed");

    act(() => {
      vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS + 100);
    });

    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
  });

  it("keeps dismissal across navigation and a fresh page load", () => {
    const firstVisit = render(<XiaozeToggleHint userId="returning-user" visible onOpen={vi.fn()} />);
    act(() => vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS));
    fireEvent.click(screen.getByLabelText("不再提示"));
    firstVisit.unmount();
    const nextVisit = render(<XiaozeToggleHint userId="returning-user" visible onOpen={vi.fn()} />);
    act(() => vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS));
    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
    nextVisit.unmount();
    resetXiaozeToggleHintPageState();
    render(<XiaozeToggleHint userId="returning-user" visible onOpen={vi.fn()} />);
    act(() => vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS));
    expect(screen.queryByTestId("xiaoze-toggle-hint")).not.toBeInTheDocument();
  });

  it("does not dismiss the hint for another user", () => {
    const firstUser = render(<XiaozeToggleHint userId="first-user" visible onOpen={vi.fn()} />);
    act(() => vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS));
    fireEvent.click(screen.getByLabelText("不再提示"));
    firstUser.unmount();
    render(<XiaozeToggleHint userId="second-user" visible onOpen={vi.fn()} />);
    act(() => vi.advanceTimersByTime(XIAOZE_TOGGLE_HINT_DELAY_MS));
    expect(screen.getByTestId("xiaoze-toggle-hint")).toBeInTheDocument();
  });
});
