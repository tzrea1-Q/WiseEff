import { describe, expect, it } from "vitest";

import { emptyClassCounts } from "./classifier/rules";
import type { ClassificationResult, FrozenP0Graph } from "./classifier";
import type { ConversionSourceSnapshot } from "./conversionManifest";
import { derivePlacementRegistrationPlans, PlacementProducerRefusal } from "./placementProducer";

const graph = (): FrozenP0Graph => ({
  catalog: "parameter-catalog-p0-graph",
  identities: [
    {
      id: "legacy-placement",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-placement",
      ownerScopeKind: "organization",
      ownerScopeId: "org-1",
      sourceId: "placement-1",
    },
    {
      id: "legacy-subject",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-subject",
      ownerScopeKind: "organization",
      ownerScopeId: "org-1",
      sourceId: "subject-1",
    },
    {
      id: "legacy-module",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-module",
      ownerScopeKind: "organization",
      ownerScopeId: "org-1",
      sourceId: "module-1",
    },
    {
      id: "legacy-schema",
      sourceSystem: "wiseeff-v1",
      sourceKind: "driver-schema",
      ownerScopeKind: "organization",
      ownerScopeId: "org-1",
      sourceId: "schema-1",
    },
  ],
  specs: [],
  specVersions: [],
  subjects: [{ id: "subject-1", organizationId: "org-1", subjectKind: "driver-registration" }],
  driverRegistrations: [{ attributionSubjectId: "subject-1" }],
  nodeTypeDefinitions: [],
  driverSchemas: [{
    id: "schema-1",
    parameterSpecId: "spec-1",
    organizationId: "org-1",
    attributionSubjectId: "subject-1",
  }],
  driverSchemaVersions: [],
  dtsPropertySpecs: [],
  modules: [{
    id: "module-1",
    organizationId: "org-1",
    kind: "driver-group",
    origin: "auto",
    name: "Power",
    attributionSubjectId: "subject-1",
  }],
  placements: [{
    id: "placement-1",
    organizationId: "org-1",
    attributionSubjectId: "subject-1",
    driverGroupModuleId: "module-1",
  }],
  bindings: [],
  bindingRevisions: [],
});

const classification = (): ClassificationResult => {
  const classCounts = emptyClassCounts();
  classCounts.R2 = 1;
  classCounts.R10 = 3;
  return {
    classifierVersion: "1.0.0",
    graphFingerprint: "sha256:" + "b".repeat(64),
    blockers: [],
    conservation: {
      inputCount: 4,
      classifiedCount: 4,
      duplicatePrimaryCount: 0,
      classCounts,
      dispositionCounts: {
        blocked: 0,
        mapped: 1,
        archived: 3,
        "review-evidence": 0,
        "definition-proposal": 0,
      },
      conserved: true,
    },
    assignments: [
      {
        identityId: "legacy-placement",
        sourceKind: "parameter-placement",
        sourceId: "placement-1",
        ownerScopeKind: "organization",
        ownerScopeId: "org-1",
        rClass: "R10",
        ruleId: "PCAT-CLASS-R10-RESIDUAL-UNKNOWN",
        disposition: "archived",
        mappingClass: "module-placement",
        propertyKey: null,
      },
      {
        identityId: "legacy-subject",
        sourceKind: "parameter-subject",
        sourceId: "subject-1",
        ownerScopeKind: "organization",
        ownerScopeId: "org-1",
        rClass: "R10",
        ruleId: "PCAT-CLASS-R10-RESIDUAL-UNKNOWN",
        disposition: "archived",
        mappingClass: "formal-subject",
        propertyKey: null,
      },
      {
        identityId: "legacy-module",
        sourceKind: "parameter-module",
        sourceId: "module-1",
        ownerScopeKind: "organization",
        ownerScopeId: "org-1",
        rClass: "R10",
        ruleId: "PCAT-CLASS-R10-RESIDUAL-UNKNOWN",
        disposition: "archived",
        mappingClass: "module-placement",
        propertyKey: null,
      },
      {
        identityId: "legacy-schema",
        sourceKind: "driver-schema",
        sourceId: "schema-1",
        ownerScopeKind: "organization",
        ownerScopeId: "org-1",
        rClass: "R2",
        ruleId: "PCAT-CLASS-R2-PROVABLE-DRIVERSCHEMA-ROOT",
        disposition: "mapped",
        mappingClass: "formal-definition",
        propertyKey: null,
      },
    ],
  };
};

const snapshot = (): ConversionSourceSnapshot => ({
  sourceInventoryFingerprint: "sha256:" + "c".repeat(64),
  records: [{
    sourceKind: "parameter-placement",
    sourceId: "placement-1",
    payload: {
      id: "placement-1",
      organization_id: "org-1",
      attribution_subject_id: "subject-1",
      driver_group_module_id: "module-1",
      default_business_category_module_id: null,
    },
    sqlNullColumns: ["default_business_category_module_id"],
  }],
});

describe("source placement producer", () => {
  it("derives one owned placement from R10 source facts and an R2 schema", () => {
    expect(derivePlacementRegistrationPlans({
      snapshot: snapshot(),
      graph: graph(),
      classification: classification(),
    })).toMatchObject([{
      sourcePlacementId: "placement-1",
      organizationId: "org-1",
      sourceSubjectId: "subject-1",
      driverSchemaIdentityId: "legacy-schema",
      destinationModuleId: "module-1",
    }]);
  });

  it.each([
    ["wrong owner", (value: ConversionSourceSnapshot) => {
      const record = value.records[0]!;
      return { ...value, records: [{ ...record, payload: { ...record.payload, organization_id: "org-2" } }] };
    }],
    ["missing non-null target", (value: ConversionSourceSnapshot) => {
      const record = value.records[0]!;
      return { ...value, records: [{ ...record, payload: { ...record.payload, driver_group_module_id: null }, sqlNullColumns: [...record.sqlNullColumns, "driver_group_module_id"] }] };
    }],
    ["duplicate placement identity", (value: ConversionSourceSnapshot) => ({ ...value, records: [...value.records, value.records[0]!] })],
  ])("refuses %s", (_name, mutate) => {
    expect(() => derivePlacementRegistrationPlans({
      snapshot: mutate(snapshot()),
      graph: graph(),
      classification: classification(),
    })).toThrow(PlacementProducerRefusal);
  });
});
