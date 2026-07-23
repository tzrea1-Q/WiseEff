import "dotenv/config";
import { pathToFileURL } from "node:url";

import { loadServerEnv } from "../server/config/env";
import {
  createPostgresDatabase,
  type Database,
  type Queryable
} from "../server/shared/database/client";

const seededUserIds = [
  "u-xu-yun",
  "u-zhao-heng",
  "u-liu-min",
  "u-wang-jie",
  "u-chen-na",
  "u-li-peng",
  "u-sun-mei"
] as const;

/**
 * Ownership rows that commonly collide when reassigned onto a seeded user
 * (unique on project/value/user). Safe to drop before quality reseeding.
 */
const deleteOwnedByTransientUser: ReadonlyArray<{ table: string; column: string }> = [
  { table: "parameter_drafts", column: "user_id" },
  { table: "user_notifications", column: "recipient_user_id" }
];

/**
 * Flat PPV is renamed to legacy_* at parameter-identity cutover. Quality reset
 * must tolerate either name (and skip when neither remains).
 */
const FLAT_OR_LEGACY_PPV_TABLES = [
  "project_parameter_values",
  "legacy_project_parameter_values"
] as const;

/** Optional attribution FKs can be cleared instead of deleting the parent row. */
const nullifyTransientUserRefs: ReadonlyArray<{ table: string; column: string }> = [
  { table: "agent_approvals", column: "decided_by_user_id" },
  { table: "audit_events", column: "actor_user_id" },
  { table: "debug_nodes", column: "archived_by" },
  { table: "debugging_parameters", column: "archived_by" },
  { table: "identity_mapping_tasks", column: "reviewer_user_id" },
  { table: "local_registration_role_requests", column: "decided_by_user_id" },
  { table: "parameter_change_requests", column: "assigned_to_user_id" },
  { table: "parameter_change_requests", column: "workflow_hardware_committer_user_id" },
  { table: "parameter_change_requests", column: "workflow_software_committer_user_id" },
  { table: "parameter_change_requests", column: "workflow_software_user_id" },
  { table: "parameter_file_sync_conflicts", column: "resolved_by_user_id" },
  { table: "parameter_history_entries", column: "changed_by_user_id" },
  { table: "parameter_review_decisions", column: "reviewer_user_id" },
  { table: "parameter_spec_review_tasks", column: "reviewer_user_id" }
];

/**
 * Durable domain rows keep their data; only the actor pointer moves to a seeded
 * admin so transient acceptance users can be deleted before reseeding.
 */
const reassignTransientUserRefs: ReadonlyArray<{ table: string; column: string }> = [
  { table: "agent_approvals", column: "requested_by_user_id" },
  { table: "agent_sessions", column: "actor_user_id" },
  { table: "debug_device_leases", column: "lease_owner_user_id" },
  { table: "debugging_sessions", column: "actor_user_id" },
  { table: "debugging_snapshots", column: "created_by_user_id" },
  { table: "dts_config_revisions", column: "created_by_user_id" },
  { table: "dts_release_baseline", column: "created_by_user_id" },
  { table: "dts_sensitive_node_rules", column: "created_by_user_id" },
  { table: "log_feedback", column: "user_id" },
  { table: "log_file_objects", column: "uploaded_by_user_id" },
  { table: "log_records", column: "submitted_by_user_id" },
  { table: "node_operations", column: "actor_user_id" },
  { table: "parameter_change_requests", column: "submitter_user_id" },
  { table: "parameter_import_batches", column: "created_by_user_id" },
  { table: "parameter_submission_rounds", column: "submitter_user_id" },
  { table: "product_feedback", column: "submitter_user_id" },
  { table: "project_parameter_file_versions", column: "created_by_user_id" }
];

async function publicTableExists(tx: Queryable, tableName: string): Promise<boolean> {
  const result = await tx.query<{ c: string }>(
    `
    select count(*)::text as c
    from information_schema.tables
    where table_schema = 'public' and table_name = $1
    `,
    [tableName]
  );
  return Number(result.rows[0]?.c ?? 0) > 0;
}

/** Resolve which PPV attribution table exists before/after identity cutover. */
export async function resolveFlatOrLegacyPpvTable(tx: Queryable): Promise<string | null> {
  for (const table of FLAT_OR_LEGACY_PPV_TABLES) {
    if (await publicTableExists(tx, table)) return table;
  }
  return null;
}

export async function resetQualityRuntime(db: Database) {
  await db.transaction(async (tx) => {
    await tx.query("update users set organization_id = 'org-chargelab' where id = any($1::text[])", [seededUserIds]);
    await tx.query("delete from local_registration_role_requests");
    await tx.query("delete from auth_sessions");
    await tx.query("delete from user_password_credentials");
    await tx.query("delete from user_role_bindings");
    await tx.query("delete from audit_events where app in ('auth', 'user-governance') or target_type = 'user'");

    for (const { table, column } of nullifyTransientUserRefs) {
      await tx.query(
        `update ${table} set ${column} = null where ${column} is not null and ${column} <> all($1::text[])`,
        [seededUserIds]
      );
    }

    const ppvTable = await resolveFlatOrLegacyPpvTable(tx);
    if (ppvTable) {
      await tx.query(
        `update ${ppvTable} set updated_by_user_id = null where updated_by_user_id is not null and updated_by_user_id <> all($1::text[])`,
        [seededUserIds]
      );
    }

    for (const { table, column } of deleteOwnedByTransientUser) {
      await tx.query(`delete from ${table} where ${column} <> all($1::text[])`, [seededUserIds]);
    }

    const keepUserId = seededUserIds[0];
    for (const { table, column } of reassignTransientUserRefs) {
      await tx.query(
        `update ${table} set ${column} = $2 where ${column} is not null and ${column} <> all($1::text[])`,
        [seededUserIds, keepUserId]
      );
    }

    await tx.query("delete from users where id <> all($1::text[])", [seededUserIds]);
  });
}

async function main() {
  const env = loadServerEnv(process.env);

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to reset quality runtime data.");
  }

  await resetQualityRuntime(createPostgresDatabase(env.DATABASE_URL));
  console.log("Reset transient WiseEff quality runtime data.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
