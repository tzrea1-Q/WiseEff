import type { Database } from "../../../shared/database/client";
import { getRootPostgresPool } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import type { AuthContext } from "../../auth/types";
import { createCatalogKernel, DriverCompatible } from "../../catalog-kernel/interface";
import { createPinCapturingCatalogRuntime, captureCurrentCatalogPin } from "../../catalog-publication/runtime";
import { subjectMatcherRevision } from "../../catalog-kernel/runtime/subjectMatch";
import type { ObjectStore } from "../../logs/objectStore";
import type { CatalogReleasePin } from "../../parameter-catalog-contract";
import { readCurrentDtsCompatibleSource, type CurrentDtsCompatibleSourceInput,
  type DtsObservationLocator } from "../../parameter-topology/currentDtsCompatibleSource";
import { requireCanViewProject } from "../../parameter-topology/service";
import { groupReviewEvidence } from "../review/group";
import { parseStoredEvidence } from "../review/query";
import type { ReviewEvidenceRecord } from "../review/types";
import { isUsableToken } from "./client";

const MAX_PAGE = 50;
const MAX_REVIEW_EVIDENCE = 500;
const MAX_COMPATIBLES_PER_SOURCE = 64;
const token = (value: unknown): value is string => isUsableToken(value) && value.length <= 256;

type Observation = {
  id: string; projectId: string; logicalNodeId: string; configRevisionId: string;
  catalogReleaseId: string; matcherRevision: string; locator: unknown;
  configSetId: string | null; fileId: string | null; sourceRevisionId: string | null;
  sourceNodeId: string | null;
};
type StoredEvidence = {
  id: string; observationId: string; organizationId: string; reason: ReviewEvidenceRecord["reason"];
  candidateSafeDigest: string; rClass: ReviewEvidenceRecord["rClass"];
  sourceGraphRef: string | null; evidence: unknown;
};
type StoredItem = { id: string; evidenceFingerprint: string; matcherRevision: string; status: string };

export type DriverCompatibleDiscoveryItem = {
  readonly observationId: string;
  readonly projectId: string;
  readonly logicalNodeId: string;
  readonly configRevisionId: string;
  readonly observedCatalogReleaseId: string;
  readonly observedMatcherRevision: string;
  readonly source:
    | { readonly status: "unavailable"; readonly reason: string }
    | { readonly status: "historical"; readonly currentConfigRevisionId: string;
        readonly historicalCompatibles: readonly string[] }
    | { readonly status: "current"; readonly configSetId: string;
        readonly sourceName: string; readonly fileVersionId: string;
        readonly sourceDigest: string; readonly revisionDigest: string };
  /** One entry per complete selector from the source-owned parser. Historical/unavailable sources have none. */
  readonly compatibles: readonly {
    readonly compatible: string;
    readonly candidate:
      | { readonly kind: "recognized"; readonly subjectId: string; readonly registrationId: string | null }
      | { readonly kind: "review-required"; readonly reason: "unknown" | "ambiguous" | "retired";
          /** Null means no source-bound review evidence is available to prove an item association. */
          readonly reviewItemIds: readonly string[] | null };
  }[];
};

export type DriverCompatibleDiscoveryPage =
  | { readonly status: "unavailable"; readonly reason: "catalog-unavailable" | "release-drift"
      | "review-evidence-limit" | "review-evidence-invalid" }
  | { readonly status: "ready"; readonly catalogRelease: CatalogReleasePin;
      readonly matcherRevision: string; readonly items: readonly DriverCompatibleDiscoveryItem[];
      readonly nextCursor: string | null;
      /** Null when the principal cannot read the organization-wide Review Queue. */
      readonly ignoredReviewItemCount: number | null;
      readonly emptyReason?: "no-observations" };

