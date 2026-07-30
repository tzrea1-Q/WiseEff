import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { createAuditEvent, listAuditEvents, writePlatformAuditEvent } from "./repository";

describe("audit repository", () => {
  it("rejects platform-scoped audit rows outside writePlatformAuditEvent", async () => {
    const db: Queryable = {
      query: async () => ({ rows: [], rowCount: 0 })
    };

    await expect(
      createAuditEvent(db, {
        id: "audit-platform",
        organizationId: null,
        projectId: null,
        actorUserId: "u-platform-admin",
        actorType: "user",
        app: "platform-console",
        kind: "schema-promotion",
        action: "promote",
        severity: "High",
        targetType: "driver-schema-overlay",
        targetId: "overlay-1",
        metadata: {},
        traceId: "trace-platform"
      })
    ).rejects.toThrow("Platform-scoped audit events must be written via writePlatformAuditEvent.");
  });

  it("fans out platform audit events to affected organizations", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [] as Row[], rowCount: 1 };
      }
    };

    await writePlatformAuditEvent(db, {
      id: "audit-platform",
      projectId: null,
      actorUserId: "u-platform-admin",
      actorType: "user",
      app: "platform-console",
      kind: "schema-promotion",
      action: "promote",
      severity: "High",
      targetType: "driver-schema-overlay",
      targetId: "overlay-1",
      metadata: { compatible: "demo-board" },
      traceId: "trace-platform",
      affectedOrganizationIds: ["org-chargelab", "org-hardware-department"]
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].values[1]).toBeNull();
    expect(calls[1].values[1]).toBe("org-chargelab");
    expect(calls[2].values[1]).toBe("org-hardware-department");
    expect(calls.every((call) => call.values[12] === "trace-platform")).toBe(true);
  });

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

  it("lists audit events for an organization with actor name", async () => {
    const db: Queryable = {
      query: async <Row,>(text: string) => {
        expect(text).toContain("left join users u");
        return {
          rows: [
            {
              id: "audit-1",
              organization_id: "org-chargelab",
              project_id: "aurora",
              actor_user_id: "u-xu-yun",
              actor_type: "user",
              actor_name: "Xu Yun",
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
        };
      }
    };

    const result = await listAuditEvents(db, { organizationId: "org-chargelab" });

    expect(result.items[0].id).toBe("audit-1");
    expect(result.items[0].actorName).toBe("Xu Yun");
    expect(result.items[0].metadata).toEqual({ snapshotName: "parameter-admin.json" });
    expect(result.nextCursor).toBeNull();
  });

  it("applies app and severity filters", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [] as Row[], rowCount: 0 };
      }
    };

    await listAuditEvents(db, {
      organizationId: "org-chargelab",
      app: "parameter-management",
      severity: "High",
      projectId: "aurora"
    });

    expect(calls[0].text).toContain("ae.app = $");
    expect(calls[0].text).toContain("ae.severity = $");
    expect(calls[0].text).toContain("ae.project_id = $");
    expect(calls[0].values).toContain("parameter-management");
    expect(calls[0].values).toContain("High");
    expect(calls[0].values).toContain("aurora");
  });

  it("returns nextCursor when more rows exist than limit", async () => {
    const db: Queryable = {
      query: async <Row,>() => ({
        rows: [
          {
            id: "audit-1",
            organization_id: "org-chargelab",
            project_id: "aurora",
            actor_user_id: "u-xu-yun",
            actor_type: "user",
            actor_name: "Xu Yun",
            app: "parameter-management",
            kind: "parameter-submit",
            action: "submit",
            severity: "Medium",
            target_type: "parameter-change-request",
            target_id: "req-2",
            metadata: {},
            trace_id: "trace-1",
            created_at: "2026-05-25T00:00:00.000Z"
          },
          {
            id: "audit-2",
            organization_id: "org-chargelab",
            project_id: "aurora",
            actor_user_id: "u-xu-yun",
            actor_type: "user",
            actor_name: "Xu Yun",
            app: "parameter-management",
            kind: "parameter-merge",
            action: "merge",
            severity: "High",
            target_type: "parameter-change-request",
            target_id: "req-1",
            metadata: {},
            trace_id: "trace-2",
            created_at: "2026-05-24T00:00:00.000Z"
          }
        ] as Row[],
        rowCount: 2
      })
    };

    const result = await listAuditEvents(db, { organizationId: "org-chargelab", limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe("2026-05-25T00:00:00.000Z");
  });
});
