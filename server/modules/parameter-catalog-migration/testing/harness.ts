/**
 * Shared real-harness fixture for the definition identity correction migration
 * tests.  It bootstraps a real published predecessor release, publishes extra
 * Catalog changes through the existing Candidate/Authorization/manager path,
 * registers an organization subject through the existing guarded registration
 * writer, seeds canonical Bindings/ProjectValues through the existing services,
 * and drives the publication manager through its real claim/execute path.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";

import { PublicationJobId, type CatalogReleasePin } from "../../parameter-catalog-contract/index";
import { CatalogArtifactId, CatalogReleaseId } from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { firstAcmePredecessor } from "../../catalog-publication/builder/predecessorHarness";
import { persistArtifact } from "../../catalog-publication/persistence/store";
import {
  createCatalogKernel,
  jsonCatalogReleaseSource,
  type CatalogSnapshot,
} from "../../catalog-kernel/interface";
import { createCatalogInstaller, installPublishedRelease } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import {
  enablePublicationPolicy,
  publisherPermissions,
  userActor,
} from "../../catalog-publication/authorization/testHarness";
import { enqueuePublicationJob } from "../../catalog-publication/enqueue";
import { runPublicationManagerOnce } from "../../catalog-publication/jobs/manager";
import { withPublicationCoordinator } from "../../catalog-publication/coordinator";
import { getJob } from "../../catalog-publication/persistence/store";
import { previewPublicationCandidate } from "../../catalog-publication/preview";
import type { CatalogChange } from "../../catalog-publication/builder/types";
import type { RegisterSubjectCommand } from "../../parameter-governance/registration/command";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import { stabilizeCanonicalBinding } from "../../parameter-bindings/binding/index";
import { createProjectValueService } from "../../parameter-bindings/values/index";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type Database,
} from "../../../shared/database/client";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";

import {
  createParameterCatalogMigrationService,
  type CatalogDefinitionMigrationPorts,
} from "../service";
import type { DefinitionReplacementFailure, ReplacementPublicationPorts } from "../types";

export const PREDECESSOR_SUBJECT_ID = "csub_acme_power";
export const PREDECESSOR_DEFINITION_ID = "pdef_acme_power_iin_max";
export const PREDECESSOR_PROPERTY_KEY = "iin_max";
export const PREDECESSOR_REVISION_ID = "drev_acme_power_iin_max_1";

export const MIGRATION_PRINCIPAL = "user-definition-migration-admin";
export const HARNESS_ORG = "org-drepl-harness";

export type HarnessContent = {
  readonly displayName: string;
  readonly documentation: string;
  readonly unit?: string;
  readonly valueSchema: Record<string, unknown>;
  readonly examples?: readonly (number | string | boolean | null)[];
};

export const integerContent = (
  displayName: string,
  minimum: number,
  maximum?: number,
): HarnessContent => ({
  displayName,
  documentation: `${displayName} documentation.`,
  unit: "mA",
  valueSchema:
    maximum === undefined ? { type: "integer", minimum } : { type: "integer", minimum, maximum },
});

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

export type MigrationHarness = {
  readonly database: EphemeralTestDatabase;
  readonly db: Database;
  readonly pool: pg.Pool;
  readonly client: pg.PoolClient;
  readonly migration: CatalogDefinitionMigrationPorts;
  readonly pin: () => CatalogReleasePin;
  readonly snapshot: () => CatalogSnapshot;
  readonly seedOrganization: (organizationId: string) => Promise<void>;
  readonly seedProject: (organizationId: string, projectId: string, name: string) => Promise<void>;
  readonly registerSubject: (input: {
    readonly organizationId: string;
    readonly subjectId: string;
    readonly subjectKind: "driver" | "node-type";
    readonly moduleId: string;
    readonly principalId?: string;
  }) => Promise<string>;
  readonly seedBindingValue: (input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly logicalNodeId: string;
    readonly registrationId: string;
    readonly definitionId?: string;
    readonly revisionId?: string;
    readonly sources: readonly { readonly sourceRef: string; readonly configRevisionId: string }[];
    readonly values: readonly number[];
  }) => Promise<{ readonly bindingId: string; readonly valueId: string }>;
  readonly publishChange: (
    changeSet: readonly CatalogChange[],
    label: string,
  ) => Promise<CatalogReleasePin>;
  readonly allocatedDefinition: (
    releaseId: string,
    propertyKey: string,
  ) => Promise<{
    readonly definitionId: string;
    readonly revisionId: string;
    readonly subjectId: string;
  } | null>;
  readonly currentTip: (
    projectId: string,
    definitionId: string,
  ) => Promise<{ readonly bindingId: string; readonly valueId: string } | null>;
  readonly setCurrentRelease: (releaseId: string) => Promise<void>;
  readonly close: () => Promise<void>;
};

export const mapEnqueueFailure = (
  error: { readonly kind: string; readonly reason?: string },
  idempotencyKey: string,
): DefinitionReplacementFailure => {
  if (error.kind === "not-found") return { kind: "not-found" };
  if (error.kind === "idempotency-key-conflict") {
    return {
      kind: "revision-conflict",
      idempotencyKey,
      storedFingerprint: "idempotency-key-conflict",
      attemptedFingerprint: "idempotency-key-conflict",
    };
  }
  if (error.kind === "authorization") {
    const reason = error.reason ?? "publication-not-authorized";
    if (reason === "publication-self-approval-forbidden") {
      return { kind: "permission-denied" };
    }
    return { kind: "preview-unavailable", reason: "unsupported-catalog-capability" };
  }
  return { kind: "invalid-command", reason: error.reason ?? "publication" };
};

export const runQueuedPublicationJob = async (
  db: Database,
  pool: pg.Pool,
  jobId: string,
): Promise<
  | { readonly kind: "active"; readonly releaseId: string; readonly releaseDigest: string }
  | { readonly kind: "blocked"; readonly jobId: string; readonly reason: string }
  | { readonly kind: "pending"; readonly jobId: string }
> => {
  const installer = createCatalogInstaller(pool);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const observed = await withPublicationCoordinator(db, (tx) =>
      getJob(tx, PublicationJobId(jobId)),
    );
    if (
      observed.ok &&
      observed.value.status !== "queued" &&
      observed.value.status !== "running" &&
      observed.value.status !== "failed-retryable"
    ) {
      break;
    }
    const claimed = await runPublicationManagerOnce({
      db,
      pool,
      installer,
      resolvePublisherActor: async (principalId) => userActor(principalId, publisherPermissions),
      ownerId: `drepl-${attempt}-${randomUUID().slice(0, 6)}`,
      activationTimeoutMs: 20_000,
      retryBudget: 5,
    });
    if (claimed === "idle") break;
  }
  const settled = await withPublicationCoordinator(db, (tx) => getJob(tx, PublicationJobId(jobId)));
  const pointer = await readCurrentCatalogPointer(pool);
  if (settled.ok && settled.value.status === "active" && pointer.kind === "installed") {
    return { kind: "active", releaseId: pointer.current.id, releaseDigest: pointer.current.digest };
  }
  if (settled.ok && settled.value.status === "needs-rebase") {
    return { kind: "blocked", jobId, reason: "needs-rebase" };
  }
  return { kind: "pending", jobId };
};

/**
 * Real publication port: enqueues through the existing Candidate/Authorization
 * path and drives the queued job through the publication manager's own
 * claim/execute/receipt-recovery sequence.
 */
