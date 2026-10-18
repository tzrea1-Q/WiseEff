import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { quoteIdent } from "../catalog-kernel/security/catalogRoleManifest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { createPostgresDatabase, type Database } from "../../shared/database/client";
import { claimLogWebhook } from "./webhookOutbox";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("log webhook migration runtime ACL", () => {
  it("grants pre-existing domain writers outbox DML without granting readers or PUBLIC", async () => {
    await withTestClusterRoleCatalogLock(async () => {
      const ephemeral = await createEphemeralTestDatabase("whacl");
      const db = createPostgresDatabase(ephemeral.url);
      const writer = `cxlogwh_writer_${randomUUID().replaceAll("-", "")}`;
      const reader = `cxlogwh_reader_${randomUUID().replaceAll("-", "")}`;
      const password = randomUUID();
      try {
        // Rewind only 0185's DDL on the disposable clone to model an upgrade.
        await db.query(`drop table log_webhook_outbox;
          alter table log_domains drop column webhook_secret_last_four,
            drop column if exists webhook_secret_encrypted`);
        await db.query(`create role ${quoteIdent(writer)} login password '${password}' nosuperuser nocreatedb nocreaterole`);
        await db.query(`create role ${quoteIdent(reader)} nologin nosuperuser nocreatedb nocreaterole`);
        await db.query(`grant usage on schema public to ${quoteIdent(writer)}, ${quoteIdent(reader)}`);
        await db.query(`grant select, insert, update, delete on log_domains to ${quoteIdent(writer)}`);
        await db.query(`grant select on log_domains to ${quoteIdent(reader)}`);
        const migration = await readFile(new URL("../../migrations/0185_log_webhook_outbox.sql", import.meta.url), "utf8");
        await db.transaction(async (tx) => { await tx.query(migration); });
        await db.query(`insert into organizations (id, name) values ('wh-acl-org', 'Webhook ACL');
          insert into log_domains (id, organization_id, name) values ('wh-acl-domain', 'wh-acl-org', 'Webhook ACL');
          insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
            values ('wh-acl-file', 'wh-acl-org', 'wh-acl-file', 'test.log', 'text/plain', 1, 'checksum');
          insert into log_records (id, organization_id, file_object_id, file_name, source, status)
            values ('wh-acl-log', 'wh-acl-org', 'wh-acl-file', 'test.log', 'api', 'complete')`);
        const loginUrl = new URL(ephemeral.url);
        loginUrl.username = writer;
        loginUrl.password = password;
        const login = new pg.Client({ connectionString: loginUrl.toString() });
        await login.connect();
        try {
          expect((await login.query<{ current_user: string }>("select current_user")).rows[0].current_user).toBe(writer);
          await login.query(`insert into log_webhook_outbox (id, organization_id, log_domain_id, log_record_id, run_id, payload)
            values ('wh-acl-event', 'wh-acl-org', 'wh-acl-domain', 'wh-acl-log', 'wh-acl-run', '{}'::jsonb)`);
          const queryable: Pick<Database, "query"> = { query: async (sql, values) => {
            const result = await login.query(sql, values);
            return { rows: result.rows, rowCount: result.rowCount };
          } };
          expect(await claimLogWebhook(queryable, 60_000)).toMatchObject({ id: "wh-acl-event", lease_token: expect.any(String) });
          expect((await login.query(`delete from log_webhook_outbox where id = 'wh-acl-event' returning id`)).rowCount).toBe(1);
        } finally { await login.end(); }
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const grants = await db.query<{ writer: boolean; reader: boolean }>(
            `select has_table_privilege($1, 'public.log_webhook_outbox', $3) as writer,
              has_table_privilege($2, 'public.log_webhook_outbox', $3) as reader`, [writer, reader, privilege]);
          expect(grants.rows[0]).toEqual({ writer: true, reader: false });
        }
        expect((await db.query(`select 1 from pg_class, lateral aclexplode(relacl)
          where oid = 'public.log_webhook_outbox'::regclass and grantee = 0`)).rows).toHaveLength(0);
      } finally {
        for (const role of [writer, reader]) {
          await db.query(`drop owned by ${quoteIdent(role)}; drop role ${quoteIdent(role)}`);
        }
        await db.close();
        await ephemeral.drop();
      }
    });
  });
});
