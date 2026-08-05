import { describe, expect, it } from "vitest";

import {
  initialParameterAdminState,
  parameterAdminReducer,
  type ParameterAdminRecentAuditEvent
} from "./parameterAdminState";

describe("parameterAdminReducer audit projection", () => {
  it("stores recent audit events from the audit center projection", () => {
    const events: ParameterAdminRecentAuditEvent[] = [
      {
        id: "ae-1",
        kind: "project.updated",
        summary: "Updated project Aurora",
        reason: "rename",
        recordedAt: "2026-08-05T10:00:00.000Z"
      }
    ];

    const next = parameterAdminReducer(initialParameterAdminState, {
      type: "SET_RECENT_AUDIT_EVENTS",
      events
    });

    expect(next.recentAuditEvents).toEqual(events);
    expect(next).not.toHaveProperty("auditHints");
  });

  it("clears recent audit events", () => {
    const seeded = parameterAdminReducer(initialParameterAdminState, {
      type: "SET_RECENT_AUDIT_EVENTS",
      events: [
        {
          id: "ae-1",
          kind: "module.created",
          summary: "Created module",
          reason: "",
          recordedAt: "2026-08-05T10:00:00.000Z"
        }
      ]
    });

    const next = parameterAdminReducer(seeded, { type: "CLEAR_RECENT_AUDIT_EVENTS" });
    expect(next.recentAuditEvents).toEqual([]);
  });
});
