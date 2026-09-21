import { createHash } from "node:crypto";
import {
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  PublicationJobId,
  serializeContract,
} from "../../server/modules/parameter-catalog-contract";
import { getAuthContext } from "../../server/modules/auth/repository";
import {
  createUserInvocation,
  type TrustedInvocationContext,
} from "../../server/modules/auth/trustedInvocation";
import type { AuthContext } from "../../server/modules/auth/types";
import { parseBundleBytes } from "../../server/modules/catalog-publication/builder/bundleCodec";
import {
  buildPowerConfigSuccessor,
  powerConfigImpactFacts,
} from "../../server/modules/catalog-publication/import/configurationSchemaSuccessor";
import { SEED_POWER_CONFIG_SCHEMA_ID } from "../../server/modules/parameter-bindings/seedInitialization/powerConfig";
import {
  importVendorCatalog,
  type ClaimedVendorIdentity,
  type VendorImportError,
  type VendorIdKind,
} from "../../server/modules/catalog-publication/import/vendorAdapter";
import {
  CATALOG_BASELINE_READER_ROLE,
  quoteIdent,
} from "../../server/modules/catalog-kernel/security/catalogRoleManifest";
import { withPublicationCoordinator } from "../../server/modules/catalog-publication/coordinator";
import { enqueuePublicationJob } from "../../server/modules/catalog-publication/enqueue";
import {
  getArtifactByDigest,
  getCandidate,
  getJob,
  getReceiptByJobId,
  persistCandidate,
} from "../../server/modules/catalog-publication/persistence/store";
import {
  persistSuccessorBuild,
} from "../../server/modules/catalog-publication/builder/completeSuccessor";
import type {
  BuildCompleteSuccessorValue,
  FrozenPublicationIdentity,
  FrozenToolchain,
  SuccessorBuildValue,
} from "../../server/modules/catalog-publication/builder/types";
import type {
  ArtifactSourceKind,
  JsonObject,
  PublicationCandidateRecord,
  PublicationJobRecord,
} from "../../server/modules/catalog-publication/persistence/types";
import type { Database } from "../../server/shared/database/client";

export type SeedCatalogStage = "vendor" | "configuration-schema";

const withCatalogBaselineReader = async <T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> =>
  db.transaction(async (tx) => {
    await tx.query(`set local role ${quoteIdent(CATALOG_BASELINE_READER_ROLE)}`);
    return fn(tx);
  });

/** The run manifest owns these values; this helper never allocates a retry ID. */
export type SeedCatalogFrozenIdentity = {
  readonly candidateId: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly releaseVersion: string;
  readonly publishedAt: string;
  readonly toolchain: FrozenToolchain;
  readonly definitions: readonly {
    readonly subjectId: string;
    readonly propertyKey: string;
    readonly definitionId: string;
    readonly revisionId: string;
  }[];
  readonly subjects?: readonly {
    readonly canonicalKey: string;
    readonly subjectId: string;
  }[];
};

export type SeedCatalogIdentity = SeedCatalogFrozenIdentity & {
  readonly runId: string;
  readonly stage: SeedCatalogStage;
};

export type SeedCatalogPin = {
  readonly id: string;
  readonly digest: string;
  readonly version?: string;
};

export type SeedCatalogPrepareInput = {
  readonly db: Database;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly identity: SeedCatalogIdentity;
  readonly pins: {
    readonly expectedCurrent: SeedCatalogPin;
    readonly predecessorArtifactDigest: string;
    readonly expectedArtifactDigest?: string;
    readonly expectedVendorContentHash?: string;
    readonly expectedListedInputHash?: string;
    readonly schemasRoot?: string;
  };
};

export type SeedCatalogPublishInput = {
  readonly db: Database;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly runId: string;
  readonly stage: SeedCatalogStage;
  readonly candidateId: string;
  readonly expectedArtifactDigest: string;
  readonly expectedCurrent: SeedCatalogPin;
  readonly idempotencyKey: string;
};

export type SeedCatalogStatusInput = {
  readonly db: Database;
  readonly candidateId: string;
  readonly expectedRunId?: string;
  readonly expectedStage?: SeedCatalogStage;
};

export type SeedCatalogFreezeInput = {
  readonly db: Database;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly runId: string;
  readonly stage: SeedCatalogStage;
  readonly candidateId: string;
  readonly artifactId: string;
  readonly releaseId: string;
  readonly releaseVersion: string;
  readonly publishedAt: string;
  readonly expectedCurrent: SeedCatalogPin;
  readonly predecessorArtifactDigest: string;
  readonly expectedVendorContentHash?: string;
  readonly expectedListedInputHash?: string;
  readonly schemasRoot?: string;
};

export type SeedCatalogFrozenPreparation = {
  readonly identity: SeedCatalogIdentity;
  readonly expectedArtifactDigest: string;
  readonly source: {
    readonly vendorContentHash?: string;
    readonly listedInputHash?: string;
  };
};

