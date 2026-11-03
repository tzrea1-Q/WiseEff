import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { refreshAuthoritativeSource, validCatalogReleaseBundle } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../modules/catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource, type CatalogSnapshot } from "../../modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { CURRENT_POINTER_LOCK_KEY } from "../../modules/catalog-kernel/install/lockProtocol";
import { CatalogCommitInjectedFailure } from "./failureInjection";
import { CatalogArtifactId } from "../../modules/parameter-catalog-contract";
import { encodeBundleBytes } from "../../modules/catalog-publication/builder/bundleCodec";
import { persistArtifact } from "../../modules/catalog-publication/persistence/store";

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

type SourceRevisionLifecycleFixtureInput = (
  { target: "subject"; lifecycle: "active" | "retired" } | { target: "definition"; lifecycle: "active" | "deprecated" | "retired" }
) & { previousBundle?: CatalogReleaseBundle; includeManagedSibling?: boolean; retainArtifactForErasure?: boolean };

export function sourceRevisionLifecycleFixtureBundle(current: CatalogSnapshot["release"], input: SourceRevisionLifecycleFixtureInput): CatalogReleaseBundle {
  const initial = validCatalogReleaseBundle();
  const history = input.previousBundle?.releases ?? [initial.releases[0]!];
  const predecessor = history.at(-1)!;
  const next = structuredClone(predecessor) as Parameters<typeof refreshAuthoritativeSource>[0];
  const sequence = predecessor.manifest.release.sequence + 1;
  next.manifest.release = { ...next.manifest.release, id: `crel_acme_${sequence}`, sequence,
    version: `1.${sequence - 1}.0`, publishedAt: `2026-09-${String(sequence).padStart(2, "0")}T00:00:00Z`,
    predecessor: { id: current.id, digest: current.digest } };
  for (const document of next.documents) {
    if (input.target === "subject" && document.kind === "subject") {
      document.content.lifecycle = input.lifecycle;
      document.content.tombstone = input.lifecycle === "retired" ? { reason: "Source management fixture",
        withdrawnByReleaseId: next.manifest.release.id, previousSelector: document.content.selector.value } : null;
    }
    if (input.target === "subject" && document.kind === "alias") {
      document.content.lifecycle = input.lifecycle;
      document.content.tombstone = input.lifecycle === "retired" ? { reason: "Source management fixture",
        withdrawnByReleaseId: next.manifest.release.id, previousSelector: document.content.normalizedSelector } : null;
    }
    if (input.target === "definition" && document.kind === "definition" && document.content.id === "pdef_acme_power_iin_max"
      && document.content.revision.lifecycle !== input.lifecycle) {
      const revisionNumber = document.content.revision.number + 1;
      document.content.revision = { ...document.content.revision, id: `drev_acme_power_iin_max_${revisionNumber}`,
        number: revisionNumber, lifecycle: input.lifecycle };
      if (input.lifecycle === "deprecated") document.content.revision.successorDefinitionId = "pdef_acme_power_iin_min";
      else delete document.content.revision.successorDefinitionId;
    }
  }
  if (input.includeManagedSibling || input.lifecycle === "deprecated") {
    const definition = next.documents.find(document => document.kind === "definition");
    if (!definition || definition.kind !== "definition") throw new Error("Source revision fixture Definition unavailable");
    const sibling = structuredClone(definition);
    sibling.content.id = "pdef_acme_power_iin_min";
    sibling.content.propertyKey = "iin_min";
    sibling.content.revision = { ...sibling.content.revision, id: "drev_acme_power_iin_min_1", number: 1, lifecycle: "active",
      displayName: "Minimum input current", matching: { ...sibling.content.revision.matching, sourceProperty: "iin_min" } };
    delete sibling.content.revision.successorDefinitionId;
    next.documents.push(sibling);
  }
  refreshAuthoritativeSource(next);
  return { schemaVersion: initial.schemaVersion,
    targetReleaseId: next.manifest.release.id, releases: [...history, next] };
}

/** Publish a lifecycle successor while preserving the fixture's stable identities and release history. */
export async function publishSourceRevisionLifecycleFixture(db: Database, current: CatalogSnapshot["release"], input: SourceRevisionLifecycleFixtureInput) {
  const pool = getRootPostgresPool(db);
  if (!pool) throw new Error("Source revision Catalog fixture requires native PostgreSQL");
  const bundle = sourceRevisionLifecycleFixtureBundle(current, input);
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(bundle),
    expectedCurrent: current, expectedTargetDigest: compiled.value.aggregateDigest });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));
  if (input.retainArtifactForErasure) {
    const stored = await persistArtifact(db, { id: CatalogArtifactId(`cart_source_revision_${compiled.value.release.id}`),
      artifactDigest: compiled.value.aggregateDigest, artifactBytes: encodeBundleBytes(bundle), sourceKind: "repository-bundle",
      targetReleaseId: compiled.value.release.id, targetReleaseDigest: compiled.value.release.digest,
      predecessorReleaseId: current.id, predecessorReleaseDigest: current.digest, toolchain: bundle.releases.at(-1)!.manifest.toolchain });
    if (!stored.ok) throw new Error(JSON.stringify(stored.error));
  }
  return { bundle, release: compiled.value.release };
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

/** Synthetic lifecycle transition for source-preview race and retention tests. */
export async function setSourceRevisionRegistrationStatus(db: Queryable, input: {
  organizationId: string; registrationId: string; status: "active" | "retired";
}): Promise<void> {
  const result = await db.query(`update parameter_catalog.organization_subject_registrations set status=$3
    where organization_id=$1 and id=$2`, [input.organizationId, input.registrationId, input.status]);
  if (result.rowCount !== 1) throw new Error("Source revision fixture requires one exact registration");
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
