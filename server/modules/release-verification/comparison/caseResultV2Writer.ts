import type pg from "pg";

import { getAuthContextForExternalIdentity } from "../../auth/repository";
import type { AuthContext } from "../../auth/types";
import {
  assertTrustedInvocationContext,
  assertTrustedInvocationMatchesAuth,
  type TrustedInvocationContext,
} from "../../auth/trustedInvocation";
import { CatalogReleaseDigest, CatalogReleaseId } from "../../parameter-catalog-contract";
import {
  readCompletedModComparisonManifestForComparison,
  type CompletedMappingManifest,
} from "../../parameter-catalog-api/productionWire";
import { readRegistry } from "../../parameter-modules/repository";
import type { ParameterModuleDto } from "../../parameter-modules/types";
import { getRootPostgresPool, type Database } from "../../../shared/database/client";
import { createProductionComparisonCaseProvidersV2 } from "./productionProviders";
import {
  checksumCanonicalBytes,
  comparisonCaseIdV2For,
  serializeCanonical,
  type ComparisonCaseBatchV2,
  type ComparisonCaseContributionV2,
  type ComparisonCaseInventoryV2,
  type ComparisonCaseSelectionV2,
  type QueryObservation,
} from "./corpusContributionSchema";

const D02_GATE_ID = "PCAT-CMP-D02";
const D02_COMPARISON_ID = "PCAT-CMP-D02-SUBJECT-IDENTITY";
const UNQUERYABLE_CODE = "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE";

export type WriteModComparisonCaseBatchV2Input = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly runId: string;
  readonly invocation: TrustedInvocationContext;
  readonly phase: "pre-activation";
};

export type WriteModComparisonCaseBatchV2Result = {
  readonly contractVersion: "pcat-comparison-case-write/v2";
  readonly family: "MOD";
  readonly comparisonId: typeof D02_COMPARISON_ID;
  readonly phase: "pre-activation";
  readonly organizationId: string;
  readonly selectionRunId: string;
  readonly selectionProjectionDigest: string;
  readonly coverage: "organization-projection";
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly caseCount: number;
  readonly newlyWrittenCount: number;
  readonly replayedWriteCount: number;
  readonly selectionStatusCounts: { readonly appended: number; readonly replayed: number };
  readonly fullReport: { readonly available: false; readonly reason: "eleven-family-and-nine-gate-coverage-not-collected" };
  readonly caseIds: readonly string[];
};

const failClosed = (detail: string): never => {
  throw new Error(`${UNQUERYABLE_CODE}: ${detail}`);
};

const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value;

const keyOf = (input: {
  readonly kind: string;
  readonly id: string;
  readonly ownerScopeKind: string;
  readonly ownerScopeId: string;
}): string => `${input.kind}\0${input.id}\0${input.ownerScopeKind}\0${input.ownerScopeId}`;

const sortText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const inventoryChecksum = (inventory: readonly ComparisonCaseInventoryV2[]): string =>
  checksumCanonicalBytes(serializeCanonical(inventory));

const asSelection = (value: unknown): ComparisonCaseSelectionV2 | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as ComparisonCaseSelectionV2
    : null;

const subjectFrom = (observation: QueryObservation): { readonly id: string; readonly type: string; readonly lifecycle: string } | null => {
  if (observation.status !== "value") return null;
  const subject = observation.value.subject;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) return null;
  const record = subject as Record<string, unknown>;
  return text(record.id) && text(record.type) && text(record.lifecycle)
    ? { id: record.id, type: record.type, lifecycle: record.lifecycle }
    : null;
};

const queryFailureDetail = (item: ComparisonCaseContributionV2): string =>
  item.unqueryableReason ?? "unqueryable-reason-missing";

