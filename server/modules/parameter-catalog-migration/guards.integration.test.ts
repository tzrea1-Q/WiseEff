/**
 * Definition identity correction migration — persisted guards, idempotency and
 * authorization.
 *
 * Executed threat-matrix rows: RC-02, RC-03, RC-04, RC-05, RC-06, IV-03, IV-05,
 * IV-09, IV-10, TN-03, TN-04, AU-03, ST-04.
 */
import { describe, expect, it } from "vitest";

import {
  MIGRATION_PRINCIPAL,
  PREDECESSOR_DEFINITION_ID,
  PREDECESSOR_SUBJECT_ID,
  createMigrationHarness,
  integerContent,
  migrationTrustedActor,
  type MigrationHarness,
} from "./testing/harness";

const ORG = "org-drepl-guards";
const MODULE = "pmod-drepl-guards";
const P1 = "proj-guards-1";
const P2 = "proj-guards-2";

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

const seed = async (harness: MigrationHarness, projectIds: readonly string[]) => {
  await harness.seedOrganization(ORG);
  for (const projectId of projectIds) {
    await harness.seedProject(ORG, projectId, projectId);
  }
  const registrationId = await harness.registerSubject({
    organizationId: ORG,
    subjectId: PREDECESSOR_SUBJECT_ID,
    subjectKind: "driver",
    moduleId: MODULE,
  });
  for (const [index, projectId] of projectIds.entries()) {
    await harness.seedBindingValue({
      organizationId: ORG,
      projectId,
      logicalNodeId: `ln-${index}`,
      registrationId,
      sources: [{ sourceRef: `config/g${index}.dts`, configRevisionId: `crev-${index}` }],
      values: [5 + index],
    });
  }
  return registrationId;
};

const runReplacement = async (
  harness: MigrationHarness,
  input: {
    readonly propertyKey: string;
    readonly projectIds: readonly string[];
    readonly idempotencyKey: string;
    readonly content?: ReturnType<typeof integerContent>;
  },
) => {
  const preview = await harness.migration.previewDefinitionReplacement({
    organizationId: ORG,
    oldDefinitionId: PREDECESSOR_DEFINITION_ID,
    newSubjectId: PREDECESSOR_SUBJECT_ID,
    newPropertyKey: input.propertyKey,
    proposedContent: input.content ?? integerContent("Guards", 0),
    projectIds: [...input.projectIds],
    reason: "guards",
    expectedRelease: harness.pin(),
    context: context(),
  });
  if (!preview.ok) return { preview, created: null } as const;
  const created = await harness.migration.createDefinitionReplacement({
    organizationId: ORG,
    previewId: preview.value.previewId,
    previewFingerprint: preview.value.previewFingerprint,
    idempotencyKey: input.idempotencyKey,
    expectedRelease: harness.pin(),
    context: context(),
    trustedActor: migrationTrustedActor(),
  });
  return { preview, created } as const;
};

