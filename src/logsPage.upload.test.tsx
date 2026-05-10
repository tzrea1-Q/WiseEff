import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { reducer } from "./App";
import { initialState } from "./mockData";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("reducer · SIMULATE_LOG_UPLOAD", () => {
  it("supported=true 时新增 Processing 状态 log", () => {
    const next = reducer(initialState, { type: "SIMULATE_LOG_UPLOAD", fileName: "new.log", supported: true });

    expect(next.logs.length).toBe(initialState.logs.length + 1);
    expect(next.logs[0].status).toBe("Processing");
    expect(next.logs[0].fileName).toBe("new.log");
    expect(next.logs[0].stage).toBe("parse");
  });

  it("supported=false 时新增 Failed 状态 log 且带 failureReason", () => {
    const next = reducer(initialState, { type: "SIMULATE_LOG_UPLOAD", fileName: "x.bin", supported: false });

    expect(next.logs[0].status).toBe("Failed");
    expect(next.logs[0].failureReason).toMatch(/不支持/);
  });
});

describe("LogsPage · 上传日志对话框", () => {
  it("打开时聚焦文件选择入口并设置 aria-modal", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));

    const dialog = screen.getByRole("dialog", { name: "上传日志" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("选择日志文件")).toHaveFocus();
  });

  it("选择支持格式后先显示 validating，再确认上传并新增 Processing 日志", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByLabelText("选择日志文件"), { target: { files: [new File(["x"], "fresh.log")] } });

    expect(screen.getByText(/正在读取/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByText(/正在读取/)).not.toBeInTheDocument();
    expect(screen.getByText("fresh.log")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认上传" }));

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /fresh\.log/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog", { name: "上传日志" })).not.toBeInTheDocument();
  });

  it("选择不支持格式后显示警示，仍然上传会创建 Failed 日志", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByLabelText("选择日志文件"), { target: { files: [new File(["x"], "thermal.bin")] } });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    const dialog = screen.getByRole("dialog", { name: "上传日志" });
    expect(dialog).toHaveTextContent("格式不支持");

    fireEvent.click(within(dialog).getByRole("button", { name: "仍然上传" }));

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /thermal\.bin/ })).toHaveTextContent("失败");
    expect(screen.getByRole("alert")).toHaveTextContent(/格式不支持/);
  });

  it("Failed 日志点击重新上传会打开 UploadLogDialog", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot/ }));
    fireEvent.click(screen.getByRole("button", { name: /重新上传/ }));

    expect(screen.getByRole("dialog", { name: "上传日志" })).toBeInTheDocument();
  });
});
