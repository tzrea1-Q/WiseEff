import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AuditEventView } from "@/domain/audit/types";
import { AuditEventDetail } from "./AuditEventDetail";

const event: AuditEventView = {
  id: "ae-1",
  app: "parameter-admin",
  kind: "parameter-update",
  action: "更新 fast_charge_current_limit_ma 推荐值",
  severity: "High",
  actor: "Wang Jie",
  actorType: "user",
  timeLabel: "刚刚",
  createdAt: "2026-05-25T08:00:00.000Z",
  traceId: "trace-1",
  metadata: { previousValue: "3800", newValue: "3200" }
};

describe("AuditEventDetail", () => {
  it("shows placeholder when no event selected", () => {
    render(<AuditEventDetail event={null} />);
    expect(screen.getByText(/选择一条审计记录/)).toBeInTheDocument();
  });

  it("renders diff card for previous/new values", () => {
    render(<AuditEventDetail event={event} />);
    expect(screen.getByText("更新 fast_charge_current_limit_ma 推荐值")).toBeInTheDocument();
    expect(screen.getByText("3800")).toBeInTheDocument();
    expect(screen.getByText("3200")).toBeInTheDocument();
    expect(screen.getByText("trace-1")).toBeInTheDocument();
  });

  it("renders status transition metadata", () => {
    render(
      <AuditEventDetail
        event={{
          ...event,
          kind: "parameter-merge",
          app: "parameter-management",
          metadata: { fromStatus: "pending-merge", toStatus: "merged", note: "approved" }
        }}
      />
    );

    expect(screen.getByText("pending-merge → merged")).toBeInTheDocument();
    expect(screen.getByText("approved")).toBeInTheDocument();
  });
});