export type SeedCatalogPublicationPointers = {
  readonly runId: string;
  readonly stage: SeedCatalogStage;
  readonly candidateId: string;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly releaseId: string;
  readonly releaseVersion: string;
  readonly predecessorReleaseId: string;
  readonly predecessorReleaseDigest: string;
  readonly impactReportDigest: string;
  readonly impactSummary: {
    readonly sourceKind: ArtifactSourceKind;
    readonly operations: readonly string[];
    readonly introducesNewSubject: boolean;
    readonly changesSelector: boolean;
    readonly changesAlias: boolean;
    readonly changesFallback: boolean;
    readonly tightensExistingContract: boolean;
    readonly changesUnitOrSemantic: boolean;
    readonly retiresIdentity: boolean;
    readonly unknownImpact: boolean;
  } | null;
  readonly authorizationId: string | null;
  readonly jobId: string | null;
  readonly jobStatus: PublicationJobRecord["status"] | null;
  readonly receiptId: string | null;
  readonly receiptReleaseId: string | null;
  readonly receiptReleaseDigest: string | null;
};

export type SeedCatalogPublicationError = {
  readonly kind:
    | "invalid-input"
    | "unauthorized"
    | "stale"
    | "conflict"
    | "not-found"
    | "publication-denied"
    | "storage";
  readonly message: string;
};

export type SeedCatalogPublicationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SeedCatalogPublicationError };

const ok = <T>(value: T): SeedCatalogPublicationResult<T> => ({ ok: true, value });
const fail = <T>(
  kind: SeedCatalogPublicationError["kind"],
  message: string,
): SeedCatalogPublicationResult<T> => ({ ok: false, error: { kind, message } });

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HEX_DIGEST = /^[0-9a-f]{64}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const safeMessageForStoreError = (error: { readonly kind: string }): SeedCatalogPublicationError => {
  if (error.kind === "not-found") return { kind: "not-found", message: "catalog publication record not found" };
  if (error.kind === "conflict") return { kind: "conflict", message: "catalog publication identity conflict" };
  if (error.kind === "invalid-input") return { kind: "invalid-input", message: "catalog publication input is invalid" };
  if (error.kind === "permission-denied") return { kind: "unauthorized", message: "catalog publication storage access denied" };
  return { kind: "storage", message: "catalog publication storage failed" };
};

const sameContract = (left: unknown, right: unknown): boolean => {
  try {
    return serializeContract(left as never) === serializeContract(right as never);
  } catch {
    return false;
  }
};

const validNonEmpty = (value: string): boolean => value.trim().length > 0;

const validateDigest = (value: string, label: string): string | null =>
  DIGEST.test(value) ? null : `${label} must be sha256:<64 lowercase hex>`;

const validateHexDigest = (value: string, label: string): string | null =>
  HEX_DIGEST.test(value) ? null : `${label} must be 64 lowercase hex characters`;

const asFrozenIdentity = (identity: SeedCatalogFrozenIdentity): FrozenPublicationIdentity => ({
  candidateId: CatalogCandidateId(identity.candidateId),
  artifactId: CatalogArtifactId(identity.artifactId),
  releaseId: CatalogReleaseId(identity.releaseId),
  releaseVersion: CatalogReleaseVersion(identity.releaseVersion),
  publishedAt: identity.publishedAt,
  toolchain: identity.toolchain,
  definitions: identity.definitions.map((definition) => ({ ...definition })),
  subjects: identity.subjects?.map((subject) => ({ ...subject })),
});

const operatorMetadata = (input: SeedCatalogPrepareInput): JsonObject => ({
  runId: input.identity.runId,
  stage: input.identity.stage,
  organizationId: input.organizationId,
  sourceKind: input.identity.stage === "vendor" ? "vendor-yaml" : "typed-changeset",
  releaseVersion: input.identity.releaseVersion,
  predecessorArtifactDigest: input.pins.predecessorArtifactDigest,
  ...(input.pins.expectedVendorContentHash
    ? { expectedVendorContentHash: input.pins.expectedVendorContentHash }
    : {}),
  ...(input.pins.expectedListedInputHash
    ? { expectedListedInputHash: input.pins.expectedListedInputHash }
    : {}),
});

const allocationMetadata = (
  built: SuccessorBuildValue,
  facts: JsonObject,
  input: SeedCatalogPrepareInput,
): JsonObject => ({
  ...built.candidate.identityAllocation,
  authorPrincipalId: input.actorUserId,
  authorOrganizationId: input.organizationId,
  impactFacts: facts,
  seedOperator: operatorMetadata(input),
});

const expectedSourceKind = (stage: SeedCatalogStage): ArtifactSourceKind =>
  stage === "vendor" ? "adopted-preexisting" : "vendor-yaml";

const validatePrepareInput = (
  input: SeedCatalogPrepareInput,
): SeedCatalogPublicationResult<true> => {
  if (!validNonEmpty(input.organizationId) || !validNonEmpty(input.actorUserId)) {
    return fail("invalid-input", "organizationId and actorUserId are required");
  }
  if (!validNonEmpty(input.identity.runId) || !validNonEmpty(input.identity.candidateId)) {
    return fail("invalid-input", "runId and candidateId are required");
  }
  if (!validNonEmpty(input.identity.stage) || input.identity.stage !== "vendor" && input.identity.stage !== "configuration-schema") {
    return fail("invalid-input", "stage is invalid");
  }
  for (const [value, label] of [
    [input.pins.expectedCurrent.digest, "expectedCurrent.digest"],
    [input.pins.predecessorArtifactDigest, "predecessorArtifactDigest"],
    [input.pins.expectedArtifactDigest, "expectedArtifactDigest"],
  ] as const) {
    if (value !== undefined) {
      const reason = validateDigest(value, label);
      if (reason) return fail("invalid-input", reason);
    }
  }
  if (input.identity.stage === "vendor" && !validNonEmpty(input.pins.schemasRoot ?? "")) {
    return fail("invalid-input", "schemasRoot is required for vendor preparation");
  }
  for (const [value, label] of [
    [input.pins.expectedVendorContentHash, "expectedVendorContentHash"],
    [input.pins.expectedListedInputHash, "expectedListedInputHash"],
  ] as const) {
    if (value !== undefined) {
      const reason = validateHexDigest(value, label);
      if (reason) return fail("invalid-input", reason);
    }
  }
  return ok(true);
};

