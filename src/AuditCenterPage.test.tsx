import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditCenterPage } from "./AuditCenterPage";
import { initialState } from "./mockData";

afterEach(() => {
  cleanup();
});

describe("AuditCenterPage", () => {
  it("combines severity choices while preserving the other query filters", () => {
    const onNavigate = vi.fn();
    render(<AuditCenterPage state={initialState} dispatch={() => undefined} onNavigate={onNavigate}
      search="?app=parameters&severity=Medium&q=fast&tw=7d&projectId=aurora&traceId=trace-example" />);
    fireEvent.click(screen.getByRole("button", { name: "筛选严重度" }));
    const severity = screen.getByRole("group", { name: "严重度筛选" });
    expect(within(severity).getByRole("checkbox", { name: "中" })).toBeChecked();
    fireEvent.click(within(severity).getByRole("checkbox", { name: "高" }));
    expect(onNavigate).toHaveBeenCalledWith("/audit?app=parameter&severity=High%2CMedium&q=fast&tw=7d&projectId=aurora&traceId=trace-example");
    fireEvent.click(within(severity).getByRole("button", { name: "清除" }));
    expect(onNavigate).toHaveBeenCalledWith("/audit?app=parameter&q=fast&tw=7d&projectId=aurora&traceId=trace-example");
  });

  it("renders cross-module audit events with filters", () => {
    render(
      <AuditCenterPage
        state={initialState}
        dispatch={() => undefined}
        onNavigate={() => undefined}
        search=""
      />
    );

    expect(screen.queryByRole("heading", { level: 1, name: "审计中心" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("模块筛选")).toBeInTheDocument();
    expect(screen.getAllByText("更新 fast_charge_current_limit_ma 推荐值").length).toBeGreaterThan(0);
  });

  it("opens audit detail dialog when an event is selected", async () => {
    render(
      <AuditCenterPage
        state={initialState}
        dispatch={() => undefined}
        onNavigate={() => undefined}
        search=""
      />
    );

    const table = screen.getByRole("table", { name: "审计事件" });
    const row = within(table).getByText("导入 8 条混合参数草稿").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "查看" }));

    const dialog = screen.getByRole("dialog", { name: "操作证据与变更摘要" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "关联事件" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("关联事件")).toBeInTheDocument();
    expect(within(dialog).getByText(/更新 fast_charge_current_limit_ma/)).toBeInTheDocument();
  });
});