const assertCaseContribution = (
  item: ComparisonCaseContributionV2,
  manifest: CompletedMappingManifest,
  batch: ComparisonCaseBatchV2,
): void => {
  if (item.contractVersion !== "pcat-comparison-case-contribution/v2" ||
      item.family !== "MOD" || item.comparisonId !== D02_COMPARISON_ID ||
      item.context.contractVersion !== "pcat-comparison-case-context/v2" ||
      item.context.phase !== "pre-activation" ||
      item.context.selectionRunId !== manifest.selectionRunId ||
      item.context.selectionPlanDigest !== manifest.planDigest ||
      item.context.selectionTargetArtifactSha !== manifest.targetArtifactSha ||
      item.context.selectionCatalogReleaseId !== manifest.catalogRelease.id ||
      item.context.selectionCatalogReleaseDigest !== manifest.catalogRelease.digest ||
      item.context.selectionManifestDigest !== manifest.fullRunDigest ||
      item.context.selectionP7CheckpointDigest !== manifest.p7CheckpointDigest ||
      item.context.selectionProjectionDigest !== manifest.projection.digest ||
      item.context.selectionProjectionCoverage !== manifest.projection.coverage ||
      item.context.selectionProjectionCount !== manifest.projection.selectionCount ||
      item.context.sourceInventoryCount !== batch.sourceInventoryCount ||
      item.context.sourceInventoryChecksum !== batch.sourceInventoryChecksum ||
      item.protectedReferenceOwnerScopeKind !== "organization" ||
      item.protectedReferenceOwnerScopeId !== batch.organizationId) {
    failClosed(`case context or protected owner scope drifted for ${item.caseId}`);
  }

  const selection = asSelection(item.context.selection);
  const expectedCaseId = comparisonCaseIdV2For({
    selectionRunId: manifest.selectionRunId,
    phase: "pre-activation",
    family: "MOD",
    comparisonId: D02_COMPARISON_ID,
    protectedReference: item.protectedReference,
    ownerScopeKind: "organization",
    ownerScopeId: item.protectedReferenceOwnerScopeId,
    legacyIdentityId: selection?.legacyIdentityId ?? null,
  });
  if (item.caseId !== expectedCaseId) failClosed(`case identity is not bound to owner and selection for ${item.caseId}`);
  const { checksum, ...unsigned } = item;
  if (!/^[a-f0-9]{64}$/u.test(checksum) ||
      checksumCanonicalBytes(serializeCanonical(unsigned)) !== checksum) {
    failClosed(`case checksum is invalid for ${item.caseId}`);
  }

  if (selection) {
    if (selection.sourceKind !== item.protectedReference.kind ||
        selection.sourceId !== item.protectedReference.id ||
        selection.ownerScopeKind !== item.protectedReferenceOwnerScopeKind ||
        selection.ownerScopeId !== item.protectedReferenceOwnerScopeId ||
        selection.mappingVersion.legacyIdentityId !== selection.legacyIdentityId) {
      failClosed(`case identity differs from its exact P7 selection for ${item.caseId}`);
    }
    const exactSelection = manifest.projection.selections.find((candidate) =>
      candidate.legacyIdentityId === selection.legacyIdentityId);
    if (!exactSelection || !serializeCanonical(exactSelection).equals(serializeCanonical(selection))) {
      failClosed(`case selection differs from the completed-manifest reader for ${item.caseId}`);
    }
  }

  const legacyValue = item.legacyObservation.status === "value" ? item.legacyObservation.value : null;
  const subject = subjectFrom(item.canonicalObservation);
  if (legacyValue && (legacyValue.id !== item.protectedReference.id ||
      legacyValue.kind !== "driver-group" && legacyValue.kind !== "node-type")) {
    failClosed(`D02 legacy observation is not a supported module identity for ${item.caseId}`);
  }
  if (subject && legacyValue) {
    const expectedKind = legacyValue.kind === "driver-group" ? "driver" : "node-type";
    if (subject.type !== expectedKind) failClosed(`D02 module/Subject kind mismatch for ${item.caseId}`);
  }

  if (item.result === "unqueryable/protected-reference-missing") {
    if (item.expectedDifference !== null || !text(item.unqueryableReason)) {
      failClosed(`unqueryable case lacks a closed blocker reason for ${item.caseId}`);
    }
    return;
  }
  if (item.unqueryableReason !== null) failClosed(`resolved case carries an unqueryable reason for ${item.caseId}`);
  const resolvedSelection = selection ?? failClosed(`resolved D02 case has no exact P7 selection: ${item.caseId}`);
  const resolvedSubject = subject ?? failClosed(`resolved D02 case has no Subject observation: ${item.caseId}`);
  if (!legacyValue || item.legacyObservation.status !== "value" ||
      item.canonicalObservation.status !== "value") {
    return failClosed(`resolved D02 case has an incomplete source or Subject observation for ${item.caseId}`);
  }
  const legacyObservation = item.legacyObservation;
  const canonicalObservation = item.canonicalObservation;
  if (legacyObservation.status !== "value" || canonicalObservation.status !== "value") {
    return failClosed(`resolved D02 observation changed for ${item.caseId}`);
  }
  const observationsEqual = serializeCanonical(legacyObservation.value)
    .equals(serializeCanonical(canonicalObservation.value));
  if (item.result === "exact-equivalent") {
    if (!observationsEqual || item.expectedDifference !== null) {
      failClosed(`exact-equivalent D02 evidence is inconsistent for ${item.caseId}`);
    }
    return;
  }
  if (item.result === "declared-expected-difference") {
    const expected = item.expectedDifference;
    if (observationsEqual || !expected || expected.rClass !== resolvedSelection.rClass ||
        expected.mappingVersionId !== resolvedSelection.mappingVersion.id ||
        expected.ruleId !== D02_COMPARISON_ID || expected.planPin !== manifest.planDigest ||
        resolvedSelection.mappingVersion.targetKind !== "catalog-subject" ||
        resolvedSelection.mappingVersion.targetId !== resolvedSubject.id ||
        expected.typedTarget?.kind !== "catalog-subject" || expected.typedTarget.id !== resolvedSubject.id ||
        expected.Archive !== undefined) {
      failClosed(`D02 expected difference is not tied to the exact selected Subject for ${item.caseId}`);
    }
    return;
  }
  if (item.result === "unexplained-difference" && !observationsEqual && item.expectedDifference === null &&
      resolvedSelection.disposition === "archived" &&
      (resolvedSelection.rClass === "R1" || resolvedSelection.rClass === "R10") &&
      resolvedSelection.mappingVersion.rClass === resolvedSelection.rClass &&
      text(resolvedSelection.mappingVersion.archiveId) &&
      resolvedSelection.mappingVersion.targetKind === null &&
      resolvedSelection.mappingVersion.targetId === null) return;
  failClosed(`unsupported D02 case result for ${item.caseId}`);
};

