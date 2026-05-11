import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/mockData";
import { AuditTimeline } from "./AuditTimeline";

const events: AuditEvent[] = [
  { id: "a1", app: "log-admin", actor: "Jane Smith", action: "授予 Mike Kruger 为 Editor", time: "2 小时前", severity: "Low" },
  { id: "a2", app: "logs", actor: "WiseAgent", action: "生成充电温升根因证据链", time: "18 分钟前", severity: "Medium" },
  { id: "a3", app: "logs", actor: "WiseAgent", action: "检出 thermal_snapshot.bin 解析失败", time: "昨天 09:31", severity: "High" },
  { id: "a4", app: "log-admin", actor: "Ana Lin", action: "导出报表", time: "3 小时前", severity: "Low" },
  { id: "a5", app: "log-admin", actor: "Rui Peng", action: "重新分析 log-stuck-01", time: "昨天 14:02", severity: "Medium" },
  { id: "a6", app: "log-admin", actor: "Jane Smith", action: "新增用户 Xiao Wang", time: "前天", severity: "Medium" }
];

describe("AuditTimeline", () => {
  it("renders heading with total count", () => {
    render(<AuditTimeline events={events} />);

    expect(screen.getByText(/审计事件/)).toBeInTheDocument();
    expect(screen.getByText(/6/)).toBeInTheDocument();
  });

  it("renders at most initialVisible events initially", () => {
    render(<AuditTimeline events={events} />);

    expect(screen.getByText("授予 Mike Kruger 为 Editor")).toBeInTheDocument();
    expect(screen.queryByText("新增用户 Xiao Wang")).not.toBeInTheDocument();
  });

  it("expands to show all events when 展开更多 clicked", async () => {
    render(<AuditTimeline events={events} />);

    await userEvent.click(screen.getByRole("button", { name: /展开更多/ }));

    expect(screen.getByText("新增用户 Xiao Wang")).toBeInTheDocument();
  });

  it("shows empty state when events is empty", () => {
    render(<AuditTimeline events={[]} />);

    expect(screen.getByText(/暂无审计事件/)).toBeInTheDocument();
  });

  it("respects custom initialVisible", () => {
    render(<AuditTimeline events={events} initialVisible={2} />);

    expect(screen.getByText("授予 Mike Kruger 为 Editor")).toBeInTheDocument();
    expect(screen.queryByText("检出 thermal_snapshot.bin 解析失败")).not.toBeInTheDocument();
  });

  it("does not render 展开更多 when all events fit", () => {
    render(<AuditTimeline events={events.slice(0, 2)} />);

    expect(screen.queryByRole("button", { name: /展开更多/ })).not.toBeInTheDocument();
  });
});