const loadUserInvocation = async (
  input: Pick<SeedCatalogPrepareInput, "db" | "organizationId" | "actorUserId">,
  requiredPermission: "catalog:author" | null,
): Promise<SeedCatalogPublicationResult<{ readonly auth: AuthContext; readonly invocation: TrustedInvocationContext }>> => {
  let auth: AuthContext;
  try {
    auth = await getAuthContext(input.db, input.actorUserId);
  } catch {
    return fail("unauthorized", "actor is not an active persisted user");
  }
  if (
    auth.user.id !== input.actorUserId ||
    auth.user.organizationId !== input.organizationId ||
    auth.organization.id !== input.organizationId ||
    !auth.user.isActive
  ) {
    return fail("unauthorized", "actor organization or active state is invalid");
  }
  if (requiredPermission && !auth.permissions.includes(requiredPermission)) {
    return fail("unauthorized", `${requiredPermission} is required`);
  }
  try {
    return ok({ auth, invocation: createUserInvocation(auth) });
  } catch {
    return fail("unauthorized", "actor invocation is invalid");
  }
};

const readCurrent = async (
  db: Database,
): Promise<SeedCatalogPublicationResult<{ readonly id: string; readonly digest: string; readonly version: string }>> => {
  try {
    const result = await withCatalogBaselineReader(db, (tx) =>
      tx.query<{
        id: string;
        digest: string;
        version: string;
      }>(
        `select release.id, release.release_digest as digest, release.release_version as version
           from parameter_catalog.catalog_state state
           join parameter_catalog.catalog_releases release
             on release.id = state.current_catalog_release_id
          where state.singleton`,
      ),
    );
    const row = result.rows[0];
    if (!row) {
      return fail("stale", "current Catalog pin is empty");
    }
    return ok(row);
  } catch {
    return fail("storage", "current Catalog pin could not be read");
  }
};

const loadPredecessor = async (
  input: SeedCatalogPrepareInput,
  current: { readonly id: string; readonly digest: string; readonly version: string },
) => {
  const expected = input.pins.expectedCurrent;
  if (
    current.id !== expected.id ||
    current.digest !== expected.digest ||
    (expected.version !== undefined && current.version !== expected.version)
  ) {
    return fail<never>("stale", "current Catalog pin drifted");
  }
  if (input.identity.releaseId === current.id) {
    return fail<never>("invalid-input", "successor release must differ from predecessor");
  }
  const loaded = await withPublicationCoordinator(input.db, (tx) =>
    getArtifactByDigest(tx, input.pins.predecessorArtifactDigest),
  );
  if (!loaded.ok) return fail<never>(safeMessageForStoreError(loaded.error).kind, "predecessor artifact is unavailable");
  if (
    loaded.value.artifactDigest !== input.pins.predecessorArtifactDigest ||
    loaded.value.targetReleaseId !== expected.id ||
    loaded.value.targetReleaseDigest !== expected.digest ||
    loaded.value.sourceKind !== expectedSourceKind(input.identity.stage)
  ) {
    return fail<never>("stale", "predecessor artifact pin or source kind drifted");
  }
  return ok(loaded.value);
};

const canonicalKeyBySubjectId = (bytes: Uint8Array): Map<string, string> => {
  const parsed = parseBundleBytes(bytes);
  if (!parsed.ok) return new Map();
  const target = parsed.bundle.releases.find((release) => release.manifest.release.id === parsed.bundle.targetReleaseId);
  if (!target) return new Map();
  return new Map(
    target.documents
      .filter((document) => document.kind === "subject")
      .map((document) => [document.content.id, document.content.canonicalKey]),
  );
};

const vendorClaims = (
  identity: SeedCatalogIdentity,
  predecessorBytes: Uint8Array,
): readonly ClaimedVendorIdentity[] => {
  const keyBySubjectId = canonicalKeyBySubjectId(predecessorBytes);
  const claims: ClaimedVendorIdentity[] = (identity.subjects ?? []).map((subject) => ({
    canonicalKey: subject.canonicalKey,
    subjectId: subject.subjectId,
  }));
  for (const definition of identity.definitions) {
    const canonicalKey =
      (identity.subjects ?? []).find((subject) => subject.subjectId === definition.subjectId)?.canonicalKey ??
      keyBySubjectId.get(definition.subjectId);
    if (!canonicalKey) continue;
    claims.push({
      canonicalKey,
      propertyKey: definition.propertyKey,
      definitionId: definition.definitionId,
      subjectId: definition.subjectId,
    });
  }
  return claims;
};

