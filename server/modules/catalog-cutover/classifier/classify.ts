import { createHash } from "node:crypto";

import {
  serializeContract,
  type ContractJsonValue,
  type Result,
} from "../../parameter-catalog-contract/index";
import {
  CLASSIFIER_RULE_IDS,
  CLASSIFIER_VERSION,
  DISPOSITION_BY_R_CLASS,
  emptyClassCounts,
  isLegacyScaffoldingModuleName,
  isStructuralDtsPropertyKey,
  mappingClassForSourceKind,
} from "./rules";
import type {
  ClassificationAssignment,
  ClassificationBlocker,
  ClassificationFailure,
  ClassificationResult,
  ConservationTotals,
  FrozenBinding,
  FrozenDriverSchema,
  FrozenDtsProperty,
  FrozenLegacyIdentity,
  FrozenModule,
  FrozenP0Graph,
  FrozenPlacement,
  FrozenSpec,
  FrozenSpecVersion,
  FrozenSubject,
  OwnerScopeKind,
  PrimaryDisposition,
  RClass,
} from "./types";

type Owner = { kind: OwnerScopeKind; id: string };

type GraphIndex = {
  specById: Map<string, FrozenSpec>;
  versionsBySpecId: Map<string, FrozenSpecVersion[]>;
  versionById: Map<string, FrozenSpecVersion>;
  dtsBySpecId: Map<string, FrozenDtsProperty[]>;
  schemasByRootSpecId: Map<string, FrozenDriverSchema[]>;
  schemaById: Map<string, FrozenDriverSchema>;
  schemaVersionsBySchemaId: Map<string, { lifecycle: string }[]>;
  subjectById: Map<string, FrozenSubject>;
  driverRegistrationSubjects: Set<string>;
  nodeTypeSubjects: Set<string>;
  placementsBySubjectId: Map<string, FrozenPlacement[]>;
  modulesBySubjectId: Map<string, FrozenModule[]>;
  bindingsBySpecId: Map<string, FrozenBinding[]>;
  moduleById: Map<string, FrozenModule>;
  bindingById: Map<string, FrozenBinding>;
  duplicateActiveSpecIds: Set<string>;
};

const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
};

const sortById = <Row extends { readonly id: string }>(rows: readonly Row[]): Row[] =>
  [...rows].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

const groupBy = <Row>(
  rows: readonly Row[],
  keyOf: (row: Row) => string | null,
): Map<string, Row[]> => {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
};

export const canonicalizeP0Graph = (graph: FrozenP0Graph): FrozenP0Graph => ({
  catalog: "parameter-catalog-p0-graph",
  identities: sortById(graph.identities),
  specs: sortById(graph.specs),
  specVersions: sortById(graph.specVersions),
  subjects: sortById(graph.subjects),
  driverRegistrations: [...graph.driverRegistrations].sort((left, right) =>
    left.attributionSubjectId < right.attributionSubjectId ? -1 : 1,
  ),
  nodeTypeDefinitions: [...graph.nodeTypeDefinitions].sort((left, right) =>
    left.attributionSubjectId < right.attributionSubjectId ? -1 : 1,
  ),
  driverSchemas: sortById(graph.driverSchemas),
  driverSchemaVersions: sortById(graph.driverSchemaVersions),
  dtsPropertySpecs: sortById(graph.dtsPropertySpecs),
  modules: sortById(graph.modules),
  placements: sortById(graph.placements),
  bindings: sortById(graph.bindings),
  bindingRevisions: sortById(graph.bindingRevisions),
});

export const fingerprintP0Graph = (graph: FrozenP0Graph): string => {
  const canonical = canonicalizeP0Graph(graph);
  const digest = createHash("sha256")
    .update(serializeContract(canonical as unknown as ContractJsonValue))
    .digest("hex");
  return `sha256:${digest}`;
};

const ownerOfNullableOrg = (organizationId: string | null): Owner =>
  organizationId === null
    ? { kind: "platform", id: "platform" }
    : { kind: "organization", id: organizationId };

const ownersEqual = (left: Owner, right: Owner): boolean =>
  left.kind === right.kind && left.id === right.id;

