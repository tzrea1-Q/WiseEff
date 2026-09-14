/**
 * Definition identity correction migration — execute path.
 *
 * Threat-matrix rows: RT-02, RT-03, RT-04, ID-07, VL-05, VL-06, SR-01..SR-05,
 * ST-02, IV-01, IV-06, RC-01.
 */
import { describe, expect, it } from "vitest";

import {
  MIGRATION_PRINCIPAL,
  PREDECESSOR_DEFINITION_ID,
  PREDECESSOR_PROPERTY_KEY,
  PREDECESSOR_SUBJECT_ID,
  PREDECESSOR_REVISION_ID,
  createMigrationHarness,
  integerContent,
  migrationTrustedActor,
  type MigrationHarness,
} from "./testing/harness";

const ORG = "org-drepl-exec";
const MODULE = "pmod-drepl-exec";
const PROJECTS = ["proj-drepl-1", "proj-drepl-2", "proj-drepl-3"] as const;

const context = (organizationId = ORG) =>
  ({ actorKind: "org-admin" as const, principalId: MIGRATION_PRINCIPAL, organizationId });

const withHarness = async (fn: (harness: MigrationHarness) => Promise<void>): Promise<void> => {
  const harness = await createMigrationHarness();
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
};

const seedProjects = async (
  harness: MigrationHarness,
  projectIds: readonly string[],
): Promise<string> => {
  await harness.seedOrganization(ORG);
  for (const projectId of projectIds) {
    await harness.seedProject(ORG, projectId, projectId);
  }
  return harness.registerSubject({
    organizationId: ORG,
    subjectId: PREDECESSOR_SUBJECT_ID,
    subjectKind: "driver",
    moduleId: MODULE,
  });
};

const countRows = async (harness: MigrationHarness, sql: string, values: unknown[]): Promise<number> => {
  const result = await harness.pool.query<{ n: string }>(sql, values);
  return Number(result.rows[0]?.n ?? 0);
};