const vendorAllocator = (identity: SeedCatalogIdentity): ((kind: "ccand" | "cart" | "crel" | "csub" | "pdef" | "drev") => string) => {
  const queues: Partial<Record<VendorIdKind, string[]>> = {
    csub: (identity.subjects ?? []).map((subject) => subject.subjectId),
    pdef: identity.definitions.map((definition) => definition.definitionId),
    drev: identity.definitions.map((definition) => definition.revisionId),
  };
  return (kind: VendorIdKind) => {
    const queue = queues[kind];
    const value = queue?.shift();
    if (!value) throw new Error("seed identity allocation exhausted");
    return value;
  };
};

const deterministicAllocator = (runId: string) => {
  const counters: Partial<Record<VendorIdKind, number>> = {};
  return (kind: VendorIdKind): string => {
    const next = (counters[kind] ?? 0) + 1;
    counters[kind] = next;
    const suffix = createHash("sha256")
      .update(`${runId}\0${kind}\0${next}`)
      .digest("hex")
      .slice(0, 20);
    return `${kind}_seed_${suffix}`;
  };
};

const exactIdentity = (
  actual: FrozenPublicationIdentity,
  expected: SeedCatalogFrozenIdentity,
): boolean => sameContract(actual, asFrozenIdentity(expected));

const targetVersion = (built: SuccessorBuildValue): string | null =>
  built.artifact.bundle.releases.find((release) => release.manifest.release.id === built.artifact.targetReleaseId)?.manifest.release.version ?? null;

const persistBuilt = async (
  input: SeedCatalogPrepareInput,
  built: SuccessorBuildValue,
  facts: JsonObject,
): Promise<SeedCatalogPublicationResult<PublicationCandidateRecord>> => {
  if (input.pins.expectedArtifactDigest && built.artifact.artifactDigest !== input.pins.expectedArtifactDigest) {
    return fail("stale", "successor artifact digest drifted");
  }
  if (targetVersion(built) !== input.identity.releaseVersion) {
    return fail("stale", "successor release version drifted");
  }
  const operator = operatorMetadata(input);
  const existing = await withPublicationCoordinator(input.db, async (tx) => {
    const candidate = await getCandidate(tx, built.candidate.id);
    if (candidate.ok) return { kind: "candidate" as const, value: candidate.value };
    if (candidate.error.kind !== "not-found") return { kind: "error" as const, error: candidate.error };
    const artifact = await getArtifactByDigest(tx, built.artifact.artifactDigest);
    if (artifact.ok) return { kind: "artifact" as const, value: artifact.value };
    if (artifact.error.kind !== "not-found") return { kind: "error" as const, error: artifact.error };
    return { kind: "none" as const };
  });
  if (existing.kind === "error") {
    const mapped = safeMessageForStoreError(existing.error);
    return fail(mapped.kind, mapped.message);
  }
  if (existing.kind === "candidate") {
    const allocation = existing.value.identityAllocation;
    if (
      existing.value.artifactId !== built.artifact.id ||
      existing.value.artifactDigest !== built.artifact.artifactDigest ||
      existing.value.expectedBaseReleaseId !== built.candidate.expectedBaseReleaseId ||
      existing.value.expectedBaseReleaseDigest !== built.candidate.expectedBaseReleaseDigest ||
      !isRecord(allocation) ||
      allocation.authorPrincipalId !== input.actorUserId ||
      allocation.authorOrganizationId !== input.organizationId ||
      !sameContract(isRecord(allocation) ? allocation.seedOperator : undefined, operator)
    ) {
      return fail("conflict", "candidate identity differs from the reviewed run");
    }
    return ok(existing.value);
  }
  if (existing.kind === "artifact") {
    if (
      existing.value.id !== built.artifact.id ||
      existing.value.sourceKind !== (input.identity.stage === "vendor" ? "vendor-yaml" : "typed-changeset") ||
      existing.value.targetReleaseId !== built.artifact.targetReleaseId ||
      existing.value.targetReleaseDigest !== built.artifact.targetReleaseDigest
    ) {
      return fail("conflict", "artifact identity differs from the reviewed run");
    }
  }
  const persisted = await persistSuccessorBuild(
    {
      db: input.db,
      ports: {
        persistCandidate: async (db, candidateInput) => {
          return persistCandidate(db, {
            ...candidateInput,
            identityAllocation: {
              ...candidateInput.identityAllocation,
              authorPrincipalId: input.actorUserId,
              authorOrganizationId: input.organizationId,
              impactFacts: facts,
              seedOperator: operator,
            },
          });
        },
      },
    },
    {
      ...built.artifact,
      sourceKind: input.identity.stage === "vendor" ? "vendor-yaml" : "typed-changeset",
    },
    {
      ...built.candidate,
      identityAllocation: allocationMetadata(built, facts, input),
    },
  );
  if ("ok" in persisted) {
    if (persisted.ok === false) {
      const mapped = persisted.error.kind === "persist-failed"
        ? { kind: "storage" as const, message: "catalog publication persistence failed" }
        : { kind: "conflict" as const, message: "catalog publication identity conflict" };
      return fail(mapped.kind, mapped.message);
    }
    return fail("storage", "catalog publication persistence failed");
  }
  if (persisted.kind !== "persisted") return fail("storage", "catalog publication persistence failed");
  return ok(persisted.candidate);
};

