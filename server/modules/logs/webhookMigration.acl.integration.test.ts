import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isTestDatabaseAvailable, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { claimLogWebhook } from "./webhookOutbox";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("log webhook migration runtime ACL", () => {
  it("grants pre-existing domain writers outbox DML without granting readers or PUBLIC", async () => {
    await withTestClusterRoleCatalogLock(() => withTempDatabase({ prefix: "whacl", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { through: "0184_product_feedback_progress_author.sql" });
      const writer = `cxlogwh_writer_${randomUUID().replaceAll("-", "")}`;
      const reader = `cxlogwh_reader_${randomUUID().replaceAll("-", "")}`;
      const password = randomUUID();
      try {
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
        await applyMigrations(db, migrationsDir, { through: "0275_organization_lifecycle.sql" });
        await db.query(`insert into organizations (id, name) values ('wh-acl-org', 'Webhook ACL');
          insert into log_domains (id, organization_id, name) values ('wh-acl-domain', 'wh-acl-org', 'Webhook ACL');
          insert into log_skill_revisions (id, organization_id, skill_id, revision_number, status, spec, content_hash)
            values ('wh-acl-v1', 'wh-acl-org', 'wh-acl-domain', 1, 'published', '{"schemaVersion":"skill/v1"}', 'fixture');
          insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256)
            values ('wh-acl-file', 'wh-acl-org', 'wh-acl-file', 'test.log', 'text/plain', 1, 'checksum');
          insert into log_records (id, organization_id, file_object_id, file_name, source, status)
            values ('wh-acl-log', 'wh-acl-org', 'wh-acl-file', 'test.log', 'api', 'complete')`);
        const loginUrl = new URL(connectionString);
        loginUrl.username = writer;
        loginUrl.password = password;
        const login = createPostgresDatabase(loginUrl.toString());
        try {
          expect((await login.query<{ current_user: string }>("select current_user")).rows[0].current_user).toBe(writer);
          await login.query(`insert into log_webhook_outbox (id, organization_id, log_domain_id, log_record_id, run_id, payload)
            values ('wh-acl-event', 'wh-acl-org', 'wh-acl-domain', 'wh-acl-log', 'wh-acl-run', '{}'::jsonb)`);
          await expect(claimLogWebhook(login, 60_000)).rejects.toMatchObject({ code: "42501" });
          await applyMigrations(db, migrationsDir);
          expect(await claimLogWebhook(login, 60_000)).toMatchObject({ id: "wh-acl-event", lease_token: expect.any(String) });
          expect((await login.query(`select has_table_privilege(current_user,'public.organizations','SELECT') as table_read,
            has_column_privilege(current_user,'public.organizations','name','SELECT') as name_read,
            has_table_privilege(current_user,'public.organizations','UPDATE') as organization_write`)).rows)
            .toEqual([{ table_read: false, name_read: false, organization_write: false }]);
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
        for (const column of ["id", "status"]) {
          expect((await db.query(`select has_column_privilege($1,'public.organizations',$2,'SELECT') as reader,
            has_column_privilege('public','public.organizations',$2,'SELECT') as public`, [reader, column])).rows)
            .toEqual([{ reader: false, public: false }]);
        }
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
      }
    }));
  }, 120_000);
});
