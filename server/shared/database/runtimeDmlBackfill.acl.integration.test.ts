import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { quoteIdent } from "../../modules/catalog-kernel/security/catalogRoleManifest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { createPostgresDatabase } from "./client";

const databaseAvailable = await isTestDatabaseAvailable();
const tables = ["product_feedback_progress_events", "knowledge_definition_references"];
const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE"];

describe.skipIf(!databaseAvailable)("runtime DML backfill ACL", () => {
  it("repairs pre-existing writers without granting readers, PUBLIC, or owner-only tables", async () => {
    await withTestClusterRoleCatalogLock(async () => {
      const ephemeral = await createEphemeralTestDatabase("dmlacl");
      const db = createPostgresDatabase(ephemeral.url);
      const writer = `dml_writer_${randomUUID().replaceAll("-", "")}`;
      const reader = `dml_reader_${randomUUID().replaceAll("-", "")}`;
      const createdRoles: string[] = [];
      try {
        for (const role of [writer, reader]) {
          await db.query(`create role ${quoteIdent(role)} nologin nosuperuser nocreatedb nocreaterole`);
          createdRoles.push(role);
        }
        await db.query(`grant select, insert, update, delete on public.log_domains to ${quoteIdent(writer)}`);
        await db.query(`grant select on public.log_domains to ${quoteIdent(reader)}`);
        for (const table of tables) {
          // Model LOGINs provisioned before these tables existed, even on a migrated clone.
          await db.query(`revoke all on public.${table} from ${quoteIdent(writer)}, ${quoteIdent(reader)}`);
          for (const privilege of privileges) {
            expect((await db.query<{ writer: boolean }>(
              "select has_table_privilege($1, $2, $3) as writer", [writer, `public.${table}`, privilege],
            )).rows[0].writer).toBe(false);
          }
        }
        const migration = await readFile(new URL("../../migrations/0186_runtime_dml_backfill.sql", import.meta.url), "utf8");
        // Replay twice to cover idempotence as well as the upgrade gap.
        for (let replay = 0; replay < 2; replay++) {
          await db.transaction(async (tx) => { await tx.query(migration); });
        }
        for (const table of tables) {
          for (const privilege of privileges) {
            const grants = await db.query<{ writer: boolean; reader: boolean }>(
              `select has_table_privilege($1, $3, $4) as writer,
                has_table_privilege($2, $3, $4) as reader`, [writer, reader, `public.${table}`, privilege],
            );
            expect(grants.rows[0], `${table}: ${privilege}`).toEqual({ writer: true, reader: false });
          }
          expect((await db.query(`select 1 from pg_class, lateral aclexplode(relacl)
            where oid = $1::regclass and grantee = 0`, [`public.${table}`])).rows).toHaveLength(0);
        }
        for (const privilege of privileges) {
          expect((await db.query<{ writer: boolean }>(
            "select has_table_privilege($1, 'public.project_parameter_value_change_targets', $2) as writer",
            [writer, privilege],
          )).rows[0].writer).toBe(false);
        }
      } finally {
        try {
          for (const role of createdRoles) {
            await db.query(`drop owned by ${quoteIdent(role)}; drop role ${quoteIdent(role)}`);
          }
        } finally {
          await db.close();
          await ephemeral.drop();
        }
      }
    });
  });
});