const pointersFromCandidate = (
  candidate: PublicationCandidateRecord,
  input?: { readonly job?: PublicationJobRecord | null; readonly receipt?: { readonly id: string; readonly releaseId: string; readonly releaseDigest: string } | null },
): SeedCatalogPublicationPointers | null => {
  const allocation = candidate.identityAllocation;
  if (!isRecord(allocation) || !isRecord(allocation.seedOperator)) return null;
  const operator = allocation.seedOperator;
  if (
    typeof operator.runId !== "string" ||
    (operator.stage !== "vendor" && operator.stage !== "configuration-schema") ||
    typeof allocation.releaseVersion !== "string"
  ) return null;
  const facts = isRecord(allocation.impactFacts) ? allocation.impactFacts : null;
  const operations = facts && Array.isArray(facts.operations)
    ? facts.operations.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.op !== "string") return [];
        return [entry.op];
      })
    : null;
  const boolFact = (key: string): boolean | null => {
    if (!facts || typeof facts[key] !== "boolean") return null;
    return facts[key] as boolean;
  };
  const sourceKind = facts?.sourceKind;
  const knownSourceKind: ArtifactSourceKind | null =
    sourceKind === "typed-changeset" ||
    sourceKind === "vendor-yaml" ||
    sourceKind === "repository-bundle" ||
    sourceKind === "adopted-preexisting"
      ? sourceKind
      : null;
  const impactSummary =
    operations &&
    knownSourceKind !== null &&
    boolFact("introducesNewSubject") !== null &&
    boolFact("changesSelector") !== null &&
    boolFact("changesAlias") !== null &&
    boolFact("changesFallback") !== null &&
    boolFact("tightensExistingContract") !== null &&
    boolFact("changesUnitOrSemantic") !== null &&
    boolFact("retiresIdentity") !== null &&
    boolFact("unknownImpact") !== null
      ? {
          sourceKind: knownSourceKind,
          operations,
          introducesNewSubject: boolFact("introducesNewSubject")!,
          changesSelector: boolFact("changesSelector")!,
          changesAlias: boolFact("changesAlias")!,
          changesFallback: boolFact("changesFallback")!,
          tightensExistingContract: boolFact("tightensExistingContract")!,
          changesUnitOrSemantic: boolFact("changesUnitOrSemantic")!,
          retiresIdentity: boolFact("retiresIdentity")!,
          unknownImpact: boolFact("unknownImpact")!,
        }
      : null;
  return {
    runId: operator.runId,
    stage: operator.stage,
    candidateId: candidate.id,
    artifactId: candidate.artifactId,
    artifactDigest: candidate.artifactDigest,
    releaseId: typeof allocation.releaseId === "string" ? allocation.releaseId : "",
    releaseVersion: allocation.releaseVersion,
    predecessorReleaseId: candidate.expectedBaseReleaseId,
    predecessorReleaseDigest: candidate.expectedBaseReleaseDigest,
    impactReportDigest: candidate.impactReportDigest,
    impactSummary,
    authorizationId: input?.job?.authorizationId ?? null,
    jobId: input?.job?.id ?? null,
    jobStatus: input?.job?.status ?? null,
    receiptId: input?.receipt?.id ?? null,
    receiptReleaseId: input?.receipt?.releaseId ?? null,
    receiptReleaseDigest: input?.receipt?.releaseDigest ?? null,
  };
};

type VendorBuild = {
  readonly built: SuccessorBuildValue;
  readonly frozenIdentity: FrozenPublicationIdentity;
  readonly impactFacts: JsonObject;
  readonly vendorContentHash: string;
  readonly listedInputHash: string;
};

const buildVendor = async (
  input: SeedCatalogPrepareInput,
  predecessor: { readonly artifactBytes: Uint8Array; readonly artifactDigest: string },
  identity: SeedCatalogIdentity,
  allocateId: (kind: VendorIdKind) => string,
  enforceIdentity = true,
): Promise<SeedCatalogPublicationResult<VendorBuild>> => {
  const imported = await importVendorCatalog({
    predecessorArtifact: { digest: predecessor.artifactDigest, bytes: predecessor.artifactBytes },
    schemasRoot: input.pins.schemasRoot!,
    identity: {
      candidateId: identity.candidateId,
      artifactId: identity.artifactId,
      releaseId: identity.releaseId,
      releaseVersion: identity.releaseVersion,
      publishedAt: identity.publishedAt,
      allocateId,
    },
    claimedIdentities: vendorClaims(identity, predecessor.artifactBytes),
    authorPrincipalId: input.actorUserId,
    authorOrganizationId: input.organizationId,
  });
  if (!imported.ok) return fail("stale", vendorImportErrorMessage(imported.error));
  if (imported.value.kind !== "successor" || imported.value.built.kind !== "successor") {
    return fail("conflict", "vendor source produced no successor");
  }
  if (enforceIdentity && !exactIdentity(imported.value.frozenIdentity, identity)) {
    return fail("conflict", "vendor source differs from the frozen identity");
  }
  if (
    (input.pins.expectedVendorContentHash && imported.value.report.inventory.vendorContentHash !== input.pins.expectedVendorContentHash) ||
    (input.pins.expectedListedInputHash && imported.value.report.inventory.listedInputHash !== input.pins.expectedListedInputHash)
  ) {
    return fail("stale", "vendor source digest drifted");
  }
  return ok({
    built: imported.value.built,
    frozenIdentity: imported.value.frozenIdentity,
    impactFacts: imported.value.impactFacts as unknown as JsonObject,
    vendorContentHash: imported.value.report.inventory.vendorContentHash,
    listedInputHash: imported.value.report.inventory.listedInputHash,
  });
};

