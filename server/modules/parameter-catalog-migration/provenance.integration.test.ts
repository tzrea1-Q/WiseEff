/**
 * Definition identity correction migration — DTS source provenance.
 *
 * Executed threat-matrix rows: SR-01, SR-02, SR-03, SR-05 and ID-02 for values
 * whose recorded `source_ref` is the opaque `config-set:<id>` write the dts
 * ingest path stores.  The real `.dts` location is resolved from
 * `dts_property_occurrences`, so append-only value rows never have to be
 * rewritten for the capability to see (and rewrite) a real source.
 */
import { describe, expect, it } from "vitest";

import {
  MIGRATION_PRINCIPAL,
  PREDECESSOR_DEFINITION_ID,
  PREDECESSOR_PROPERTY_KEY,
  PREDECESSOR_SUBJECT_ID,
  createMigrationHarness,
  integerContent,
  migrationTrustedActor,
  subjectChange,
  type MigrationHarness,
} from "./testing/harness";

const ORG = "org-drepl-provenance";
const MODULE = "pmod-drepl-provenance";
const P1 = "proj-provenance-1";
const CONFIG_SET_ID = "dcs-provenance";
const CONFIG_REVISION_ID = "drev-provenance";
const FILE_ID = "file-provenance";
const FILE_VERSION_ID = "fileversion-provenance";
const LOGICAL_NODE_ID = "ln-provenance";
const NODE_LOCATOR = "/charger@0";
const FILE_NAME = "charger-board.dts";

const context = () => ({
  actorKind: "org-admin" as const,
  principalId: MIGRATION_PRINCIPAL,
  organizationId: ORG,
});

const withHarness = async (fn: (harness: MigrationHarness) => Promise<void>): Promise<void> => {
  const harness = await createMigrationHarness();
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
};

const seed = async (harness: MigrationHarness) => {
  await harness.seedOrganization(ORG);
  await harness.seedProject(ORG, P1, P1);
  return harness.registerSubject({
    organizationId: ORG,
    subjectId: PREDECESSOR_SUBJECT_ID,
    subjectKind: "driver",
    moduleId: MODULE,
  });
};

const insertConfigSet = async (harness: MigrationHarness) => {
  await harness.pool.query(
    `insert into dts_config_set (id, organization_id, project_id, name) values ($1, $2, $3, 'default')`,
    [CONFIG_SET_ID, ORG, P1],
  );
  await harness.pool.query(
    `insert into dts_config_revisions (
       id, organization_id, project_id, config_set_id, revision_number, status
     ) values ($1, $2, $3, $4, 1, 'resolved')`,
    [CONFIG_REVISION_ID, ORG, P1, CONFIG_SET_ID],
  );
  await harness.pool.query(
    `insert into project_parameter_files (
       id, organization_id, project_id, file_name, format, config_set_id, config_set_role, enabled
     ) values ($1, $2, $3, $4, 'dts', $5, 'base', true)`,
    [FILE_ID, ORG, P1, FILE_NAME, CONFIG_SET_ID],
  );
  await harness.pool.query(
    `insert into project_parameter_file_versions (
       id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
     ) values ($1, $2, 1, $3, $4, 128, '{}'::jsonb, 'upload')`,
    [FILE_VERSION_ID, FILE_ID, `object/${FILE_ID}`, "checksum-provenance"],
  );
  await harness.pool.query(
    `update project_parameter_files set current_version_id = $1 where id = $2`,
    [FILE_VERSION_ID, FILE_ID],
  );
  await harness.pool.query(
    `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
     values ($1, $2, $3, $4)`,
    [LOGICAL_NODE_ID, ORG, P1, CONFIG_SET_ID],
  );
  await harness.pool.query(
    `insert into dts_logical_node_revisions (
       id, logical_node_id, config_revision_id, node_locator, name
     ) values ($1, $2, $3, $4, 'charger')`,
    ["lnr-provenance", LOGICAL_NODE_ID, CONFIG_REVISION_ID, NODE_LOCATOR],
  );
};

