import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import type { CreateAuditEventInput } from "./types";
import { createAuditEvent, listAuditEvents, writePlatformAuditEvent } from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

function auditInput(overrides: Partial<CreateAuditEventInput> & { id: string }): CreateAuditEventInput {
  return {
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
    metadata: {},
    traceId: "trace-1",
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("audit repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-chargelab", name: "ChargeLab" },
      users: [{ id: "u-xu-yun", name: "Xu Yun" }],
      projects: [{ id: "aurora", name: "Aurora" }]
    });
    await seedCoreGraph(db, {
      organization: { id: "org-hardware-department", name: "Hardware Department" }
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  /** now() is transaction-stable, so pagination/ordering tests pin explicit timestamps. */
  async function setCreatedAt(eventId: string, createdAt: string) {
    await db.query(`update audit_events set created_at = $2::timestamptz where id = $1`, [eventId, createdAt]);
  }

  it("rejects platform-scoped audit rows outside writePlatformAuditEvent", async () => {
    await expect(
      createAuditEvent(db, auditInput({ id: "audit-platform", organizationId: null, projectId: null }))
    ).rejects.toThrow("Platform-scoped audit events must be written via writePlatformAuditEvent.");

    const rows = await db.query(`select id from audit_events where id = 'audit-platform'`);
    expect(rows.rows).toHaveLength(0);
  });

  it("fans out platform audit events to affected organizations", async () => {
    await writePlatformAuditEvent(db, {
      id: "audit-platform",
      projectId: null,
      actorUserId: "u-xu-yun",
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

    const rows = await db.query<{ id: string; organization_id: string | null; metadata: Record<string, unknown> }>(
      `select id, organization_id, metadata from audit_events where trace_id = 'trace-platform' order by organization_id nulls first`
    );
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows[0]).toMatchObject({ id: "audit-platform", organization_id: null });
    expect(rows.rows.map((row) => row.organization_id)).toEqual([null, "org-chargelab", "org-hardware-department"]);
    // Every fan-out copy carries the shared trace and payload.
    expect(rows.rows.every((row) => row.metadata.compatible === "demo-board")).toBe(true);
  });

  it("inserts audit events with metadata", async () => {
    await createAuditEvent(db, auditInput({ id: "audit-1", metadata: { snapshotName: "parameter-admin.json" } }));

    const rows = await db.query<{
      organization_id: string;
      project_id: string;
      actor_user_id: string;
      actor_type: string;
      app: string;
      kind: string;
      action: string;
      severity: string;
      target_type: string;
      target_id: string;
      metadata: Record<string, unknown>;
      trace_id: string;
    }>(`select * from audit_events where id = 'audit-1'`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
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
      trace_id: "trace-1"
    });
  });

  it("lists audit events for an organization with actor name and hides other orgs", async () => {
    await createAuditEvent(db, auditInput({ id: "audit-1", metadata: { snapshotName: "parameter-admin.json" } }));
    // Cross-org decoy: same shape, different tenant.
    await createAuditEvent(
      db,
      auditInput({
        id: "audit-foreign",
        organizationId: "org-hardware-department",
        projectId: null,
        actorUserId: null
      })
    );

    const result = await listAuditEvents(db, { organizationId: "org-chargelab" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "audit-1",
      actorName: "Xu Yun",
      metadata: { snapshotName: "parameter-admin.json" }
    });
    expect(result.nextCursor).toBeNull();
  });

  it("applies app and severity filters", async () => {
    await createAuditEvent(
      db,
      auditInput({ id: "audit-match", app: "parameter-management", kind: "parameter-merge", severity: "High" })
    );
    // Decoys: each differs from the filter in exactly one dimension.
    await createAuditEvent(db, auditInput({ id: "audit-wrong-app", app: "log-analysis", severity: "High" }));
    await createAuditEvent(
      db,
      auditInput({ id: "audit-wrong-severity", app: "parameter-management", severity: "Low" })
    );
    await createAuditEvent(
      db,
      auditInput({ id: "audit-wrong-project", app: "parameter-management", severity: "High", projectId: null })
    );

    const result = await listAuditEvents(db, {
      organizationId: "org-chargelab",
      app: "parameter-management",
      severity: "High",
      projectId: "aurora"
    });

    expect(result.items.map((item) => item.id)).toEqual(["audit-match"]);
  });

  it("pushes q down as an escaped ILIKE across action, kind, target id, and actor name", async () => {
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ('u-shutdown', 'org-chargelab', '值班员50%_关机负责人', 'shutdown@example.com', 'Operator', true)`
    );
    await createAuditEvent(db, auditInput({ id: "audit-action", action: "触发 50%_关机 保护" }));
    await createAuditEvent(db, auditInput({ id: "audit-kind", kind: "50%_关机" }));
    await createAuditEvent(db, auditInput({ id: "audit-target", targetId: "node-50%_关机" }));
    await createAuditEvent(db, auditInput({ id: "audit-actor", actorUserId: "u-shutdown" }));
    // Wildcard decoys: they match only if % / _ leak through unescaped.
    await createAuditEvent(db, auditInput({ id: "audit-decoy-percent", action: "触发 50x_关机 保护" }));
    await createAuditEvent(db, auditInput({ id: "audit-decoy-underscore", action: "触发 50%y关机 保护" }));

    const result = await listAuditEvents(db, { organizationId: "org-chargelab", q: "50%_关机" });

    expect(result.items.map((item) => item.id).sort()).toEqual([
      "audit-action",
      "audit-actor",
      "audit-kind",
      "audit-target"
    ]);
  });

  it("ignores blank q values", async () => {
    await createAuditEvent(db, auditInput({ id: "audit-1" }));
    await createAuditEvent(db, auditInput({ id: "audit-2", action: "unrelated action" }));

    const result = await listAuditEvents(db, { organizationId: "org-chargelab", q: "   " });

    expect(result.items.map((item) => item.id).sort()).toEqual(["audit-1", "audit-2"]);
  });

  it("returns nextCursor when more rows exist than limit and pages by created_at", async () => {
    // Inserted out of chronological order: newest-first output must come from
    // created_at ordering, not insertion order.
    await createAuditEvent(db, auditInput({ id: "audit-middle", kind: "parameter-submit" }));
    await createAuditEvent(db, auditInput({ id: "audit-newest", kind: "parameter-merge" }));
    await createAuditEvent(db, auditInput({ id: "audit-oldest", kind: "parameter-view" }));
    await setCreatedAt("audit-middle", "2026-05-24T12:00:00.000Z");
    await setCreatedAt("audit-newest", "2026-05-25T00:00:00.000Z");
    await setCreatedAt("audit-oldest", "2026-05-24T00:00:00.000Z");

    const firstPage = await listAuditEvents(db, { organizationId: "org-chargelab", limit: 1 });
    expect(firstPage.items.map((item) => item.id)).toEqual(["audit-newest"]);
    expect(firstPage.nextCursor).toBe(firstPage.items[0].createdAt);

    const secondPage = await listAuditEvents(db, {
      organizationId: "org-chargelab",
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined
    });
    expect(secondPage.items.map((item) => item.id)).toEqual(["audit-middle"]);
    expect(secondPage.nextCursor).not.toBeNull();

    const lastPage = await listAuditEvents(db, {
      organizationId: "org-chargelab",
      limit: 1,
      cursor: secondPage.nextCursor ?? undefined
    });
    expect(lastPage.items.map((item) => item.id)).toEqual(["audit-oldest"]);
    expect(lastPage.nextCursor).toBeNull();
  });
});