export const assertModD02CapturableBatch = (batch: ComparisonCaseBatchV2, manifest: CompletedMappingManifest): void => {
  if (batch.contractVersion !== "pcat-comparison-case-batch/v2" ||
      batch.family !== "MOD" || batch.comparisonId !== D02_COMPARISON_ID ||
      batch.phase !== "pre-activation" ||
      batch.selectionRunId !== manifest.selectionRunId ||
      batch.selectionProjectionDigest !== manifest.projection.digest ||
      batch.selectionProjectionCount !== manifest.projection.selectionCount ||
      batch.organizationId !== manifest.projection.organizationId ||
      !Number.isSafeInteger(batch.sourceInventoryCount) ||
      batch.sourceInventoryCount !== batch.inventory.length ||
      batch.cases.length === 0) {
    failClosed("MOD D02 case batch contract or organization projection is incomplete");
  }
  const expectedModSelections = manifest.projection.selections
    .filter((selection) => selection.sourceKind === "parameter-module")
    .map((selection) => selection.legacyIdentityId)
    .sort(sortText);
  if (new Set(batch.modSelectionIdentityIds).size !== batch.modSelectionIdentityIds.length ||
      !serializeCanonical([...batch.modSelectionIdentityIds].sort(sortText))
        .equals(serializeCanonical(expectedModSelections))) {
    failClosed("MOD D02 selection identity set differs from the completed manifest projection");
  }
  const inventoryIds = new Set<string>();
  for (const inventoryItem of batch.inventory) {
    if (inventoryItem.ownerScopeKind !== "organization" ||
        inventoryItem.ownerScopeId !== batch.organizationId ||
        inventoryItem.kind !== "parameter-module" || !text(inventoryItem.id)) {
      failClosed("MOD D02 source inventory contains an invalid or out-of-scope identity");
    }
    const key = keyOf(inventoryItem);
    if (inventoryIds.has(key)) failClosed(`MOD D02 source inventory repeats ${inventoryItem.id}`);
    inventoryIds.add(key);
  }
  if (inventoryChecksum(batch.inventory) !== batch.sourceInventoryChecksum) {
    failClosed("MOD D02 source inventory checksum does not match its complete inventory");
  }

  const selectionsBySource = new Map<string, ComparisonCaseSelectionV2[]>();
  for (const selection of manifest.projection.selections) {
    if (selection.sourceKind !== "parameter-module") continue;
    const key = keyOf({
      kind: selection.sourceKind,
      id: selection.sourceId,
      ownerScopeKind: selection.ownerScopeKind,
      ownerScopeId: selection.ownerScopeId,
    });
    const existing = selectionsBySource.get(key) ?? [];
    selectionsBySource.set(key, [...existing, selection]);
  }
  const casesBySource = new Map<string, ComparisonCaseContributionV2[]>();
  const caseIds = new Set<string>();
  const selectedIds = new Set<string>();
  for (const item of batch.cases) {
    assertCaseContribution(item, manifest, batch);
    if (caseIds.has(item.caseId)) failClosed(`MOD D02 batch repeats case ${item.caseId}`);
    caseIds.add(item.caseId);
    const key = keyOf({
      kind: item.protectedReference.kind,
      id: item.protectedReference.id,
      ownerScopeKind: item.protectedReferenceOwnerScopeKind,
      ownerScopeId: item.protectedReferenceOwnerScopeId,
    });
    const existing = casesBySource.get(key) ?? [];
    casesBySource.set(key, [...existing, item]);
    const selection = asSelection(item.context.selection);
    if (selection) {
      if (selectedIds.has(selection.legacyIdentityId)) failClosed(`MOD D02 case set repeats selection ${selection.legacyIdentityId}`);
      selectedIds.add(selection.legacyIdentityId);
    }
  }
  if (!serializeCanonical([...selectedIds].sort(sortText)).equals(serializeCanonical(expectedModSelections))) {
    failClosed("MOD D02 cases do not represent every selected parameter-module identity exactly once");
  }
  let expectedCaseCount = 0;
  for (const inventoryItem of batch.inventory) {
    const key = keyOf(inventoryItem);
    const expectedCount = selectionsBySource.get(key)?.length ?? 1;
    if ((casesBySource.get(key)?.length ?? 0) !== expectedCount) {
      failClosed(`MOD D02 case set is incomplete for source inventory identity ${inventoryItem.id}`);
    }
    expectedCaseCount += expectedCount;
  }
  for (const [key, selections] of selectionsBySource) {
    if (inventoryIds.has(key)) continue;
    if ((casesBySource.get(key)?.length ?? 0) !== selections.length) {
      failClosed("MOD D02 selection without a current module was dropped from the case set");
    }
    expectedCaseCount += selections.length;
  }
  if (expectedCaseCount !== batch.cases.length) failClosed("MOD D02 case set contains an unbound case");

  const expectedBlockers = batch.cases
    .filter((item) => item.result === "unqueryable/protected-reference-missing")
    .map((item) => `${item.caseId}:${queryFailureDetail(item)}`);
  if (!serializeCanonical(expectedBlockers).equals(serializeCanonical(batch.blockers))) {
    failClosed("MOD D02 blocker inventory differs from per-case observations");
  }
  if (batch.blockers.length > 0 || batch.cases.some((item) =>
    item.result === "unqueryable/protected-reference-missing")) {
    failClosed(`MOD D02 full organization inventory has ${batch.blockers.length} unqueryable case(s): ${batch.blockers.join(",")}`);
  }
};