const insertOccurrence = async (
  harness: MigrationHarness,
  input: { id: string; propertyKey: string; propertyOccurrenceId: string; nodeOccurrenceId: string },
) => {
  await harness.pool.query(
    `insert into dts_node_occurrences (
       id, config_revision_id, file_version_id, name, labels, node_path,
       start_offset, end_offset, start_line, start_column, end_line, end_column,
       raw_text, ast_json, source_order
     ) values ($1, $2, $3, 'charger', '[]'::jsonb, $4, 0, 90, 1, 1, 6, 2, 'node', '{}'::jsonb, 0)`,
    [input.nodeOccurrenceId, CONFIG_REVISION_ID, FILE_VERSION_ID, NODE_LOCATOR],
  );
  await harness.pool.query(
    `insert into dts_property_occurrences (
       id, config_revision_id, node_occurrence_id, file_version_id, property_name,
       start_offset, end_offset, start_line, start_column, end_line, end_column,
       raw_text, ast_json, source_order
     ) values ($1, $2, $3, $4, $5, 12, 30, 2, 3, 2, 22, '<5>', '{}'::jsonb, 0)`,
    [
      input.propertyOccurrenceId,
      CONFIG_REVISION_ID,
      input.nodeOccurrenceId,
      FILE_VERSION_ID,
      input.propertyKey,
    ],
  );
  await harness.pool.query(
    `insert into dts_occurrence_effects (
       id, config_revision_id, logical_node_revision_id, property_occurrence_id, node_occurrence_id,
       property_name, effect_kind, source_order
     ) values ($1, $2, $3, $4, $5, $6, 'set', 1)`,
    [
      input.id,
      CONFIG_REVISION_ID,
      "lnr-provenance",
      input.propertyOccurrenceId,
      input.nodeOccurrenceId,
      input.propertyKey,
    ],
  );
};

