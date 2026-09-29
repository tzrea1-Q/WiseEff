import { createHash } from "node:crypto";

import pg from "pg";

import { getAuthContextForExternalIdentity } from "../auth/repository";
import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import {
  fail,
  loadCheckpoints,
  ok,
  normalizedCheckpointDigestFor,
} from "./checkpoints";
import {
  MIGRATION_CONTRACT_VERSION,
  PRE_ACTIVATION_PHASES,
  type CutoverResult,
} from "./interface";
import {
  parseMappingManifestV2,
  type MappingManifestSelection,
} from "./mappingManifest";

export type CompletedMappingManifestInput = {
  readonly pool: pg.Pool;
  readonly runId: string;
  /** Supplied by an authenticated execution entry, then rechecked against persisted roles. */
  readonly auth: AuthContext;
};

export type CompletedMappingManifest = {
  readonly selectionRunId: string;
  readonly planDigest: string;
  readonly sourceSnapshotFingerprint: string;
  readonly targetArtifactSha: string;
  readonly catalogRelease: { readonly id: string; readonly digest: string };
  readonly p7CheckpointDigest: string;
  readonly fullRunDigest: string;
  /** Hidden for partial projections; only a complete scope receives the full count. */
  readonly fullRunSelectionCount: number | null;
  readonly projection: {
    readonly coverage: "complete-run" | "organization-projection";
    readonly organizationId: string;
    readonly principalId: string;
    readonly digest: string;
    readonly selectionCount: number;
    readonly selections: readonly MappingManifestSelection[];
  };
};

type RunRow = {
  id: string;
  source_snapshot_fingerprint: string;
  target_artifact_sha: string;
  target_catalog_release_digest: string;
  migration_contract_version: string;
  plan_digest: string;
  current_phase: string;
  state: string;
};

type VersionRow = {
  id: string;
  legacy_identity_id: string;
  cutover_run_id: string;
  version_number: string;
  source_checksum: string;
  graph_fingerprint: string;
  r_class: string;
  target_kind: string | null;
  target_id: string | null;
  archive_id: string | null;
  evidence_archive_id: string | null;
  supersedes_version_id: string | null;
  source_kind: string;
  source_id: string;
  owner_scope_kind: string;
  owner_scope_id: string;
};

const invalid = (detail: string): CutoverResult<never> =>
  fail("PCAT-ORC-MANIFEST-INVALID", detail);

const versionMatches = (selection: MappingManifestSelection, row: VersionRow): boolean => {
  const version = selection.mappingVersion;
  return (
    row.id === version.id &&
    row.legacy_identity_id === selection.legacyIdentityId &&
    row.legacy_identity_id === version.legacyIdentityId &&
    row.cutover_run_id === version.cutoverRunId &&
    row.version_number === String(version.versionNumber) &&
    row.source_checksum === version.sourceChecksum &&
    row.graph_fingerprint === version.graphFingerprint &&
    row.r_class === selection.rClass &&
    row.r_class === version.rClass &&
    row.target_kind === version.targetKind &&
    row.target_id === version.targetId &&
    row.archive_id === version.archiveId &&
    row.evidence_archive_id === version.evidenceArchiveId &&
    row.supersedes_version_id === version.supersedesVersionId &&
    row.source_kind === selection.sourceKind &&
    row.source_id === selection.sourceId &&
    row.owner_scope_kind === selection.ownerScopeKind &&
    row.owner_scope_id === selection.ownerScopeId
  );
};

const projectionDigestFor = (
  fullRunDigest: string,
  organizationId: string,
  selections: readonly MappingManifestSelection[],
): string =>
  `sha256:${createHash("sha256")
    .update(JSON.stringify([
      "s7-orc-organization-projection-v1",
      fullRunDigest,
      organizationId,
      selections.map((selection) => [
        selection.legacyIdentityId,
        selection.mappingVersion.id,
        selection.headCasVersion,
      ]),
    ]))
    .digest("hex")}`;

