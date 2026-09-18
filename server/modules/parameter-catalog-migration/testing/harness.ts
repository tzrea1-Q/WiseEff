/**
 * Shared real-harness fixture for the definition identity correction migration
 * tests.  It bootstraps a real published predecessor release, publishes extra
 * Catalog changes through the existing Candidate/Authorization/manager path,
 * registers an organization subject through the existing guarded registration
 * writer, seeds canonical Bindings/ProjectValues through the existing services,
 * and drives the publication manager through its real claim/execute path.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
import { appendProjectValue } from "../../parameter-bindings/values/service";
import { createLocalObjectStore, type ObjectStore } from "../../logs/objectStore";
import { offsetToLineColumn, parseDts, type DtsNodeCst, type DtsPropertyCst } from "../../dts";
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
  readonly objectStore?: ObjectStore;
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
    /**
     * Property keys that must exist in the DTS graph before the first source
     * pin.  Pinned provenance is immutable, so later tests must not append
     * target/sibling effects to an already pinned revision.
     */
    readonly propertyKeys?: readonly string[];
    readonly values: readonly number[];
  }) => Promise<{ readonly bindingId: string; readonly valueId: string }>;
  readonly seedSourceFacts: (input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly logicalNodeId: string;
    readonly definitionId?: string;
    readonly propertyKey?: string;
    readonly sourceRef: string;
    readonly configRevisionId: string;
  }) => Promise<void>;
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

