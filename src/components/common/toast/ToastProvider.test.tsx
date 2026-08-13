import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast, type ToastInput } from "./ToastProvider";

function Trigger({ input }: { input: ToastInput }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(input)}>
      触发
    </button>
  );
}

function renderWithProvider(input: ToastInput) {
  return render(
    <ToastProvider>
      <Trigger input={input} />
    </ToastProvider>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("stacks queued toasts in one viewport and renders status roles", () => {
    render(
      <ToastProvider>
        <Trigger input={{ tone: "success", message: "第一条已保存" }} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "触发" }));
    fireEvent.click(screen.getByRole("button", { name: "触发" }));

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(2);
    expect(document.querySelectorAll(".toast-viewport")).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent("第一条已保存");
  });

  it("uses an alert role for danger toasts", () => {
    renderWithProvider({ tone: "danger", message: "操作失败" });

    fireEvent.click(screen.getByRole("button", { name: "触发" }));

    expect(screen.getByRole("alert")).toHaveTextContent("操作失败");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("auto-dismisses after four seconds", () => {
    vi.useFakeTimers();
    renderWithProvider({ tone: "info", message: "稍后消失" });

    fireEvent.click(screen.getByRole("button", { name: "触发" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("pauses auto-dismiss while hovered and resumes on leave", () => {
    vi.useFakeTimers();
    renderWithProvider({ tone: "info", message: "悬停暂停" });

    fireEvent.click(screen.getByRole("button", { name: "触发" }));
    fireEvent.mouseEnter(screen.getByRole("status"));

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("runs the optional action and dismisses the toast", () => {
    const onAction = vi.fn();
    renderWithProvider({ tone: "success", message: "已归档", action: { label: "撤销", onClick: onAction } });

    fireEvent.click(screen.getByRole("button", { name: "触发" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("throws when used outside the provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger input={{ tone: "info", message: "无提供者" }} />)).toThrow(
      /ToastProvider/
    );
    consoleError.mockRestore();
  });
});
