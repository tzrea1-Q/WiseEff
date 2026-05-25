import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { createAuditEvent, listAuditEvents } from "./repository";

describe("audit repository", () => {
  it("inserts audit events with metadata", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [{ id: "audit-1" } as Row], rowCount: 1 };
      }
    };

    await createAuditEvent(db, {
      id: "audit-1",
      organizationId: "org-chargelab",
      projectId: "aurora",
      actorUserId: "u-xu-yun",
      actorType: "user",
      app: "parameter-admin",
      kind: "export",
      action: "Exported parameter snapshot",
      severity: "Low",
      targetType: "parameter-snapshot",
      targetId: "snap-1",
      metadata: { snapshotName: "parameter-admin.json" },
      traceId: "trace-1"
    });

    expect(calls[0].text).toContain("insert into audit_events");
    expect(calls[0].values).toContain("audit-1");
  });

  it("lists audit events for an organization", async () => {
    const db: Queryable = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "audit-1",
            organization_id: "org-chargelab",
            project_id: "aurora",
            actor_user_id: "u-xu-yun",
            actor_type: "user",
            app: "parameter-admin",
            kind: "export",
            action: "Exported parameter snapshot",
            severity: "Low",
            target_type: "parameter-snapshot",
            target_id: "snap-1",
            metadata: { snapshotName: "parameter-admin.json" },
            trace_id: "trace-1",
            created_at: "2026-05-25T00:00:00.000Z"
          } as Row
        ],
        rowCount: 1
      })
    };

    const rows = await listAuditEvents(db, { organizationId: "org-chargelab" });

    expect(rows[0].id).toBe("audit-1");
    expect(rows[0].metadata).toEqual({ snapshotName: "parameter-admin.json" });
  });
});
