import { randomUUID } from "node:crypto";
import pg from "pg";

import { verifyAuthorizationForActivation } from "../../catalog-publication/authorization/authorize";
import {
  getArtifactByDigest,
  getCandidate,
  getJob,
  getReceiptByJobId,
  insertReceipt,
} from "../../catalog-publication/persistence/store";
import type { CatalogActivationReceiptRecord } from "../../catalog-publication/persistence/types";
import {
  CatalogActivationReceiptId,
  CatalogMaterializationFingerprint,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  type CatalogReleaseIdentity,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract/index";
import type { Queryable } from "../../../shared/database/client";
import { compileCatalogRelease } from "../compiler/index";
import type { CatalogReleaseBundle, CompiledCatalogRelease } from "../compiler/types";
import type {
  AdoptedPreexistingEvidence,
  InstallPublishedReleaseCommand,
} from "../interface";
import { CATALOG_SYNCHRONIZER_ROLE, quoteIdent } from "../security/catalogRoleManifest";
import { verifyStagedReleaseProjection } from "../verification/index";
import {
  advanceCurrentPointer,
  readCurrentCatalogPointer,
  restoreCurrentDefinitionHeads,
} from "./currentPointer";
import { acquirePublicationGuardLock } from "./lockProtocol";
import {
  CatalogMaterializationInjectedFailure,
  materializeCompiledRelease,
  type MaterializeReleaseOptions,
} from "./materializeRelease";
import {
  CatalogInstallFailure,
  PublicationActivationFailure,
  type ActivationReceiptSummary,
  type AlreadyRecordedResult,
  type CatalogInstallOutcome,
} from "./publicationTypes";

export type PublicationActivationOptions = MaterializeReleaseOptions;

export type PublicationActivationTestHooks = {
  readonly afterMaterialize?: (client: pg.PoolClient) => Promise<void>;
  readonly afterGuard?: (client: pg.PoolClient) => Promise<void>;
};

export type PublicationActivationTestOptions = PublicationActivationOptions &
  PublicationActivationTestHooks;

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export const asQueryable = (client: Pick<pg.Client, "query">): Queryable => ({
  query: async (text, values = []) => {
    const result = await client.query(text, values);
    return { rows: result.rows, rowCount: result.rowCount };
  },
});

export const setSynchronizerRole = async (client: Pick<pg.Client, "query">): Promise<void> => {
  await client.query(`set local role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`);
};

export const publicationRegimeActive = async (
  client: Pick<pg.Client, "query">,
): Promise<boolean> => {
  const result = await client.query<{ active: boolean }>(
    `select exists (
       select 1 from parameter_catalog.catalog_activation_receipts
     ) as active`,
  );
  return result.rows[0]?.active === true;
};

const identityFromCompiled = (
  compiled: CompiledCatalogRelease,
): CatalogReleaseIdentity => ({
  id: compiled.release.id,
  version: compiled.release.version,
  digest: compiled.release.digest,
});

const parseArtifactBundle = (
  bytes: Uint8Array,
): CatalogReleaseBundle => {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("schemaVersion" in parsed) ||
    !("targetReleaseId" in parsed) ||
    !("releases" in parsed)
  ) {
    throw new PublicationActivationFailure({
      kind: "artifact-missing",
      detail: "stored artifact bytes are not a catalog release bundle",
    });
  }
  return parsed as CatalogReleaseBundle;
};

const receiptSummary = (
  receipt: CatalogActivationReceiptRecord,
): ActivationReceiptSummary => ({
  id: receipt.id,
  kind: receipt.kind,
  releaseId: receipt.releaseId,
  releaseDigest: receipt.releaseDigest,
  predecessorReleaseId: receipt.predecessorReleaseId,
  predecessorReleaseDigest: receipt.predecessorReleaseDigest,
  publicationJobId: receipt.publicationJobId,
  authorizationId: receipt.authorizationId,
  candidateId: receipt.candidateId,
});

