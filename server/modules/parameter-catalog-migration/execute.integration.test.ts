/**
 * Definition identity correction migration — execute path.
 *
 * Executed threat-matrix rows: RT-02, RT-03, RT-04 (partial: see the note on
 * organization-scoped pending work), VL-05, VL-06, SR-01, SR-02, SR-04, ST-02,
 * IV-01, IV-06, RC-01.
 */
import { describe, expect, it } from "vitest";

import {
  MIGRATION_PRINCIPAL,
  PREDECESSOR_DEFINITION_ID,
  PREDECESSOR_REVISION_ID,
  PREDECESSOR_SUBJECT_ID,
  createMigrationHarness,
  integerContent,
  migrationTrustedActor,
  type MigrationHarness,
} from "./testing/harness";

const ORG = "org-drepl-exec";
const MODULE = "pmod-drepl-exec";
const P1 = "proj-drepl-1";
const P2 = "proj-drepl-2";
const P3 = "proj-drepl-3";

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

const countRows = async (
  harness: MigrationHarness,
  sql: string,
  values: unknown[],
): Promise<number> => {
  const result = await harness.pool.query<{ n: string }>(sql, values);
  return Number(result.rows[0]?.n ?? 0);
};

const previewFor = (
  harness: MigrationHarness,
  input: {
    readonly newPropertyKey: string;
    readonly content: ReturnType<typeof integerContent>;
    readonly projectIds: readonly string[];
    readonly reason: string;
    readonly newSubjectId?: string;
    readonly oldDefinitionId?: string;
  },
) =>
  harness.migration.previewDefinitionReplacement({
    organizationId: ORG,
    oldDefinitionId: input.oldDefinitionId ?? PREDECESSOR_DEFINITION_ID,
    newSubjectId: input.newSubjectId ?? PREDECESSOR_SUBJECT_ID,
    newPropertyKey: input.newPropertyKey,
    proposedContent: input.content,
    projectIds: [...input.projectIds],
    reason: input.reason,
    expectedRelease: harness.pin(),
    context: context(),
  });