const inventoryFor = (
  modules: readonly { readonly id: string }[],
  organizationId: string,
): ComparisonCaseInventoryV2[] => modules
  .map((module) => ({
    kind: "parameter-module",
    id: module.id,
    ownerScopeKind: "organization" as const,
    ownerScopeId: organizationId,
  }))
  .sort((left, right) => sortText(left.id, right.id));

const invocationScope = (value: TrustedInvocationContext): { organizationId: string; principalId: string } => {
  const invocation = assertTrustedInvocationContext(value);
  if (invocation.initiator === "user") {
    return {
      organizationId: invocation.principal.organization.id,
      principalId: invocation.principal.user.id,
    };
  }
  return failClosed("MOD D02 write requires a user invocation");
};

const assertPersistedOrganizationAdmin = (
  auth: AuthContext,
  scope: { readonly organizationId: string; readonly principalId: string },
): void => {
  if (auth.organization.id !== scope.organizationId || auth.user.id !== scope.principalId ||
      auth.user.organizationId !== scope.organizationId || !auth.user.isActive ||
      !auth.roles.some((role) => role.projectId === null &&
        (role.roleId === "admin" || role.roleId === "platform-admin"))) {
    failClosed("persisted principal is not authorized for this organization projection");
  }
};

const lockAndReadPersistedAuth = async (
  tx: Database,
  input: WriteModComparisonCaseBatchV2Input,
  scope: { readonly organizationId: string; readonly principalId: string },
): Promise<AuthContext> => {
  const user = await tx.query<{ id: string }>(
    "select id from public.users where id = $1 and organization_id = $2 for share",
    [scope.principalId, scope.organizationId],
  );
  if (user.rows.length !== 1) failClosed("persisted user is missing from the requested organization");
  const bindings = await tx.query<{ id: string }>(
    "select id from public.user_role_bindings where user_id = $1 and organization_id = $2 for share",
    [scope.principalId, scope.organizationId],
  );
  if (bindings.rows.length === 0) failClosed("persisted user has no organization role binding");
  const auth = await getAuthContextForExternalIdentity(tx, {
    organizationId: scope.organizationId,
    subject: scope.principalId,
  });
  assertTrustedInvocationMatchesAuth(auth, input.invocation, "MOD D02 protected write");
  assertPersistedOrganizationAdmin(auth, scope);
  return auth;
};

