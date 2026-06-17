import { describe, expect, it } from "vitest";
import { mapApiAuditEventToView, mapMockAuditEventToView, isParameterAdminAuditApp } from "./mapAuditEventView";

describe("mapAuditEventView", () => {
  it("maps API audit events with actor name and ISO time", () => {
    const view = mapApiAuditEventToView({
      id: "audit-1",
      organizationId: "org-1",
      projectId: "aurora",
      actorUserId: "u-1",
      actorType: "user",
      actorName: "Wang Jie",
      app: "parameter-management",
      kind: "parameter-merge",
      action: "merge",
      severity: "High",
      targetType: "parameter-change-request",
      targetId: "req-1",
      metadata: { fromStatus: "pending-merge", toStatus: "merged" },
      traceId: "trace-1",
      createdAt: "2026-05-25T08:00:00.000Z"
    });

    expect(view.actor).toBe("Wang Jie");
    expect(view.app).toBe("parameter-management");
    expect(view.traceId).toBe("trace-1");
    expect(view.metadata?.fromStatus).toBe("pending-merge");
  });

  it("maps mock audit events preserving relative labels when time is not ISO", () => {
    const view = mapMockAuditEventToView({
      id: "ae-1",
      app: "parameter-admin",
      actor: "Sun Mei",
      action: "调整 battery_temp_target_c 范围",
      time: "12 分钟前",
      severity: "Medium",
      kind: "parameter-update",
      metadata: { previousValue: "32 - 44", newValue: "30 - 42" }
    });

    expect(view.timeLabel).toBe("12 分钟前");
    expect(view.metadata?.previousValue).toBe("32 - 44");
  });

  it("recognizes parameter admin audit apps", () => {
    expect(isParameterAdminAuditApp("parameter-admin")).toBe(true);
    expect(isParameterAdminAuditApp("parameter-management")).toBe(true);
    expect(isParameterAdminAuditApp("log-analysis")).toBe(false);
  });
});