const indexGraph = (graph: FrozenP0Graph): GraphIndex => {
  const versionsBySpecId = groupBy(graph.specVersions, (row) => row.parameterSpecId);
  const dtsBySpecId = groupBy(graph.dtsPropertySpecs, (row) => row.parameterSpecId);
  const schemasByRootSpecId = groupBy(graph.driverSchemas, (row) => row.parameterSpecId);
  const schemaVersionsBySchemaId = groupBy(
    graph.driverSchemaVersions,
    (row) => row.driverSchemaId,
  );
  const placementsBySubjectId = groupBy(graph.placements, (row) => row.attributionSubjectId);
  const modulesBySubjectId = groupBy(graph.modules, (row) => row.attributionSubjectId);
  const bindingsBySpecId = groupBy(graph.bindings, (row) => row.parameterSpecId);

  const activeIdentityKey = (spec: FrozenSpec): string | null => {
    if (spec.definitionLifecycle !== "active" || spec.propertyKey === null) return null;
    const owner = ownerOfNullableOrg(spec.organizationId);
    return `${owner.kind}\0${owner.id}\0${spec.attributionSubjectId ?? ""}\0${spec.propertyKey}`;
  };
  const duplicateActiveSpecIds = new Set<string>();
  const activeGroups = new Map<string, FrozenSpec[]>();
  for (const spec of graph.specs) {
    const key = activeIdentityKey(spec);
    if (key === null) continue;
    const list = activeGroups.get(key);
    if (list) list.push(spec);
    else activeGroups.set(key, [spec]);
  }
  for (const group of activeGroups.values()) {
    if (group.length > 1) {
      for (const spec of group) duplicateActiveSpecIds.add(spec.id);
    }
  }

  return {
    specById: new Map(graph.specs.map((spec) => [spec.id, spec])),
    versionsBySpecId,
    versionById: new Map(graph.specVersions.map((version) => [version.id, version])),
    dtsBySpecId,
    schemasByRootSpecId,
    schemaById: new Map(graph.driverSchemas.map((schema) => [schema.id, schema])),
    schemaVersionsBySchemaId,
    subjectById: new Map(graph.subjects.map((subject) => [subject.id, subject])),
    driverRegistrationSubjects: new Set(
      graph.driverRegistrations.map((row) => row.attributionSubjectId),
    ),
    nodeTypeSubjects: new Set(
      graph.nodeTypeDefinitions.map((row) => row.attributionSubjectId),
    ),
    placementsBySubjectId,
    modulesBySubjectId,
    bindingsBySpecId,
    moduleById: new Map(graph.modules.map((module) => [module.id, module])),
    bindingById: new Map(graph.bindings.map((binding) => [binding.id, binding])),
    duplicateActiveSpecIds,
  };
};

const activeCurrentVersions = (
  index: GraphIndex,
  specId: string,
): FrozenSpecVersion[] =>
  (index.versionsBySpecId.get(specId) ?? []).filter(
    (version) => version.versionStatus === "active" && version.lifecycle === "active",
  );

const isDriverSchemaRootSpec = (index: GraphIndex, specId: string): boolean => {
  const schemas = index.schemasByRootSpecId.get(specId) ?? [];
  if (schemas.length === 0) return false;
  const dtsRows = index.dtsBySpecId.get(specId) ?? [];
  return dtsRows.length === 0;
};

const schemaHasActiveRevision = (index: GraphIndex, schemaId: string): boolean =>
  (index.schemaVersionsBySchemaId.get(schemaId) ?? []).some(
    (version) => version.lifecycle === "active",
  );

type Contradiction = { invariant: string } | null;

