import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AuditEventView } from "@/domain/audit/types";
import { AuditEventDetailPanel } from "./AuditEventDetailPanel";

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
});
