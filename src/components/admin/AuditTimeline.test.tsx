import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AuditEventView } from "@/domain/audit/types";
import { AuditTimeline } from "./AuditTimeline";
import { AuditRelatedTimeline } from "./AuditRelatedTimeline";

const events: AuditEventView[] = [
  {
    id: "a1",
    app: "log-admin",
    kind: "user-role-change",
    actor: "Jane Smith",
    actorType: "user",
    action: "授予 Mike Kruger 为 Editor",
    timeLabel: "2 小时前",
    severity: "Low"
  },
  {
    id: "a2",
    app: "logs",
    kind: "agent-action",
    actor: "WiseAgent",
    actorType: "agent",
    action: "生成充电温升根因证据链",
    timeLabel: "18 分钟前",
    severity: "Medium"
  },
  {
    id: "a3",
    app: "logs",
    kind: "log-upload-failed",
    actor: "WiseAgent",
    actorType: "agent",
    action: "检出 thermal_snapshot.bin 解析失败",
    timeLabel: "昨天 09:31",
    severity: "High"
  },
  {
    id: "a4",
    app: "log-admin",
    kind: "export",
    actor: "Ana Lin",
    actorType: "user",
    action: "导出报表",
    timeLabel: "3 小时前",
    severity: "Low"
  },
  {
    id: "a5",
    app: "log-admin",
    kind: "log-rerun",
    actor: "Rui Peng",
    actorType: "user",
    action: "重新分析 log-stuck-01",
    timeLabel: "昨天 14:02",
    severity: "Medium"
  },
  {
    id: "a6",
    app: "log-admin",
    kind: "user-add",
    actor: "Jane Smith",
    actorType: "user",
    action: "新增用户 Xiao Wang",
    timeLabel: "前天",
    severity: "Medium"
  }
];

describe("AuditTimeline", () => {
  it("presents related trace events with Chinese labels and raw codes too", () => {
    render(<AuditRelatedTimeline events={[
      { ...events[0], kind: "validation.gate", action: "run" },
      { ...events[1], action: "future-action" }
    ]} />);
    expect(screen.getByText("校验门禁检查")).toBeInTheDocument();
    expect(screen.getByText("validation.gate", { selector: "code" })).toBeInTheDocument();
    expect(screen.getAllByText("future-action")).toHaveLength(2);
  });
  it("shows the Chinese event title with both diagnostic codes beneath it", () => {
    render(<AuditTimeline events={[{ ...events[0], kind: "validation.gate", action: "run" }]} />);
    expect(screen.getByText("校验门禁检查")).toBeInTheDocument();
    expect(screen.getByText("validation.gate", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("run", { selector: "code" })).toBeInTheDocument();
  });

  it("keeps an unknown action visible as the title and diagnostic code", () => {
    render(<AuditTimeline events={[{ ...events[0], action: "future-action" }]} />);
    expect(screen.getAllByText("future-action")).toHaveLength(2);
  });
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

  it("calls onSelect when an item is clicked", async () => {
    const onSelect = vi.fn();
    render(<AuditTimeline events={events.slice(0, 2)} onSelect={onSelect} selectedId="a1" />);

    await userEvent.click(screen.getByRole("button", { name: /授予 Mike Kruger/ }));

    expect(onSelect).toHaveBeenCalledWith("a1");
  });
});
