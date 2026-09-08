import { describe, expect, it } from "vitest";
import {
  captureArchivedSourceGraph,
  type ConversionSourceSnapshot,
} from "./conversionManifest";

const sourceSnapshot = (): ConversionSourceSnapshot => ({
  sourceInventoryFingerprint: `sha256:${"a".repeat(64)}`,
  records: [
    {
      sourceKind: "parameter-spec",
      sourceId: "spec-1",
      payload: {
        id: "spec-1",
        organization_id: "org-1",
        attribution_subject_id: "subject-1",
      },
      sqlNullColumns: [],
    },
    {
      sourceKind: "parameter-spec-version",
      sourceId: "version-1",
      payload: {
        id: "version-1",
        parameter_spec_id: "spec-1",
        lifecycle: "active",
      },
      sqlNullColumns: [],
    },
    {
      sourceKind: "driver-schema",
      sourceId: "schema-1",
      payload: {
        id: "schema-1",
        parameter_spec_id: "spec-1",
        organization_id: "org-1",
        attribution_subject_id: "subject-1",
      },
      sqlNullColumns: [],
    },
    {
      sourceKind: "driver-schema-version",
      sourceId: "schema-version-1",
      payload: {
        id: "schema-version-1",
        driver_schema_id: "schema-1",
        parameter_spec_version_id: "version-1",
        source: "manual",
      },
      sqlNullColumns: [],
    },
    {
      sourceKind: "parameter-subject",
      sourceId: "subject-1",
      payload: {
        id: "subject-1",
        organization_id: "org-1",
        subject_kind: "driver-registration",
      },
      sqlNullColumns: [],
    },
    {
      sourceKind: "parameter-module",
      sourceId: "module-1",
      payload: {
        id: "module-1",
        organization_id: "org-1",
        attribution_subject_id: "subject-1",
        parent_id: "category-1",
      },
      sqlNullColumns: [],
    },
    {
      sourceKind: "parameter-module",
      sourceId: "category-1",
      payload: {
        id: "category-1",
        organization_id: "org-1",
        attribution_subject_id: null,
        parent_id: null,
      },
      sqlNullColumns: ["attribution_subject_id", "parent_id"],
    },
    {
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
    },
  ],
});

describe("conversion Archive owner for closed source identities", () => {
  it("retains SQL NULL and the actual version/subject/module/placement FK graph", async () => {
    const result = await captureArchivedSourceGraph(
      sourceSnapshot(),
      "driver-schema-version",
      "schema-version-1",
    );

    expect(result).toMatchObject({
      sourcePayload: {
        sourceKind: "driver-schema-version",
        sourceId: "schema-version-1",
        table: "driver_schema_versions",
        row: {
          id: "schema-version-1",
          driver_schema_id: "schema-1",
          parameter_spec_version_id: "version-1",
          source: "manual",
        },
        sqlNullColumns: [],
      },
      relationGraph: {
        version: "pcat-archive-source-graph-v2",
        sourceInventoryFingerprint: `sha256:${"a".repeat(64)}`,
        root: { sourceKind: "driver-schema-version", sourceId: "schema-version-1" },
      },
    });
    const relationGraph = result?.relationGraph as {
      records: readonly Record<string, unknown>[];
      links: readonly Record<string, unknown>[];
    };
    expect(relationGraph.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: "parameter-subject", sourceId: "subject-1" }),
      expect.objectContaining({ sourceKind: "parameter-spec-version", sourceId: "version-1" }),
      expect.objectContaining({ sourceKind: "parameter-spec", sourceId: "spec-1" }),
    ]));
    expect(relationGraph.links).toEqual(expect.arrayContaining([
      {
        from: "driver-schema-version\u0000schema-version-1",
        field: "driver_schema_id",
        to: "driver-schema\u0000schema-1",
      },
      {
        from: "driver-schema-version\u0000schema-version-1",
        field: "parameter_spec_version_id",
        to: "parameter-spec-version\u0000version-1",
      },
    ]));

    const placement = await captureArchivedSourceGraph(
      sourceSnapshot(),
      "parameter-placement",
      "placement-1",
    );
    const placementGraph = placement?.relationGraph as {
      records: readonly Record<string, unknown>[];
      links: readonly Record<string, unknown>[];
      externalReferences: readonly Record<string, unknown>[];
    };
    expect(placementGraph.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKind: "parameter-placement",
        sourceId: "placement-1",
        sqlNullColumns: ["default_business_category_module_id"],
      }),
      expect.objectContaining({ sourceKind: "parameter-subject", sourceId: "subject-1" }),
      expect.objectContaining({ sourceKind: "parameter-module", sourceId: "module-1" }),
    ]));
    expect(placementGraph.links).toEqual(expect.arrayContaining([
      {
        from: "parameter-placement\u0000placement-1",
        field: "driver_group_module_id",
        to: "parameter-module\u0000module-1",
      },
    ]));
    expect(placementGraph.externalReferences).toEqual(expect.arrayContaining([
      {
        from: "parameter-placement\u0000placement-1",
        field: "organization_id",
        targetTable: "organizations",
        targetId: "org-1",
      },
    ]));
  });

  it("does not invent a relation for an unsupported source kind", async () => {
    await expect(
      captureArchivedSourceGraph(sourceSnapshot(), "parameter-policy-target", "policy-1"),
    ).resolves.toBeNull();
  });

  it("refuses duplicate projected identities and a missing non-null FK target", () => {
    const duplicate = sourceSnapshot();
    expect(() => captureArchivedSourceGraph({
      ...duplicate,
      records: [...duplicate.records, duplicate.records[0]!],
    }, "parameter-placement", "placement-1")).toThrow(
      "PCAT-CONVERSION-ARCHIVE-SOURCE-GRAPH-DUPLICATE",
    );

    const missingTarget = sourceSnapshot();
    const placement = missingTarget.records.find((record) => record.sourceKind === "parameter-placement")!;
    expect(() => captureArchivedSourceGraph({
      ...missingTarget,
      records: missingTarget.records.map((record) => record === placement
        ? { ...record, payload: { ...record.payload, driver_group_module_id: "missing-module" } }
        : record),
    }, "parameter-placement", "placement-1")).toThrow(
      "PCAT-CONVERSION-ARCHIVE-SOURCE-GRAPH-FK-TARGET-MISSING",
    );
  });
});
