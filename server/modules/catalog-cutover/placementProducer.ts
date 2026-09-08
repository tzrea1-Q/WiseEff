import type pg from "pg";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogSubjectId,
} from "../parameter-catalog-contract/index";
import { digestOf } from "../release-verification/core/digest";
import {
  writeGuardedRegistration,
  type RegistrationWriterClient,
} from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import {
  DISPOSITION_BY_R_CLASS,
  type ClassificationAssignment,
  type ClassificationResult,
  type FrozenP0Graph,
} from "./classifier";
import { readCurrentMappingHead } from "./mapping";
import type { ConversionSourceRecord, ConversionSourceSnapshot } from "./conversionManifest";

export class PlacementProducerRefusal extends Error {}

const requireFact = (condition: unknown, reason: string): asserts condition => {
  if (!condition) throw new PlacementProducerRefusal(reason);
};

const payloadString = (record: ConversionSourceRecord, field: string): string | null => {
  const value = record.payload[field];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const identityFor = (
  graph: FrozenP0Graph,
  sourceKind: FrozenP0Graph["identities"][number]["sourceKind"],
  sourceId: string,
) => {
  const matches = graph.identities.filter(
    (identity) => identity.sourceKind === sourceKind && identity.sourceId === sourceId,
  );
  requireFact(matches.length === 1, `placement-${sourceKind}-identity-not-unique`);
  return matches[0]!;
};

const assignmentFor = (
  classification: ClassificationResult,
  identityId: string,
): ClassificationAssignment => {
  const matches = classification.assignments.filter(
    (assignment) => assignment.identityId === identityId,
  );
  requireFact(matches.length === 1, "placement-classification-assignment-not-unique");
  return matches[0]!;
};

const requireArchivedR10 = (
  classification: ClassificationResult,
  identityId: string,
  reason: string,
): ClassificationAssignment => {
  const assignment = assignmentFor(classification, identityId);
  requireFact(
    assignment.rClass === "R10" && assignment.disposition === DISPOSITION_BY_R_CLASS.R10,
    reason,
  );
  return assignment;
};

export type PlacementRegistrationPlan = {
  readonly sourcePlacementId: string;
  readonly sourcePlacementDigest: string;
  readonly organizationId: string;
  readonly sourceSubjectId: string;
  readonly driverSchemaIdentityId: string;
  readonly destinationModuleId: string;
};

/** Derive registration work only from the original graph and closed source
 * projection. This preserves R10 placement/module/subject identities as
 * archived evidence while using the independently mapped R2 driver schema
 * subject as the only operational target authority. */
export const derivePlacementRegistrationPlans = (input: {
  readonly snapshot: ConversionSourceSnapshot;
  readonly graph: FrozenP0Graph;
  readonly classification: ClassificationResult;
}): readonly PlacementRegistrationPlan[] => {
  const plans: PlacementRegistrationPlan[] = [];
  const placementRecords = input.snapshot.records
    .filter((record) => record.sourceKind === "parameter-placement")
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const graphPlacementIds = new Set(input.graph.placements.map((placement) => placement.id));
  const snapshotPlacementIds = new Set(placementRecords.map((record) => record.sourceId));
  requireFact(
    graphPlacementIds.size === snapshotPlacementIds.size &&
      [...graphPlacementIds].every((placementId) => snapshotPlacementIds.has(placementId)),
    "placement-source-graph-conservation",
  );

  for (const record of placementRecords) {
    const sourcePlacementId = payloadString(record, "id");
    const organizationId = payloadString(record, "organization_id");
    const sourceSubjectId = payloadString(record, "attribution_subject_id");
    const destinationModuleId = payloadString(record, "driver_group_module_id");
    requireFact(sourcePlacementId === record.sourceId, "placement-source-id-mismatch");
    requireFact(organizationId && sourceSubjectId && destinationModuleId, "placement-source-fk-missing");
    const graphPlacement = input.graph.placements.find((placement) => placement.id === sourcePlacementId);
    requireFact(
      graphPlacement &&
        graphPlacement.organizationId === organizationId &&
        graphPlacement.attributionSubjectId === sourceSubjectId &&
        graphPlacement.driverGroupModuleId === destinationModuleId,
      "placement-source-graph-row-mismatch",
    );

    const placementIdentity = identityFor(input.graph, "parameter-placement", sourcePlacementId);
    const placementAssignment = requireArchivedR10(
      input.classification,
      placementIdentity.id,
      "placement-must-remain-r10-archive",
    );
    requireFact(
      placementAssignment.ownerScopeKind === "organization" &&
        placementAssignment.ownerScopeId === organizationId,
      "placement-owner-scope-mismatch",
    );

    const subjects = input.graph.subjects.filter((subject) => subject.id === sourceSubjectId);
    requireFact(
      subjects.length === 1 &&
        subjects[0]!.subjectKind === "driver-registration" &&
        subjects[0]!.organizationId === organizationId,
      "placement-driver-subject-unavailable",
    );
    requireFact(
      input.graph.driverRegistrations.filter(
        (registration) => registration.attributionSubjectId === sourceSubjectId,
      ).length === 1,
      "placement-driver-registration-unavailable",
    );
    const subjectIdentity = identityFor(input.graph, "parameter-subject", sourceSubjectId);
    requireArchivedR10(
      input.classification,
      subjectIdentity.id,
      "subject-must-remain-r10-archive",
    );

    const modules = input.graph.modules.filter((module) => module.id === destinationModuleId);
    requireFact(
      modules.length === 1 &&
        modules[0]!.organizationId === organizationId &&
        modules[0]!.kind === "driver-group" &&
        modules[0]!.attributionSubjectId === sourceSubjectId,
      "placement-driver-module-unavailable",
    );
    const moduleIdentity = identityFor(input.graph, "parameter-module", destinationModuleId);
    requireArchivedR10(
      input.classification,
      moduleIdentity.id,
      "module-must-remain-r10-archive",
    );

    const schemas = input.graph.driverSchemas.filter(
      (schema) =>
        schema.attributionSubjectId === sourceSubjectId &&
        schema.organizationId === organizationId,
    );
    requireFact(schemas.length === 1, "placement-driver-schema-not-unique");
    const schemaIdentity = identityFor(input.graph, "driver-schema", schemas[0]!.id);
    const schemaAssignment = assignmentFor(input.classification, schemaIdentity.id);
    requireFact(
      schemaAssignment.rClass === "R2" &&
        schemaAssignment.disposition === DISPOSITION_BY_R_CLASS.R2,
      "placement-driver-schema-mapping-unavailable",
    );

    plans.push({
      sourcePlacementId,
      sourcePlacementDigest: digestOf({
        sourceInventoryFingerprint: input.snapshot.sourceInventoryFingerprint,
        sourceKind: record.sourceKind,
        sourceId: record.sourceId,
        payload: record.payload,
        sqlNullColumns: [...record.sqlNullColumns],
      }),
      organizationId,
      sourceSubjectId,
      driverSchemaIdentityId: schemaIdentity.id,
      destinationModuleId,
    });
  }
  return plans;
};

export type ProducedPlacementRegistration = PlacementRegistrationPlan & {
  readonly targetSubjectId: string;
  readonly registrationId: string;
  readonly placementId: string;
};

type PlacementProducerInput = {
  readonly client: RegistrationWriterClient;
  readonly runId: string;
  readonly planDigest: string;
  readonly targetRelease: { readonly id: string; readonly digest: string };
  readonly snapshot: ConversionSourceSnapshot;
  readonly graph: FrozenP0Graph;
  readonly classification: ClassificationResult;
};

/** Produce actual Registration + Placement rows through the existing guarded
 * governance writer. The target subject comes only from a current P7 R2
 * mapping head bound to this run and classification fingerprint. */
export const producePlacementRegistrations = async (
  input: PlacementProducerInput,
): Promise<readonly ProducedPlacementRegistration[]> => {
  const plans = derivePlacementRegistrationPlans(input);
  const targetBySchema = new Map<string, string>();
  for (const plan of plans) {
    if (targetBySchema.has(plan.driverSchemaIdentityId)) continue;
    const mapping = await readCurrentMappingHead({
      client: input.client as pg.PoolClient,
      identityId: plan.driverSchemaIdentityId,
    });
    requireFact(mapping.ok && mapping.value, `placement-driver-schema-${mapping.ok ? "mapping-unavailable" : mapping.error.detail}`);
    requireFact(
      mapping.value.version.cutoverRunId === input.runId &&
        mapping.value.version.graphFingerprint === input.classification.graphFingerprint &&
        mapping.value.version.rClass === "R2" &&
        mapping.value.version.targetKind === "catalog-subject" &&
        typeof mapping.value.version.targetId === "string" &&
        mapping.value.version.targetId.length > 0,
      "placement-driver-schema-mapping-authority-mismatch",
    );
    targetBySchema.set(plan.driverSchemaIdentityId, mapping.value.version.targetId!);
  }

  const produced: ProducedPlacementRegistration[] = [];
  for (const plan of plans) {
    const targetSubjectId = targetBySchema.get(plan.driverSchemaIdentityId);
    requireFact(targetSubjectId, "placement-target-subject-unavailable");
    const registered = await writeGuardedRegistration(input.client, {
      kind: "register",
      organizationId: plan.organizationId,
      subjectId: CatalogSubjectId(targetSubjectId),
      subjectKind: "driver",
      expectedRelease: {
        id: CatalogReleaseId(input.targetRelease.id),
        digest: CatalogReleaseDigest(input.targetRelease.digest),
      },
      placement: { mode: "use-default" },
      destinationModuleId: plan.destinationModuleId,
      method: "automatic",
      proof: {
        cutoverRunId: input.runId,
        planDigest: input.planDigest,
        sourcePlacementId: plan.sourcePlacementId,
        sourcePlacementDigest: plan.sourcePlacementDigest,
        sourceInventoryFingerprint: input.snapshot.sourceInventoryFingerprint,
      },
      idempotencyKey: `s7-placement:${input.runId}:${plan.sourcePlacementId}`,
      context: {
        actorKind: "trusted-system",
        principalId: "catalog-cutover-placement-producer",
      },
    });
    if (!registered.ok) {
      throw new PlacementProducerRefusal(
        `placement-registration-${registered.error.kind}`,
      );
    }
    produced.push({
      ...plan,
      targetSubjectId,
      registrationId: String(registered.value.registrationId),
      placementId: String(registered.value.placementId),
    });
  }
  return produced;
};