const selectedSubjectId = (item: ComparisonCaseContributionV2): string => {
  const subject = subjectFrom(item.canonicalObservation);
  if (!subject || subject.lifecycle !== "active") return failClosed(`active Catalog Subject is unavailable for ${item.caseId}`);
  return subject.id;
};

const verifyLockedGovernanceAssociations = async (
  tx: Database,
  batch: ComparisonCaseBatchV2,
): Promise<void> => {
  const modules = batch.inventory.map((item) => item.id);
  const result = await tx.query<{
    registration_id: string;
    subject_id: string;
    registration_status: string;
    registration_method: string;
    placement_id: string | null;
    module_id: string | null;
  }>(
    `select registration.id as registration_id,
            registration.subject_id,
            registration.status as registration_status,
            registration.registration_method,
            placement.id as placement_id,
            placement.module_id
       from parameter_catalog.organization_subject_registrations registration
       left join parameter_catalog.subject_placements placement
         on placement.id = registration.current_placement_id
        and placement.organization_id = registration.organization_id
      where registration.organization_id = $1
      order by registration.id`,
    [batch.organizationId],
  );
  const byModule = new Map<string, typeof result.rows>();
  for (const row of result.rows) {
    if (!row.module_id || !modules.includes(row.module_id)) continue;
    const existing = byModule.get(row.module_id) ?? [];
    byModule.set(row.module_id, [...existing, row]);
  }
  for (const moduleId of modules) {
    const moduleCases = batch.cases.filter((item) => item.protectedReference.id === moduleId &&
      item.protectedReferenceOwnerScopeId === batch.organizationId &&
      item.protectedReference.kind === "parameter-module");
    const rows = byModule.get(moduleId) ?? [];
    if (rows.length !== 1 || moduleCases.length === 0) {
      failClosed(`scoped Registration/Placement changed or is ambiguous for module ${moduleId}`);
    }
    const row = rows[0]!;
    for (const item of moduleCases) {
      if (item.canonicalObservation.status !== "value") {
        return failClosed(`scoped Registration/Placement is not queryable for module ${moduleId}`);
      }
      const observation = item.canonicalObservation;
      if (observation.status !== "value") return failClosed(`scoped Registration/Placement is unavailable for module ${moduleId}`);
      const association = observation.value.association;
      const subject = subjectFrom(item.canonicalObservation);
      if (!association || typeof association !== "object" ||
          (association as Record<string, unknown>).registrationId !== row.registration_id ||
          (association as Record<string, unknown>).placementId !== row.placement_id ||
          (association as Record<string, unknown>).moduleId !== row.module_id ||
          (association as Record<string, unknown>).registrationStatus !== row.registration_status ||
          (association as Record<string, unknown>).registrationMethod !== row.registration_method ||
          row.registration_status !== "active" ||
          subject?.id !== row.subject_id || !row.placement_id) {
        failClosed(`scoped Registration/Placement no longer matches the pinned provider result for ${moduleId}`);
      }
    }
  }
};

