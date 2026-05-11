import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UndoableToast } from "./UndoableToast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("UndoableToast", () => {
  it("renders the message, progress bar, and undo button", () => {
    render(<UndoableToast message="已删除 X" timeout={5000} onExpire={vi.fn()} onUndo={vi.fn()} />);

    expect(screen.getByText("已删除 X")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /撤销/ })).toBeInTheDocument();
    expect(document.querySelector(".undo-toast-progress")).toBeInTheDocument();
  });

  it("calls onExpire after timeout", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<UndoableToast message="x" timeout={300} onExpire={onExpire} onUndo={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("calls onUndo when undo is clicked", () => {
    const onUndo = vi.fn();
    render(<UndoableToast message="x" timeout={5000} onExpire={vi.fn()} onUndo={onUndo} />);

    fireEvent.click(screen.getByRole("button", { name: /撤销/ }));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