const specOwnerMismatch = (
  index: GraphIndex,
  spec: FrozenSpec,
): Contradiction => {
  const specOwner = ownerOfNullableOrg(spec.organizationId);
  if (spec.attributionSubjectId !== null) {
    const subject = index.subjectById.get(spec.attributionSubjectId);
    if (!subject) {
      return { invariant: "missing-subject-parent" };
    }
    if (!ownersEqual(specOwner, ownerOfNullableOrg(subject.organizationId))) {
      return { invariant: "spec-subject-owner-mismatch" };
    }
  }
  for (const schema of index.schemasByRootSpecId.get(spec.id) ?? []) {
    if (!ownersEqual(specOwner, ownerOfNullableOrg(schema.organizationId))) {
      return { invariant: "spec-schema-owner-mismatch" };
    }
    if (schema.attributionSubjectId !== null) {
      const schemaSubject = index.subjectById.get(schema.attributionSubjectId);
      if (!schemaSubject) {
        return { invariant: "missing-schema-subject-parent" };
      }
      if (!ownersEqual(specOwner, ownerOfNullableOrg(schemaSubject.organizationId))) {
        return { invariant: "schema-subject-owner-mismatch" };
      }
    }
  }
  for (const dts of index.dtsBySpecId.get(spec.id) ?? []) {
    if (dts.driverSchemaId !== null) {
      const schema = index.schemaById.get(dts.driverSchemaId);
      if (!schema) {
        return { invariant: "missing-dts-schema-parent" };
      }
      if (!ownersEqual(specOwner, ownerOfNullableOrg(schema.organizationId))) {
        return { invariant: "spec-linked-schema-owner-mismatch" };
      }
    }
    if (
      spec.propertyKey !== null &&
      dts.propertyKey !== spec.propertyKey
    ) {
      return { invariant: "spec-dts-property-key-mismatch" };
    }
  }
  for (const binding of index.bindingsBySpecId.get(spec.id) ?? []) {
    if (!ownersEqual(specOwner, { kind: "organization", id: binding.organizationId })) {
      return { invariant: "spec-binding-owner-mismatch" };
    }
    const module = index.moduleById.get(binding.moduleId);
    if (!module) {
      return { invariant: "missing-binding-module-parent" };
    }
    if (!ownersEqual({ kind: "organization", id: module.organizationId }, {
      kind: "organization",
      id: binding.organizationId,
    })) {
      return { invariant: "binding-module-owner-mismatch" };
    }
  }
  if (index.duplicateActiveSpecIds.has(spec.id)) {
    return { invariant: "duplicate-active-identity" };
  }
  if (activeCurrentVersions(index, spec.id).length > 1) {
    return { invariant: "multiple-active-current-revisions" };
  }
  return null;
};

const bindingRevisionOwnedByOtherSpec = (
  graph: FrozenP0Graph,
  index: GraphIndex,
  specId: string,
): boolean => {
  for (const revision of graph.bindingRevisions) {
    const binding = index.bindingById.get(revision.bindingId);
    if (!binding || binding.parameterSpecId !== specId) continue;
    const version = index.versionById.get(revision.parameterSpecVersionId);
    if (!version) return true;
    if (version.parameterSpecId !== specId) return true;
  }
  return false;
};

const contradictionForSpec = (
  graph: FrozenP0Graph,
  index: GraphIndex,
  spec: FrozenSpec,
): Contradiction => {
  const mismatch = specOwnerMismatch(index, spec);
  if (mismatch) return mismatch;
  if (bindingRevisionOwnedByOtherSpec(graph, index, spec.id)) {
    return { invariant: "binding-revision-owned-by-other-spec" };
  }
  return null;
};

const hasProtectedDependency = (index: GraphIndex, specId: string): boolean =>
  (index.bindingsBySpecId.get(specId) ?? []).length > 0;

const isDisposableScaffoldSpec = (index: GraphIndex, spec: FrozenSpec): boolean => {
  if (hasProtectedDependency(index, spec.id)) return false;
  const keys = [
    spec.propertyKey,
    ...(index.dtsBySpecId.get(spec.id) ?? []).map((row) => row.propertyKey),
  ].filter((key): key is string => key !== null);
  return keys.some((key) => isStructuralDtsPropertyKey(key));
};

const isProvableDriverSchemaRoot = (index: GraphIndex, spec: FrozenSpec): boolean => {
  if (!isDriverSchemaRootSpec(index, spec.id)) return false;
  const schemas = index.schemasByRootSpecId.get(spec.id) ?? [];
  const subjects = schemas.map((schema) => schema.attributionSubjectId);
  if (subjects.some((subjectId) => subjectId === null)) return false;
  const unique = new Set(subjects);
  if (unique.size !== 1) return false;
  const subjectId = subjects[0];
  if (subjectId === null) return false;
  const subject = index.subjectById.get(subjectId);
  if (!subject) return false;
  const specOwner = ownerOfNullableOrg(spec.organizationId);
  if (!ownersEqual(specOwner, ownerOfNullableOrg(subject.organizationId))) return false;
  if (spec.attributionSubjectId !== null && spec.attributionSubjectId !== subjectId) {
    return false;
  }
  return schemas.every((schema) =>
    ownersEqual(specOwner, ownerOfNullableOrg(schema.organizationId)),
  );
};

