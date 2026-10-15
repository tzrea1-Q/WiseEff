import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AuditEventView } from "@/domain/audit/types";
import { AuditEventDetailPanel } from "./AuditEventDetailPanel";
import { AuditEventDetailDialog } from "./AuditEventDetailDialog";

const event: AuditEventView = {
  id: "ae-1",
  app: "parameter-management",
  kind: "parameter-merge",
  action: "merge",
  severity: "High",
  actor: "Liu Min",
  actorType: "user",
  timeLabel: "9 小时前",
  createdAt: "2026-06-17T08:42:31.000Z",
  traceId: "trace-1",
  metadata: {
    fromStatus: "software_merge",
    toStatus: "merged",
    parameterName: "fast_charge_current_limit_ma",
    module: "Charging Policy",
    currentValue: "3200",
    targetValue: "3800",
    risk: "High",
    submitter: "Wang Jie",
    participants: [
      { role: "提交人", name: "Wang Jie", action: "提交变更" },
      { role: "硬件 Committer 检视", name: "Sun Mei", action: "推进流程" }
    ]
  }
};

describe("AuditEventDetailPanel", () => {
  it("renders parameter change, participants, and collapsible technical details", () => {
    render(<AuditEventDetailPanel event={event} />);

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("fast_charge_current_limit_ma");
    expect(screen.getByText("3200")).toBeInTheDocument();
    expect(screen.getByText("3800")).toBeInTheDocument();
    expect(screen.getByText("参与人员")).toBeInTheDocument();
    expect(screen.getByText("Wang Jie")).toBeInTheDocument();
    expect(screen.queryByText("trace-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /技术追踪信息/ }));
    expect(screen.getByText("trace-1")).toBeInTheDocument();
  });

  it("shows informational and unknown severity without blank badges and explains missing evidence", () => {
    const { rerender } = render(<AuditEventDetailPanel event={{ ...event, actor: "System", actorType: "system", severity: "info", metadata: {}, targetName: "充电电流" }} />);
    expect(screen.getByText("信息")).toBeInTheDocument();
    expect(screen.getByText("系统", { selector: ".audit-event-context dd" })).toBeInTheDocument();
    expect(screen.queryByText("系统", { selector: ".audit-event-context dd > span" })).not.toBeInTheDocument();
    expect(screen.getByText(/此事件未记录可展示的变更前后内容/)).toBeInTheDocument();
    expect(screen.queryByText("参与人员")).not.toBeInTheDocument();
    rerender(<AuditEventDetailPanel event={{ ...event, severity: "future" as AuditEventView["severity"], metadata: {} }} />);
    expect(screen.getByText("未知")).toBeInTheDocument();
  });

  it("keeps related errors actionable and supports next-event browsing and copying", async () => {
    const next = vi.fn();
    const retry = vi.fn();
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
    render(<AuditEventDetailDialog event={event} relatedEvents={[]} relatedError="关联事件加载失败" onRetryRelated={retry} onNext={next} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    expect(next).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "上一条" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("事件链接已复制"));
    expect(copy).toHaveBeenCalledWith(expect.stringContaining("eventId=ae-1"));
  });

  it("reports clipboard failures", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<AuditEventDetailDialog event={event} relatedEvents={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("复制失败"));
  });

  it("shows source-only evidence accurately instead of claiming no records exist", () => {
    render(<AuditEventDetailPanel event={{ ...event, metadata: {}, evidence: { sourceLabel: "已核对 120 条历史，参数值未发生变化" } }} />);
    expect(screen.getByText("已核对 120 条历史，参数值未发生变化")).toBeInTheDocument();
    expect(screen.queryByText(/此事件未记录可展示/)).not.toBeInTheDocument();
  });

  it("renders named changes separately and expands exact long values only on demand", () => {
    const longValue = { payload: "x".repeat(200), enabled: false };
    const { container } = render(<AuditEventDetailPanel event={{ ...event, metadata: {}, evidence: {
      previousValue: [{ target: "充电电流", value: 5000 }, { target: "配置内容", value: { enabled: true } }],
      newValue: [{ target: "配置内容", value: longValue }, { target: "充电电流", value: 6000 }]
    } }} />);
    expect(screen.getByRole("heading", { name: "充电电流", level: 5 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "配置内容", level: 5 })).toBeInTheDocument();
    expect(screen.getByText("5000")).toBeInTheDocument();
    expect(screen.getByText("6000")).toBeInTheDocument();
    const disclosure = container.querySelector("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure?.querySelector("code")?.textContent).toBe(JSON.stringify(longValue, null, 2));
    fireEvent.click(screen.getByText("查看完整值"));
    expect(disclosure).toHaveAttribute("open");
  });

  it("distinguishes deletion and restoration from unchanged retained values", () => {
    const { rerender } = render(<AuditEventDetailPanel event={{ ...event, metadata: {}, evidence: {
      previousValue: 5000, newValue: 5000, previousValueState: "present", newValueState: "deleted"
    } }} />);
    expect(screen.getByText("已删除")).toBeInTheDocument();
    expect(screen.getByText("有效值")).toBeInTheDocument();
    expect(screen.getByText("保留的历史内容")).toBeInTheDocument();
    expect(screen.getAllByText("5000")).toHaveLength(2);
    expect(screen.getByText("已删除").closest(".audit-parameter-diff")?.lastElementChild).toContainElement(screen.getByText("已删除"));
    rerender(<AuditEventDetailPanel event={{ ...event, metadata: {}, evidence: {
      previousValue: [{ target: "充电电流", value: 5000, valueState: "deleted" }],
      newValue: [{ target: "充电电流", value: 5000, valueState: "present" }]
    } }} />);
    expect(screen.getByText("已删除").closest(".audit-parameter-diff")?.firstElementChild).toContainElement(screen.getByText("已删除"));
    expect(screen.getByText("有效值").closest(".audit-parameter-diff")?.lastElementChild).toContainElement(screen.getByText("有效值"));
  });
});
