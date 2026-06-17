import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuditCenterPage } from "./AuditCenterPage";
import { initialState } from "./mockData";

afterEach(() => {
  cleanup();
});

describe("AuditCenterPage", () => {
  it("renders cross-module audit events with filters", () => {
    render(
      <AuditCenterPage
        state={initialState}
        dispatch={() => undefined}
        onNavigate={() => undefined}
        search=""
      />
    );

    expect(screen.getByRole("heading", { name: "审计中心" })).toBeInTheDocument();
    expect(screen.getByLabelText("模块筛选")).toBeInTheDocument();
    expect(screen.getAllByText("更新 fast_charge_current_limit_ma 推荐值").length).toBeGreaterThan(0);
  });

  it("shows trace related events for mock data", () => {
    render(
      <AuditCenterPage
        state={initialState}
        dispatch={() => undefined}
        onNavigate={() => undefined}
        search=""
      />
    );

    const timeline = screen.getByRole("heading", { name: "审计事件" }).closest("section");
    expect(timeline).toBeTruthy();
    fireEvent.click(within(timeline!).getByRole("button", { name: /导入 8 条混合参数草稿/ }));

    expect(screen.getByText("同一 Trace 链路")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Trace 关联事件")).getByText(/更新 fast_charge_current_limit_ma/)).toBeInTheDocument();
  });
});