const linkedDts = (index: GraphIndex, specId: string): FrozenDtsProperty | null => {
  const rows = index.dtsBySpecId.get(specId) ?? [];
  const linked = rows.filter((row) => row.driverSchemaId !== null);
  return linked.length === 1 ? linked[0] ?? null : null;
};

const isCompleteDtsProperty = (
  index: GraphIndex,
  spec: FrozenSpec,
  expectedSubjectKind: FrozenSubject["subjectKind"],
): boolean => {
  if (spec.definitionLifecycle !== "active") return false;
  const dts = linkedDts(index, spec.id);
  if (!dts || dts.driverSchemaId === null) return false;
  if (spec.propertyKey === null || spec.propertyKey !== dts.propertyKey) return false;
  if (spec.attributionSubjectId === null) return false;
  const subject = index.subjectById.get(spec.attributionSubjectId);
  if (!subject || subject.subjectKind !== expectedSubjectKind) return false;
  const specOwner = ownerOfNullableOrg(spec.organizationId);
  if (!ownersEqual(specOwner, ownerOfNullableOrg(subject.organizationId))) return false;
  const schema = index.schemaById.get(dts.driverSchemaId);
  if (!schema) return false;
  if (!ownersEqual(specOwner, ownerOfNullableOrg(schema.organizationId))) return false;
  if (schema.attributionSubjectId !== spec.attributionSubjectId) return false;
  if (activeCurrentVersions(index, spec.id).length !== 1) return false;
  if (!schemaHasActiveRevision(index, schema.id)) return false;
  if (expectedSubjectKind === "driver-registration") {
    if (!index.driverRegistrationSubjects.has(subject.id)) return false;
    const placements = index.placementsBySubjectId.get(subject.id) ?? [];
    return placements.length === 1;
  }
  if (!index.nodeTypeSubjects.has(subject.id)) return false;
  const nodeModules = (index.modulesBySubjectId.get(subject.id) ?? []).filter(
    (module) => module.kind === "node-type",
  );
  return nodeModules.length === 1;
};

const isUnlinkedDtsSurface = (index: GraphIndex, spec: FrozenSpec): boolean => {
  if (spec.sourceKind !== "dts") return false;
  if (isDriverSchemaRootSpec(index, spec.id)) return false;
  const rows = index.dtsBySpecId.get(spec.id) ?? [];
  return rows.some((row) => row.driverSchemaId === null);
};

const isActiveNonDtsPolicy = (index: GraphIndex, spec: FrozenSpec): boolean => {
  if (spec.sourceKind !== "manual" && spec.sourceKind !== "json") return false;
  if (spec.definitionLifecycle !== "active") return false;
  if (isDriverSchemaRootSpec(index, spec.id)) return false;
  if (linkedDts(index, spec.id) !== null) return false;
  return activeCurrentVersions(index, spec.id).length === 1;
};

const isLegacyDraftProposal = (spec: FrozenSpec): boolean =>
  (spec.sourceKind === "manual" || spec.sourceKind === "json") &&
  spec.definitionLifecycle === "draft";

const isHistoricalSpec = (spec: FrozenSpec): boolean =>
  spec.definitionLifecycle === "deprecated";

const classifySpec = (
  graph: FrozenP0Graph,
  index: GraphIndex,
  spec: FrozenSpec,
): { rClass: RClass; invariant: string | null } => {
  const contradiction = contradictionForSpec(graph, index, spec);
  if (contradiction) return { rClass: "R0", invariant: contradiction.invariant };
  if (isDisposableScaffoldSpec(index, spec)) return { rClass: "R1", invariant: null };
  if (isDriverSchemaRootSpec(index, spec.id)) {
    return isProvableDriverSchemaRoot(index, spec)
      ? { rClass: "R2", invariant: null }
      : { rClass: "R3", invariant: null };
  }
  if (isCompleteDtsProperty(index, spec, "driver-registration")) {
    return { rClass: "R4", invariant: null };
  }
  if (isCompleteDtsProperty(index, spec, "node-type-definition")) {
    return { rClass: "R5", invariant: null };
  }
  if (isUnlinkedDtsSurface(index, spec)) return { rClass: "R6", invariant: null };
  if (isActiveNonDtsPolicy(index, spec)) return { rClass: "R7", invariant: null };
  if (isLegacyDraftProposal(spec)) return { rClass: "R8", invariant: null };
  if (isHistoricalSpec(spec)) return { rClass: "R9", invariant: null };
  return { rClass: "R10", invariant: null };
};

