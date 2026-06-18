import { describe, expect, it } from "vitest";
import { presentAuditEvent } from "./presentAuditEvent";
import type { AuditEventView } from "./types";

const baseEvent: AuditEventView = {
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
  targetType: "parameter-change-request",
  targetId: "request-1",
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

describe("presentAuditEvent", () => {
  it("builds human-readable parameter change and participants", () => {
    const presentation = presentAuditEvent(baseEvent);

    expect(presentation.headline).toContain("fast_charge_current_limit_ma");
    expect(presentation.parameterChange).toMatchObject({
      name: "fast_charge_current_limit_ma",
      previousValue: "3200",
      newValue: "3800"
    });
    expect(presentation.statusChange).toMatchObject({
      from: "软件开发人员合入",
      to: "已合入"
    });
    expect(presentation.participants).toHaveLength(2);
    expect(presentation.technical.some((row) => row.label === "Trace ID")).toBe(true);
  });

  it("falls back to previous/new value metadata", () => {
    const presentation = presentAuditEvent({
      ...baseEvent,
      kind: "parameter-update",
      action: "更新 fast_charge_current_limit_ma 推荐值",
      metadata: { previousValue: "3800", newValue: "3200" }
    });

    expect(presentation.parameterChange).toMatchObject({
      name: "fast_charge_current_limit_ma",
      previousValue: "3800",
      newValue: "3200"
    });
  });
});
