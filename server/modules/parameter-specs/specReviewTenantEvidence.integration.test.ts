/**
 * Round 5 P1-2: retained cross-tenant review evidence migration integrity.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import {
  migrationsDir,
  withTempDatabase as withSharedTempDatabase
} from "../../testing/tempDatabase";
import type { Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { backfillReviewTaskScopeColumns } from "./repository";

const ORG_A = "org-tenant-evidence-a";
const ORG_B = "org-tenant-evidence-b";
const PROJECT_A = "project-tenant-evidence-a";
const PROJECT_B = "project-tenant-evidence-b";
const USER_ID = "user-tenant-evidence";
const CONFIG_SET_A = "dcs-tenant-evidence-a";
const CONFIG_SET_B = "dcs-tenant-evidence-b";
const SPEC_A = "pspec:manual:tenant_mystery";
const PROPERTY_KEY = "tenant_mystery";

const migration0055 = "0055_parameter_spec_review_task_scope_backfill.sql";
const migration0057 = "0057_parameter_spec_review_task_scope_reconcile.sql";
const migration0058 = "0058_parameter_spec_review_task_scope_evidence_only.sql";

const databaseAvailable = await isTestDatabaseAvailable();

async function withTempDatabase(fn: (db: Database) => Promise<void>) {
  // Migration replay suite: migrations are applied selectively via applyMigrations options.
  await withSharedTempDatabase({ prefix: "mig0055", migrate: false }, ({ db }) => fn(db));
}

async function applySingleMigration(db: Database, file: string) {
  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
  await db.query("begin");
  try {
    await db.query(sql);
    await db.query(
      `insert into schema_migrations (name) values ($1) on conflict (name) do nothing`,
      [file],
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function seedGraph(db: InMemoryTestDatabase | Database) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Org A'), ($2, 'Org B')
     on conflict (id) do update set name = excluded.name`,
    [ORG_A, ORG_B],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Tenant Evidence Admin', 'tenant-evidence@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_A],
  );
  for (const [projectId, orgId, configSetId, code] of [
    [PROJECT_A, ORG_A, CONFIG_SET_A, "TEA"],
    [PROJECT_B, ORG_B, CONFIG_SET_B, "TEB"],
  ] as const) {
    await db.query(
      `
      insert into projects (id, organization_id, name, code, status)
      values ($1, $2, $3, $4, 'initialized')
      on conflict (id) do update set organization_id = excluded.organization_id
      `,
      [projectId, orgId, `Tenant Evidence ${code}`, code],
    );
    await db.query(
      `
      insert into dts_config_set (id, organization_id, project_id, name, description)
      values ($1, $2, $3, 'tenant-set', 'tenant evidence fixture')
      on conflict (id) do update set organization_id = excluded.organization_id
      `,
      [configSetId, orgId, projectId],
    );
  }
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'manual', 'manual/tenant_mystery')
    on conflict (id) do nothing
    `,
    [SPEC_A, ORG_A],
  );
}

describe.skipIf(!databaseAvailable)("0055/0057 review task scope backfill", () => {
  it(
    "only backfills tenant-valid ids, marks invalid evidence with diagnostics, and re-runs idempotently",
    async () => {
    await withTempDatabase(async (db) => {
      await applyMigrations(db, migrationsDir, { through: "0054_config_revision_manifest_backfill.sql" });
      await seedGraph(db);

      const validRevisionId = randomUUID();
      const danglingRevisionId = randomUUID();
      const crossRevisionId = randomUUID();
      await db.query(
        `
        insert into dts_config_revisions (
          id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
        ) values
          ($1, $2, $3, $4, 1, 'resolved', $5),
          ($6, $7, $8, $9, 1, 'resolved', $5)
        `,
        [
          validRevisionId,
          ORG_A,
          PROJECT_A,
          CONFIG_SET_A,
          USER_ID,
          crossRevisionId,
          ORG_B,
          PROJECT_B,
          CONFIG_SET_B,
        ],
      );

      const validOccurrenceId = randomUUID();
      const crossOccurrenceId = randomUUID();
      const nodeOccA = randomUUID();
      const nodeOccB = randomUUID();
      const fileVersionA = randomUUID();
      const fileVersionB = randomUUID();
      const fileIdA = randomUUID();
      const fileIdB = randomUUID();
      await db.query(
        `
        insert into project_parameter_files (id, organization_id, project_id, file_name, format, enabled)
        values ($1, $2, $3, 'a.dts', 'dts', true), ($4, $5, $6, 'b.dts', 'dts', true)
        `,
        [fileIdA, ORG_A, PROJECT_A, fileIdB, ORG_B, PROJECT_B],
      );
      await db.query(
        `
        insert into project_parameter_file_versions (
          id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
        ) values ($1, $2, 1, 'k-a', 'abc', 1, '{}'::jsonb, 'upload', $3),
               ($4, $5, 1, 'k-b', 'def', 1, '{}'::jsonb, 'upload', $3)
        `,
        [fileVersionA, fileIdA, USER_ID, fileVersionB, fileIdB],
      );
      await db.query(
        `
        insert into dts_node_occurrences (
          id, config_revision_id, file_version_id, name, labels, node_path,
          start_offset, end_offset, start_line, start_column, end_line, end_column,
          raw_text, ast_json, source_order
        ) values ($1, $2, $3, 'n', '[]'::jsonb, '/n', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0),
               ($4, $5, $6, 'n', '[]'::jsonb, '/n', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0)
        `,
        [nodeOccA, validRevisionId, fileVersionA, nodeOccB, crossRevisionId, fileVersionB],
      );
      await db.query(
        `
        insert into dts_property_occurrences (
          id, config_revision_id, node_occurrence_id, file_version_id, property_name,
          start_offset, end_offset, start_line, start_column, end_line, end_column,
          raw_text, ast_json, source_order
        ) values ($1, $2, $3, $4, 'p', 0, 1, 1, 1, 1, 2, '<1>', '{}'::jsonb, 0),
               ($5, $6, $7, $8, 'p', 0, 1, 1, 1, 1, 2, '<1>', '{}'::jsonb, 0)
        `,
        [
          validOccurrenceId,
          validRevisionId,
          nodeOccA,
          fileVersionA,
          crossOccurrenceId,
          crossRevisionId,
          nodeOccB,
          fileVersionB,
        ],
      );

      const validTaskId = randomUUID();
      const crossProjectTaskId = randomUUID();
      const danglingTaskId = randomUUID();
      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, source_evidence, candidate_schemas, project_count, status
        ) values
          ($1, $2, $3::jsonb, '[]'::jsonb, 1, 'open'),
          ($4, $2, $5::jsonb, '[]'::jsonb, 1, 'open'),
          ($6, $2, $7::jsonb, '[]'::jsonb, 1, 'open')
        `,
        [
          validTaskId,
          ORG_A,
          JSON.stringify({
            projectId: PROJECT_A,
            configRevisionId: validRevisionId,
            propertyOccurrenceId: validOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          crossProjectTaskId,
          JSON.stringify({
            projectId: PROJECT_B,
            configRevisionId: validRevisionId,
            propertyOccurrenceId: validOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          danglingTaskId,
          JSON.stringify({
            projectId: PROJECT_A,
            configRevisionId: danglingRevisionId,
            propertyOccurrenceId: randomUUID(),
            propertyKey: PROPERTY_KEY,
          }),
        ],
      );

      await applySingleMigration(db, migration0055);

      const validRow = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        blocker_scope: string;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, blocker_scope
         from parameter_spec_review_tasks where id = $1`,
        [validTaskId],
      );
      expect(validRow.rows[0]).toMatchObject({
        project_id: PROJECT_A,
        config_revision_id: validRevisionId,
        property_occurrence_id: validOccurrenceId,
        blocker_scope: "revision",
      });

      const crossProjectRow = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        blocker_scope: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, blocker_scope, source_evidence
         from parameter_spec_review_tasks where id = $1`,
        [crossProjectTaskId],
      );
      expect(crossProjectRow.rows[0]?.project_id).toBeNull();
      expect(crossProjectRow.rows[0]?.config_revision_id).toBeNull();
      expect(crossProjectRow.rows[0]?.property_occurrence_id).toBeNull();
      expect(crossProjectRow.rows[0]?.blocker_scope).toBe("platform");
      expect(crossProjectRow.rows[0]?.source_evidence.scopeBackfill).toMatchObject({
        code: "invalid_review_evidence",
      });

      const danglingRow = await db.query<{
        config_revision_id: string | null;
        source_evidence: Record<string, unknown>;
      }>(
        `select config_revision_id, source_evidence from parameter_spec_review_tasks where id = $1`,
        [danglingTaskId],
      );
      expect(danglingRow.rows[0]?.config_revision_id).toBeNull();
      expect(danglingRow.rows[0]?.source_evidence.scopeBackfill).toBeTruthy();

      await applySingleMigration(db, migration0057);
      const rerunRow = await db.query<{ source_evidence: Record<string, unknown> }>(
        `select source_evidence from parameter_spec_review_tasks where id = $1`,
        [crossProjectTaskId],
      );
      expect(rerunRow.rows[0]?.source_evidence.scopeBackfill).toBeTruthy();

      const updated = await backfillReviewTaskScopeColumns(db);
      expect(updated).toBeGreaterThanOrEqual(0);
      const idempotent = await backfillReviewTaskScopeColumns(db);
      expect(idempotent).toBe(0);
    });
    },
    30_000,
  );
});

describe.skipIf(!databaseAvailable)("0058 evidence-only scope reconcile from polluted 0055 state", () => {
  // Migration replay through 0057+0058 plus rollback probes is heavy under acceptance preflight load.
  it(
    "clears cross-tenant FKs preserved by 0057 coalesce, keeps valid rows, and rolls back mid-failure",
    async () => {
    await withTempDatabase(async (db) => {
      await applyMigrations(db, migrationsDir, { through: migration0057 });
      await seedGraph(db);

      const validRevisionId = randomUUID();
      const crossRevisionId = randomUUID();
      await db.query(
        `
        insert into dts_config_revisions (
          id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
        ) values
          ($1, $2, $3, $4, 1, 'resolved', $5),
          ($6, $7, $8, $9, 1, 'resolved', $5)
        `,
        [
          validRevisionId,
          ORG_A,
          PROJECT_A,
          CONFIG_SET_A,
          USER_ID,
          crossRevisionId,
          ORG_B,
          PROJECT_B,
          CONFIG_SET_B,
        ],
      );

      const validOccurrenceId = randomUUID();
      const crossOccurrenceId = randomUUID();
      const nodeOccA = randomUUID();
      const nodeOccB = randomUUID();
      const fileVersionA = randomUUID();
      const fileVersionB = randomUUID();
      const fileIdA = randomUUID();
      const fileIdB = randomUUID();
      await db.query(
        `
        insert into project_parameter_files (id, organization_id, project_id, file_name, format, enabled)
        values ($1, $2, $3, 'a.dts', 'dts', true), ($4, $5, $6, 'b.dts', 'dts', true)
        `,
        [fileIdA, ORG_A, PROJECT_A, fileIdB, ORG_B, PROJECT_B],
      );
      await db.query(
        `
        insert into project_parameter_file_versions (
          id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
        ) values ($1, $2, 1, 'k-a', 'abc', 1, '{}'::jsonb, 'upload', $3),
               ($4, $5, 1, 'k-b', 'def', 1, '{}'::jsonb, 'upload', $3)
        `,
        [fileVersionA, fileIdA, USER_ID, fileVersionB, fileIdB],
      );
      await db.query(
        `
        insert into dts_node_occurrences (
          id, config_revision_id, file_version_id, name, labels, node_path,
          start_offset, end_offset, start_line, start_column, end_line, end_column,
          raw_text, ast_json, source_order
        ) values ($1, $2, $3, 'n', '[]'::jsonb, '/n', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0),
               ($4, $5, $6, 'n', '[]'::jsonb, '/n', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0)
        `,
        [nodeOccA, validRevisionId, fileVersionA, nodeOccB, crossRevisionId, fileVersionB],
      );
      await db.query(
        `
        insert into dts_property_occurrences (
          id, config_revision_id, node_occurrence_id, file_version_id, property_name,
          start_offset, end_offset, start_line, start_column, end_line, end_column,
          raw_text, ast_json, source_order
        ) values ($1, $2, $3, $4, 'p', 0, 1, 1, 1, 1, 2, '<1>', '{}'::jsonb, 0),
               ($5, $6, $7, $8, 'p', 0, 1, 1, 1, 1, 2, '<1>', '{}'::jsonb, 0)
        `,
        [
          validOccurrenceId,
          validRevisionId,
          nodeOccA,
          fileVersionA,
          crossOccurrenceId,
          crossRevisionId,
          nodeOccB,
          fileVersionB,
        ],
      );

      const validTaskId = randomUUID();
      const pollutedTaskId = randomUUID();
      const missingEvidenceTaskId = randomUUID();
      // Simulate historical old-0055 pollution already written into task FKs
      // (0057 coalesce would preserve these incorrect values).
      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, parameter_spec_id, source_evidence, candidate_schemas,
          project_count, status, reviewer_user_id, reason, resolved_at,
          project_id, config_revision_id, property_occurrence_id, blocker_scope
        ) values
          (
            $1, $2, $3, $4::jsonb, '[]'::jsonb, 1, 'resolved', $5, 'ok', now(),
            $6, $7, $8, 'revision'
          ),
          (
            $9, $2, $3, $10::jsonb, '[]'::jsonb, 1, 'resolved', $5, 'polluted', now(),
            $11, $12, $13, 'revision'
          )
        `,
        [
          validTaskId,
          ORG_A,
          SPEC_A,
          JSON.stringify({
            projectId: PROJECT_A,
            configRevisionId: validRevisionId,
            propertyOccurrenceId: validOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          USER_ID,
          PROJECT_A,
          validRevisionId,
          validOccurrenceId,
          pollutedTaskId,
          JSON.stringify({
            // Evidence claims org-A project, but columns were polluted to org-B.
            projectId: PROJECT_A,
            configRevisionId: validRevisionId,
            propertyOccurrenceId: validOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          PROJECT_B,
          crossRevisionId,
          crossOccurrenceId,
        ],
      );

      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, parameter_spec_id, source_evidence, candidate_schemas,
          project_count, status, reviewer_user_id, reason, resolved_at,
          project_id, blocker_scope
        ) values (
          $1, $2, $3, $4::jsonb, '[]'::jsonb, 1, 'resolved', $5,
          'polluted scope without evidence ids', now(), $6, 'revision'
        )
        `,
        [
          missingEvidenceTaskId,
          ORG_A,
          SPEC_A,
          JSON.stringify({ propertyKey: PROPERTY_KEY }),
          USER_ID,
          PROJECT_B,
        ],
      );

      // Prove 0057-style coalesce would keep pollution if re-applied to polluted columns.
      await applySingleMigration(db, migration0057);
      const stillPolluted = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, status
         from parameter_spec_review_tasks where id = $1`,
        [pollutedTaskId],
      );
      expect(stillPolluted.rows[0]).toMatchObject({
        project_id: PROJECT_B,
        config_revision_id: crossRevisionId,
        property_occurrence_id: crossOccurrenceId,
        status: "resolved",
      });

      // Mid-migration failure must roll back completely.
      await db.query("begin");
      try {
        const sql = await fs.readFile(path.join(migrationsDir, migration0058), "utf8");
        await db.query(sql);
        await db.query("select 1 / 0");
        await db.query("commit");
      } catch {
        await db.query("rollback");
      }
      const afterRollback = await db.query<{ project_id: string | null; status: string }>(
        `select project_id, status from parameter_spec_review_tasks where id = $1`,
        [pollutedTaskId],
      );
      expect(afterRollback.rows[0]).toMatchObject({
        project_id: PROJECT_B,
        status: "resolved",
      });

      await applySingleMigration(db, migration0058);

      const rebuilt = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        parameter_spec_id: string | null;
        blocker_scope: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, status,
                parameter_spec_id, blocker_scope, source_evidence
         from parameter_spec_review_tasks where id = $1`,
        [pollutedTaskId],
      );
      // Evidence proves PROJECT_A chain — polluted columns rebuilt from evidence only.
      expect(rebuilt.rows[0]).toMatchObject({
        project_id: PROJECT_A,
        config_revision_id: validRevisionId,
        property_occurrence_id: validOccurrenceId,
        status: "resolved",
        parameter_spec_id: SPEC_A,
        blocker_scope: "revision",
      });
      expect(rebuilt.rows[0]?.source_evidence.scopeBackfill).toMatchObject({
        migration: "0058",
        clearedPriorProjectId: PROJECT_B,
        provenProjectId: PROJECT_A,
      });

      const kept = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        parameter_spec_id: string | null;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, status, parameter_spec_id
         from parameter_spec_review_tasks where id = $1`,
        [validTaskId],
      );
      expect(kept.rows[0]).toMatchObject({
        project_id: PROJECT_A,
        config_revision_id: validRevisionId,
        property_occurrence_id: validOccurrenceId,
        status: "resolved",
        parameter_spec_id: SPEC_A,
      });

      // Unproven / cross-tenant evidence: clear FKs and reopen so finalize cannot treat as resolved.
      const unprovenTaskId = randomUUID();
      await db.query(
        `
        insert into parameter_spec_review_tasks (
          id, organization_id, parameter_spec_id, source_evidence, candidate_schemas,
          project_count, status, reviewer_user_id, resolved_at,
          project_id, config_revision_id, property_occurrence_id, blocker_scope
        ) values (
          $1, $2, $3, $4::jsonb, '[]'::jsonb, 1, 'resolved', $5, now(),
          $6, $7, $8, 'revision'
        )
        `,
        [
          unprovenTaskId,
          ORG_A,
          SPEC_A,
          JSON.stringify({
            projectId: PROJECT_B,
            configRevisionId: crossRevisionId,
            propertyOccurrenceId: crossOccurrenceId,
            propertyKey: PROPERTY_KEY,
          }),
          USER_ID,
          PROJECT_B,
          crossRevisionId,
          crossOccurrenceId,
        ],
      );
      await applySingleMigration(db, migration0058);
      const unproven = await db.query<{
        project_id: string | null;
        status: string;
        parameter_spec_id: string | null;
        blocker_scope: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select project_id, status, parameter_spec_id, blocker_scope, source_evidence
         from parameter_spec_review_tasks where id = $1`,
        [unprovenTaskId],
      );
      expect(unproven.rows[0]?.project_id).toBeNull();
      expect(unproven.rows[0]?.status).toBe("open");
      expect(unproven.rows[0]?.parameter_spec_id).toBeNull();
      expect(unproven.rows[0]?.blocker_scope).toBe("platform");
      expect(unproven.rows[0]?.source_evidence.scopeBackfill).toMatchObject({
        migration: "0058",
        code: "polluted_or_unproven_scope",
      });

      const missingEvidence = await db.query<{
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        parameter_spec_id: string | null;
        reviewer_user_id: string | null;
        resolved_at: Date | null;
        blocker_scope: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select project_id, config_revision_id, property_occurrence_id, status,
                parameter_spec_id, reviewer_user_id, resolved_at, blocker_scope, source_evidence
         from parameter_spec_review_tasks where id = $1`,
        [missingEvidenceTaskId],
      );
      expect(missingEvidence.rows[0]).toMatchObject({
        project_id: null,
        config_revision_id: null,
        property_occurrence_id: null,
        status: "open",
        parameter_spec_id: null,
        reviewer_user_id: null,
        resolved_at: null,
        blocker_scope: "platform",
      });
      expect(missingEvidence.rows[0]?.source_evidence.scopeBackfill).toMatchObject({
        migration: "0058",
        code: "missing_or_unproven_evidence_chain",
        clearedPriorProjectId: PROJECT_B,
      });

      // Idempotent second apply: no scoped value or diagnostic metadata changes.
      const beforeSecondApply = await db.query<{
        id: string;
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select id, project_id, config_revision_id, property_occurrence_id, status, source_evidence
         from parameter_spec_review_tasks where id = any($1::text[]) order by id`,
        [[pollutedTaskId, missingEvidenceTaskId]],
      );
      await applySingleMigration(db, migration0058);
      const again = await db.query<{
        id: string;
        project_id: string | null;
        config_revision_id: string | null;
        property_occurrence_id: string | null;
        status: string;
        source_evidence: Record<string, unknown>;
      }>(
        `select id, project_id, config_revision_id, property_occurrence_id, status, source_evidence
         from parameter_spec_review_tasks where id = any($1::text[]) order by id`,
        [[pollutedTaskId, missingEvidenceTaskId]],
      );
      expect(again.rows).toEqual(beforeSecondApply.rows);
    });
    },
    30_000,
  );
});
