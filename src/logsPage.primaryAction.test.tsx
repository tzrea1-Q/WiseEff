import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { getContextQuery } from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("getContextQuery", () => {
  it("返回 logId 字段", () => {
    const query = getContextQuery("?logId=log-active&project=aurora");

    expect(query.logId).toBe("log-active");
    expect(query.projectId).toBe("aurora");
  });

  it("无 logId 时返回空字符串", () => {
    const query = getContextQuery("?project=aurora");

    expect(query.logId).toBe("");
  });
});

describe("LogsPage · 主行动", () => {
  it("Complete 日志点击主按钮跳转到 /parameters 且 URL 带 logId", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成参数修改请求/ }));

    expect(window.location.pathname).toBe("/parameters");
    expect(window.location.search).toContain("logId=log-auth");
    expect(window.location.search).toContain("project=aurora");
  });

  it("从日志跳到参数页后，修改原因预填日志结论", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成参数修改请求/ }));

    const reason = screen.getByLabelText("修改原因");
    expect(reason).toHaveValue("依据日志 usb_pd_negotiation_20260503.log 分析：PD 协商在 9V/3A 档位稳定完成，未出现握手重试。");
  });

  it("点击导出报告会创建 Markdown 下载", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    fireEvent.click(screen.getByRole("button", { name: /导出报告/ }));

    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("点击复制链接会写入包含 logId 的分享链接", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /复制链接/ }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("logId=log-active"));
  });
});