export async function createMigrationHarness(options: { readonly objectStore?: ObjectStore; readonly database?: EphemeralTestDatabase } = {}): Promise<MigrationHarness> {
  const database = options.database ?? await createEphemeralTestDatabase("drepl");
  const db = createPostgresDatabase(database.url, {});
  const pool = getRootPostgresPool(db)!;
  const client = await pool.connect();
  const ownedStorageDirectory = options.objectStore
    ? null
    : await mkdtemp(path.join(tmpdir(), "wiseeff-drepl-"));
  const objectStore = options.objectStore ?? createLocalObjectStore(ownedStorageDirectory!);

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

  const ensureSourceFacts = async (input: {
    readonly organizationId: string;
    readonly projectId: string;
    readonly logicalNodeId: string;
    readonly definitionId?: string;
    readonly propertyKey?: string;
    readonly sourceRef: string;
    readonly configRevisionId: string;
    readonly propertyKeys?: readonly string[];
    readonly fixtureValue?: number;
  }) => {
    const propertyKey = input.propertyKey ?? (() => {
      if (!input.definitionId) throw new Error("source facts require definitionId or propertyKey");
      const key = currentSnapshot.getDefinitionById(input.definitionId as never);
      if (key.status !== "found") throw new Error(`definition unavailable: ${input.definitionId}`);
      return key.definition.propertyKey;
    })();
    const propertyKeys = Array.from(new Set([propertyKey, ...(input.propertyKeys ?? [])]));
    const token = createHash("sha256")
      .update(`${input.organizationId}|${input.projectId}|${input.configRevisionId}|${input.logicalNodeId}`)
      .digest("hex")
      .slice(0, 24);
    const propertyToken = createHash("sha256")
      .update(`${token}|${propertyKey}`)
      .digest("hex")
      .slice(0, 24);
    const existingRevision = await pool.query<{
      config_set_id: string;
      organization_id: string;
      project_id: string;
    }>(
      `select config_set_id, organization_id, project_id
         from public.dts_config_revisions
        where id = $1`,
      [input.configRevisionId],
    );
    let configSetId: string;
    let fileId: string;
    let fileVersionId: string;
    if (existingRevision.rows[0]) {
      configSetId = existingRevision.rows[0].config_set_id;
      const member = await pool.query<{ file_id: string; file_version_id: string }>(
        `select file_id, file_version_id
           from public.dts_config_revision_members
          where config_revision_id = $1
          order by sort_order, id
          limit 1`,
        [input.configRevisionId],
      );
      if (member.rows[0]) {
        fileId = member.rows[0].file_id;
        fileVersionId = member.rows[0].file_version_id;
      } else {
        const fallbackFile = await pool.query<{ id: string; current_version_id: string | null; file_name: string }>(
          `select id, current_version_id, file_name
             from public.project_parameter_files
            where config_set_id = $1 and organization_id = $2 and project_id = $3
            order by id limit 1`,
          [configSetId, input.organizationId, input.projectId],
        );
        if (!fallbackFile.rows[0]?.current_version_id) {
          throw new Error(`source revision has no member: ${input.configRevisionId}`);
        }
        fileId = fallbackFile.rows[0].id;
        fileVersionId = fallbackFile.rows[0].current_version_id;
        await pool.query(
          `insert into public.dts_config_revision_members (
             id, config_revision_id, file_id, file_version_id, role, sort_order, source_name
           ) values ($1,$2,$3,$4,'base',0,$5)`,
          [`member-drepl-${token}`, input.configRevisionId, fileId, fileVersionId, fallbackFile.rows[0].file_name],
        );
      }
    } else {
      configSetId = `dcs-drepl-${token}`;
      fileId = `file-drepl-${token}`;
      fileVersionId = `fileversion-drepl-${token}`;
      const rawName = input.sourceRef.split("!")[0]?.split("/").pop() ?? "fixture.dts";
      const fileName = rawName.endsWith(".dts") ? rawName : `fixture-${token}.dts`;
      const sourceContent = [
        "/dts-v1/;",
        "/ {",
        `  ${input.logicalNodeId} {`,
        ...propertyKeys.map((key) => `    ${key} = <${input.fixtureValue ?? 5}>;`),
        "  };",
        "};",
        "",
      ].join("\n");
      const stored = await objectStore.put({
        organizationId: input.organizationId,
        fileName,
        contentType: "text/plain",
        bytes: Buffer.from(sourceContent, "utf8"),
      });
      await pool.query(
        `insert into public.dts_config_set (id, organization_id, project_id, name)
         values ($1,$2,$3,$4) on conflict (id) do nothing`,
        [configSetId, input.organizationId, input.projectId, `drepl-${token}`],
      );
      await pool.query(
        `insert into public.project_parameter_files (
           id, organization_id, project_id, file_name, format, config_set_id, config_set_role, enabled
         ) values ($1,$2,$3,$4,'dts',$5,'base',true)
         on conflict (id) do nothing`,
        [fileId, input.organizationId, input.projectId, fileName, configSetId],
      );
      await pool.query(
        `insert into public.project_parameter_file_versions (
           id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
         ) values ($1,$2,1,$3,$4,$5,'{}'::jsonb,'upload')
         on conflict (id) do nothing`,
        [fileVersionId, fileId, stored.storageKey, stored.checksumSha256, stored.fileSizeBytes],
      );
      await pool.query(
        `update public.project_parameter_files set current_version_id = $1 where id = $2`,
        [fileVersionId, fileId],
      );
      await pool.query(
        `insert into public.dts_config_revisions (
           id, organization_id, project_id, config_set_id, revision_number, status,
           entry_file, include_search_paths, overlay_order, manifest_state
         ) values ($1,$2,$3,$4,1,'resolved',$5,$6::jsonb,$7::jsonb,'complete')`,
        [input.configRevisionId, input.organizationId, input.projectId, configSetId, fileName, JSON.stringify(["."]), JSON.stringify([])],
      );
      await pool.query(
        `insert into public.dts_config_revision_members (
           id, config_revision_id, file_id, file_version_id, role, sort_order, source_name
         ) values ($1,$2,$3,$4,'base',0,$5)`,
        [`member-drepl-${token}`, input.configRevisionId, fileId, fileVersionId, fileName],
      );
    }

    const logicalNode = await pool.query<{ config_set_id: string }>(
      `select config_set_id from public.dts_logical_nodes where id = $1`,
      [input.logicalNodeId],
    );
    if (!logicalNode.rows[0]) {
      await pool.query(
        `insert into public.dts_logical_nodes (id, organization_id, project_id, config_set_id)
         values ($1,$2,$3,$4)`,
        [input.logicalNodeId, input.organizationId, input.projectId, configSetId],
      );
    }
    const existingLogicalRevision = await pool.query<{ id: string }>(
      `select id from public.dts_logical_node_revisions
        where logical_node_id = $1 and config_revision_id = $2`,
      [input.logicalNodeId, input.configRevisionId],
    );
    const logicalRevisionId = existingLogicalRevision.rows[0]?.id ?? `lnr-drepl-${token}`;
    if (!existingLogicalRevision.rows[0]) {
      await pool.query(
        `insert into public.dts_logical_node_revisions (
           id, logical_node_id, config_revision_id, node_locator, name
         ) values ($1,$2,$3,$4,'fixture')`,
        [logicalRevisionId, input.logicalNodeId, input.configRevisionId, `/${input.logicalNodeId}`],
      );
    }
    const existingProperties = await pool.query<{
      property_occurrence_id: string;
      node_occurrence_id: string;
      file_version_id: string;
      property_name: string;
    }>(
      `select property.id as property_occurrence_id,
              property.node_occurrence_id,
              property.file_version_id,
              property.property_name
         from public.dts_occurrence_effects effect
         join public.dts_property_occurrences property
           on property.id = effect.property_occurrence_id
          and property.config_revision_id = effect.config_revision_id
        where effect.logical_node_revision_id = $1
          and effect.config_revision_id = $2
          and effect.effect_kind in ('set','override')
          and effect.node_occurrence_id = property.node_occurrence_id
          and effect.property_name = property.property_name
        order by effect.source_order desc, effect.id`,
      [logicalRevisionId, input.configRevisionId],
    );
    const propertiesByName = new Map(
      existingProperties.rows.map((row) => [row.property_name, row]),
    );
    if (propertyKeys.some((key) => !propertiesByName.has(key))) {
      const version = await pool.query<{ storage_key: string; checksum: string; size_bytes: number }>(
        `select storage_key, checksum, size_bytes::int
           from public.project_parameter_file_versions where id = $1`,
        [fileVersionId],
      );
      const metadata = version.rows[0];
      if (!metadata) throw new Error(`source file version missing: ${fileVersionId}`);
      if (!objectStore.getBounded) throw new Error("source fixture requires bounded object storage");
      const bytes = await objectStore.getBounded(metadata.storage_key, 8 * 1024 * 1024);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const parsed = parseDts(content);
      const node = parsed.topLevel
        .flatMap((candidate) => [
          candidate,
          ...candidate.children.filter(
            (child): child is DtsNodeCst => child.kind === "node",
          ),
        ])
        .find((candidate) => candidate.name === input.logicalNodeId);
      if (!node) throw new Error(`source fixture node missing: ${input.logicalNodeId}`);
      const existingNodeId = existingProperties.rows[0]?.node_occurrence_id;
      const nodeOccurrenceId = existingNodeId ?? `nodeocc-drepl-${token}`;
      if (!existingNodeId) {
        const nodeStart = offsetToLineColumn(content, node.span.start);
        const nodeEnd = offsetToLineColumn(content, node.span.end);
        await pool.query(
          `insert into public.dts_node_occurrences (
             id, config_revision_id, file_version_id, name, ref_target, unit_address, labels, node_path,
             start_offset, end_offset, start_line, start_column, end_line, end_column,
             raw_text, ast_json, source_order
           ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,0)`,
          [
            nodeOccurrenceId,
            input.configRevisionId,
            fileVersionId,
            node.name,
            node.refTarget ?? null,
            node.unitAddress ?? null,
            JSON.stringify(node.labels),
            `/${input.logicalNodeId}`,
            node.span.start,
            node.span.end,
            nodeStart.line,
            nodeStart.column,
            nodeEnd.line,
            nodeEnd.column,
            content.slice(node.span.start, node.span.end),
            "{}",
          ],
        );
      }
      for (const key of propertyKeys) {
        if (propertiesByName.has(key)) continue;
        const property = node.children.find(
          (child): child is DtsPropertyCst =>
            child.kind === "property" && child.name === key,
        );
        if (!property) throw new Error(`source fixture property missing: ${key}`);
        const propertyStart = offsetToLineColumn(content, property.span.start);
        const propertyEnd = offsetToLineColumn(content, property.span.end);
        const propertyOccurrenceId = `propocc-drepl-${createHash("sha256")
          .update(`${token}|${key}`)
          .digest("hex")
          .slice(0, 24)}`;
        await pool.query(
          `insert into public.dts_property_occurrences (
             id, config_revision_id, node_occurrence_id, file_version_id, property_name,
             start_offset, end_offset, start_line, start_column, end_line, end_column,
             raw_text, ast_json, source_order
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,0)`,
          [
            propertyOccurrenceId,
            input.configRevisionId,
            nodeOccurrenceId,
            fileVersionId,
            key,
            property.span.start,
            property.span.end,
            propertyStart.line,
            propertyStart.column,
            propertyEnd.line,
            propertyEnd.column,
            property.rawText,
            "{}",
          ],
        );
        await pool.query(
          `insert into public.dts_occurrence_effects (
             id, config_revision_id, logical_node_revision_id, property_occurrence_id,
             node_occurrence_id, property_name, effect_kind, source_order
           ) values ($1,$2,$3,$4,$5,$6,'set',0)`,
          [
            `effect-drepl-${createHash("sha256")
              .update(`${token}|${key}`)
              .digest("hex")
              .slice(0, 24)}`,
            input.configRevisionId,
            logicalRevisionId,
            propertyOccurrenceId,
            nodeOccurrenceId,
            key,
          ],
        );
        propertiesByName.set(key, {
          property_occurrence_id: propertyOccurrenceId,
          node_occurrence_id: nodeOccurrenceId,
          file_version_id: fileVersionId,
          property_name: key,
        });
      }
    }
    const requestedProperty = propertiesByName.get(propertyKey);
    if (!requestedProperty) {
      throw new Error(`source fixture property missing after preparation: ${propertyKey}`);
    }
    const nodeOccurrenceId = requestedProperty.node_occurrence_id;
    const propertyOccurrenceId = requestedProperty.property_occurrence_id;
    const existingOccurrence = await pool.query<{ id: string }>(
      `select id from parameter_catalog.project_parameter_source_occurrences
        where organization_id = $1 and project_id = $2 and config_set_id = $3
          and file_id = $4 and occurrence_kind = 'dts' and logical_node_id = $5`,
      [input.organizationId, input.projectId, configSetId, fileId, input.logicalNodeId],
    );
    const sourceOccurrenceId = existingOccurrence.rows[0]?.id ?? `src_occ_drepl_${token}`;
    if (!existingOccurrence.rows[0]) {
      await pool.query(
        `insert into parameter_catalog.project_parameter_source_occurrences (
           id, organization_id, project_id, config_set_id, file_id, occurrence_kind, logical_node_id
         ) values ($1,$2,$3,$4,$5,'dts',$6)`,
        [sourceOccurrenceId, input.organizationId, input.projectId, configSetId, fileId, input.logicalNodeId],
      );
    }
    return { sourceOccurrenceId, configRevisionId: input.configRevisionId, fileId, fileVersionId, propertyOccurrenceId, nodeOccurrenceId };
  };

  const seedBindingValue: MigrationHarness["seedBindingValue"] = async (input) => {
    const definitionId = input.definitionId ?? PREDECESSOR_DEFINITION_ID;
    const revisionId = input.revisionId ?? PREDECESSOR_REVISION_ID;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const firstSource = input.sources[0];
      if (!firstSource) throw new Error("seedBindingValue requires a source");
      const definition = currentSnapshot.getDefinitionById(definitionId as never);
      const definitionPropertyKey =
        definition.status === "found" ? definition.definition.propertyKey : definitionId;
      const preparedSources = new Map<string, Awaited<ReturnType<typeof ensureSourceFacts>>>();
      for (const [sourceIndex, source] of input.sources.entries()) {
        const sourceKey = `${source.sourceRef}\0${source.configRevisionId}`;
        if (preparedSources.has(sourceKey)) continue;
        const firstFacts = await ensureSourceFacts({
          organizationId: input.organizationId,
          projectId: input.projectId,
          logicalNodeId: input.logicalNodeId,
          definitionId,
          propertyKey: definitionPropertyKey,
          propertyKeys: input.propertyKeys,
          fixtureValue: input.values[sourceIndex] ?? input.values[0] ?? 5,
          sourceRef: source.sourceRef,
          configRevisionId: source.configRevisionId,
        });
        preparedSources.set(sourceKey, firstFacts);
      }
      const firstFacts = preparedSources.get(
        `${firstSource.sourceRef}\0${firstSource.configRevisionId}`,
      );
      if (!firstFacts) throw new Error("seedBindingValue first source graph was not prepared");
      const binding = await stabilizeCanonicalBinding(client, {
        snapshot: currentSnapshot,
        organizationId: input.organizationId,
        projectId: input.projectId,
        logicalNodeId: input.logicalNodeId,
        sourceOccurrenceId: firstFacts.sourceOccurrenceId,
        registrationId: input.registrationId as never,
        definitionId: definitionId as never,
        effectiveRevisionId: revisionId as never,
        expectedEffectiveRevisionId: null,
      });
      if (!binding.ok) {
        await client.query("rollback");
        throw new Error(`binding failed: ${JSON.stringify(binding.error)}`);
      }
      let tip = binding.value.binding.currentValueId;
      for (let index = 0; index < input.values.length; index += 1) {
        const source = input.sources[index] ?? input.sources[input.sources.length - 1]!;
        const facts = preparedSources.get(`${source.sourceRef}\0${source.configRevisionId}`);
        if (!facts) throw new Error("seedBindingValue source graph was not prepared");
        const appended = await appendProjectValue({
          query: client.query.bind(client),
        }, {
          snapshot: currentSnapshot,
          binding: binding.value.binding,
          definitionRevisionId: revisionId as never,
          source: { sourceRef: source.sourceRef, configRevisionId: source.configRevisionId },
          payload: { kind: "number", value: input.values[index]! },
          expectedTip: tip,
        });
        if (!appended.ok) {
          await client.query("rollback");
          throw new Error(`value append failed: ${JSON.stringify(appended.error)}`);
        }
        const definition = currentSnapshot.getDefinitionById(definitionId as never);
        const locator = {
          kind: "dts-property",
          propertyOccurrenceId: facts.propertyOccurrenceId,
          nodeOccurrenceId: facts.nodeOccurrenceId,
          fileVersionId: facts.fileVersionId,
          propertyName: definition.status === "found" ? definition.definition.propertyKey : definitionId,
        };
        await client.query(
          `insert into parameter_catalog.project_value_source_pins (
             id, project_value_id, binding_id, definition_id, organization_id, project_id,
             source_occurrence_id, config_revision_id, file_id, file_version_id, format,
             property_occurrence_id, locator, locator_digest
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'dts',$11,$12::jsonb,$13)`,
          [
            `src_pin_drepl_${appended.value.value.id.slice("pval_".length)}`,
            appended.value.value.id,
            binding.value.binding.id,
            definitionId,
            input.organizationId,
            input.projectId,
            facts.sourceOccurrenceId,
            facts.configRevisionId,
            facts.fileId,
            facts.fileVersionId,
            facts.propertyOccurrenceId,
            JSON.stringify(locator),
            `sha256:${createHash("sha256").update(JSON.stringify(locator)).digest("hex")}`,
          ],
        );
        tip = appended.value.currentTip;
      }
      await client.query("set constraints all immediate");
      await client.query("commit");
      return { bindingId: binding.value.binding.id, valueId: tip };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };

  const seedSourceFacts: MigrationHarness["seedSourceFacts"] = async (input) => {
    await ensureSourceFacts(input);
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
    objectStore,
  });

  return {
    database,
    db,
    pool,
    client,
    migration,
    objectStore,
    pin: () => currentPin,
    snapshot: () => currentSnapshot,
    seedOrganization,
    seedProject,
    registerSubject,
    seedBindingValue,
    seedSourceFacts,
    publishChange,
    allocatedDefinition,
    currentTip,
    setCurrentRelease,
    close: async () => {
      client.release();
      await db.close();
      await database.drop();
      if (ownedStorageDirectory) {
        await rm(ownedStorageDirectory, { recursive: true, force: true });
      }
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