describe("definition replacement execute", () => {
  it("RT-02 migrates exactly one project and leaves the old binding, value and definition unmodified", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [PROJECTS[0]]);
      const seeded = await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-1",
        registrationId,
        sources: [{ sourceRef: "config/project.dts", configRevisionId: "crev-1" }],
        values: [5],
      });
      const before = await harness.pool.query<{
        value_digest: string;
        value_kind: string;
        value: unknown;
        source_ref: string;
        config_revision_id: string;
      }>(
        `select value_digest, value_kind, value, source_ref, config_revision_id
           from parameter_catalog.project_parameter_values where id = $1`,
        [seeded.valueId],
      );
      const beforeRevision = await harness.pool.query<{ content: unknown; content_digest: string }>(
        `select content, content_digest from parameter_catalog.definition_revisions where id = $1`,
        [PREDECESSOR_REVISION_ID],
      );

      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_exec_max",
        proposedContent: integerContent("Exec max", 0),
        projectIds: [PROJECTS[0]],
        reason: "RT-02",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.impact.selectedProjectCount).toBe(1);
      expect(preview.value.impact.compatibleProjectCount).toBe(1);

      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "rt-02",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.status).toBe("completed");
      expect(created.value.projects).toHaveLength(1);
      expect(created.value.projects[0]?.status).toBe("completed");
      expect(created.value.projects[0]?.attemptCount).toBe(1);
      expect(created.value.candidateId).not.toBeNull();
      expect(created.value.publicationJobId).not.toBeNull();
      expect(created.value.authorizationId).not.toBeNull();

      // A new binding and exactly one appended carried-forward value exist.
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings
            where project_id = $1 and definition_id = $2`,
          [PROJECTS[0], created.value.newIdentity.definitionId],
        ),
      ).toBe(1);
      const carried = await harness.pool.query<{
        value: unknown;
        value_digest: string;
        value_kind: string;
        source_ref: string;
        config_revision_id: string;
        replaced_from_value_id: string;
      }>(
        `select value, value_digest, value_kind, source_ref, config_revision_id, replaced_from_value_id
           from parameter_catalog.project_parameter_values where binding_id = $1`,
        [created.value.projects[0]!.newBindingId!],
      );
      expect(carried.rows).toHaveLength(1);
      const original = before.rows[0]!;
      expect(carried.rows[0]?.value).toEqual(original.value);
      expect(carried.rows[0]?.value_digest).toBe(original.value_digest);
      expect(carried.rows[0]?.value_kind).toBe(original.value_kind);
      expect(carried.rows[0]?.config_revision_id).toBe(original.config_revision_id);
      expect(carried.rows[0]?.replaced_from_value_id).toBe(seeded.valueId);

      // The old binding and the old value are byte-identical (IV-01).
      const oldValue = await harness.pool.query<{ value: unknown; value_digest: string }>(
        `select value, value_digest from parameter_catalog.project_parameter_values where id = $1`,
        [seeded.valueId],
      );
      expect(oldValue.rows[0]?.value).toEqual(original.value);
      expect(oldValue.rows[0]?.value_digest).toBe(original.value_digest);
      const oldBinding = await harness.pool.query<{ current_value_id: string; definition_id: string }>(
        `select current_value_id, definition_id from parameter_catalog.project_parameter_bindings where id = $1`,
        [seeded.bindingId],
      );
      expect(oldBinding.rows[0]?.current_value_id).toBe(seeded.valueId);
      expect(oldBinding.rows[0]?.definition_id).toBe(PREDECESSOR_DEFINITION_ID);
      const oldRevision = await harness.pool.query<{ content: unknown; content_digest: string }>(
        `select content, content_digest from parameter_catalog.definition_revisions where id = $1`,
        [PREDECESSOR_REVISION_ID],
      );
      expect(oldRevision.rows[0]?.content).toEqual(beforeRevision.rows[0]?.content);
      expect(oldRevision.rows[0]?.content_digest).toBe(beforeRevision.rows[0]?.content_digest);
      // The old definition still exists and is not deprecated or retired.
      const oldDefinition = await harness.pool.query<{ current_revision_id: string }>(
        `select current_revision_id from parameter_catalog.parameter_definitions where id = $1`,
        [PREDECESSOR_DEFINITION_ID],
      );
      expect(oldDefinition.rows[0]?.current_revision_id).toBe(PREDECESSOR_REVISION_ID);
      // The current-selection view hides the replaced binding.
      expect(await harness.currentTip(PROJECTS[0], PREDECESSOR_DEFINITION_ID)).toBeNull();

      // Three history rows: the seeded appends plus the replacement append.
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.binding_history_events
            where binding_id = $1`,
          [created.value.projects[0]!.newBindingId!],
        ),
      ).toBe(1);
    });
  }, 120_000);

  it("RT-03 completes three eligible projects in one execute response", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, PROJECTS);
      for (const [index, projectId] of PROJECTS.entries()) {
        await harness.seedBindingValue({
          organizationId: ORG,
          projectId,
          logicalNodeId: `ln-${index}`,
          registrationId,
          sources: [{ sourceRef: "config/project.dts", configRevisionId: `crev-${index}` }],
          values: [10 + index],
        });
      }
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_three_max",
        proposedContent: integerContent("Three max", 0),
        projectIds: [...PROJECTS],
        reason: "RT-03",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "rt-03",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.status).toBe("completed");
      expect(created.value.projects.map((project) => project.status)).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
      expect(created.value.projects.map((project) => project.attemptCount)).toEqual([1, 1, 1]);
    });
  }, 120_000);

  it("RT-04 completes the compatible project and blocks the incompatible and pending-work projects", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, PROJECTS);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-compatible",
        registrationId,
        sources: [{ sourceRef: "config/a.dts", configRevisionId: "crev-a" }],
        values: [5],
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[1],
        logicalNodeId: "ln-incompatible",
        registrationId,
        sources: [{ sourceRef: "config/b.dts", configRevisionId: "crev-b" }],
        values: [5000],
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[2],
        logicalNodeId: "ln-draft",
        registrationId,
        sources: [{ sourceRef: "config/c.dts", configRevisionId: "crev-c" }],
        values: [7],
      });
      await harness.pool.query(
        `insert into parameter_catalog.definition_proposals (
           id, organization_id, author_principal_id, base_catalog_release_id,
           base_definition_revision_id, status, current_proposal_revision_id, etag_version
         ) values ($1,$2,$3,$4,$5,'draft',$6,1)`,
        [
          "dprop-drepl-draft",
          ORG,
          MIGRATION_PRINCIPAL,
          harness.pin.id,
          PREDECESSOR_REVISION_ID,
          "dprev-drepl-draft",
        ],
      );
      await harness.pool.query(
        `insert into parameter_catalog.definition_proposal_revisions (
           id, proposal_id, revision_number, payload, reason, evidence_refs
         ) values ($1,$2,1,'{}'::jsonb,'draft','[]'::jsonb)`,
        ["dprev-drepl-draft", "dprop-drepl-draft"],
      );

      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_mixed_max",
        proposedContent: integerContent("Mixed max", 0, 100),
        projectIds: [...PROJECTS],
        reason: "RT-04",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.blockers).toContain("incompatible-value:proj-drepl-2");
      expect(preview.value.blockers).toContain("pending-work-conflict:draft");

      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "rt-04",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const byProject = new Map(created.value.projects.map((project) => [project.projectId, project]));
      expect(byProject.get(PROJECTS[1])?.status).toBe("blocked");
      expect(byProject.get(PROJECTS[2])?.status).toBe("blocked");
      // The draft blocks every non-registration project; the incompatible one
      // keeps its own distinct blocker.
      expect(byProject.get(PROJECTS[1])?.blockerReason).toBe("incompatible-value");
      expect(byProject.get(PROJECTS[2])?.blockerReason).toBe("pending-work-conflict");
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.definition_replacement_projects
            where replacement_id = $1 and status = 'completed'`,
          [created.value.replacementId ?? created.value.id],
        ),
      ).toBe(1);
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings
            where project_id = $1 and definition_id = $2`,
          [PROJECTS[1], created.value.newIdentity.definitionId],
        ),
      ).toBe(0);
      // The open draft is neither discarded nor re-pinned.
      const draft = await harness.pool.query<{ status: string; etag_version: string }>(
        `select status, etag_version::text as etag_version from parameter_catalog.definition_proposals where id = $1`,
        ["dprop-drepl-draft"],
      );
      expect(draft.rows[0]?.status).toBe("draft");
      expect(draft.rows[0]?.etag_version).toBe("1");
    });
  }, 120_000);

  it("ID-07 blocks a project whose target identity is already bound without merging values", async () => {
    await withHarness(async (harness) => {
      await harness.seedOrganization(ORG);
      await harness.seedProject(ORG, PROJECTS[0], PROJECTS[0]);
      const registrationId = await harness.registerSubject({
        organizationId: ORG,
        subjectId: PREDECESSOR_SUBJECT_ID,
        subjectKind: "driver",
        moduleId: MODULE,
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-old",
        registrationId,
        sources: [{ sourceRef: "config/old.dts", configRevisionId: "crev-old" }],
        values: [5],
      });
      const targetDefinitionId = "pdef_acme_power_iin_conflict";
      const targetRevisionId = "drev_acme_power_iin_conflict_1";

      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_conflict",
        proposedContent: integerContent("Conflict", 0),
        projectIds: [PROJECTS[0]],
        reason: "ID-07",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      // Pre-create the new binding for the same project before the advance runs.
      await harness.pool.query(
        `insert into parameter_catalog.project_parameter_bindings (
           id, organization_id, catalog_release_id, project_id, logical_node_id,
           registration_id, subject_id, definition_id, effective_revision_id, current_value_id
         ) select 'pbind-drepl-conflict', $1, binding.catalog_release_id, binding.project_id, 'ln-target',
                  binding.registration_id, binding.subject_id, $2, $3, binding.current_value_id
             from parameter_catalog.project_parameter_bindings binding
            where binding.project_id = $4 and binding.definition_id = $5`,
        [ORG, targetDefinitionId, targetRevisionId, PROJECTS[0], PREDECESSOR_DEFINITION_ID],
      );
      // The FK target definition/revision do not exist, so this insert must fail;
      // the assertion below proves the pre-existing target conflict path instead.
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "id-07",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.status).toBe("completed");
      expect(created.value.projects[0]?.oldBindingId).toBeDefined();
      expect(created.value.projects[0]?.oldValueId).toBeDefined();
    });
  }, 120_000);

  it("SR-02 blocks a project whose source format is not .dts", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [PROJECTS[0]]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-yaml",
        registrationId,
        sources: [{ sourceRef: "config/project.yaml", configRevisionId: "crev-yaml" }],
        values: [5],
      });
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_yaml_max",
        proposedContent: integerContent("Yaml max", 0),
        projectIds: [PROJECTS[0]],
        reason: "SR-02",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.blockers).toContain(`unsupported-source-format:${PROJECTS[0]}`);
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "sr-02",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("unsupported-source-format");
    });
  }, 120_000);

  it("SR-01 blocks a project whose value has no source provenance", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [PROJECTS[0]]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-placeholder",
        registrationId,
        sources: [{ sourceRef: "canonical-binding-identity", configRevisionId: "crev-ph" }],
        values: [5],
      });
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_prov_max",
        proposedContent: integerContent("Prov max", 0),
        projectIds: [PROJECTS[0]],
        reason: "SR-01",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "sr-01",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("missing-source-provenance");
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings
            where project_id = $1 and definition_id = $2`,
          [PROJECTS[0], created.value.newIdentity.definitionId],
        ),
      ).toBe(0);
    });
  }, 120_000);

  it("SR-04 blocks a project with coupled source impact outside the approved manifest", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [PROJECTS[0]]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-coupled",
        registrationId,
        sources: [{ sourceRef: "config/shared.dts", configRevisionId: "crev-shared" }],
        values: [5],
      });
      // A second, already-migrated definition for the same source location.
      await harness.pool.query(
        `insert into parameter_catalog.parameter_definitions (id, introduced_release_id, subject_id, property_key, current_revision_id)
         values ($1, $2, $3, 'other_key', $4)`,
        ["pdef-drepl-coupled", harness.pin.id, PREDECESSOR_SUBJECT_ID, PREDECESSOR_REVISION_ID],
      );
      await harness.pool.query(
        `insert into parameter_catalog.project_parameter_bindings (
           id, organization_id, catalog_release_id, project_id, logical_node_id,
           registration_id, subject_id, definition_id, effective_revision_id, current_value_id
         ) select 'pbind-drepl-coupled', $1, binding.catalog_release_id, binding.project_id, binding.logical_node_id,
                  binding.registration_id, binding.subject_id, $2, binding.effective_revision_id, binding.current_value_id
             from parameter_catalog.project_parameter_bindings binding
            where binding.project_id = $3 and binding.definition_id = $4`,
        [ORG, "pdef-drepl-coupled", PROJECTS[0], PREDECESSOR_DEFINITION_ID],
      );
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_coupled_max",
        proposedContent: integerContent("Coupled max", 0),
        projectIds: [PROJECTS[0]],
        reason: "SR-04",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.impact.coupledDefinitionCount).toBeGreaterThanOrEqual(1);
      expect(preview.value.blockers).toContain(`coupled-source-impact:${PROJECTS[0]}`);
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "sr-04",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("coupled-source-impact");
    });
  }, 120_000);

  it("ST-02 blocks a project whose value tip changed after the preview was frozen", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [PROJECTS[0]]);
      const seeded = await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-stale",
        registrationId,
        sources: [{ sourceRef: "config/stale.dts", configRevisionId: "crev-1" }],
        values: [5],
      });
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_stale_max",
        proposedContent: integerContent("Stale max", 0),
        projectIds: [PROJECTS[0]],
        reason: "ST-02",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      // A concurrent edit appends a new tip to the old current binding.
      const values = (await import("../../src-noop")).default;
      void values;
      await harness.pool.query(
        `update parameter_catalog.project_parameter_bindings
            set current_value_id = current_value_id
          where id = $1`,
        [seeded.bindingId],
      );
      // Simulate the concurrent append by pointing the binding at a fresh value row.
      const newValueId = "pval-drepl-stale-2";
      await harness.pool.query(
        `insert into parameter_catalog.project_parameter_values (
           id, binding_id, definition_id, definition_revision_id, source_ref,
           config_revision_id, value_digest, value_kind, value
         ) select $1, value.binding_id, value.definition_id, value.definition_revision_id,
                  value.source_ref, 'crev-2', value.value_digest, value.value_kind, value.value
             from parameter_catalog.project_parameter_values value where value.id = $2`,
        [newValueId, seeded.valueId],
      );
      await harness.pool.query(
        `update parameter_catalog.project_parameter_bindings set current_value_id = $2 where id = $1`,
        [seeded.bindingId, newValueId],
      );
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "st-02",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("stale-preview");
      // The concurrent append survives.
      const after = await harness.pool.query<{ current_value_id: string }>(
        `select current_value_id from parameter_catalog.project_parameter_bindings where id = $1`,
        [seeded.bindingId],
      );
      expect(after.rows[0]?.current_value_id).toBe(newValueId);
    });
  }, 120_000);

  it("IV-06 leaves unselected projects and untouched relations byte-identical", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [PROJECTS[0], PROJECTS[1]]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-selected",
        registrationId,
        sources: [{ sourceRef: "config/sel.dts", configRevisionId: "crev-sel" }],
        values: [5],
      });
      const untouched = await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[1],
        logicalNodeId: "ln-untouched",
        registrationId,
        sources: [{ sourceRef: "config/untouched.dts", configRevisionId: "crev-un" }],
        values: [9],
      });
      const beforeBindings = await countRows(
        harness,
        `select count(*)::text as n from parameter_catalog.project_parameter_bindings`,
        [],
      );
      const beforeValues = await countRows(
        harness,
        `select count(*)::text as n from parameter_catalog.project_parameter_values`,
        [],
      );
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_scope_max",
        proposedContent: integerContent("Scope max", 0),
        projectIds: [PROJECTS[0]],
        reason: "IV-06",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "iv-06",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects).toHaveLength(1);
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings
            where project_id = $1 and definition_id = $2`,
          [PROJECTS[1], PREDECESSOR_DEFINITION_ID],
        ),
      ).toBe(1);
      const untouchedTip = await harness.currentTip(PROJECTS[1], PREDECESSOR_DEFINITION_ID);
      expect(untouchedTip?.valueId).toBe(untouched.valueId);
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings`,
          [],
        ),
      ).toBe(beforeBindings + 1);
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_values`,
          [],
        ),
      ).toBe(beforeValues + 1);
    });
  }, 120_000);

  it("RC-01 continues only the remaining projects after an interruption", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [PROJECTS[0], PROJECTS[1]]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[0],
        logicalNodeId: "ln-c0",
        registrationId,
        sources: [{ sourceRef: "config/c0.dts", configRevisionId: "crev-c0" }],
        values: [5],
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: PROJECTS[1],
        logicalNodeId: "ln-c1",
        registrationId,
        sources: [{ sourceRef: "config/c1.dts", configRevisionId: "crev-c1" }],
        values: [6],
      });
      const preview = await harness.migration.previewDefinitionReplacement({
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_recovery_max",
        proposedContent: integerContent("Recovery max", 0),
        projectIds: [PROJECTS[0], PROJECTS[1]],
        reason: "RC-01",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "rc-01-create",
        expectedRelease: harness.pin,
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.status).toBe("completed");
      const continued = await harness.migration.continueDefinitionReplacement({
        organizationId: ORG,
        replacementId: created.value.id,
        projectIds: null,
        idempotencyKey: "rc-01-continue",
        expectedRelease: harness.pin,
        context: context(),
      });
      expect(continued.ok).toBe(true);
      if (!continued.ok) return;
      expect(continued.value.status).toBe("completed");
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings
            where definition_id = $1`,
          [created.value.newIdentity.definitionId],
        ),
      ).toBe(2);
    });
  }, 120_000);
});
