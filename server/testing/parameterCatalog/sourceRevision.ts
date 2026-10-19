import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { validCatalogReleaseBundle } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource, type CatalogSnapshot } from "../../modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { CURRENT_POINTER_LOCK_KEY } from "../../modules/catalog-kernel/install/lockProtocol";
import { CatalogCommitInjectedFailure } from "./failureInjection";

/** Advance the driver fixture through its real compiler and publication owner. */
export async function advanceSourceRevisionCatalogFixture(db: Database, current: CatalogSnapshot["release"]) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new Error("Source revision Catalog fixture requires native PostgreSQL");
  const bundle = validCatalogReleaseBundle();
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error("Catalog fixture unavailable");
  const installed = await installPublishedRelease(pool, {
    mode: "advance", source: jsonCatalogReleaseSource(bundle), expectedCurrent: current,
    expectedTargetDigest: compiled.value.aggregateDigest
  });
  return installed.ok ? { ok: true as const } : { ok: false as const, reason: installed.error.kind };
}

export async function trySourceRevisionPublicationLock(observer: Queryable): Promise<boolean> {
  const result = await observer.query<{ locked: boolean }>(
    "select pg_try_advisory_xact_lock($1::bigint) as locked", [CURRENT_POINTER_LOCK_KEY]
  );
  return result.rows[0]!.locked;
}

export async function lockSourceRevisionRegistrations(observer: Queryable): Promise<void> {
  await observer.query("lock table parameter_catalog.organization_subject_registrations in row exclusive mode nowait");
}

type SourceRevisionBindingState = {
  catalogReleaseId: string;
  currentValueId: string;
  valueState: "present" | "deleted";
  locator: Record<string, unknown>;
  historyCount: number;
};

/** Exact current pin and history witness scoped to one genuine test Binding. */
export async function readSourceRevisionBindingState(db: Queryable, input: {
  organizationId: string; projectId: string; bindingId: string;
}): Promise<SourceRevisionBindingState> {
  const result = await db.query<SourceRevisionBindingState>(`select binding.catalog_release_id as "catalogReleaseId",
      binding.current_value_id as "currentValueId",value.value_state as "valueState",pin.locator,
      (select count(*)::int from parameter_catalog.binding_history_events history where history.binding_id=binding.id) as "historyCount"
    from parameter_catalog.project_parameter_bindings binding
    join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id and value.binding_id=binding.id
    join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id and pin.binding_id=binding.id
    where binding.organization_id=$1 and binding.project_id=$2 and binding.id=$3`,
  [input.organizationId, input.projectId, input.bindingId]);
  if (result.rows.length !== 1) throw new Error("Source revision fixture requires one exact current Binding pin");
  return result.rows[0]!;
}

/** Abort exactly before this request's final approval UPDATE, after source writes and audit. */
export function failBeforeSourceRevisionApproval(tx: Database, requestId: string): Database {
  return {
    ...tx,
    query: <Row>(text: string, values?: unknown[]) => {
      if (text.includes("update public.project_parameter_value_change_requests set status='approved'") && values?.[0] === requestId) {
        throw new CatalogCommitInjectedFailure("late-apply-failure");
      }
      return tx.query<Row>(text, values);
    }
  };
}