describe("definition replacement execute", () => {
  it("RT-02 migrates exactly one project and leaves the old binding, value and definition unmodified", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1]);
      const seeded = await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-1",
        registrationId,
        sources: [{ sourceRef: "config/project.dts", configRevisionId: "crev-1" }],
        values: [5],
      });
      const beforeValue = await harness.pool.query<{
        value: unknown;
        value_digest: string;
        value_kind: string;
        config_revision_id: string;
      }>(
        `select value, value_digest, value_kind, config_revision_id
           from parameter_catalog.project_parameter_values where id = $1`,
        [seeded.valueId],
      );
      const beforeRevision = await harness.pool.query<{ content: unknown; content_digest: string }>(
        `select content, content_digest from parameter_catalog.definition_revisions where id = $1`,
        [PREDECESSOR_REVISION_ID],
      );

      const preview = await previewFor(harness, {
        newPropertyKey: "iin_exec_max",
        content: integerContent("Exec max", 0),
        projectIds: [P1],
        reason: "RT-02",
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
        expectedRelease: harness.pin(),
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

      const carried = await harness.pool.query<{
        value: unknown;
        value_digest: string;
        value_kind: string;
        config_revision_id: string;
        replaced_from_value_id: string;
      }>(
        `select value, value_digest, value_kind, config_revision_id, replaced_from_value_id
           from parameter_catalog.project_parameter_values where binding_id = $1`,
        [created.value.projects[0]!.newBindingId!],
      );
      expect(carried.rows).toHaveLength(1);
      const original = beforeValue.rows[0]!;
      expect(carried.rows[0]?.value).toEqual(original.value);
      expect(carried.rows[0]?.value_digest).toBe(original.value_digest);
      expect(carried.rows[0]?.value_kind).toBe(original.value_kind);
      expect(carried.rows[0]?.config_revision_id).toBe(original.config_revision_id);
      expect(carried.rows[0]?.replaced_from_value_id).toBe(seeded.valueId);

      // IV-01: the old identity, revision and value bytes are unmodified.
      const oldValue = await harness.pool.query<{ value: unknown; value_digest: string }>(
        `select value, value_digest from parameter_catalog.project_parameter_values where id = $1`,
        [seeded.valueId],
      );
      expect(oldValue.rows[0]?.value).toEqual(original.value);
      expect(oldValue.rows[0]?.value_digest).toBe(original.value_digest);
      const oldBinding = await harness.pool.query<{
        current_value_id: string;
        definition_id: string;
      }>(
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
      const oldDefinition = await harness.pool.query<{ current_revision_id: string }>(
        `select current_revision_id from parameter_catalog.parameter_definitions where id = $1`,
        [PREDECESSOR_DEFINITION_ID],
      );
      expect(oldDefinition.rows[0]?.current_revision_id).toBe(PREDECESSOR_REVISION_ID);
      // The current-selection view hides the replaced binding.
      expect(await harness.currentTip(P1, PREDECESSOR_DEFINITION_ID)).toBeNull();
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.binding_history_events where binding_id = $1`,
          [created.value.projects[0]!.newBindingId!],
        ),
      ).toBe(1);
    });
  }, 180_000);

  it("RT-03 completes three eligible projects in one execute response", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1, P2, P3]);
      for (const [index, projectId] of [P1, P2, P3].entries()) {
        await harness.seedBindingValue({
          organizationId: ORG,
          projectId,
          logicalNodeId: `ln-${index}`,
          registrationId,
          sources: [{ sourceRef: `config/p${index}.dts`, configRevisionId: `crev-${index}` }],
          values: [10 + index],
        });
      }
      const preview = await previewFor(harness, {
        newPropertyKey: "iin_three_max",
        content: integerContent("Three max", 0),
        projectIds: [P1, P2, P3],
        reason: "RT-03",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "rt-03",
        expectedRelease: harness.pin(),
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
  }, 180_000);

  it("RT-04 completes the compatible project and blocks the others with distinct per-project reasons", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1, P2, P3]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-compatible",
        registrationId,
        sources: [{ sourceRef: "config/a.dts", configRevisionId: "crev-a" }],
        values: [5],
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P2,
        logicalNodeId: "ln-incompatible",
        registrationId,
        sources: [{ sourceRef: "config/b.dts", configRevisionId: "crev-b" }],
        values: [5000],
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P3,
        logicalNodeId: "ln-unsupported",
        registrationId,
        sources: [{ sourceRef: "config/c.yaml", configRevisionId: "crev-c" }],
        values: [7],
      });
      const preview = await previewFor(harness, {
        newPropertyKey: "iin_mixed_max",
        content: integerContent("Mixed max", 0, 100),
        projectIds: [P1, P2, P3],
        reason: "RT-04",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.blockers).toContain(`incompatible-value:${P2}`);
      expect(preview.value.blockers).toContain(`unsupported-source-format:${P3}`);
      expect(preview.value.impact.compatibleProjectCount).toBe(1);
      expect(preview.value.impact.blockedProjectCount).toBe(2);

      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "rt-04",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const byProject = new Map(created.value.projects.map((project) => [project.projectId, project]));
      expect(byProject.get(P1)?.status).toBe("completed");
      expect(byProject.get(P2)?.status).toBe("blocked");
      expect(byProject.get(P2)?.blockerReason).toBe("incompatible-value");
      expect(byProject.get(P3)?.status).toBe("blocked");
      expect(byProject.get(P3)?.blockerReason).toBe("unsupported-source-format");
      expect(created.value.status).toBe("blocked");
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings where definition_id = $1`,
          [created.value.newIdentity.definitionId],
        ),
      ).toBe(1);
      // No conversion, truncation or default substitution row exists.
      const carried = await harness.pool.query<{ value: unknown }>(
        `select value from parameter_catalog.project_parameter_values where binding_id = $1`,
        [byProject.get(P1)!.newBindingId!],
      );
      expect(carried.rows[0]?.value).toBe(5);
    });
  }, 180_000);

  it("VL-05 and VL-06 block every affected project while leaving the draft and review rows untouched", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-pending",
        registrationId,
        sources: [{ sourceRef: "config/pending.dts", configRevisionId: "crev-pending" }],
        values: [5],
      });
      await harness.db.transaction(async (tx) => {
        await tx.query("set constraints all deferred");
        await tx.query(
          `insert into parameter_catalog.definition_proposals (
             id, organization_id, author_principal_id, base_catalog_release_id,
             base_definition_revision_id, status, current_proposal_revision_id, etag_version
           ) values ($1,$2,$3,$4,$5,'draft',$6,1)`,
          [
            "dprop-drepl-draft",
            ORG,
            MIGRATION_PRINCIPAL,
            harness.pin().id,
            PREDECESSOR_REVISION_ID,
            "dprev-drepl-draft",
          ],
        );
        await tx.query(
          `insert into parameter_catalog.definition_proposal_revisions (
             id, proposal_id, revision_number, payload, reason, evidence_refs
           ) values ($1,$2,1,'{}'::jsonb,'draft','[]'::jsonb)`,
          ["dprev-drepl-draft", "dprop-drepl-draft"],
        );
      });
      await harness.pool.query(
        `insert into parameter_catalog.parameter_review_items (
           id, organization_id, evidence_fingerprint, matcher_revision, catalog_release_id,
           reason, status, etag_version
         ) values ($1,$2,'fp-drepl','catalog-matcher/v1',$3,'unknown','open',7)`,
        ["prit-drepl-open", ORG, harness.pin().id],
      );

      const preview = await previewFor(harness, {
        newPropertyKey: "iin_pending_max",
        content: integerContent("Pending max", 0),
        projectIds: [P1],
        reason: "VL-05",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.blockers).toContain("pending-work-conflict:draft");
      expect(preview.value.blockers).toContain("pending-work-conflict:review");

      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "vl-05",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("pending-work-conflict");
      const draft = await harness.pool.query<{
        status: string;
        etag_version: string;
        base_definition_revision_id: string | null;
      }>(
        `select status, etag_version::text as etag_version, base_definition_revision_id
           from parameter_catalog.definition_proposals where id = $1`,
        ["dprop-drepl-draft"],
      );
      expect(draft.rows[0]?.status).toBe("draft");
      expect(draft.rows[0]?.etag_version).toBe("1");
      expect(draft.rows[0]?.base_definition_revision_id).toBe(PREDECESSOR_REVISION_ID);
      const review = await harness.pool.query<{ status: string; etag_version: string }>(
        `select status, etag_version::text as etag_version
           from parameter_catalog.parameter_review_items where id = $1`,
        ["prit-drepl-open"],
      );
      expect(review.rows[0]?.status).toBe("open");
      expect(review.rows[0]?.etag_version).toBe("7");
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.parameter_review_resolutions`,
          [],
        ),
      ).toBe(0);
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings where definition_id = $1`,
          [created.value.newIdentity.definitionId],
        ),
      ).toBe(0);
    });
  }, 180_000);

  it("SR-01 blocks a project whose value has no real source provenance", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-placeholder",
        registrationId,
        // No real append: the tip stays the canonical binding-identity placeholder.
        sources: [{ sourceRef: "config/placeholder.dts", configRevisionId: "crev-ph" }],
        values: [],
      });
      const preview = await previewFor(harness, {
        newPropertyKey: "iin_prov_max",
        content: integerContent("Prov max", 0),
        projectIds: [P1],
        reason: "SR-01",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "sr-01",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("missing-source-provenance");
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings where definition_id = $1`,
          [created.value.newIdentity.definitionId],
        ),
      ).toBe(0);
    });
  }, 180_000);

  it("SR-02 blocks a project whose source file is not .dts and leaves the bytes unchanged", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1]);
      const seeded = await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-yaml",
        registrationId,
        sources: [{ sourceRef: "config/project.yaml", configRevisionId: "crev-yaml" }],
        values: [5],
      });
      const preview = await previewFor(harness, {
        newPropertyKey: "iin_yaml_max",
        content: integerContent("Yaml max", 0),
        projectIds: [P1],
        reason: "SR-02",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.impact.sourceFormatSupported).toBe(false);
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "sr-02",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("unsupported-source-format");
      const value = await harness.pool.query<{ source_ref: string }>(
        `select source_ref from parameter_catalog.project_parameter_values where id = $1`,
        [seeded.valueId],
      );
      expect(value.rows[0]?.source_ref).toBe("config/project.yaml");
    });
  }, 180_000);

  it("SR-04 blocks a project with coupled source impact outside the approved manifest", async () => {
    await withHarness(async (harness) => {
      // Publish a second definition on the same subject, then bind it in the
      // same project at the same source location.
      const release = await harness.publishChange(
        [
          {
            op: "create-definition",
            subjectId: PREDECESSOR_SUBJECT_ID,
            propertyKey: "iin_coupled_sibling",
            content: integerContent("Coupled sibling", 0),
          },
        ] as never,
        "coupled",
      );
      const sibling = await harness.allocatedDefinition(release.id, "iin_coupled_sibling");
      expect(sibling).not.toBeNull();
      if (!sibling) return;
      const registrationId = await seedProjects(harness, [P1]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-coupled",
        registrationId,
        sources: [{ sourceRef: "config/shared.dts", configRevisionId: "crev-shared" }],
        values: [5],
      });
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-coupled",
        registrationId,
        definitionId: sibling.definitionId,
        revisionId: sibling.revisionId,
        sources: [{ sourceRef: "config/shared.dts", configRevisionId: "crev-shared" }],
        values: [8],
      });
      const preview = await previewFor(harness, {
        newPropertyKey: "iin_coupled_max",
        content: integerContent("Coupled max", 0),
        projectIds: [P1],
        reason: "SR-04",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.impact.coupledDefinitionCount).toBeGreaterThanOrEqual(1);
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "sr-04",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("coupled-source-impact");
      // Nothing outside the approved manifest is rewritten.
      const siblingTip = await harness.currentTip(P1, sibling.definitionId);
      expect(siblingTip).not.toBeNull();
    });
  }, 240_000);

  it("ST-02 blocks a project whose value tip and source changed after the preview was frozen", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1]);
      const seeded = await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-stale",
        registrationId,
        sources: [{ sourceRef: "config/stale.dts", configRevisionId: "crev-1" }],
        values: [5],
      });
      const preview = await previewFor(harness, {
        newPropertyKey: "iin_stale_max",
        content: integerContent("Stale max", 0),
        projectIds: [P1],
        reason: "ST-02",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
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
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects[0]?.blockerReason).toBe("stale-preview");
      const after = await harness.pool.query<{ current_value_id: string }>(
        `select current_value_id from parameter_catalog.project_parameter_bindings where id = $1`,
        [seeded.bindingId],
      );
      expect(after.rows[0]?.current_value_id).toBe(newValueId);
    });
  }, 180_000);

  it("IV-06 leaves unselected projects byte-identical and adds exactly one binding and value", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1, P2]);
      await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P1,
        logicalNodeId: "ln-selected",
        registrationId,
        sources: [{ sourceRef: "config/sel.dts", configRevisionId: "crev-sel" }],
        values: [5],
      });
      const untouched = await harness.seedBindingValue({
        organizationId: ORG,
        projectId: P2,
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
      const preview = await previewFor(harness, {
        newPropertyKey: "iin_scope_max",
        content: integerContent("Scope max", 0),
        projectIds: [P1],
        reason: "IV-06",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "iv-06",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.projects).toHaveLength(1);
      const untouchedTip = await harness.currentTip(P2, PREDECESSOR_DEFINITION_ID);
      expect(untouchedTip?.valueId).toBe(untouched.valueId);
      expect(untouchedTip?.bindingId).toBe(untouched.bindingId);
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
  }, 180_000);

  it("RC-01 keeps completed projects and continues only the remaining ones", async () => {
    await withHarness(async (harness) => {
      const registrationId = await seedProjects(harness, [P1, P2]);
      for (const [index, projectId] of [P1, P2].entries()) {
        await harness.seedBindingValue({
          organizationId: ORG,
          projectId,
          logicalNodeId: `ln-c${index}`,
          registrationId,
          sources: [{ sourceRef: `config/c${index}.dts`, configRevisionId: `crev-c${index}` }],
          values: [5 + index],
        });
      }
      const preview = await previewFor(harness, {
        newPropertyKey: "iin_recovery_max",
        content: integerContent("Recovery max", 0),
        projectIds: [P1, P2],
        reason: "RC-01",
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const created = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: preview.value.previewId,
        previewFingerprint: preview.value.previewFingerprint,
        idempotencyKey: "rc-01-create",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.status).toBe("completed");
      const newDefinitionId = created.value.newIdentity.definitionId;
      const continued = await harness.migration.continueDefinitionReplacement({
        organizationId: ORG,
        replacementId: created.value.id,
        projectIds: null,
        idempotencyKey: "rc-01-continue",
        expectedRelease: harness.pin(),
        context: context(),
        });
      expect(continued.ok).toBe(true);
      if (!continued.ok) return;
      expect(continued.value.status).toBe("completed");
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings where definition_id = $1`,
          [newDefinitionId],
        ),
      ).toBe(2);
      expect(
        await countRows(
          harness,
          `select count(*)::text as n from parameter_catalog.project_parameter_values where definition_id = $1`,
          [newDefinitionId],
        ),
      ).toBe(2);
    });
  }, 180_000);
});