const buildConfigurationSchema = async (
  input: SeedCatalogPrepareInput,
  predecessor: { readonly artifactBytes: Uint8Array; readonly artifactDigest: string },
): Promise<SeedCatalogPublicationResult<{ readonly built: SuccessorBuildValue; readonly impactFacts: JsonObject }>> => {
  const toolchain = predecessorToolchain(predecessor.artifactBytes);
  if (!toolchain || !sameContract(toolchain, input.identity.toolchain)) {
    return fail("stale", "predecessor toolchain differs from the frozen identity");
  }
  const built = await buildPowerConfigSuccessor({
    predecessorArtifact: { digest: predecessor.artifactDigest, bytes: predecessor.artifactBytes },
    frozenIdentity: asFrozenIdentity(input.identity),
  });
  if (!built.ok || built.value.kind !== "successor") {
    return fail(built.ok ? "conflict" : "stale", built.ok ? "ConfigurationSchema produced no successor" : "ConfigurationSchema successor could not be built");
  }
  return ok({
    built: built.value,
    impactFacts: powerConfigImpactFacts(input.actorUserId) as unknown as JsonObject,
  });
};

const predecessorToolchain = (bytes: Uint8Array): SeedCatalogFrozenIdentity["toolchain"] | null => {
  const parsed = parseBundleBytes(bytes);
  if (!parsed.ok) return null;
  const target = parsed.bundle.releases.find((release) => release.manifest.release.id === parsed.bundle.targetReleaseId);
  const toolchain = target?.manifest.toolchain;
  if (
    !toolchain ||
    typeof toolchain.compiler !== "string" ||
    typeof toolchain.jsonSchemaDialect !== "string" ||
    typeof toolchain.sourceFormat !== "string"
  ) return null;
  return {
    compiler: toolchain.compiler,
    jsonSchemaDialect: toolchain.jsonSchemaDialect,
    sourceFormat: toolchain.sourceFormat,
  };
};

const deterministicIdentityValue = (runId: string, kind: string, label: string): string => {
  const suffix = createHash("sha256").update(`${runId}\0${kind}\0${label}`).digest("hex").slice(0, 20);
  return `${kind}_seed_${suffix}`;
};

const freezeIdentityInput = (
  input: SeedCatalogFreezeInput,
  toolchain: SeedCatalogFrozenIdentity["toolchain"],
): SeedCatalogPrepareInput => {
  const subjectId = deterministicIdentityValue(input.runId, "csub", "power-config");
  const identity: SeedCatalogIdentity = {
    runId: input.runId,
    stage: input.stage,
    candidateId: input.candidateId,
    artifactId: input.artifactId,
    releaseId: input.releaseId,
    releaseVersion: input.releaseVersion,
    publishedAt: input.publishedAt,
    toolchain,
    subjects:
      input.stage === "configuration-schema"
        ? [{ canonicalKey: SEED_POWER_CONFIG_SCHEMA_ID, subjectId }]
        : [],
    definitions:
      input.stage === "configuration-schema"
        ? [
            {
              subjectId,
              propertyKey: "charger.cv.limitMv",
              definitionId: deterministicIdentityValue(input.runId, "pdef", "charger.cv.limitMv"),
              revisionId: deterministicIdentityValue(input.runId, "drev", "charger.cv.limitMv"),
            },
            {
              subjectId,
              propertyKey: "battery.thermal.targetTempC",
              definitionId: deterministicIdentityValue(input.runId, "pdef", "battery.thermal.targetTempC"),
              revisionId: deterministicIdentityValue(input.runId, "drev", "battery.thermal.targetTempC"),
            },
          ]
        : [],
  };
  return {
    db: input.db,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    identity,
    pins: {
      expectedCurrent: input.expectedCurrent,
      predecessorArtifactDigest: input.predecessorArtifactDigest,
      expectedVendorContentHash: input.expectedVendorContentHash,
      expectedListedInputHash: input.expectedListedInputHash,
      schemasRoot: input.schemasRoot,
    },
  };
};

const prepareVendor = async (
  input: SeedCatalogPrepareInput,
  predecessor: { readonly artifactBytes: Uint8Array; readonly artifactDigest: string },
): Promise<SeedCatalogPublicationResult<PublicationCandidateRecord>> => {
  const imported = await buildVendor(input, predecessor, input.identity, vendorAllocator(input.identity));
  if (!imported.ok) return imported;
  return persistBuilt(input, imported.value.built, imported.value.impactFacts);
};

const prepareConfigurationSchema = async (
  input: SeedCatalogPrepareInput,
  predecessor: { readonly artifactBytes: Uint8Array; readonly artifactDigest: string },
): Promise<SeedCatalogPublicationResult<PublicationCandidateRecord>> => {
  const built = await buildConfigurationSchema(input, predecessor);
  if (!built.ok) return built;
  return persistBuilt(input, built.value.built, built.value.impactFacts);
};

const vendorImportErrorMessage = (error: VendorImportError): string => {
  if (error.kind === "artifact-missing" || error.kind === "artifact-digest-mismatch") return "predecessor artifact is stale";
  if (error.kind === "import-blocked") return "vendor source is blocked by the reviewed import contract";
  if (error.kind === "invalid-input") return "vendor source input is invalid";
  return `vendor source could not produce the reviewed successor: ${error.kind}`;
};