const loadReleaseIdentity = async (
  client: Pick<pg.Client, "query">,
  releaseId: string,
): Promise<CatalogReleaseIdentity | null> => {
  const result = await client.query<{
    id: string;
    release_version: string;
    release_digest: string;
  }>(
    `select id, release_version, release_digest
       from parameter_catalog.catalog_releases
      where id = $1`,
    [releaseId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: CatalogReleaseId(row.id),
    version: CatalogReleaseVersion(row.release_version),
    digest: CatalogReleaseDigest(row.release_digest),
  };
};

const loadMaterializationFingerprint = async (
  client: Pick<pg.Client, "query">,
  releaseId: string,
): Promise<CatalogMaterializationFingerprint | null> => {
  const result = await client.query<{ compiled_fingerprint: string }>(
    `select compiled_fingerprint
       from parameter_catalog.catalog_materializations
      where release_id = $1`,
    [releaseId],
  );
  const fingerprint = result.rows[0]?.compiled_fingerprint;
  return fingerprint ? CatalogMaterializationFingerprint(fingerprint) : null;
};

const loadReleaseCounts = async (
  client: Pick<pg.Client, "query">,
  releaseId: string,
) => {
  const result = await client.query<{
    subjects: string;
    aliases: string;
    definitions: string;
    definition_revisions: string;
  }>(
    `select
       (select count(*)::text
          from parameter_catalog.catalog_release_subjects
         where release_id = $1) as subjects,
       (select count(*)::text
          from parameter_catalog.catalog_release_subject_aliases
         where release_id = $1) as aliases,
       (select count(*)::text
          from parameter_catalog.catalog_release_definition_heads
         where release_id = $1) as definitions,
       (select count(*)::text
          from parameter_catalog.definition_revisions
         where catalog_release_id = $1) as definition_revisions`,
    [releaseId],
  );
  const row = result.rows[0];
  const subjects = Number(row?.subjects ?? 0);
  const aliases = Number(row?.aliases ?? 0);
  const definitions = Number(row?.definitions ?? 0);
  return {
    subjects,
    subjectMemberships: subjects,
    aliases,
    aliasMemberships: aliases,
    definitions,
    definitionRevisions: Number(row?.definition_revisions ?? 0),
  };
};

const currentnessForReceipt = (
  pointer: Awaited<ReturnType<typeof readCurrentCatalogPointer>>,
  receipt: CatalogActivationReceiptRecord,
): "active" | "active-superseded" => {
  if (
    pointer.kind === "installed" &&
    pointer.current.id === receipt.releaseId &&
    pointer.current.digest === receipt.releaseDigest
  ) {
    return "active";
  }
  return "active-superseded";
};

const alreadyRecorded = async (
  client: Pick<pg.Client, "query">,
  receipt: CatalogActivationReceiptRecord,
  commandKind: "online-publication" | "adopted-preexisting",
): Promise<AlreadyRecordedResult> => {
  const pointer = await readCurrentCatalogPointer(client);
  const current =
    pointer.kind === "installed"
      ? pointer.current
      : (await loadReleaseIdentity(client, receipt.releaseId)) ?? {
          id: receipt.releaseId,
          version: CatalogReleaseVersion("0.0.0"),
          digest: receipt.releaseDigest,
        };
  return {
    status: "already-recorded",
    commandKind,
    currentness: currentnessForReceipt(pointer, receipt),
    current,
    target: { id: receipt.releaseId, digest: receipt.releaseDigest },
    base:
      receipt.predecessorReleaseId && receipt.predecessorReleaseDigest
        ? {
            id: receipt.predecessorReleaseId,
            digest: receipt.predecessorReleaseDigest,
          }
        : null,
    receipt: receiptSummary(receipt),
    materializationFingerprint: await loadMaterializationFingerprint(
      client,
      receipt.releaseId,
    ),
    counts: await loadReleaseCounts(client, receipt.releaseId),
  };
};

const maybeFailStage = (
  options: PublicationActivationTestOptions | undefined,
  stage: "staged-verify" | "receipt" | "job-status" | "pointer",
): void => {
  if (options?.failAfter === stage) {
    throw new CatalogMaterializationInjectedFailure(stage);
  }
};

const markJobActivated = async (
  client: Pick<pg.Client, "query">,
  jobId: string,
  expectedFence: number,
): Promise<void> => {
  await client.query(
    `select catalog_publication.mark_job_activated($1, $2)`,
    [jobId, expectedFence],
  );
};

const appendActivationSuccessAudit = async (
  client: Pick<pg.Client, "query">,
  input: {
    readonly actorPrincipalId: string;
    readonly action: "online-publication" | "adopted-preexisting";
    readonly receiptId: string;
    readonly releaseId: string;
    readonly releaseDigest: string;
    readonly verificationDigest: string;
    readonly publicationJobId?: string | null;
    readonly candidateId?: string | null;
  },
): Promise<void> => {
  await client.query(
    `select catalog_publication.append_activation_success_audit($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      `audit_${randomUUID()}`,
      input.actorPrincipalId,
      input.action,
      input.receiptId,
      JSON.stringify({
        receiptId: input.receiptId,
        releaseId: input.releaseId,
        releaseDigest: input.releaseDigest,
        verificationDigest: input.verificationDigest,
        publicationJobId: input.publicationJobId ?? null,
        candidateId: input.candidateId ?? null,
      }),
      input.verificationDigest,
    ],
  );
};

const loadAdoptedReceipt = async (
  client: Pick<pg.Client, "query">,
  releaseId: string,
): Promise<CatalogActivationReceiptRecord | null> => {
  const loaded = await asQueryable(client).query<{
    id: string;
    kind: "adopted-preexisting";
    release_id: string;
    release_digest: string;
    predecessor_release_id: string | null;
    predecessor_release_digest: string | null;
    verification_digest: string;
    publication_job_id: string | null;
    authorization_id: string | null;
    candidate_id: string | null;
    actor_principal_id: string;
    adoption_evidence: unknown;
    created_at: Date | string;
  }>(
    `select
       id, kind, release_id, release_digest, predecessor_release_id,
       predecessor_release_digest, verification_digest, publication_job_id,
       authorization_id, candidate_id, actor_principal_id, adoption_evidence,
       created_at
     from parameter_catalog.catalog_activation_receipts
     where kind = 'adopted-preexisting' and release_id = $1`,
    [releaseId],
  );
  const row = loaded.rows[0];
  if (!row) return null;
  return {
    id: CatalogActivationReceiptId(row.id),
    kind: row.kind,
    releaseId: CatalogReleaseId(row.release_id),
    releaseDigest: CatalogReleaseDigest(row.release_digest),
    predecessorReleaseId: row.predecessor_release_id
      ? CatalogReleaseId(row.predecessor_release_id)
      : null,
    predecessorReleaseDigest: row.predecessor_release_digest
      ? CatalogReleaseDigest(row.predecessor_release_digest)
      : null,
    verificationDigest: row.verification_digest,
    publicationJobId: null,
    authorizationId: null,
    candidateId: null,
    actorPrincipalId: row.actor_principal_id,
    adoptionEvidence:
      row.adoption_evidence && typeof row.adoption_evidence === "object"
        ? (row.adoption_evidence as CatalogActivationReceiptRecord["adoptionEvidence"])
        : null,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
};

const evidenceMatches = (
  stored: CatalogActivationReceiptRecord["adoptionEvidence"],
  expected: AdoptedPreexistingEvidence,
): boolean => {
  if (!stored) return false;
  return (
    stored.source_bundle_digest === expected.source_bundle_digest &&
    stored.verification_digest === expected.verification_digest &&
    stored.data_mode === expected.data_mode &&
    stored.collected_at === expected.collected_at &&
    stored.approved_by === expected.approved_by
  );
};

export const activateOnlinePublication = async (
  client: pg.PoolClient,
  command: Extract<InstallPublishedReleaseCommand, { mode: "online-publication" }>,
  options?: PublicationActivationTestOptions,
): Promise<CatalogInstallOutcome> => {
  await acquirePublicationGuardLock(client);
  if (options?.afterGuard) {
    await options.afterGuard(client);
  }
  const db = asQueryable(client);

  const job = await getJob(db, command.jobId);
  if (!job.ok) {
    throw new PublicationActivationFailure({
      kind: "publication-not-authorized",
      reason: "publication-not-authorized",
      detail: "publication job not found",
    });
  }
  if (
    job.value.candidateId !== command.candidateId ||
    job.value.authorizationId !== command.authorizationId
  ) {
    throw new PublicationActivationFailure({
      kind: "activation-receipt-mismatch",
      jobId: command.jobId,
      detail: "command job/candidate/authorization tuple does not match the stored job",
    });
  }
  if (job.value.fencingToken !== command.fencingToken) {
    throw new PublicationActivationFailure({
      kind: "fencing-token-mismatch",
      expected: command.fencingToken,
      actual: job.value.fencingToken,
    });
  }

  const existingReceipt = await getReceiptByJobId(db, command.jobId);
  if (existingReceipt.ok) {
    const receipt = existingReceipt.value;
    if (
      receipt.candidateId !== command.candidateId ||
      receipt.authorizationId !== command.authorizationId ||
      receipt.publicationJobId !== command.jobId
    ) {
      throw new PublicationActivationFailure({
        kind: "activation-receipt-mismatch",
        jobId: command.jobId,
        detail: "existing receipt does not match the job/candidate/authorization tuple",
      });
    }
    return alreadyRecorded(client, receipt, "online-publication");
  }

  const authorized = await verifyAuthorizationForActivation(db, {
    candidateId: command.candidateId,
    authorizationId: command.authorizationId,
    trustedActor: command.trustedActor,
    impactFacts: command.impactFacts,
    lockMode: "publication-guard",
  });
  if (!authorized.ok) {
    throw new PublicationActivationFailure({
      kind: "publication-not-authorized",
      reason: authorized.error.reason,
      detail: authorized.error.detail,
    });
  }

  const candidate = await getCandidate(db, command.candidateId);
  if (!candidate.ok) {
    throw new PublicationActivationFailure({
      kind: "publication-not-authorized",
      reason: "candidate-stale",
      detail: "candidate not found",
    });
  }
  const artifact = await getArtifactByDigest(db, candidate.value.artifactDigest);
  if (!artifact.ok) {
    throw new PublicationActivationFailure({
      kind: "artifact-missing",
      detail: "candidate artifact bytes are missing",
    });
  }
  if (artifact.value.artifactDigest !== candidate.value.artifactDigest) {
    throw new PublicationActivationFailure({
      kind: "publication-not-authorized",
      reason: "candidate-tampered",
      detail: "artifact digest does not match the candidate",
    });
  }

  let bundle: CatalogReleaseBundle;
  try {
    bundle = parseArtifactBundle(artifact.value.artifactBytes);
  } catch (error) {
    if (error instanceof PublicationActivationFailure) throw error;
    throw new PublicationActivationFailure({
      kind: "artifact-missing",
      detail: "stored artifact bytes are unreadable",
    });
  }
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new CatalogInstallFailure(compiled.error);
  }
  if (compiled.value.aggregateDigest !== candidate.value.artifactDigest) {
    throw new PublicationActivationFailure({
      kind: "publication-not-authorized",
      reason: "candidate-tampered",
      detail: "compiled artifact digest does not match the candidate",
    });
  }
  if (
    compiled.value.release.id !== artifact.value.targetReleaseId ||
    compiled.value.release.digest !== artifact.value.targetReleaseDigest
  ) {
    throw new PublicationActivationFailure({
      kind: "publication-not-authorized",
      reason: "candidate-tampered",
      detail: "compiled release pin does not match the artifact target pin",
    });
  }

  const pointer = await readCurrentCatalogPointer(client);
  const expectedCurrent = command.expectedCurrent;
  if (
    pointer.kind !== "installed" ||
    pointer.current.id !== expectedCurrent.id ||
    pointer.current.digest !== expectedCurrent.digest
  ) {
    throw new PublicationActivationFailure({
      kind: "needs-rebase",
      installed: pointer.kind === "installed" ? pointer.current : null,
      target: identityFromCompiled(compiled.value),
      expectedCurrent,
    });
  }
  if (
    compiled.value.predecessor === null ||
    compiled.value.predecessor.id !== expectedCurrent.id ||
    compiled.value.predecessor.digest !== expectedCurrent.digest ||
    candidate.value.expectedBaseReleaseId !== expectedCurrent.id ||
    candidate.value.expectedBaseReleaseDigest !== expectedCurrent.digest
  ) {
    throw new PublicationActivationFailure({
      kind: "needs-rebase",
      installed: pointer.current,
      target: identityFromCompiled(compiled.value),
      expectedCurrent,
    });
  }

  await materializeCompiledRelease(client, compiled.value, options);
  if (options?.afterMaterialize) {
    await options.afterMaterialize(client);
  }

  const staged = await verifyStagedReleaseProjection(client, compiled.value);
  if (!staged.ok) {
    throw new CatalogInstallFailure(staged.error);
  }
  maybeFailStage(options, "staged-verify");

  const inserted = await insertReceipt(db, {
    id: CatalogActivationReceiptId(`crct_${randomUUID()}`),
    kind: "online-publication",
    releaseId: compiled.value.release.id,
    releaseDigest: compiled.value.release.digest,
    predecessorReleaseId: candidate.value.expectedBaseReleaseId,
    predecessorReleaseDigest: candidate.value.expectedBaseReleaseDigest,
    verificationDigest: compiled.value.materializationFingerprint,
    publicationJobId: command.jobId,
    authorizationId: command.authorizationId,
    candidateId: command.candidateId,
    actorPrincipalId: authorized.value.authorization.actorPrincipalId,
    adoptionEvidence: null,
  });
  if (!inserted.ok) {
    throw new PublicationActivationFailure({
      kind: "activation-receipt-mismatch",
      jobId: command.jobId,
      detail: `receipt insert failed: ${inserted.error.kind}`,
    });
  }
  await appendActivationSuccessAudit(client, {
    actorPrincipalId: authorized.value.authorization.actorPrincipalId,
    action: "online-publication",
    receiptId: inserted.value.id,
    releaseId: compiled.value.release.id,
    releaseDigest: compiled.value.release.digest,
    verificationDigest: compiled.value.materializationFingerprint,
    publicationJobId: command.jobId,
    candidateId: command.candidateId,
  });
  maybeFailStage(options, "receipt");

  await restoreCurrentDefinitionHeads(client, compiled.value.release.id);
  maybeFailStage(options, "pointer");
  await advanceCurrentPointer(client, compiled.value.release.id);
  await client.query("set constraints all immediate");
  await markJobActivated(client, command.jobId, command.fencingToken);
  maybeFailStage(options, "job-status");

  return {
    status: "installed",
    commandKind: "online-publication",
    previous: expectedCurrent,
    current: identityFromCompiled(compiled.value),
    receipt: receiptSummary(inserted.value),
    currentness: "active",
    materializationFingerprint: compiled.value.materializationFingerprint,
    counts: compiled.value.counts,
  };
};

const validateAdoptionEvidence = (
  evidence: AdoptedPreexistingEvidence,
  current: CatalogReleasePin,
): void => {
  if (
    !SHA256_DIGEST.test(evidence.source_bundle_digest) ||
    !SHA256_DIGEST.test(evidence.verification_digest) ||
    evidence.source_bundle_digest !== current.digest
  ) {
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: "adoption evidence pin does not match the current catalog digest",
    });
  }
  if (
    evidence.approved_by.trim().length === 0 ||
    evidence.collected_at.trim().length === 0
  ) {
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: "adoption evidence is missing required fields",
    });
  }
};

export const adoptPreexistingCurrent = async (
  client: pg.PoolClient,
  command: Extract<InstallPublishedReleaseCommand, { mode: "adopted-preexisting" }>,
  options?: PublicationActivationTestOptions,
): Promise<CatalogInstallOutcome> => {
  await acquirePublicationGuardLock(client);
  if (options?.afterGuard) {
    await options.afterGuard(client);
  }
  const pointer = await readCurrentCatalogPointer(client);
  if (
    pointer.kind !== "installed" ||
    pointer.current.id !== command.expectedCurrent.id ||
    pointer.current.digest !== command.expectedCurrent.digest
  ) {
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: "adoption target is not the current catalog pin",
    });
  }
  validateAdoptionEvidence(command.adoptionEvidence, pointer.current);

  const identity = await loadReleaseIdentity(client, pointer.current.id);
  const fingerprint = await loadMaterializationFingerprint(client, pointer.current.id);
  if (!identity || !fingerprint) {
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: "adoption target is missing stored catalog history",
    });
  }
  if (command.adoptionEvidence.verification_digest !== fingerprint) {
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: "adoption verification_digest does not match the stored materialization fingerprint",
    });
  }

  const artifact = await getArtifactByDigest(asQueryable(client), pointer.current.digest);
  if (!artifact.ok) {
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: "adoption target artifact bytes are missing",
    });
  }
  let bundle: CatalogReleaseBundle;
  try {
    bundle = parseArtifactBundle(artifact.value.artifactBytes);
  } catch (error) {
    if (error instanceof PublicationActivationFailure) throw error;
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: "adoption target artifact bytes are unreadable",
    });
  }
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new CatalogInstallFailure(compiled.error);
  }
  if (
    compiled.value.release.id !== pointer.current.id ||
    compiled.value.release.digest !== pointer.current.digest ||
    compiled.value.materializationFingerprint !== fingerprint
  ) {
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: "compiled adoption artifact does not match the current materialization",
    });
  }
  const verified = await verifyStagedReleaseProjection(client, compiled.value, {
    checkCurrentPointer: true,
  });
  if (!verified.ok) {
    throw new CatalogInstallFailure(verified.error);
  }

  const existing = await loadAdoptedReceipt(client, pointer.current.id);
  if (existing) {
    if (!evidenceMatches(existing.adoptionEvidence, command.adoptionEvidence)) {
      throw new PublicationActivationFailure({
        kind: "adoption-evidence-invalid",
        detail: "an adopted-preexisting receipt already exists with different evidence",
      });
    }
    return alreadyRecorded(client, existing, "adopted-preexisting");
  }

  let predecessorReleaseId: ReturnType<typeof CatalogReleaseId> | null = null;
  let predecessorReleaseDigest: ReturnType<typeof CatalogReleaseDigest> | null = null;
  if (pointer.predecessorReleaseId) {
    const predecessor = await loadReleaseIdentity(client, pointer.predecessorReleaseId);
    if (!predecessor) {
      throw new PublicationActivationFailure({
        kind: "adoption-evidence-invalid",
        detail: "adoption predecessor history is missing",
      });
    }
    predecessorReleaseId = predecessor.id;
    predecessorReleaseDigest = predecessor.digest;
  }

  const inserted = await insertReceipt(asQueryable(client), {
    id: CatalogActivationReceiptId(`crct_${randomUUID()}`),
    kind: "adopted-preexisting",
    releaseId: pointer.current.id,
    releaseDigest: pointer.current.digest,
    predecessorReleaseId,
    predecessorReleaseDigest,
    verificationDigest: fingerprint,
    publicationJobId: null,
    authorizationId: null,
    candidateId: null,
    actorPrincipalId: command.actorPrincipalId,
    adoptionEvidence: command.adoptionEvidence,
  });
  if (!inserted.ok) {
    throw new PublicationActivationFailure({
      kind: "adoption-evidence-invalid",
      detail: `adoption receipt insert failed: ${inserted.error.kind}`,
    });
  }
  await appendActivationSuccessAudit(client, {
    actorPrincipalId: command.actorPrincipalId,
    action: "adopted-preexisting",
    receiptId: inserted.value.id,
    releaseId: pointer.current.id,
    releaseDigest: pointer.current.digest,
    verificationDigest: fingerprint,
  });
  maybeFailStage(options, "receipt");

  return {
    status: "installed",
    commandKind: "adopted-preexisting",
    previous: command.expectedCurrent,
    current: identity,
    receipt: receiptSummary(inserted.value),
    currentness: "active",
    materializationFingerprint: fingerprint,
    counts: await loadReleaseCounts(client, pointer.current.id),
  };
};
