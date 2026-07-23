/**
 * Local-dev only: finish semantic-identity cutover after a semantic-only M1 seed.
 * Does not weaken production `parameter-identities:*` gates; refuse dirty dual-track DBs.
 */
import type { Queryable } from "../../shared/database/client";
import {
  isParameterIdentityCutoverComplete,
  resetParameterIdentityCutoverCache
} from "../parameters/cutoverAwareIdentity";
import {
  applyParameterIdentityCutover,
  migrateParameterIdentities
} from "./migration";

/** Fixed local-dev token; never treat as production PARAMETER_IDENTITY_MAINTENANCE_TOKEN. */
export const LOCAL_POST_CUTOVER_MAINTENANCE_TOKEN = "local-dev-post-cutover";

export const LOCAL_POST_CUTOVER_DIRTY_MESSAGE =
  "Local post-cutover finalize refused: legacy flat identity (or unbound workflow rows) is present. " +
  "Wipe the local Docker volume and re-run `npm run dev:all` " +
  "(e.g. `docker compose down -v` then `npm run dev:all`). " +
  "Do not migrate/cut over a dirty dual-track developer database in place.";

export type LocalPostCutoverResult =
  | { status: "already-complete" }
  | { status: "applied"; migrationRunId: string };

async function countRows(db: Queryable, sql: string): Promise<number> {
  try {
    const result = await db.query<{ c: string }>(sql);
    return Number(result.rows[0]?.c ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // After cutover, flat tables are renamed; treat missing tables as zero for dirty checks.
    if (/does not exist|undefined_table|42P01/i.test(message)) return 0;
    throw error;
  }
}

export async function assertLocalDatabaseCleanForPostCutover(db: Queryable): Promise<void> {
  const definitionCount = await countRows(
    db,
    `select count(*)::text as c from parameter_definitions`
  );
  const valueCount = await countRows(
    db,
    `select count(*)::text as c from project_parameter_values`
  );
  const historyNullBinding = await countRows(
    db,
    `select count(*)::text as c from parameter_history_entries where project_parameter_binding_id is null`
  );
  const draftNullBinding = await countRows(
    db,
    `select count(*)::text as c from parameter_drafts where project_parameter_binding_id is null`
  );
  const changeRequestNullBinding = await countRows(
    db,
    `select count(*)::text as c from parameter_change_requests where project_parameter_binding_id is null`
  );

  if (
    definitionCount > 0 ||
    valueCount > 0 ||
    historyNullBinding > 0 ||
    draftNullBinding > 0 ||
    changeRequestNullBinding > 0
  ) {
    throw new Error(LOCAL_POST_CUTOVER_DIRTY_MESSAGE);
  }
}

export async function ensureLocalPostCutoverIdentity(
  db: Queryable
): Promise<LocalPostCutoverResult> {
  if (await isParameterIdentityCutoverComplete(db)) {
    return { status: "already-complete" };
  }

  await assertLocalDatabaseCleanForPostCutover(db);

  const report = await migrateParameterIdentities(db, {
    mode: "apply",
    maintenanceToken: LOCAL_POST_CUTOVER_MAINTENANCE_TOKEN,
    expectedMaintenanceToken: LOCAL_POST_CUTOVER_MAINTENANCE_TOKEN,
    writeLockConfirmed: true,
    dbSnapshotId: "local-dev-db",
    objectSnapshotId: "local-dev-object-store"
  });

  if (report.blockers.length > 0) {
    throw new Error(
      `Local post-cutover migrate was blocked: ${report.blockers.join("; ")}`
    );
  }

  await applyParameterIdentityCutover(db, { migrationRunId: report.migrationRunId });
  resetParameterIdentityCutoverCache();
  return { status: "applied", migrationRunId: report.migrationRunId };
}