/**
 * Read-only identity/artifact freeze. It runs the same importer/builder as
 * prepare, but never persists an artifact, candidate, authorization, or job.
 */
export async function freezeSeedCatalogIdentity(
  input: SeedCatalogFreezeInput,
): Promise<SeedCatalogPublicationResult<Omit<SeedCatalogPrepareInput, "db"> & { readonly expectedArtifactDigest: string }>> {
  if (
    !validNonEmpty(input.organizationId) ||
    !validNonEmpty(input.actorUserId) ||
    !validNonEmpty(input.runId) ||
    !validNonEmpty(input.candidateId) ||
    !validNonEmpty(input.artifactId) ||
    !validNonEmpty(input.releaseId) ||
    !validNonEmpty(input.releaseVersion) ||
    !validNonEmpty(input.publishedAt) ||
    (input.stage !== "vendor" && input.stage !== "configuration-schema")
  ) return fail("invalid-input", "freeze input is incomplete");
  const digestError = validateDigest(input.expectedCurrent.digest, "expectedCurrent.digest") ??
    validateDigest(input.predecessorArtifactDigest, "predecessorArtifactDigest");
  if (digestError) return fail("invalid-input", digestError);
  const temporary = freezeIdentityInput(input, {
    compiler: "seed-freeze",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    sourceFormat: input.stage === "vendor" ? "vendor-yaml" : "typed-changeset",
  });
  const valid = validatePrepareInput(temporary);
  if (!valid.ok) return valid;
  const actor = await loadUserInvocation(temporary, "catalog:author");
  if (!actor.ok) return actor;
  const current = await readCurrent(input.db);
  if (!current.ok) return current;
  const predecessor = await loadPredecessor(temporary, current.value);
  if (!predecessor.ok) return predecessor;
  const toolchain = predecessorToolchain(predecessor.value.artifactBytes);
  if (!toolchain) return fail("stale", "predecessor toolchain is unavailable");
  const withToolchain = freezeIdentityInput(input, toolchain);
  let identity: SeedCatalogIdentity;
  let successor: SuccessorBuildValue;
  if (input.stage === "vendor") {
    const built = await buildVendor(
      withToolchain,
      predecessor.value,
      withToolchain.identity,
      deterministicAllocator(input.runId),
      false,
    );
    if (!built.ok) return built;
    identity = {
      ...built.value.frozenIdentity,
      runId: input.runId,
      stage: input.stage,
    };
    successor = built.value.built;
  } else {
    const built = await buildConfigurationSchema(withToolchain, predecessor.value);
    if (!built.ok) return built;
    identity = withToolchain.identity;
    successor = built.value.built;
  }
  const value: Omit<SeedCatalogPrepareInput, "db"> & { readonly expectedArtifactDigest: string } = {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    identity,
    pins: {
      expectedCurrent: input.expectedCurrent,
      predecessorArtifactDigest: input.predecessorArtifactDigest,
      expectedArtifactDigest: successor.artifact.artifactDigest,
      expectedVendorContentHash: input.expectedVendorContentHash,
      expectedListedInputHash: input.expectedListedInputHash,
      schemasRoot: input.schemasRoot,
    },
    expectedArtifactDigest: successor.artifact.artifactDigest,
  };
  void actor.value;
  return ok(value);
}

export async function prepareSeedCatalog(
  input: SeedCatalogPrepareInput,
): Promise<SeedCatalogPublicationResult<SeedCatalogPublicationPointers>> {
  const valid = validatePrepareInput(input);
  if (!valid.ok) return valid;
  const actor = await loadUserInvocation(input, "catalog:author");
  if (!actor.ok) return actor;
  const current = await readCurrent(input.db);
  if (!current.ok) return current;
  const predecessor = await loadPredecessor(input, current.value);
  if (!predecessor.ok) return predecessor;
  const prepared = input.identity.stage === "vendor"
    ? await prepareVendor(input, predecessor.value)
    : await prepareConfigurationSchema(input, predecessor.value);
  if (!prepared.ok) return prepared;
  const pointers = pointersFromCandidate(prepared.value);
  if (!pointers) return fail("storage", "persisted candidate metadata is incomplete");
  void actor.value;
  return ok(pointers);
}

const loadCandidateForOperation = async (
  input: SeedCatalogPublishInput,
): Promise<SeedCatalogPublicationResult<PublicationCandidateRecord>> => {
  const candidate = await withPublicationCoordinator(input.db, (tx) =>
    getCandidate(tx, CatalogCandidateId(input.candidateId)),
  );
  if (!candidate.ok) {
    const mapped = safeMessageForStoreError(candidate.error);
    return fail(mapped.kind, mapped.message);
  }
  const allocation = candidate.value.identityAllocation;
  if (!isRecord(allocation) || !isRecord(allocation.seedOperator)) {
    return fail("conflict", "candidate is not a reviewed seed candidate");
  }
  const operator = allocation.seedOperator;
  if (
    operator.runId !== input.runId ||
    operator.stage !== input.stage ||
    operator.organizationId !== input.organizationId ||
    candidate.value.artifactDigest !== input.expectedArtifactDigest ||
    candidate.value.expectedBaseReleaseId !== input.expectedCurrent.id ||
    candidate.value.expectedBaseReleaseDigest !== input.expectedCurrent.digest
  ) {
    return fail("stale", "candidate or Catalog pin drifted");
  }
  return ok(candidate.value);
};