describe("definition replacement guards", () => {
  it("RC-02 and RC-03 replay the same key and reject the same key with a different body", async () => {
    await withHarness(async (harness) => {
      await seed(harness, [P1]);
      const first = await runReplacement(harness, {
        propertyKey: "iin_replay",
        projectIds: [P1],
        idempotencyKey: "rc-02",
      });
      expect(first.created?.ok).toBe(true);
      if (!first.created?.ok || !first.preview.ok) return;
      const bindings = await harness.pool.query<{ n: string }>(
        `select count(*)::text as n from parameter_catalog.project_parameter_bindings`,
      );
      const values = await harness.pool.query<{ n: string }>(
        `select count(*)::text as n from parameter_catalog.project_parameter_values`,
      );
      const history = await harness.pool.query<{ n: string }>(
        `select count(*)::text as n from parameter_catalog.binding_history_events`,
      );

      // Same key, same body: replayed with identical row counts.
      const replay = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: first.preview.value.previewId,
        previewFingerprint: first.preview.value.previewFingerprint,
        idempotencyKey: "rc-02",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      expect(replay.value.id).toBe(first.created.value.id);
      expect(
        (await harness.pool.query<{ n: string }>(
          `select count(*)::text as n from parameter_catalog.project_parameter_bindings`,
        )).rows[0]?.n,
      ).toBe(bindings.rows[0]?.n);
      expect(
        (await harness.pool.query<{ n: string }>(
          `select count(*)::text as n from parameter_catalog.project_parameter_values`,
        )).rows[0]?.n,
      ).toBe(values.rows[0]?.n);
      expect(
        (await harness.pool.query<{ n: string }>(
          `select count(*)::text as n from parameter_catalog.binding_history_events`,
        )).rows[0]?.n,
      ).toBe(history.rows[0]?.n);

      // Same key, different body: revision conflict, nothing written.
      const conflicting = await harness.migration.createDefinitionReplacement({
        organizationId: ORG,
        previewId: first.preview.value.previewId,
        previewFingerprint:
          first.preview.value.previewFingerprint.slice(0, -1) +
          (first.preview.value.previewFingerprint.endsWith("0") ? "1" : "0"),
        idempotencyKey: "rc-02",
        expectedRelease: harness.pin(),
        context: context(),
        trustedActor: migrationTrustedActor(),
      });
      expect(conflicting.ok).toBe(false);
      if (conflicting.ok) return;
      expect(conflicting.error.kind).toBe("revision-conflict");
    });
  }, 240_000);

  it("RC-04, RC-05 and RC-06 replay continue, stay idempotent when nothing is blocked and refuse a project outside the manifest", async () => {
    await withHarness(async (harness) => {
      await seed(harness, [P1, P2]);
      const created = await runReplacement(harness, {
        propertyKey: "iin_continue",
        projectIds: [P1, P2],
        idempotencyKey: "rc-04-create",
      });
      expect(created.created?.ok).toBe(true);
      if (!created.created?.ok) return;
      const replacementId = created.created.value.id;
      const valuesBefore = await harness.pool.query<{ n: string }>(
        `select count(*)::text as n from parameter_catalog.project_parameter_values`,
      );

      // RC-06: a project outside the approved manifest is refused.
      const outside = await harness.migration.continueDefinitionReplacement({
        organizationId: ORG,
        replacementId,
        projectIds: [P1, "proj-not-in-manifest"],
        idempotencyKey: "rc-06",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(outside.ok).toBe(false);
      if (outside.ok) return;
      expect(outside.error).toEqual({
        kind: "invalid-command",
        reason: "project-outside-approved-manifest",
      });

      // RC-05: every project is already completed; continue is a no-op.
      const noop = await harness.migration.continueDefinitionReplacement({
        organizationId: ORG,
        replacementId,
        projectIds: null,
        idempotencyKey: "rc-05",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(noop.ok).toBe(true);
      if (!noop.ok) return;
      expect(noop.value.status).toBe("completed");
      expect(
        (await harness.pool.query<{ n: string }>(
          `select count(*)::text as n from parameter_catalog.project_parameter_values`,
        )).rows[0]?.n,
      ).toBe(valuesBefore.rows[0]?.n);

      // RC-04: the same continue idempotency key replays.
      const replay = await harness.migration.continueDefinitionReplacement({
        organizationId: ORG,
        replacementId,
        projectIds: null,
        idempotencyKey: "rc-05",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) return;
      expect(replay.value.status).toBe("completed");
      expect(
        (await harness.pool.query<{ n: string }>(
          `select count(*)::text as n from parameter_catalog.project_parameter_values`,
        )).rows[0]?.n,
      ).toBe(valuesBefore.rows[0]?.n);
    });
  }, 240_000);

  it("IV-03 admits exactly one non-failed successor per old definition", async () => {
    await withHarness(async (harness) => {
      await seed(harness, [P1]);
      const created = await runReplacement(harness, {
        propertyKey: "iin_successor_slot",
        projectIds: [P1],
        idempotencyKey: "iv-03",
      });
      expect(created.created?.ok).toBe(true);
      if (!created.created?.ok) return;
      const existing = await harness.pool.query<Record<string, unknown>>(
        `select * from parameter_catalog.definition_replacements where id = $1`,
        [created.created.value.id],
      );
      const row = existing.rows[0]!;
      await expect(
        harness.pool.query(
          `insert into parameter_catalog.definition_replacements (
             id, organization_id, status, replacement_version,
             old_definition_id, old_subject_id, old_property_key, old_revision_id,
             new_definition_id, new_subject_id, new_property_key, new_revision_id,
             preview_fingerprint, preview_catalog_release_id, preview_catalog_release_digest,
             source_preview_id, frozen_manifest, candidate_id, publication_job_id,
             authorization_id, successor_release_id, successor_release_digest,
             approval_principal_id, reason
           ) select 'drep-drepl-second', organization_id, 'blocked', 1,
                    old_definition_id, old_subject_id, old_property_key, old_revision_id,
                    new_definition_id, new_subject_id, new_property_key, new_revision_id,
                    preview_fingerprint, preview_catalog_release_id, preview_catalog_release_digest,
                    source_preview_id, frozen_manifest, candidate_id, publication_job_id,
                    authorization_id, successor_release_id, successor_release_digest,
                    approval_principal_id, reason
               from parameter_catalog.definition_replacements where id = $1`,
          [row.id],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "definition_replacements_current_successor_unique",
      });
    });
  }, 240_000);

  it("IV-05 rejects a value naming a replaced current binding at the database layer", async () => {
    await withHarness(async (harness) => {
      await seed(harness, [P1]);
      const created = await runReplacement(harness, {
        propertyKey: "iin_old_write",
        projectIds: [P1],
        idempotencyKey: "iv-05",
      });
      expect(created.created?.ok).toBe(true);
      if (!created.created?.ok) return;
      const oldBindingId = created.created.value.projects[0]!.oldBindingId;
      const oldValueId = created.created.value.projects[0]!.oldValueId;
      const writer = await harness.pool.connect();
      try {
        await writer.query("begin");
        await writer.query("set constraints all deferred");
        await writer.query(
          `insert into parameter_catalog.project_parameter_values (
             id, binding_id, definition_id, definition_revision_id, source_ref,
             config_revision_id, value_digest, value_kind, value
           ) select 'pval-drepl-illegal', binding_id, definition_id, definition_revision_id,
                    source_ref, 'crev-illegal', value_digest, value_kind, value
               from parameter_catalog.project_parameter_values where id = $1`,
          [oldValueId],
        );
        await expect(writer.query("set constraints all immediate")).rejects.toMatchObject({
          code: "55000",
          constraint: "project_value_current_binding_ck",
        });
      } finally {
        await writer.query("rollback").catch(() => undefined);
        writer.release();
      }
      expect(oldBindingId).toBeTruthy();
    });
  }, 240_000);

  it("TN-04 rejects a manifest row whose binding belongs to another project or organization", async () => {
    await withHarness(async (harness) => {
      await seed(harness, [P1, P2]);
      const created = await runReplacement(harness, {
        propertyKey: "iin_tenant",
        projectIds: [P1],
        idempotencyKey: "tn-04",
      });
      expect(created.created?.ok).toBe(true);
      if (!created.created?.ok) return;
      const manifest = await harness.pool.query<{ id: string; old_binding_id: string; old_value_id: string }>(
        `select id, old_binding_id, old_value_id from parameter_catalog.definition_replacement_projects
          where replacement_id = $1`,
        [created.created.value.id],
      );
      const row = manifest.rows[0]!;
      // The manifest may only name the binding owned by its own project and
      // organization: the composite FK carries (binding, organization, project).
      // `(old_binding_id, organization_id, project_id)` must agree: P1's
      // binding cannot be declared against P2 in the same organization.
      await expect(
        harness.pool.query(
          `insert into parameter_catalog.definition_replacement_projects (
             id, replacement_id, organization_id, project_id, status,
             old_binding_id, old_value_id, old_definition_id, new_definition_id
           ) values ('drepp-drepl-tenant', $1, $2, $3, 'pending', $4, $5, $6, $7)`,
          [
            created.created.value.id,
            ORG,
            P2,
            row.old_binding_id,
            row.old_value_id,
            PREDECESSOR_DEFINITION_ID,
            created.created.value.newIdentity.definitionId,
          ],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });
  }, 240_000);

  it("IV-09 and IV-10 expose an organization-wide retirement evidence count and never prove completion from a scoped manifest", async () => {
    await withHarness(async (harness) => {
      await seed(harness, [P1, P2]);
      const created = await runReplacement(harness, {
        propertyKey: "iin_retire",
        projectIds: [P1],
        idempotencyKey: "iv-09",
      });
      expect(created.created?.ok).toBe(true);
      if (!created.created?.ok) return;
      const evidence = await harness.migration.loadDefinitionRetirementEvidence({
        organizationId: ORG,
        definitionId: PREDECESSOR_DEFINITION_ID,
      });
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) return;
      // P2 still binds the old definition, so retirement must not be offered.
      expect(evidence.value.remainingCurrentReferenceCount).toBe(1);
      expect(evidence.value.projectIds).toEqual([P2]);
      expect(evidence.value.authoritative).toBe(true);

      // Complete P2 as well; only then does the organization-wide count reach zero.
      const continued = await harness.migration.continueDefinitionReplacement({
        organizationId: ORG,
        replacementId: created.created.value.id,
        projectIds: null,
        idempotencyKey: "iv-09-continue",
        expectedRelease: harness.pin(),
        context: context(),
      });
      expect(continued.ok).toBe(true);
      // P2 was never in the approved manifest, so it is still bound.
      const after = await harness.migration.loadDefinitionRetirementEvidence({
        organizationId: ORG,
        definitionId: PREDECESSOR_DEFINITION_ID,
      });
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(after.value.remainingCurrentReferenceCount).toBe(1);
      expect(after.value.projectIds).toEqual([P2]);
    });
  }, 240_000);

  it("TN-03, AU-03 and ST-04 refuse the write for a non-organization-admin or changed trusted context", async () => {
    await withHarness(async (harness) => {
      await seed(harness, [P1]);
      const base = {
        organizationId: ORG,
        oldDefinitionId: PREDECESSOR_DEFINITION_ID,
        newSubjectId: PREDECESSOR_SUBJECT_ID,
        newPropertyKey: "iin_authz",
        proposedContent: integerContent("Authz", 0),
        projectIds: [P1],
        reason: "authz",
        expectedRelease: harness.pin(),
      };
      const platformAdmin = await harness.migration.previewDefinitionReplacement({
        ...base,
        context: { actorKind: "platform-admin", principalId: MIGRATION_PRINCIPAL },
      });
      expect(platformAdmin.ok).toBe(false);
      if (!platformAdmin.ok) expect(platformAdmin.error.kind).toBe("permission-denied");

      const orgMember = await harness.migration.previewDefinitionReplacement({
        ...base,
        context: { actorKind: "org-member", principalId: MIGRATION_PRINCIPAL, organizationId: ORG },
      });
      expect(orgMember.ok).toBe(false);
      if (!orgMember.ok) expect(orgMember.error.kind).toBe("permission-denied");

      const agent = await harness.migration.previewDefinitionReplacement({
        ...base,
        context: { actorKind: "agent", principalId: MIGRATION_PRINCIPAL },
      });
      expect(agent.ok).toBe(false);
      if (!agent.ok) expect(agent.error.kind).toBe("permission-denied");

      // A capable actor belonging to another organization is refused too.
      const crossOrg = await harness.migration.previewDefinitionReplacement({
        ...base,
        context: {
          actorKind: "org-admin",
          principalId: MIGRATION_PRINCIPAL,
          organizationId: "org-other-tenant",
        },
      });
      expect(crossOrg.ok).toBe(false);
      if (!crossOrg.ok) expect(crossOrg.error.kind).toBe("permission-denied");

      const replacements = await harness.pool.query<{ n: string }>(
        `select count(*)::text as n from parameter_catalog.definition_replacements`,
      );
      expect(replacements.rows[0]?.n).toBe("0");
    });
  }, 240_000);
});
