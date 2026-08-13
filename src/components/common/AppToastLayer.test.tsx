import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AppToastLayer, inferNotificationTone } from "./AppToastLayer";
import { ToastProvider } from "@/components/common/toast/ToastProvider";

afterEach(() => {
  cleanup();
});

/**
 * Drives the bridge exactly the way AppShell does: a queue reducer feeding
 * `notifications` + a DISMISS handler, with the design-system ToastProvider
 * owning the rendering.
 */
function Harness({ initial }: { initial: string[] }) {
  const [queue, dispatch] = useReducer(
    (current: string[], action: { type: "push"; message: string } | { type: "dismiss" }) =>
      action.type === "push" ? [action.message, ...current] : current.slice(1),
    initial
  );
  return (
    <ToastProvider>
      <AppToastLayer notifications={queue} onDismiss={() => dispatch({ type: "dismiss" })} />
      <button type="button" onClick={() => dispatch({ type: "push", message: "第二条通知" })}>
        push
      </button>
    </ToastProvider>
  );
}

describe("AppToastLayer bridge", () => {
  it("drains queue entries into design-system toasts and consumes the queue", () => {
    render(<Harness initial={["已连接雷泽参数 API"]} />);

    const toast = screen.getByTestId("app-toast");
    expect(toast).toHaveTextContent("已连接雷泽参数 API");
    // Success vocabulary maps to the success tone.
    expect(toast.className).toContain("toast--success");
  });

  it("gives back-to-back notifications their own toast cards", () => {
    render(<Harness initial={["第一条通知"]} />);
    expect(screen.getByTestId("app-toast")).toHaveTextContent("第一条通知");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "push" }));
    });

    const toasts = screen.getAllByTestId("app-toast");
    expect(toasts).toHaveLength(2);
    expect(toasts.map((item) => item.textContent ?? "").join("|")).toContain("第二条通知");
  });

  it("classifies failure vocabulary as an assertive danger toast", () => {
    render(<Harness initial={["无法连接雷泽日志 API"]} />);

    const toast = screen.getByTestId("app-toast");
    expect(toast.className).toContain("toast--danger");
    expect(toast).toHaveAttribute("role", "alert");
  });

  it("supports manual close through the ToastCard close button", () => {
    render(<Harness initial={["需要手动关闭"]} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));

    expect(screen.queryByTestId("app-toast")).not.toBeInTheDocument();
  });

  it("renders nothing itself when the queue is empty", () => {
    render(<Harness initial={[]} />);

    expect(screen.queryByTestId("app-toast")).not.toBeInTheDocument();
  });
});

describe("inferNotificationTone", () => {
  it("maps queue vocabulary onto toast tones", () => {
    expect(inferNotificationTone("无法连接雷泽参数 API，当前无数据")).toBe("danger");
    expect(inferNotificationTone("参数提交失败，请重试")).toBe("danger");
    expect(inferNotificationTone("已提交 RPT-1 的分析反馈")).toBe("success");
    expect(inferNotificationTone("正在同步数据")).toBe("info");
  });
});