export async function publishSeedCatalog(
  input: SeedCatalogPublishInput,
): Promise<SeedCatalogPublicationResult<SeedCatalogPublicationPointers>> {
  if (
    !validNonEmpty(input.organizationId) ||
    !validNonEmpty(input.actorUserId) ||
    !validNonEmpty(input.candidateId) ||
    !validNonEmpty(input.runId) ||
    !validNonEmpty(input.idempotencyKey) ||
    (input.stage !== "vendor" && input.stage !== "configuration-schema")
  ) return fail("invalid-input", "publish input is incomplete");
  if (validateDigest(input.expectedArtifactDigest, "expectedArtifactDigest")) {
    return fail("invalid-input", "expectedArtifactDigest is invalid");
  }
  if (validateDigest(input.expectedCurrent.digest, "expectedCurrent.digest")) {
    return fail("invalid-input", "expectedCurrent.digest is invalid");
  }
  const actor = await loadUserInvocation(input, null);
  if (!actor.ok) return actor;
  const current = await readCurrent(input.db);
  if (!current.ok) return current;
  if (
    current.value.id !== input.expectedCurrent.id ||
    current.value.digest !== input.expectedCurrent.digest ||
    (input.expectedCurrent.version !== undefined && current.value.version !== input.expectedCurrent.version)
  ) return fail("stale", "current Catalog pin drifted");
  const candidate = await loadCandidateForOperation(input);
  if (!candidate.ok) return candidate;
  const queued = await enqueuePublicationJob({
    db: input.db,
    candidateId: candidate.value.id,
    idempotencyKey: input.idempotencyKey,
    trustedActor: actor.value.invocation,
  });
  if (!queued.ok) {
    if (queued.error.kind === "not-found") return fail("not-found", "publication candidate is missing");
    if (queued.error.kind === "idempotency-key-conflict") return fail("conflict", "publication retry key conflicts");
    if (queued.error.kind === "authorization") return fail("publication-denied", queued.error.reason);
    return fail("invalid-input", "publication request is invalid");
  }
  const pointers = pointersFromCandidate(queued.value.candidate, { job: queued.value.job });
  if (!pointers) return fail("storage", "queued candidate metadata is incomplete");
  return ok(pointers);
}

const latestJobForCandidate = async (
  db: Database,
  candidateId: string,
): Promise<SeedCatalogPublicationResult<string | null>> => {
  try {
    const result = await withPublicationCoordinator(db, (tx) =>
      tx.query<{ id: string }>(
        `select id from catalog_publication.publication_jobs where candidate_id = $1 order by created_at desc limit 1`,
        [candidateId],
      ),
    );
    return ok(result.rows[0]?.id ?? null);
  } catch {
    return fail("storage", "publication job status could not be read");
  }
};

export async function getSeedCatalogPublicationStatus(
  input: SeedCatalogStatusInput,
): Promise<SeedCatalogPublicationResult<SeedCatalogPublicationPointers>> {
  if (!validNonEmpty(input.candidateId)) return fail("invalid-input", "candidateId is required");
  const candidate = await withPublicationCoordinator(input.db, (tx) =>
    getCandidate(tx, CatalogCandidateId(input.candidateId)),
  );
  if (!candidate.ok) {
    const mapped = safeMessageForStoreError(candidate.error);
    return fail(mapped.kind, mapped.message);
  }
  const initial = pointersFromCandidate(candidate.value);
  if (!initial) return fail("storage", "candidate metadata is incomplete");
  if (input.expectedRunId && initial.runId !== input.expectedRunId) return fail("stale", "candidate run does not match");
  if (input.expectedStage && initial.stage !== input.expectedStage) return fail("stale", "candidate stage does not match");
  const jobId = await latestJobForCandidate(input.db, input.candidateId);
  if (!jobId.ok) return jobId;
  if (!jobId.value) return ok(initial);
  const job = await withPublicationCoordinator(input.db, (tx) => getJob(tx, PublicationJobId(jobId.value!)));
  if (!job.ok) {
    const mapped = safeMessageForStoreError(job.error);
    return fail(mapped.kind, mapped.message);
  }
  let receipt: { readonly id: string; readonly releaseId: string; readonly releaseDigest: string } | null = null;
  const storedReceipt = await withPublicationCoordinator(input.db, (tx) => getReceiptByJobId(tx, job.value.id));
  if (storedReceipt.ok) {
    if (
      job.value.status !== "active" ||
      storedReceipt.value.kind !== "online-publication" ||
      storedReceipt.value.candidateId !== candidate.value.id ||
      storedReceipt.value.publicationJobId !== job.value.id ||
      storedReceipt.value.authorizationId !== job.value.authorizationId
    ) return fail("conflict", "publication receipt does not match the succeeded job");
    receipt = storedReceipt.value;
  } else if (storedReceipt.error.kind !== "not-found") {
    const mapped = safeMessageForStoreError(storedReceipt.error);
    return fail(mapped.kind, mapped.message);
  } else if (job.value.status === "active") {
    return fail("conflict", "active publication job has no matching receipt");
  }
  const pointers = pointersFromCandidate(candidate.value, { job: job.value, receipt });
  if (!pointers) return fail("storage", "candidate metadata is incomplete");
  return ok(pointers);
}
