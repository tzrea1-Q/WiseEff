/**
 * Definition identity correction migration — preview path.
 *
 * Executed threat-matrix rows: ID-01, ID-02, VL-08, VL-09, TN-02.
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

const ORG = "org-drepl-preview";
const OTHER_ORG = "org-drepl-preview-other";
const MODULE = "pmod-drepl-preview";
const P1 = "proj-preview-1";

const context = (organizationId = ORG) => ({
  actorKind: "org-admin" as const,
  principalId: MIGRATION_PRINCIPAL,
  organizationId,
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

describe("definition replacement preview", () => {
  it("ID-01 previews and executes a move to a different subject with its own registration", async () => {
    await withHarness(async (harness) => {
      const release = await harness.publishChange(
        [
          subjectChange({
            canonicalKey: "acme,aux",
            selector: "acme,aux",
            propertyKey: "aux_max",
            content: integerContent("Aux max", 0),
          }),
        ] as never,
        "subject",
      );
      const aux = await harness.allocatedDefinition(release.id, "aux_max");
      expect(aux).not.toBeNull();
      if (!aux) return;
      const registrationId = await seed(harness);
      const auxRegistrationId = await harness.registerSubject({
        organizationId: ORG,
        subjectId: aux.subjectId,
        subjectKind: "driver",
        moduleId: `${MODULE}-aux`,
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-1",
        registrationId,
        sources: [{ sourceRef: "config/subject.dts", configRevisionId: "crev-1" }],
        propertyKeys: ["iin_subject_moved"],
        values: [5],
      });
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: aux.subjectId,
        newPropertyKey: "iin_subject_moved",
        proposedContent: integerContent("Subject moved", 0),
        projectIds: [P1],
        reason: "ID-01",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.oldIdentity.subjectId).toBe(PREDECESSOR_SUBJECT_ID);
      expect(preview.value.newIdentity.subjectId).toBe(aux.subjectId);
      expect(preview.value.impact.targetRegistrationRequired).toBe(false);

      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "id-01",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.status).toBe("completed");
      const newBinding = await harness.pool.query<{ subject_id: string; registration_id: string }>(
        `select subject_id, registration_id from parameter_catalog.project_parameter_bindings where id = $1`,
        [created.value.projects[0]!.newBindingId!],
      );
      expect(newBinding.rows[0]?.subject_id).toBe(aux.subjectId);
      expect(newBinding.rows[0]?.registration_id).toBe(auxRegistrationId);
      const oldDefinition = await harness.pool.query<{ subject_id: string; property_key: string }>(
        `select subject_id, property_key from parameter_catalog.parameter_definitions where id = $1`,
        [PREDECESSOR_DEFINITION_ID],
      );
      expect(oldDefinition.rows[0]?.subject_id).toBe(PREDECESSOR_SUBJECT_ID);
      expect(oldDefinition.rows[0]?.property_key).toBe(PREDECESSOR_PROPERTY_KEY);
    });
  }, 240_000);

  it("ID-02 retains the exact .dts source location while changing the definition key", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seed(harness);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-1",
        registrationId,
        sources: [{ sourceRef: `${PREDECESSOR_PROPERTY_KEY}.dts`, configRevisionId: "crev-1" }],
        propertyKeys: ["iin_key_only"],
        values: [5],
      });
      const aliasesBefore = await harness.pool.query<{ n: string }>(
        `select count(*)::text as n from parameter_catalog.catalog_subject_aliases`,
      );
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_key_only",
        proposedContent: integerContent("Key only", 0),
        projectIds: [P1],
        reason: "ID-02",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.newIdentity.propertyKey).toBe("iin_key_only");
      expect(preview.value.newIdentity.subjectId).toBe(PREDECESSOR_SUBJECT_ID);
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "id-02",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.status).toBe("completed");
      const carried = await harness.pool.query<{ source_ref: string; config_revision_id: string }>(
        `select source_ref, config_revision_id from parameter_catalog.project_parameter_values where binding_id = $1`,
        [created.value.projects[0]!.newBindingId!],
      );
      expect(carried.rows[0]?.source_ref).toBe(`${PREDECESSOR_PROPERTY_KEY}.dts!/ln-1`);
      expect(carried.rows[0]?.config_revision_id).toBe("crev-1");
      const aliasesAfter = await harness.pool.query<{ n: string }>(
        `select count(*)::text as n from parameter_catalog.catalog_subject_aliases`,
      );
      expect(aliasesAfter.rows[0]?.n).toBe(aliasesBefore.rows[0]?.n);
    });
  }, 240_000);

  it("VL-08 and VL-09 refuse the preview while an open version or property-key cutover exists", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seed(harness);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-1",
        registrationId,
        sources: [{ sourceRef: "config/cutover.dts", configRevisionId: "crev-1" }],
        values: [5],
      });
      await harness.pool.query(
        `insert into public.parameter_specs (id, organization_id, source_kind, specification_key)
         values ($1,$2,'dts',$3)`,
        ["spec-drepl-cutover", ORG, PREDECESSOR_PROPERTY_KEY],
      );
      await harness.pool.query(
        `insert into public.parameter_spec_versions (
           id, parameter_spec_id, version, display_name, description, value_shape, lifecycle
         ) values ($1,$2,1,'name','description','{}'::jsonb,'active')`,
        ["specv-drepl-1", "spec-drepl-cutover"],
      );
      await harness.pool.query(
        `insert into public.parameter_spec_versions (
           id, parameter_spec_id, version, display_name, description, value_shape, lifecycle
         ) values ($1,$2,2,'name','description','{}'::jsonb,'draft')`,
        ["specv-drepl-2", "spec-drepl-cutover"],
      );
      await harness.pool.query(
        `insert into parameter_spec_property_key_cutover_runs (
           id, organization_id, parameter_spec_id, from_key, to_key, status
         ) values ($1,$2,$3,$4,$5,'preparing')`,
        ["pkcut-drepl", ORG, "spec-drepl-cutover", PREDECESSOR_PROPERTY_KEY, "iin_next"],
      );
      const refused = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_blocked_by_cutover",
        proposedContent: integerContent("Blocked", 0),
        projectIds: [P1],
        reason: "VL-09",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error).toEqual({
        kind: "pending-work-conflict",
        bindingId: "-",
        reason: "open-property-key-cutover",
      });
      const openRuns = await harness.pool.query<{ status: string }>(
        `select status from parameter_spec_property_key_cutover_runs where id = $1`,
        ["pkcut-drepl"],
      );
      expect(openRuns.rows[0]?.status).toBe("preparing");
    });
  }, 240_000);

  it("TN-02 rejects a manifest that names a project of a different organization", async () => {
    await withHarness(async (harness) => {
      await seed(harness);
      await harness.seedOrganization(OTHER_ORG);
      await harness.seedProject(OTHER_ORG, "proj-other-org", "Other");
      const refused = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_cross_org",
        proposedContent: integerContent("Cross org", 0),
        projectIds: ["proj-other-org"],
        reason: "TN-02",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error).toEqual({
        kind: "invalid-command",
        reason: "cross-organization-project",
      });
      const replacements = await harness.pool.query<{ n: string }>(
        `select count(*)::text as n from parameter_catalog.definition_replacements`,
      );
      expect(replacements.rows[0]?.n).toBe("0");
    });
  }, 240_000);

  it("reports an empty manifest when a selected project does not bind the old definition", async () => {
    await withHarness(async (harness) => {
      await seed(harness);
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_unbound",
        proposedContent: integerContent("Unbound", 0),
        projectIds: [P1],
        reason: "unbound",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.projects).toEqual([]);
      expect(preview.value.blockers).toContain("unbound-project");
      expect(preview.value.impact.oldDefinitionCurrentReferenceCount).toBe(0);
    });
  }, 240_000);

});