const readInSnapshot = async (
  client: pg.PoolClient,
  input: CompletedMappingManifestInput,
): Promise<CutoverResult<CompletedMappingManifest>> => {
  const organizationId = input.auth.organization.id;
  const principalId = input.auth.user.id;
  if (
    !organizationId || !principalId ||
    input.auth.user.organizationId !== organizationId ||
    !input.auth.user.isActive
  ) {
    return fail("PCAT-ORC-PERMISSION-DENIED", "Authenticated organization scope is invalid");
  }
  let persistedAuth: AuthContext;
  try {
    persistedAuth = await getAuthContextForExternalIdentity(client, {
      organizationId,
      subject: principalId,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return fail("PCAT-ORC-PERMISSION-DENIED", "Authenticated organization scope is unavailable");
    }
    throw error;
  }
  if (
    persistedAuth.user.id !== principalId ||
    persistedAuth.organization.id !== organizationId ||
    !persistedAuth.roles.some((role) =>
      role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin"))
  ) {
    return fail("PCAT-ORC-PERMISSION-DENIED", "Organization-wide mapping read is not authorized");
  }

  const storedRun = await client.query<RunRow>(
    `select id, source_snapshot_fingerprint, target_artifact_sha,
            target_catalog_release_digest, migration_contract_version,
            plan_digest, current_phase, state
       from parameter_catalog.parameter_catalog_cutover_runs where id = $1`,
    [input.runId],
  );
  const run = storedRun.rows[0];
  if (!run) return fail("PCAT-ORC-NOT-FOUND", "Completed cutover run was not found");
  if (run.state !== "completed" || run.current_phase !== "P10") {
    return fail("PCAT-ORC-MANIFEST-UNAVAILABLE", "Cutover run is not completed");
  }
  if (run.migration_contract_version !== MIGRATION_CONTRACT_VERSION) {
    return fail("PCAT-ORC-MANIFEST-UNAVAILABLE", "mapping-manifest-not-captured");
  }
  const checkpoints = await loadCheckpoints(client, run.id);
  if (
    checkpoints.length !== PRE_ACTIVATION_PHASES.length ||
    !PRE_ACTIVATION_PHASES.every((phase, index) => checkpoints[index]?.phase === phase)
  ) {
    return invalid("Completed run has an incomplete checkpoint set");
  }
  if (checkpoints.some((checkpoint) =>
    normalizedCheckpointDigestFor(checkpoint.phase, checkpoint.payload) !== checkpoint.checkpointDigest
  )) {
    return invalid("Completed run has a checkpoint digest mismatch");
  }
  const byPhase = new Map(checkpoints.map((checkpoint) => [checkpoint.phase, checkpoint]));
  const p0 = byPhase.get("P0")!;
  const p1 = byPhase.get("P1")!;
  const p5 = byPhase.get("P5")!;
  const p6 = byPhase.get("P6")!;
  const p7 = byPhase.get("P7")!;
  const p7CheckpointEvents = await client.query<{ checkpoint_digest: string | null }>(
    `select payload->>'checkpointDigest' as checkpoint_digest
       from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id = $1 and phase = 'P7' and event_kind = 'checkpoint'`,
    [run.id],
  );
  if (
    p7CheckpointEvents.rows.length === 0 ||
    p7CheckpointEvents.rows.some((event) => event.checkpoint_digest !== p7.checkpointDigest)
  ) {
    return invalid("P7 checkpoint digest differs from immutable checkpoint events");
  }
  const manifest = parseMappingManifestV2(p7.payload.mappingManifest);
  if (!manifest) return invalid("P7 mapping manifest is missing or malformed");
  if (
    manifest.selectionRunId !== run.id ||
    manifest.planDigest !== run.plan_digest ||
    manifest.sourceSnapshotFingerprint !== run.source_snapshot_fingerprint ||
    manifest.targetArtifactSha !== run.target_artifact_sha ||
    manifest.catalogReleaseDigest !== run.target_catalog_release_digest ||
    p0.payload.sourceSnapshotFingerprint !== run.source_snapshot_fingerprint ||
    p0.payload.identityCount !== manifest.selectionCount ||
    p1.payload.targetCatalogReleaseDigest !== manifest.catalogReleaseDigest ||
    p1.payload.releaseId !== manifest.catalogReleaseId ||
    p5.payload.currentDigest !== manifest.catalogReleaseDigest ||
    p5.payload.currentId !== manifest.catalogReleaseId ||
    p6.payload.graphFingerprint !== run.source_snapshot_fingerprint ||
    p6.payload.classifiedCount !== manifest.selectionCount ||
    p7.payload.mappedCount !== manifest.selectionCount ||
    !Array.isArray(p7.payload.dispatched) ||
    JSON.stringify(p7.payload.dispatched) !== JSON.stringify(
      manifest.selections.map((selection) => `${selection.legacyIdentityId}:${selection.disposition}`),
    )
  ) {
    return invalid("P7 manifest does not match committed run and checkpoint pins");
  }
  const release = await client.query<{ id: string; release_digest: string }>(
    "select id, release_digest from parameter_catalog.catalog_releases where id = $1",
    [manifest.catalogReleaseId],
  );
  if (release.rows.length !== 1 || release.rows[0]?.release_digest !== manifest.catalogReleaseDigest) {
    return invalid("P7 Catalog Release pin does not resolve");
  }

  const versionIds = manifest.selections.map((selection) => selection.mappingVersion.id);
  if (new Set(versionIds).size !== versionIds.length) {
    return invalid("P7 manifest repeats a mapping version");
  }
  const versions = new Map<string, VersionRow>();
  for (let offset = 0; offset < versionIds.length; offset += 200) {
    const rows = await client.query<VersionRow>(
      `select v.id, v.legacy_identity_id, v.cutover_run_id,
              v.version_number::text as version_number, v.source_checksum,
              v.graph_fingerprint, v.r_class, v.target_kind, v.target_id,
              v.archive_id, v.evidence_archive_id, v.supersedes_version_id,
              i.source_kind, i.source_id, i.owner_scope_kind, i.owner_scope_id
         from parameter_catalog.legacy_mapping_versions v
         join parameter_catalog.legacy_identities i on i.id = v.legacy_identity_id
        where v.id = any($1::text[])`,
      [versionIds.slice(offset, offset + 200)],
    );
    for (const row of rows.rows) {
      if (versions.has(row.id)) return invalid("P7 mapping version query repeated a row");
      versions.set(row.id, row);
    }
  }
  if (versions.size !== manifest.selectionCount) {
    return invalid("P7 mapping version set is incomplete");
  }
  for (const selection of manifest.selections) {
    const row = versions.get(selection.mappingVersion.id);
    if (
      !row || !versionMatches(selection, row) ||
      (selection.status === "appended" && row.cutover_run_id !== run.id)
    ) {
      return invalid(`P7 mapping version or source identity differs for ${selection.legacyIdentityId}`);
    }
  }

  const projectIds = [...new Set(manifest.selections
    .filter((selection) => selection.ownerScopeKind === "project")
    .map((selection) => selection.ownerScopeId))];
  const projects = new Map<string, string>();
  for (let offset = 0; offset < projectIds.length; offset += 200) {
    const rows = await client.query<{ id: string; organization_id: string }>(
      "select id, organization_id from public.projects where id = any($1::text[])",
      [projectIds.slice(offset, offset + 200)],
    );
    for (const row of rows.rows) projects.set(row.id, row.organization_id);
  }
  if (projects.size !== projectIds.length) return invalid("P7 project owner is missing");
  const ownerOrganizationIds = [...new Set(manifest.selections
    .filter((selection) => selection.ownerScopeKind === "organization")
    .map((selection) => selection.ownerScopeId))];
  if (ownerOrganizationIds.length > 0) {
    const organizations = await client.query<{ id: string }>(
      "select id from public.organizations where id = any($1::text[])",
      [ownerOrganizationIds],
    );
    if (organizations.rows.length !== ownerOrganizationIds.length) {
      return invalid("P7 organization owner is missing");
    }
  }
  const selections = manifest.selections.filter((selection) =>
    (selection.ownerScopeKind === "organization" && selection.ownerScopeId === organizationId) ||
    (selection.ownerScopeKind === "project" && projects.get(selection.ownerScopeId) === organizationId),
  );
  if (selections.length === 0) {
    return fail("PCAT-ORC-NOT-FOUND", "Completed cutover run is outside the authorized organization");
  }
  return ok({
    selectionRunId: run.id,
    planDigest: run.plan_digest,
    sourceSnapshotFingerprint: run.source_snapshot_fingerprint,
    targetArtifactSha: run.target_artifact_sha,
    catalogRelease: { id: manifest.catalogReleaseId, digest: manifest.catalogReleaseDigest },
    p7CheckpointDigest: p7.checkpointDigest,
    fullRunDigest: manifest.digest,
    fullRunSelectionCount: selections.length === manifest.selectionCount ? manifest.selectionCount : null,
    projection: {
      coverage: selections.length === manifest.selectionCount ? "complete-run" : "organization-projection",
      organizationId,
      principalId,
      digest: projectionDigestFor(manifest.digest, organizationId, selections),
      selectionCount: selections.length,
      selections,
    },
  });
};

/** No route or credential is created here; the caller must supply authenticated identity. */
export const readCompletedCutoverMappingManifest = async (
  input: CompletedMappingManifestInput,
): Promise<CutoverResult<CompletedMappingManifest>> => {
  let client: pg.PoolClient | null = null;
  try {
    client = await input.pool.connect();
    await client.query("begin transaction isolation level repeatable read read only");
    const result = await readInSnapshot(client, input);
    await client.query("commit");
    return result;
  } catch (error) {
    await client?.query("rollback").catch(() => undefined);
    return fail("PCAT-ORC-MANIFEST-UNAVAILABLE", error instanceof Error ? error.message : "Manifest read failed");
  } finally {
    client?.release();
  }
};