describe("definition replacement source provenance", () => {
  it("SR-05/ID-02 resolves an opaque config-set source to its .dts file and completes the project", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seed(harness);
      await insertConfigSet(harness);
      await insertOccurrence(harness, {
        id: "oe-provenance",
        propertyKey: PREDECESSOR_PROPERTY_KEY,
        propertyOccurrenceId: "po-provenance",
        nodeOccurrenceId: "no-provenance",
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: LOGICAL_NODE_ID,
        registrationId,
        sources: [{ sourceRef: `config-set:${CONFIG_SET_ID}`, configRevisionId: CONFIG_REVISION_ID }],
        values: [5],
      });

      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_provenance_max",
        proposedContent: integerContent("Provenance max", 0),
        projectIds: [P1],
        reason: "SR-05",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.blockers).toEqual([]);
      expect(preview.value.impact.compatibleProjectCount).toBe(1);
      expect(preview.value.impact.sourceFormatSupported).toBe(true);

      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "sr-05",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.status).toBe("completed");
      expect(created.value.projects[0]?.blockerReason).toBeNull();

      const carried = await harness.pool.query<{ source_ref: string; value: unknown }>(
        `select source_ref, value from parameter_catalog.project_parameter_values where binding_id = $1`,
        [created.value.projects[0]!.newBindingId!],
      );
      // The corrected value carries the real `.dts` location, not the opaque ref.
      expect(carried.rows[0]?.source_ref).toBe(`${FILE_NAME}!${NODE_LOCATOR}`);
      expect(carried.rows[0]?.value).toBe(5);
    });
  }, 240_000);

  it("SR-03 blocks a project with two source occurrences of the same key at the same location", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seed(harness);
      await insertConfigSet(harness);
      await insertOccurrence(harness, {
        id: "oe-provenance-a",
        propertyKey: PREDECESSOR_PROPERTY_KEY,
        propertyOccurrenceId: "po-provenance-a",
        nodeOccurrenceId: "no-provenance-a",
      });
      await insertOccurrence(harness, {
        id: "oe-provenance-b",
        propertyKey: PREDECESSOR_PROPERTY_KEY,
        propertyOccurrenceId: "po-provenance-b",
        nodeOccurrenceId: "no-provenance-b",
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: LOGICAL_NODE_ID,
        registrationId,
        sources: [{ sourceRef: `config-set:${CONFIG_SET_ID}`, configRevisionId: CONFIG_REVISION_ID }],
        values: [5],
      });

      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_ambiguous_max",
        proposedContent: integerContent("Ambiguous max", 0),
        projectIds: [P1],
        reason: "SR-03",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.blockers).toContain(`ambiguous-source-match:${P1}`);
      expect(preview.value.impact.sourceFormatSupported).toBe(false);

      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "sr-03",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.status).toBe("blocked");
      expect(created.value.projects[0]?.blockerReason).toBe("ambiguous-source-match");
      const values = await harness.pool.query<{ source_ref: string }>(
        `select value.source_ref
           from parameter_catalog.current_project_parameter_bindings binding
           join parameter_catalog.project_parameter_values value
             on value.id = binding.current_value_id
          where binding.id = $1`,
        [created.value.projects[0]!.oldBindingId],
      );
      expect(values.rows[0]?.source_ref).toBe(`config-set:${CONFIG_SET_ID}`);
    });
  }, 240_000);

  it("SR-02 blocks a project whose resolved source file is not .dts", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seed(harness);
      await insertConfigSet(harness);
      await harness.pool.query(`update project_parameter_files set file_name = 'charger-board.yaml' where id = $1`, [
        FILE_ID,
      ]);
      await insertOccurrence(harness, {
        id: "oe-provenance-format",
        propertyKey: PREDECESSOR_PROPERTY_KEY,
        propertyOccurrenceId: "po-provenance-format",
        nodeOccurrenceId: "no-provenance-format",
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: LOGICAL_NODE_ID,
        registrationId,
        sources: [{ sourceRef: `config-set:${CONFIG_SET_ID}`, configRevisionId: CONFIG_REVISION_ID }],
        values: [5],
      });

      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_format_max",
        proposedContent: integerContent("Format max", 0),
        projectIds: [P1],
        reason: "SR-02",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.blockers).toContain(`unsupported-source-format:${P1}`);
      expect(preview.value.impact.sourceFormatSupported).toBe(false);
    });
  }, 240_000);

  it("VL-05 ignores an open review item captured for a superseded release", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seed(harness);
      const superseded = harness.pin();
      // A later publication moves the release on; a review item captured for the
      // earlier release is no longer listed or resolvable, so it must not block
      // corrections forever on an upgraded instance.
      await harness.publishChange(
        [
          subjectChange({
            canonicalKey: "acme,prov-later",
            selector: "acme,prov-later",
            propertyKey: "later_max",
            content: integerContent("Later max", 0),
          }),
        ] as never,
        "prov-supersede",
      );
      expect(harness.pin().id).not.toBe(superseded.id);
      await harness.pool.query(
        `insert into parameter_catalog.parameter_review_items (
           id, organization_id, evidence_fingerprint, matcher_revision, catalog_release_id,
           reason, status, etag_version
         ) values ($1,$2,'fp-prov-superseded','catalog-matcher/v1',$3,'unknown','open',1)`,
        ["prit-prov-superseded", ORG, superseded.id],
      );
      await insertConfigSet(harness);
      await insertOccurrence(harness, {
        id: "oe-provenance-review",
        propertyKey: PREDECESSOR_PROPERTY_KEY,
        propertyOccurrenceId: "po-provenance-review",
        nodeOccurrenceId: "no-provenance-review",
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: LOGICAL_NODE_ID,
        registrationId,
        sources: [{ sourceRef: `config-set:${CONFIG_SET_ID}`, configRevisionId: CONFIG_REVISION_ID }],
        values: [5],
      });

      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_superseded_review_max",
        proposedContent: integerContent("Superseded review max", 0),
        projectIds: [P1],
        reason: "VL-05",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.blockers).not.toContain("pending-work-conflict:review");
      expect(preview.value.projects[0]?.status).toBe("pending");

      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "vl-05-superseded-review",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.status).toBe("completed");

      // The superseded review row itself is untouched by the correction.
      const review = await harness.pool.query<{ status: string; catalog_release_id: string }>(
        `select status, catalog_release_id from parameter_catalog.parameter_review_items where id = $1`,
        ["prit-prov-superseded"],
      );
      expect(review.rows[0]?.status).toBe("open");
      expect(review.rows[0]?.catalog_release_id).toBe(superseded.id);
    });
  }, 240_000);
});