const verifyLockedLegacyObservations = (
  modules: readonly ParameterModuleDto[],
  batch: ComparisonCaseBatchV2,
): void => {
  const byId = new Map(modules.map((module) => [module.id, module]));
  for (const item of batch.cases) {
    if (item.protectedReference.kind !== "parameter-module" ||
        item.protectedReferenceOwnerScopeId !== batch.organizationId ||
        item.legacyObservation.status !== "value") {
      return failClosed(`MOD source observation is no longer available for ${item.caseId}`);
    }
    const module = byId.get(item.protectedReference.id);
    if (!module) {
      return failClosed(`MOD source observation is no longer available for ${item.caseId}`);
    }
    const observation = item.legacyObservation.value;
    const lockedValue = {
      id: module.id,
      kind: module.kind,
      origin: module.origin,
      parentId: module.parentId,
      attributionSubjectId: module.attributionSubjectId,
      sourceKey: module.sourceKey,
    };
    if (!serializeCanonical(observation).equals(serializeCanonical(lockedValue))) {
      failClosed(`MOD source observation changed between provider read and protected write for ${item.caseId}`);
    }
  }
};

const insertOrVerifyCase = async (
  tx: Database,
  item: ComparisonCaseContributionV2,
  manifest: CompletedMappingManifest,
): Promise<{ readonly caseInserted: boolean; readonly resultInserted: boolean }> => {
  const selection = asSelection(item.context.selection) ??
    failClosed(`case has no exact manifest selection: ${item.caseId}`);
  const evidence = JSON.stringify(item);
  const caseInsert = await tx.query<{ id: string }>(
    `insert into parameter_catalog.parameter_catalog_comparison_cases (
       id, cutover_run_id, gate_id, consumer_family, case_key, protected_reference,
       comparison_phase, protected_reference_kind, protected_reference_id,
       protected_reference_owner_scope_kind, protected_reference_owner_scope_id
     ) values ($1,$2,$3,$4,$5,true,$6,$7,$8,$9,$10)
     on conflict (id) do nothing
     returning id`,
    [item.caseId, manifest.selectionRunId, D02_GATE_ID, "MOD", item.caseId,
      item.context.phase, item.protectedReference.kind, item.protectedReference.id,
      item.protectedReferenceOwnerScopeKind, item.protectedReferenceOwnerScopeId],
  );
  const caseMatch = await tx.query<{ id: string }>(
    `select id from parameter_catalog.parameter_catalog_comparison_cases
      where id = $1 and cutover_run_id = $2 and gate_id = $3 and consumer_family = $4
        and case_key = $5 and protected_reference is true and comparison_phase = $6
        and protected_reference_kind = $7 and protected_reference_id = $8
        and protected_reference_owner_scope_kind = $9
        and protected_reference_owner_scope_id = $10`,
    [item.caseId, manifest.selectionRunId, D02_GATE_ID, "MOD", item.caseId,
      item.context.phase, item.protectedReference.kind, item.protectedReference.id,
      item.protectedReferenceOwnerScopeKind, item.protectedReferenceOwnerScopeId],
  );
  if (caseMatch.rows.length !== 1) failClosed(`case ID is already bound to different evidence: ${item.caseId}`);

  const isDeclared = item.result === "declared-expected-difference";
  const resultInsert = await tx.query<{ comparison_case_id: string }>(
    `insert into parameter_catalog.parameter_catalog_comparison_results (
       comparison_case_id, outcome, mapping_version_id, rule_id, evidence,
       selection_run_id, selection_plan_digest, selection_catalog_release_id,
       selection_catalog_release_digest, selection_manifest_digest,
       selection_p7_checkpoint_digest, selection_legacy_identity_id,
       selection_mapping_version_id
     ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (comparison_case_id) do nothing
     returning comparison_case_id`,
    [item.caseId, item.result,
      isDeclared ? selection.mappingVersion.id : null,
      isDeclared ? item.expectedDifference?.ruleId ?? null : null,
      evidence,
      manifest.selectionRunId,
      manifest.planDigest,
      manifest.catalogRelease.id,
      manifest.catalogRelease.digest,
      manifest.fullRunDigest,
      manifest.p7CheckpointDigest,
      selection.legacyIdentityId,
      selection.mappingVersion.id],
  );
  const resultMatch = await tx.query<{ comparison_case_id: string }>(
    `select comparison_case_id
       from parameter_catalog.parameter_catalog_comparison_results
      where comparison_case_id = $1 and outcome = $2
        and mapping_version_id is not distinct from $3 and rule_id is not distinct from $4
        and evidence = $5::jsonb and selection_run_id = $6
        and selection_plan_digest = $7 and selection_catalog_release_id = $8
        and selection_catalog_release_digest = $9 and selection_manifest_digest = $10
        and selection_p7_checkpoint_digest = $11 and selection_legacy_identity_id = $12
        and selection_mapping_version_id = $13`,
    [item.caseId, item.result,
      isDeclared ? selection.mappingVersion.id : null,
      isDeclared ? item.expectedDifference?.ruleId ?? null : null,
      evidence,
      manifest.selectionRunId,
      manifest.planDigest,
      manifest.catalogRelease.id,
      manifest.catalogRelease.digest,
      manifest.fullRunDigest,
      manifest.p7CheckpointDigest,
      selection.legacyIdentityId,
      selection.mappingVersion.id],
  );
  if (resultMatch.rows.length !== 1) failClosed(`result key is already bound to different evidence: ${item.caseId}`);
  return {
    caseInserted: (caseInsert.rowCount ?? 0) === 1,
    resultInserted: (resultInsert.rowCount ?? 0) === 1,
  };
};