export const createRealReplacementPublicationPorts = (
  db: Database,
  pool: pg.Pool,
): ReplacementPublicationPorts => ({
  async enqueueReplacementPublication({
    organizationId,
    candidateId,
    idempotencyKey,
    trustedActor,
  }) {
    const enqueued = await enqueuePublicationJob({
      db,
      candidateId,
      idempotencyKey,
      trustedActor,
      requestScope: `organization:${organizationId}:definition-replacement`,
    });
    if (!enqueued.ok) {
      return { ok: false as const, error: mapEnqueueFailure(enqueued.error, idempotencyKey) };
    }
    return {
      ok: true as const,
      value: {
        candidateId: enqueued.value.candidate.id,
        publicationJobId: enqueued.value.job.id,
        authorizationId: enqueued.value.job.authorizationId,
        replayed: enqueued.value.replayed,
      },
    };
  },
  activateReplacementPublication: async ({ jobId }) => runQueuedPublicationJob(db, pool, jobId),
});

export async function createMigrationHarness(): Promise<MigrationHarness> {
  const database = await createEphemeralTestDatabase("drepl");
  const db = createPostgresDatabase(database.url, {});
  const pool = getRootPostgresPool(db)!;
  const client = await pool.connect();

  const bundle = firstReleaseBundle();
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(`fixture failed to compile: ${compiled.error.kind}`);
  }
  const installed = await installPublishedRelease(pool, {
    mode: "bootstrap",
    source: jsonCatalogReleaseSource(bundle),
    expectedTargetDigest: compiled.value.aggregateDigest,
  });
  if (!installed.ok || installed.value.status !== "installed") {
    throw new Error(`predecessor bootstrap failed: ${JSON.stringify(installed)}`);
  }
  await enablePublicationPolicy(client as unknown as pg.Client, {
    publicationEnabled: true,
    lowRiskSingleActorPublish: true,
  });
  // The bootstrap install does not persist a publication Artifact row, but the
  // complete-successor preview requires one for the predecessor digest.
  const predecessor = firstAcmePredecessor();
  const storedArtifact = await persistArtifact(pool, {
    id: CatalogArtifactId(`cart_drepl_pred_${randomUUID().replace(/-/g, "").slice(0, 12)}`),
    artifactDigest: predecessor.digest as never,
    artifactBytes: predecessor.bytes,
    sourceKind: "repository-bundle",
    targetReleaseId: CatalogReleaseId(predecessor.compiled.release.id) as never,
    targetReleaseDigest: predecessor.digest as never,
    predecessorReleaseId: null,
    predecessorReleaseDigest: null,
    toolchain: { ...predecessor.first.manifest.toolchain },
  });
  if (!storedArtifact.ok) {
    throw new Error(`predecessor artifact persist failed: ${JSON.stringify(storedArtifact.error)}`);
  }

  const kernel = createCatalogKernel(pool);
  let currentPin: CatalogReleasePin = {
    id: compiled.value.release.id,
    digest: compiled.value.release.digest,
  };
  let currentSnapshot: CatalogSnapshot = await (async () => {
    const loaded = await kernel.loadPinnedCatalog(currentPin);
    if (!loaded.ok) throw new Error("failed to load the pinned catalog snapshot");
    return loaded.value;
  })();

  const readPointer = async (): Promise<CatalogReleasePin> => {
    const pointer = await readCurrentCatalogPointer(pool);
    if (pointer.kind !== "installed") {
      throw new Error("no installed catalog release");
    }
    return { id: pointer.current.id, digest: pointer.current.digest };
  };

  const reloadSnapshot = async (): Promise<void> => {
    currentPin = await readPointer();
    const loaded = await kernel.loadPinnedCatalog(currentPin);
    if (!loaded.ok) throw new Error("failed to reload the pinned catalog snapshot");
    currentSnapshot = loaded.value;
  };

  const seedOrganization = async (organizationId: string): Promise<void> => {
    await pool.query(
      `insert into public.organizations (id, name) values ($1, $2) on conflict (id) do nothing`,
      [organizationId, organizationId],
    );
  };

  const seedProject = async (
    organizationId: string,
    projectId: string,
    name: string,
  ): Promise<void> => {
    await pool.query(
      `insert into public.projects (id, organization_id, name, code)
       values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [projectId, organizationId, name, projectId.slice(0, 12)],
    );
  };

  const registerSubject: MigrationHarness["registerSubject"] = async (input) => {
    const attributionId = `attr-${input.moduleId}`;
    await pool.query(
      `insert into public.attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
       values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
      [
        attributionId,
        input.organizationId,
        input.subjectKind === "driver" ? "driver-registration" : "node-type-definition",
        input.moduleId,
        `compatible:${input.moduleId}`,
      ],
    );
    if (input.subjectKind === "driver") {
      await pool.query(
        `insert into public.driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
         values ($1, 'physical-device', 'multiple') on conflict (attribution_subject_id) do nothing`,
        [attributionId],
      );
    }
    await pool.query(
      `insert into public.parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
       values ($1, $2, $3, $1, 1, $4, 'curated', $5) on conflict (id) do nothing`,
      [
        input.moduleId,
        input.organizationId,
        input.moduleId,
        input.subjectKind === "driver" ? "driver-group" : "node-type",
        attributionId,
      ],
    );
    const command: RegisterSubjectCommand = {
      kind: "register",
      organizationId: input.organizationId,
      subjectId: input.subjectId as never,
      subjectKind: input.subjectKind,
      expectedRelease: currentPin,
      placement: { mode: "use-default" },
      destinationModuleId: input.moduleId,
      method: "explicit",
      proof: { reason: "definition-replacement-harness" },
      idempotencyKey: `reg:${randomUUID()}`,
      context: { actorKind: "org-admin", principalId: input.principalId ?? MIGRATION_PRINCIPAL },
    };
    const writerClient = await pool.connect();
    try {
      await writerClient.query("begin");
      await writerClient.query("set constraints all deferred");
      const written = await writeGuardedRegistration(writerClient, command);
      if (!written.ok) {
        throw new Error(`registration failed: ${JSON.stringify(written.error)}`);
      }
      await writerClient.query("set constraints all immediate");
      await writerClient.query("commit");
      return written.value.registrationId;
    } catch (error) {
      await writerClient.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      writerClient.release();
    }
  };

  const seedBindingValue: MigrationHarness["seedBindingValue"] = async (input) => {
    const definitionId = input.definitionId ?? PREDECESSOR_DEFINITION_ID;
    const revisionId = input.revisionId ?? PREDECESSOR_REVISION_ID;
    const binding = await stabilizeCanonicalBinding(pool, {
      snapshot: currentSnapshot,
      organizationId: input.organizationId,
      projectId: input.projectId,
      logicalNodeId: input.logicalNodeId,
      registrationId: input.registrationId as never,
      definitionId: definitionId as never,
      effectiveRevisionId: revisionId as never,
      expectedEffectiveRevisionId: null,
    });
    if (!binding.ok) {
      throw new Error(`binding failed: ${JSON.stringify(binding.error)}`);
    }
    const values = createProjectValueService(pool);
    let tip = binding.value.binding.currentValueId;
    for (let index = 0; index < input.values.length; index += 1) {
      const source = input.sources[index] ?? input.sources[input.sources.length - 1]!;
      const appended = await values.append({
        snapshot: currentSnapshot,
        binding: binding.value.binding,
        definitionRevisionId: revisionId as never,
        source: { sourceRef: source.sourceRef, configRevisionId: source.configRevisionId },
        payload: { kind: "number", value: input.values[index]! },
        expectedTip: tip,
      });
      if (!appended.ok) {
        throw new Error(`value append failed: ${JSON.stringify(appended.error)}`);
      }
      tip = appended.value.currentTip;
    }
    return { bindingId: binding.value.binding.id, valueId: tip };
  };

  const publishChange: MigrationHarness["publishChange"] = async (changeSet, label) => {
    const predecessor = await readPointer();
    const built = await previewPublicationCandidate({
      db,
      predecessorDigest: predecessor.digest,
      changeSet,
      authorPrincipalId: MIGRATION_PRINCIPAL,
      authorOrganizationId: HARNESS_ORG,
    });
    if (!built.ok) {
      throw new Error(`publishChange preview failed: ${JSON.stringify(built.error)}`);
    }
    const enqueued = await enqueuePublicationJob({
      db,
      candidateId: built.value.candidate.id,
      idempotencyKey: `harness-${label}-${randomUUID().slice(0, 8)}`,
      trustedActor: userActor(MIGRATION_PRINCIPAL, publisherPermissions),
      requestScope: "instance:definition-replacement-harness",
    });
    if (!enqueued.ok) {
      throw new Error(`publishChange enqueue failed: ${JSON.stringify(enqueued.error)}`);
    }
    const activated = await runQueuedPublicationJob(db, pool, enqueued.value.job.id);
    if (activated.kind !== "active") {
      throw new Error(`publishChange activation failed: ${JSON.stringify(activated)}`);
    }
    await reloadSnapshot();
    return currentPin;
  };

  const allocatedDefinition: MigrationHarness["allocatedDefinition"] = async (
    releaseId,
    propertyKey,
  ) => {
    const result = await pool.query<{ id: string; revision_id: string; subject_id: string }>(
      `select definition.id, head.revision_id, definition.subject_id
         from parameter_catalog.parameter_definitions definition
         join parameter_catalog.catalog_release_definition_heads head
           on head.definition_id = definition.id and head.release_id = $1
        where definition.property_key = $2`,
      [releaseId, propertyKey],
    );
    const row = result.rows[0];
    return row
      ? { definitionId: row.id, revisionId: row.revision_id, subjectId: row.subject_id }
      : null;
  };

  const currentTip: MigrationHarness["currentTip"] = async (projectId, definitionId) => {
    const result = await pool.query<{ id: string; current_value_id: string }>(
      `select id, current_value_id
         from parameter_catalog.current_project_parameter_bindings
        where project_id = $1 and definition_id = $2`,
      [projectId, definitionId],
    );
    const row = result.rows[0];
    return row ? { bindingId: row.id, valueId: row.current_value_id } : null;
  };

  const setCurrentRelease: MigrationHarness["setCurrentRelease"] = async (releaseId) => {
    await pool.query(
      `update parameter_catalog.catalog_state set current_catalog_release_id = $1`,
      [releaseId],
    );
  };

  const migration = createParameterCatalogMigrationService({
    db,
    publication: createRealReplacementPublicationPorts(db, pool),
  });

  return {
    database,
    db,
    pool,
    client,
    migration,
    pin: () => currentPin,
    snapshot: () => currentSnapshot,
    seedOrganization,
    seedProject,
    registerSubject,
    seedBindingValue,
    publishChange,
    allocatedDefinition,
    currentTip,
    setCurrentRelease,
    close: async () => {
      client.release();
      await db.close();
      await database.drop();
    },
  };
}

export const migrationTrustedActor = (principalId = MIGRATION_PRINCIPAL) =>
  userActor(principalId, publisherPermissions);

export const subjectChange = (input: {
  readonly canonicalKey: string;
  readonly selector: string;
  readonly propertyKey: string;
  readonly content: HarnessContent;
}): CatalogChange =>
  ({
    op: "create-subject-with-definitions",
    kind: "driver",
    canonicalKey: input.canonicalKey,
    selector: { kind: "driver-compatible", value: input.selector },
    nature: "physical-device",
    cardinality: "multiple",
    definitions: [{ propertyKey: input.propertyKey, content: input.content }],
  }) as unknown as CatalogChange;

export const definitionChange = (input: {
  readonly subjectId: string;
  readonly propertyKey: string;
  readonly content: HarnessContent;
}): CatalogChange =>
  ({
    op: "create-definition",
    subjectId: input.subjectId,
    propertyKey: input.propertyKey,
    content: input.content,
  }) as unknown as CatalogChange;