const isCurrentVersionOfSpec = (
  index: GraphIndex,
  spec: FrozenSpec,
  version: FrozenSpecVersion,
): boolean => {
  const current = activeCurrentVersions(index, spec.id);
  if (spec.definitionLifecycle === "draft") {
    const drafts = (index.versionsBySpecId.get(spec.id) ?? []).filter(
      (row) => row.versionStatus === "draft" || row.lifecycle === "draft",
    );
    return drafts.length === 1 && drafts[0]?.id === version.id;
  }
  return current.length === 1 && current[0]?.id === version.id;
};

const classifyIdentity = (
  graph: FrozenP0Graph,
  index: GraphIndex,
  identity: FrozenLegacyIdentity,
): { rClass: RClass; invariant: string | null; propertyKey: string | null } => {
  if (identity.sourceKind === "parameter-spec") {
    const spec = index.specById.get(identity.sourceId);
    if (!spec) return { rClass: "R0", invariant: "missing-spec-parent", propertyKey: null };
    const classified = classifySpec(graph, index, spec);
    return { ...classified, propertyKey: spec.propertyKey };
  }

  if (identity.sourceKind === "parameter-spec-version") {
    const version = index.versionById.get(identity.sourceId);
    if (!version) {
      return { rClass: "R0", invariant: "missing-version-parent", propertyKey: null };
    }
    const spec = index.specById.get(version.parameterSpecId);
    if (!spec) return { rClass: "R0", invariant: "missing-spec-parent", propertyKey: null };
    const specClass = classifySpec(graph, index, spec);
    if (specClass.rClass === "R0") {
      return { ...specClass, propertyKey: spec.propertyKey };
    }
    if (!isCurrentVersionOfSpec(index, spec, version)) {
      return { rClass: "R9", invariant: null, propertyKey: spec.propertyKey };
    }
    return { ...specClass, propertyKey: spec.propertyKey };
  }

  if (identity.sourceKind === "driver-schema") {
    const schema = index.schemaById.get(identity.sourceId);
    if (!schema) {
      return { rClass: "R0", invariant: "missing-schema-parent", propertyKey: null };
    }
    const spec = index.specById.get(schema.parameterSpecId);
    if (!spec) return { rClass: "R0", invariant: "missing-spec-parent", propertyKey: null };
    return { ...classifySpec(graph, index, spec), propertyKey: spec.propertyKey };
  }

  if (identity.sourceKind === "parameter-module") {
    const module = index.moduleById.get(identity.sourceId);
    if (!module) {
      return { rClass: "R0", invariant: "missing-module-parent", propertyKey: null };
    }
    const hasBinding = graph.bindings.some((binding) => binding.moduleId === module.id);
    if (!hasBinding && isLegacyScaffoldingModuleName(module.name)) {
      return { rClass: "R1", invariant: null, propertyKey: null };
    }
    return { rClass: "R10", invariant: null, propertyKey: null };
  }

  if (
    identity.sourceKind === "parameter-history-entry" ||
    identity.sourceKind === "parameter-definition-reconciliation-run" ||
    identity.sourceKind === "parameter-definition-reconciliation-item" ||
    identity.sourceKind === "parameter-spec-version-cutover-run" ||
    identity.sourceKind === "parameter-spec-version-cutover-item" ||
    identity.sourceKind === "parameter-spec-property-key-cutover-run" ||
    identity.sourceKind === "parameter-spec-property-key-cutover-item" ||
    identity.sourceKind === "parameter-identity-migration-run" ||
    identity.sourceKind === "parameter-identity-migration-phase" ||
    identity.sourceKind === "parameter-identity-cutover" ||
    identity.sourceKind === "legacy-parameter-migration-evidence"
  ) {
    return { rClass: "R9", invariant: null, propertyKey: null };
  }

  return { rClass: "R10", invariant: null, propertyKey: null };
};