/** Protected, organization-scoped MOD D02 writer. It cannot accept caller-built contributions. */
export async function writeModParameterCatalogComparisonCasesV2(
  input: WriteModComparisonCaseBatchV2Input,
): Promise<WriteModComparisonCaseBatchV2Result> {
  const scope = invocationScope(input.invocation);
  if (getRootPostgresPool(input.database) !== input.pool) {
    failClosed("database and pool are not the same root connection");
  }
  if (!input.runId || input.phase !== "pre-activation") {
    failClosed("run, phase, and persisted organization identity are required");
  }

  const providers = createProductionComparisonCaseProvidersV2();
  if (providers.length !== 1 || providers[0]?.family !== "MOD" ||
      providers[0].comparisonIds.length !== 1 ||
      providers[0].comparisonIds[0] !== D02_COMPARISON_ID ||
      providers[0].coverage !== "organization-projection") {
    failClosed("scoped MOD D02 provider registration drifted");
  }
  const batch = await providers[0].provide(input);
  const manifestScope = await readCompletedModComparisonManifestForComparison(input);
  const authBeforeWrite = manifestScope.auth;
  assertTrustedInvocationMatchesAuth(authBeforeWrite, input.invocation, "MOD D02 protected write");
  assertPersistedOrganizationAdmin(authBeforeWrite, scope);
  const manifest = manifestScope.manifest;
  assertModD02CapturableBatch(batch, manifest);

  let newlyWrittenCount = 0;
  await input.database.transaction(async (tx) => {
    const auth = await lockAndReadPersistedAuth(tx, input, scope);
    const pin = {
      id: CatalogReleaseId(manifest.catalogRelease.id),
      digest: CatalogReleaseDigest(manifest.catalogRelease.digest),
    };
    const subjectIds = [...new Set(batch.cases.map(selectedSubjectId))].sort(sortText);
    for (const subjectId of subjectIds) {
      await tx.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, 'active')",
        [pin.id, pin.digest, subjectId],
      );
    }
    await tx.query(
      "lock table public.parameter_modules, parameter_catalog.organization_subject_registrations, parameter_catalog.subject_placements in share mode",
    );

    const registry = await readRegistry(tx, auth.organization.id, null);
    const lockedInventory = inventoryFor(registry.modules, scope.organizationId);
    if (lockedInventory.length !== batch.sourceInventoryCount ||
        inventoryChecksum(lockedInventory) !== batch.sourceInventoryChecksum) {
      failClosed("MOD source inventory changed between provider read and protected write transaction");
    }
    verifyLockedLegacyObservations(registry.modules, batch);
    await verifyLockedGovernanceAssociations(tx, batch);

    for (const item of batch.cases) {
      const written = await insertOrVerifyCase(tx, item, manifest);
      if (written.caseInserted && written.resultInserted) newlyWrittenCount += 1;
      else if (written.caseInserted !== written.resultInserted) {
        failClosed(`case/result idempotency state is incomplete for ${item.caseId}`);
      }
    }
    await tx.query("set constraints all immediate");
  });

  const selectionStatusCounts = batch.cases.reduce(
    (counts, item) => {
      const selection = asSelection(item.context.selection);
      if (selection?.status === "appended") counts.appended += 1;
      else if (selection?.status === "replayed") counts.replayed += 1;
      return counts;
    },
    { appended: 0, replayed: 0 },
  );
  return {
    contractVersion: "pcat-comparison-case-write/v2",
    family: "MOD",
    comparisonId: D02_COMPARISON_ID,
    phase: "pre-activation",
    organizationId: scope.organizationId,
    selectionRunId: manifest.selectionRunId,
    selectionProjectionDigest: manifest.projection.digest,
    coverage: "organization-projection",
    sourceInventoryCount: batch.sourceInventoryCount,
    sourceInventoryChecksum: batch.sourceInventoryChecksum,
    caseCount: batch.cases.length,
    newlyWrittenCount,
    replayedWriteCount: batch.cases.length - newlyWrittenCount,
    selectionStatusCounts,
    fullReport: {
      available: false,
      reason: "eleven-family-and-nine-gate-coverage-not-collected",
    },
    caseIds: batch.cases.map((item) => item.caseId),
  };
}
