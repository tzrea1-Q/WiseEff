import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase, type Database } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { isTestDatabaseAvailable, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { createUserInvocation } from "../auth/trustedInvocation";
import { quoteIdent } from "../catalog-kernel/security/catalogRoleManifest";
import { getWorkflowPublication, getWorkflowPublicationAdmin, updateWorkflowPublication } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();
const initial = { workflows: { "parameter-management": true, debugging: true, "log-analysis": true, knowledge: true }, version: 0 };
const administrator = makeTestAuthContext({ userId: "release-admin", organizationId: "org-a", name: "Release administrator", roleId: "platform-admin" });
const invocation = createUserInvocation(administrator);

async function seed(db: Database) {
  await seedCoreGraph(db, { organization: { id: "org-a" }, users: [{ id: "release-admin", name: administrator.user.name }] });
  await seedCoreGraph(db, { organization: { id: "org-b" } });
}

describe.skipIf(!databaseAvailable)("global workflow publication PostgreSQL", () => {
  it("grants existing runtime writers actual publication reads and audited writes without granting readers", async () => {
    await withTestClusterRoleCatalogLock(() => withTempDatabase({ prefix: "workflow_publication_acl" }, async ({ db }) => {
      await seed(db);
      const writer = `publication_writer_${randomUUID().replaceAll("-", "")}`;
      const reader = `publication_reader_${randomUUID().replaceAll("-", "")}`;
      const createdRoles: string[] = [];
      try {
        for (const role of [writer, reader]) {
          await db.query(`create role ${quoteIdent(role)} nologin nosuperuser nocreatedb nocreaterole`);
          createdRoles.push(role);
        }
        await db.query(`grant usage on schema public to ${quoteIdent(writer)};
          grant select, insert, update, delete on log_domains to ${quoteIdent(writer)};
          grant select on log_domains to ${quoteIdent(reader)};
          grant select on users to ${quoteIdent(writer)};
          grant insert on audit_events to ${quoteIdent(writer)}`);
        expect((await db.query<{ allowed: boolean }>(
          "select has_table_privilege($1, 'workflow_publication', 'SELECT') as allowed", [writer]
        )).rows[0].allowed).toBe(false);
        await db.query(await readFile(path.join(migrationsDir, "0258_workflow_publication.sql"), "utf8"));
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect((await db.query<{ writer: boolean; reader: boolean }>(
            `select has_table_privilege($1, 'workflow_publication', $3) as writer,
                    has_table_privilege($2, 'workflow_publication', $3) as reader`, [writer, reader, privilege]
          )).rows[0], privilege).toEqual({ writer: true, reader: false });
        }
        expect((await db.query(`select 1 from pg_class, lateral aclexplode(relacl)
          where oid = 'workflow_publication'::regclass and grantee = 0`)).rows).toHaveLength(0);
        await db.transaction(async (tx) => {
          await tx.query(`set local role ${quoteIdent(writer)}`);
          expect(await getWorkflowPublication(tx, administrator)).toEqual(initial);
          expect(await updateWorkflowPublication(tx, invocation,
            { workflows: { ...initial.workflows, knowledge: false }, expectedVersion: 0 }, "runtime-publication"))
            .toMatchObject({ version: 1, workflows: { ...initial.workflows, knowledge: false } });
        });
        expect((await db.query("select actor_user_id from audit_events where trace_id = 'runtime-publication'")).rows)
          .toEqual([{ actor_user_id: administrator.user.id }]);
      } finally {
        for (const role of createdRoles) await db.query(`drop owned by ${quoteIdent(role)}; drop role ${quoteIdent(role)}`);
      }
    }));
  });

  it("persists across connections for all organizations, audits trusted changes, and never reseeds published values", async () => {
    await withTempDatabase({ prefix: "workflow_publication" }, async ({ db, connectionString }) => {
      await seed(db);
      expect(await getWorkflowPublicationAdmin(db, administrator)).toEqual({ ...initial, updatedAt: null, updatedBy: null });
      const workflows = { ...initial.workflows, "log-analysis": false, knowledge: false };
      const saved = await updateWorkflowPublication(db, invocation, { workflows, expectedVersion: 0 }, "publish-change");
      expect(saved).toMatchObject({ workflows, version: 1, updatedBy: { id: administrator.user.id, name: administrator.user.name } });
      expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const reconnected = createPostgresDatabase(connectionString);
      try {
        for (const organizationId of ["org-a", "org-b"]) {
          expect(await getWorkflowPublication(reconnected, makeTestAuthContext({ organizationId, roleId: "hardware-user" })))
            .toEqual({ workflows, version: 1 });
        }
      } finally { await reconnected.close(); }
      const audit = (await db.query<{ organization_id: string | null; actor_user_id: string; metadata: unknown; trace_id: string }>(
        "select organization_id, actor_user_id, metadata, trace_id from audit_events where kind = 'workflow-publication-updated'"
      )).rows;
      expect(audit).toEqual([{ organization_id: null, actor_user_id: administrator.user.id, trace_id: "publish-change",
        metadata: { initiator: "user", scope: "platform", previous: initial, next: { workflows, version: 1 } } }]);
      expect(await updateWorkflowPublication(db, invocation, { workflows, expectedVersion: 1 }, "noop")).toEqual(saved);
      expect((await db.query("select id from audit_events where kind = 'workflow-publication-updated'")).rows).toHaveLength(1);
      await db.query(await readFile(path.join(migrationsDir, "0258_workflow_publication.sql"), "utf8"));
      expect(await getWorkflowPublicationAdmin(db, administrator)).toEqual(saved);
    });
  });

  it("accepts exactly one concurrent edit and refuses the stale version without a second audit", async () => {
    await withTempDatabase({ prefix: "workflow_publication_cas" }, async ({ db, connectionString }) => {
      await seed(db);
      const pool = createPostgresDatabase(connectionString);
      try {
        const outcomes = await Promise.allSettled([
          updateWorkflowPublication(pool, invocation, { workflows: { ...initial.workflows, knowledge: false }, expectedVersion: 0 }, "first"),
          updateWorkflowPublication(pool, invocation, { workflows: { ...initial.workflows, "log-analysis": false }, expectedVersion: 0 }, "second")
        ]);
        expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT", details: { reason: "stale-workflow-publication" } } });
        const winner = outcomes.find((result) => result.status === "fulfilled");
        expect(await getWorkflowPublicationAdmin(pool, administrator)).toEqual(winner?.status === "fulfilled" ? winner.value : null);
        expect((await db.query("select id from audit_events where kind = 'workflow-publication-updated'")).rows).toHaveLength(1);
      } finally { await pool.close(); }
    });
  });

  it("rolls back publication and version when platform audit insertion fails", async () => {
    await withTempDatabase({ prefix: "workflow_publication_audit" }, async ({ db }) => {
      await seed(db);
      await db.query(`create function fail_publication_audit() returns trigger language plpgsql as $$
        begin
          if new.kind = 'workflow-publication-updated' then raise exception 'audit unavailable'; end if;
          return new;
        end $$;
        create trigger reject_publication_audit before insert on audit_events
          for each row execute function fail_publication_audit()`);
      await expect(updateWorkflowPublication(db, invocation,
        { workflows: { ...initial.workflows, knowledge: false }, expectedVersion: 0 }, "audit-fails"))
        .rejects.toThrow("audit unavailable");
      expect(await getWorkflowPublicationAdmin(db, administrator)).toEqual({ ...initial, updatedAt: null, updatedBy: null });
      expect((await db.query("select id from audit_events where kind = 'workflow-publication-updated'")).rows).toHaveLength(0);
    });
  });

  it("keeps absent catalog entries unpublished and refuses to invent missing configuration", async () => {
    await withTempDatabase({ prefix: "workflow_publication_missing" }, async ({ db }) => {
      await seed(db);
      await db.query("update workflow_publication set workflows = (workflows - 'knowledge') || '{\"future-workflow\":true}'::jsonb");
      expect(await getWorkflowPublication(db, administrator)).toEqual({ ...initial, workflows: { ...initial.workflows, knowledge: false } });
      await db.query("delete from workflow_publication");
      await expect(getWorkflowPublication(db, administrator)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
      await expect(updateWorkflowPublication(db, invocation, { workflows: initial.workflows, expectedVersion: 0 }, "missing"))
        .rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    });
  });
});