const conservationOf = (
  assignments: readonly ClassificationAssignment[],
  inputCount: number,
): ConservationTotals => {
  const classCounts = emptyClassCounts();
  const dispositionCounts = {
    blocked: 0,
    mapped: 0,
    archived: 0,
    "review-evidence": 0,
    "definition-proposal": 0,
  } satisfies { [K in PrimaryDisposition]: number };
  const seen = new Set<string>();
  let duplicatePrimaryCount = 0;
  for (const assignment of assignments) {
    if (seen.has(assignment.identityId)) duplicatePrimaryCount += 1;
    seen.add(assignment.identityId);
    classCounts[assignment.rClass] += 1;
    dispositionCounts[assignment.disposition] += 1;
  }
  const classifiedCount = assignments.length;
  return {
    inputCount,
    classifiedCount,
    duplicatePrimaryCount,
    classCounts,
    dispositionCounts,
    conserved:
      inputCount === classifiedCount &&
      duplicatePrimaryCount === 0 &&
      seen.size === classifiedCount,
  };
};

const validateGraph = (graph: FrozenP0Graph): ClassificationFailure | null => {
  if (graph.catalog !== "parameter-catalog-p0-graph") {
    return { code: "PCAT-CLASS-GRAPH-INVALID", detail: "P0 graph catalog marker is required" };
  }
  const ids = new Set<string>();
  for (const identity of graph.identities) {
    if (ids.has(identity.id)) {
      return {
        code: "PCAT-CLASS-DUPLICATE-PRIMARY",
        detail: `Duplicate source identity ${identity.id}`,
      };
    }
    ids.add(identity.id);
  }
  return null;
};

export const classifyFrozenP0Graph = (
  graph: FrozenP0Graph,
): Result<ClassificationResult, ClassificationFailure> => {
  const invalid = validateGraph(graph);
  if (invalid) return { ok: false, error: invalid };

  const canonical = canonicalizeP0Graph(graph);
  const graphFingerprint = fingerprintP0Graph(canonical);
  const index = indexGraph(canonical);
  const assignments: ClassificationAssignment[] = canonical.identities.map((identity) => {
    const classified = classifyIdentity(canonical, index, identity);
    return {
      identityId: identity.id,
      sourceKind: identity.sourceKind,
      sourceId: identity.sourceId,
      ownerScopeKind: identity.ownerScopeKind,
      ownerScopeId: identity.ownerScopeId,
      rClass: classified.rClass,
      ruleId: CLASSIFIER_RULE_IDS[classified.rClass],
      disposition: DISPOSITION_BY_R_CLASS[classified.rClass],
      mappingClass: mappingClassForSourceKind(identity.sourceKind),
      propertyKey: classified.propertyKey,
    };
  });

  const conservation = conservationOf(assignments, canonical.identities.length);
  if (!conservation.conserved) {
    return {
      ok: false,
      error: {
        code: "PCAT-CLASS-SOURCE-CONSERVATION",
        detail: `count(in)=${conservation.inputCount} count(classified)=${conservation.classifiedCount} duplicates=${conservation.duplicatePrimaryCount}`,
      },
    };
  }

  const identityById = new Map(
    canonical.identities.map((identity) => [identity.id, identity]),
  );
  const blockers: ClassificationBlocker[] = [];
  for (const assignment of assignments) {
    if (assignment.rClass !== "R0") continue;
    const identity = identityById.get(assignment.identityId);
    if (!identity) continue;
    const classified = classifyIdentity(canonical, index, identity);
    blockers.push({
      identityId: assignment.identityId,
      rClass: "R0",
      ruleId: CLASSIFIER_RULE_IDS.R0,
      disposition: "blocked",
      invariant: classified.invariant ?? "contradictory-or-cross-owner-graph",
      graphFingerprint,
    });
  }

  return {
    ok: true,
    value: deepFreeze({
      classifierVersion: CLASSIFIER_VERSION,
      graphFingerprint,
      conservation,
      blockers,
      assignments,
    }),
  };
};