/** Internal C1 read entry. The authenticated principal supplies only filters, never observation provenance. */
export async function listDriverCompatibleDiscovery(input: {
  readonly db: Database; readonly objectStore: ObjectStore; readonly auth: AuthContext;
  readonly projectId?: string; readonly observationId?: string;
  readonly cursor?: string; readonly limit?: number;
}): Promise<DriverCompatibleDiscoveryPage> {
  const { db, objectStore, auth } = input;
  const canReadReviewQueue = auth.roles.some((role) => role.roleId === "admin" && role.projectId === null);
  const limit = input.limit ?? MAX_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE
    || (input.projectId !== undefined && !token(input.projectId))
    || (input.observationId !== undefined && !token(input.observationId))
    || (input.cursor !== undefined && !token(input.cursor))) {
    throw new ApiError("VALIDATION_FAILED", "Invalid compatible discovery page.");
  }
  if (input.projectId) {
    try { requireCanViewProject(auth, input.projectId); }
    catch { throw new ApiError("NOT_FOUND", "DTS observation is not available."); }
  } else {
    requireCanViewProject(auth, auth.roles.find((role) => role.projectId)?.projectId ?? "");
  }
  const pool = getRootPostgresPool(db);
  if (!pool) return { status: "unavailable", reason: "catalog-unavailable" };
  const pin = await captureCurrentCatalogPin(pool);
  if (!pin) return { status: "unavailable", reason: "catalog-unavailable" };
  const runtime = createPinCapturingCatalogRuntime(pool, createCatalogKernel(pool));
  const loaded = await runtime.loadCurrentCatalog(pin);
  if (!loaded.ok) return { status: "unavailable", reason: "catalog-unavailable" };

  const allProjects = auth.roles.some((role) => role.roleId === "admin" || role.roleId === "platform-admin" || role.projectId === null);
  const projectIds = allProjects ? null : [...new Set(auth.roles.map((role) => role.projectId).filter((id): id is string => !!id))];
  const rows = (await db.query<Observation>(
    `select observation.id,observation.project_id as "projectId",observation.logical_node_id as "logicalNodeId",
       observation.config_revision_id as "configRevisionId",observation.catalog_release_id as "catalogReleaseId",
       observation.matcher_revision as "matcherRevision",observation.source_locator as locator,
       occurrence.config_set_id as "configSetId",occurrence.file_id as "fileId",
       revision.id as "sourceRevisionId",logical.id as "sourceNodeId"
     from parameter_catalog.parameter_observations observation
     left join parameter_catalog.project_parameter_source_occurrences occurrence
       on occurrence.id=observation.source_occurrence_id and occurrence.organization_id=observation.organization_id
       and occurrence.project_id=observation.project_id and occurrence.logical_node_id=observation.logical_node_id
       and occurrence.occurrence_kind='dts'
     left join dts_config_revisions revision on revision.id=observation.config_revision_id
       and revision.organization_id=observation.organization_id and revision.project_id=observation.project_id
       and revision.config_set_id=occurrence.config_set_id
     left join dts_logical_nodes logical on logical.id=observation.logical_node_id
       and logical.organization_id=observation.organization_id and logical.project_id=observation.project_id
       and logical.config_set_id=occurrence.config_set_id
     where observation.organization_id=$1 and ($2::text is null or observation.project_id=$2)
       and ($3::text[] is null or observation.project_id=any($3::text[]))
       and ($4::text is null or observation.id=$4) and ($5::text is null or observation.id>$5)
     order by observation.id limit $6`,
    [auth.organization.id,input.projectId ?? null,projectIds,input.observationId ?? null,input.cursor ?? null,limit + 1],
  )).rows;
  if (input.observationId && rows.length === 0) throw new ApiError("NOT_FOUND", "DTS observation is not available.");
  const selected = rows.slice(0,limit);
  const ids = selected.map((row) => row.id);
  const evidenceRows = ids.length ? (await db.query<StoredEvidence>(
    `select id,observation_id as "observationId",organization_id as "organizationId",reason,
       candidate_safe_digest as "candidateSafeDigest",r_class as "rClass",
       source_graph_ref as "sourceGraphRef",evidence
     from parameter_catalog.parameter_review_evidence
     where organization_id=$1 and observation_id=any($2::text[])
     order by id limit $3`, [auth.organization.id,ids,MAX_REVIEW_EVIDENCE + 1],
  )).rows : [];
  if (evidenceRows.length > MAX_REVIEW_EVIDENCE) return { status: "unavailable", reason: "review-evidence-limit" };
  const reviewRecords: ReviewEvidenceRecord[] = [];
  for (const row of evidenceRows) {
    const parsed = parseStoredEvidence(row.evidence);
    if (!parsed) return { status: "unavailable", reason: "review-evidence-invalid" };
    reviewRecords.push({ id: row.id, organizationId: row.organizationId, reason: row.reason,
      candidateSafeDigest: row.candidateSafeDigest, rClass: row.rClass,
      sourceGraphRef: row.sourceGraphRef, evidence: parsed });
  }
  const grouped = groupReviewEvidence(reviewRecords,pin);
  if (!grouped.ok) return { status: "unavailable", reason: "review-evidence-invalid" };
  const fingerprints = grouped.value.map((group) => group.groupingFingerprint);
  const persisted = fingerprints.length ? (await db.query<StoredItem>(
    `select id,evidence_fingerprint as "evidenceFingerprint",matcher_revision as "matcherRevision",status
       from parameter_catalog.parameter_review_items
      where organization_id=$1 and catalog_release_id=$2 and evidence_fingerprint=any($3::text[])`,
    [auth.organization.id,pin.id,fingerprints],
  )).rows : [];
  const openByGroup = new Map(persisted.filter((row) => row.status === "open")
    .map((row) => [`${row.matcherRevision}\0${row.evidenceFingerprint}`,row.id]));
  const evidenceObservation = new Map(evidenceRows.map((row) => [row.id,row.observationId]));
  const reviewIdsBySelector = new Map<string, Set<string>>();
  const linkedSelectors = new Set<string>();
  for (const group of grouped.value) {
    if (group.matcherRevision !== subjectMatcherRevision) continue;
    const itemId = openByGroup.get(`${group.matcherRevision}\0${group.groupingFingerprint}`);
    for (const record of group.evidence) {
      const observationId = evidenceObservation.get(record.id);
      const compatible = record.evidence.payload.compatible;
      if (!observationId || typeof compatible !== "string") continue;
      const key = `${observationId}\0${compatible}`;
      linkedSelectors.add(key);
      if (!itemId) continue;
      const set = reviewIdsBySelector.get(key) ?? new Set<string>();
      set.add(itemId);
      reviewIdsBySelector.set(key,set);
    }
  }

  const items: DriverCompatibleDiscoveryItem[] = [];
  for (const row of selected) {
    const identity = { observationId: row.id, projectId: row.projectId,
      logicalNodeId: row.logicalNodeId, configRevisionId: row.configRevisionId,
      observedCatalogReleaseId: row.catalogReleaseId, observedMatcherRevision: row.matcherRevision };
    if (!row.configSetId || !row.fileId || !row.sourceRevisionId || !row.sourceNodeId) {
      items.push({ ...identity,source: { status: "unavailable",reason: "source-link-unavailable" },compatibles: [] });
      continue;
    }
    const sourceInput: CurrentDtsCompatibleSourceInput = {
      organizationId: auth.organization.id, projectId: row.projectId, observationId: row.id,
      catalogReleaseId: row.catalogReleaseId, matcherRevision: row.matcherRevision,
      configSetId: row.configSetId, fileId: row.fileId, configRevisionId: row.configRevisionId,
      logicalNodeId: row.logicalNodeId, locator: row.locator as DtsObservationLocator,
    };
    let source: Awaited<ReturnType<typeof readCurrentDtsCompatibleSource>>;
    try {
      source = await readCurrentDtsCompatibleSource(db,objectStore,auth,sourceInput);
    } catch (error) {
      if (error instanceof ApiError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) throw error;
      const reason = error !== null && typeof error === "object" && "code" in error && error.code === "42501"
        ? "source-permission-denied" : "source-read-failed";
      items.push({ ...identity,source: { status: "unavailable",reason },compatibles: [] });
      continue;
    }
    if (source.status !== "unavailable" && source.compatibles.length > MAX_COMPATIBLES_PER_SOURCE) {
      items.push({ ...identity,source: { status: "unavailable",reason: "compatible-limit" },compatibles: [] });
      continue;
    }
    if (source.status === "unavailable") {
      items.push({ ...identity,source,compatibles: [] });
    } else if (source.status === "historical") {
      items.push({ ...identity,source: { status: "historical",
        currentConfigRevisionId: source.currentConfigRevisionId,
        historicalCompatibles: source.compatibles },compatibles: [] });
    } else {
      const proof = source.compatibleProof;
      items.push({ ...identity,source: { status: "current",configSetId: source.configSetId,
        sourceName: proof.sourceName,fileVersionId: proof.fileVersionId,
        sourceDigest: proof.sourceDigest,revisionDigest: proof.revisionDigest },
        compatibles: [...new Set(source.compatibles)].map((compatible) => {
          const matched = loaded.value.resolveSubject({
            driverCompatibles: [DriverCompatible(compatible)], nodeTypeFallback: { kind: "absent" },
          });
          return { compatible, candidate: matched.status === "matched" && matched.subject.kind === "driver"
            ? { kind: "recognized" as const,subjectId: matched.subject.id,registrationId: null }
            : { kind: "review-required" as const,
                reason: matched.status === "ambiguous" ? "ambiguous" as const
                  : matched.status === "retired" ? "retired" as const : "unknown" as const,
                reviewItemIds: canReadReviewQueue && linkedSelectors.has(`${row.id}\0${compatible}`)
                  ? [...(reviewIdsBySelector.get(`${row.id}\0${compatible}`) ?? [])].sort() : null } };
        }) });
    }
  }
  const subjectIds = [...new Set(items.flatMap((item) => item.compatibles.flatMap((entry) =>
    entry.candidate.kind === "recognized" ? [entry.candidate.subjectId] : [])))];
  let completedItems = items;
  if (subjectIds.length) {
    const registrations = (await db.query<{ id: string; subjectId: string }>(
      `select id,subject_id as "subjectId" from parameter_catalog.organization_subject_registrations
        where organization_id=$1 and subject_id=any($2::text[]) and status='active'`,
      [auth.organization.id,subjectIds],
    )).rows;
    const bySubject = new Map(registrations.map((row) => [row.subjectId,row.id]));
    completedItems = items.map((item) => ({ ...item,compatibles: item.compatibles.map((entry) => ({
      ...entry,candidate: entry.candidate.kind === "recognized"
        ? { ...entry.candidate,registrationId: bySubject.get(entry.candidate.subjectId) ?? null }
        : entry.candidate,
    })) }));
  }
  const ignored = canReadReviewQueue ? (await db.query<{ count: string }>(
    `select count(distinct id)::text as count from parameter_catalog.parameter_review_items
      where organization_id=$1 and catalog_release_id=$2 and status='out-of-scope'`,
    [auth.organization.id,pin.id],
  )).rows[0]?.count ?? "0" : null;
  const finalPin = await captureCurrentCatalogPin(pool);
  if (!finalPin || finalPin.id !== pin.id || finalPin.digest !== pin.digest) {
    return { status: "unavailable", reason: "release-drift" };
  }
  return { status: "ready",catalogRelease: pin,matcherRevision: subjectMatcherRevision,
    items: completedItems,nextCursor: rows.length > limit ? selected.at(-1)!.id : null,
    ignoredReviewItemCount: ignored === null ? null : Number(ignored),
    ...(items.length ? {} : { emptyReason: "no-observations" as const }) };
}
