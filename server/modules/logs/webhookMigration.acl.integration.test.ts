import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { migrationsDir } from "../../testing/tempDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
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
        await db.transaction(async (tx) => {
          await tx.query(`select set_config('wiseeff.test_webhook_writer', $1, true),
            set_config('wiseeff.test_webhook_reader', $2, true),
            set_config('wiseeff.test_webhook_password', $3, true)`, [writer, reader, password]);
          await tx.query(`do $$
            declare
              writer text := current_setting('wiseeff.test_webhook_writer');
              reader text := current_setting('wiseeff.test_webhook_reader');
            begin
              execute format('create role %I login password %L nosuperuser nocreatedb nocreaterole',
                writer, current_setting('wiseeff.test_webhook_password'));
              execute format('create role %I nologin nosuperuser nocreatedb nocreaterole', reader);
              execute format('grant usage on schema public to %I, %I', writer, reader);
              execute format('grant select, insert, update, delete on log_domains to %I', writer);
              execute format('grant select on log_domains to %I', reader);
            end $$`);
        });
        await db.query(`delete from schema_migrations where name = '0185_log_webhook_outbox.sql'`);
        await applyMigrations(db, migrationsDir, { through: "0185_log_webhook_outbox.sql" });
        await db.query(`insert into organizations (id, name) values ('wh-acl-org', 'Webhook ACL');
          insert into log_domains (id, organization_id, name) values ('wh-acl-domain', 'wh-acl-org', 'Webhook ACL');
          insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
            values ('wh-acl-file', 'wh-acl-org', 'wh-acl-file', 'test.log', 'text/plain', 1, 'checksum');
          insert into log_records (id, organization_id, file_object_id, file_name, source, status)
            values ('wh-acl-log', 'wh-acl-org', 'wh-acl-file', 'test.log', 'api', 'complete')`);
        const loginUrl = new URL(ephemeral.url);
        loginUrl.username = writer;
        loginUrl.password = password;
        const login = createPostgresDatabase(loginUrl.toString());
        try {
          expect((await login.query<{ current_user: string }>("select current_user")).rows[0].current_user).toBe(writer);
          await login.query(`insert into log_webhook_outbox (id, organization_id, log_domain_id, log_record_id, run_id, payload)
            values ('wh-acl-event', 'wh-acl-org', 'wh-acl-domain', 'wh-acl-log', 'wh-acl-run', '{}'::jsonb)`);
          expect(await claimLogWebhook(login, 60_000)).toMatchObject({ id: "wh-acl-event", lease_token: expect.any(String) });
          expect((await login.query(`delete from log_webhook_outbox where id = 'wh-acl-event' returning id`)).rowCount).toBe(1);
        } finally { await login.close(); }
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const grants = await db.query<{ writer: boolean; reader: boolean }>(
            `select has_table_privilege($1, 'public.log_webhook_outbox', $3) as writer,
              has_table_privilege($2, 'public.log_webhook_outbox', $3) as reader`, [writer, reader, privilege]);
          expect(grants.rows[0]).toEqual({ writer: true, reader: false });
        }
        expect((await db.query(`select 1 from pg_class, lateral aclexplode(relacl)
          where oid = 'public.log_webhook_outbox'::regclass and grantee = 0`)).rows).toHaveLength(0);
      } finally {
        await db.transaction(async (tx) => {
          await tx.query(`select set_config('wiseeff.test_webhook_writer', $1, true),
            set_config('wiseeff.test_webhook_reader', $2, true)`, [writer, reader]);
          await tx.query(`do $$
            declare role_name text;
            begin
              foreach role_name in array array[current_setting('wiseeff.test_webhook_writer'), current_setting('wiseeff.test_webhook_reader')]
              loop
                if exists (select 1 from pg_roles where rolname = role_name) then
                  execute format('drop owned by %I', role_name);
                  execute format('drop role %I', role_name);
                end if;
              end loop;
            end $$`);
        });
        await db.close();
        await ephemeral.drop();
      }
    });
  });
});
