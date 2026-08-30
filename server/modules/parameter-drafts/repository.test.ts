/**
 * Behavior-level integration coverage for the parameter draft repository:
 * upsert/list/delete scoping, binding-draft enrichment, origin metadata, and
 * candidate rebase against a real database. Asserts returned DTOs and
 * subsequent reads — never SQL text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { createAgentInvocation, trustedDomainAttribution } from "../auth/trustedInvocation";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import {
  deleteDraft,
  listDraftsForParameterValue,
  listDraftsForUser,
  listOpenBindingDraftsForUser,
  rebaseOpenBindingDraftCandidates,
  upsertDraft
} from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("draft repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "user-1", name: "Riley Chen", email: "riley@example.com" },
        { id: "user-2", name: "Other Editor", email: "other@example.com" },
        { id: "user-sync", name: "Sync Bot", email: "sync@example.com" },
        { id: "user-ui", name: "UI Editor", email: "ui@example.com" }
      ],
      projects: [
        { id: "project-1", name: "Aurora", code: "AUR" },
        { id: "project-2", name: "Borealis", code: "BOR" }
      ]
    });

    // Legacy flat identity rows drafts hang off.
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values
         ('pd-1', 'org-1', 'fast_charge_current_limit_ma', 'Limit fast charge current.', 'Controls fast charging current.', 'ENV', 'Charging Policy', '1000 - 5000', 'mA', 'High'),
         ('pd-2', 'org-1', 'thermal_guard_threshold_c', 'Thermal guard.', 'Thermal guard threshold.', 'ENV', 'Thermal', '40 - 90', 'C', 'Medium')`
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values
         ('param-1', 'org-1', 'project-1', 'pd-1', '3200', '3000', 7, 'user-1'),
         ('param-2', 'org-1', 'project-2', 'pd-2', '70', '68', 2, 'user-1')`
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  /**
   * Spec + binding graph for binding-identified drafts (FKs require real rows).
   * Candidate revisions carry an FK to dts_config_revisions; logical nodes back
   * enablement drafts.
   */
  async function seedBindingGraph(input: { revisionIds?: string[]; logicalNodeIds?: string[] } = {}) {
    await seedSpecBindingGraph(db, {
      organizationId: "org-1",
      specs: [
        {
          id: "spec-thermal",
          specificationKey: "Power/thermal-limit",
          versions: [{ id: "psv-thermal", displayName: "thermal-limit", description: "thermal limit" }],
          propertySpec: { id: "dps-thermal", propertyKey: "thermal-limit" }
        },
        { id: "spec-current", specificationKey: "Power/current-limit" }
      ],
      modules: [{ id: "pm-power", name: "Power" }],
      configSets: [
        {
          id: "set-1",
          projectId: "project-1",
          revisions: (input.revisionIds ?? []).map((id) => ({ id })),
          logicalNodes: (input.logicalNodeIds ?? []).map((id) => ({ id }))
        }
      ],
      bindings: [
        { id: "binding-1", projectId: "project-1", parameterSpecId: "spec-thermal", moduleId: "pm-power" },
        { id: "binding-b", projectId: "project-1", parameterSpecId: "spec-current", moduleId: "pm-power" }
      ]
    });
  }

  async function draftRows(where: string, values: unknown[] = []) {
    const result = await db.query<{
      id: string;
      user_id: string;
      target_value: string;
      reason: string;
      candidate_config_revision_id: string | null;
    }>(
      `select id, user_id, target_value, reason, candidate_config_revision_id
       from parameter_drafts where ${where} order by id asc`,
      values
    );
    return result.rows;
  }

  it("upsertDraft inserts a draft and updates it in place on the same (project, parameter, user) key", async () => {
    const inserted = await upsertDraft(db, {
      id: "draft-1",
      organizationId: "org-1",
      projectId: "project-1",
      parameterId: "param-1",
      userId: "user-1",
      targetValue: "3100",
      reason: "Reduce thermal risk."
    });
    expect(inserted).toMatchObject({
      id: "draft-1",
      projectId: "project-1",
      parameterId: "param-1",
      targetValue: "3100",
      action: "set",
      reason: "Reduce thermal risk."
    });

    // A second save for the same key keeps the original draft row and updates it.
    const updated = await upsertDraft(db, {
      id: "draft-2",
      organizationId: "org-1",
      projectId: "project-1",
      parameterId: "param-1",
      userId: "user-1",
      targetValue: "3050",
      reason: "Lower further after review."
    });
    expect(updated).toMatchObject({ id: "draft-1", targetValue: "3050", reason: "Lower further after review." });

    const stored = await draftRows(`organization_id = 'org-1' and user_id = 'user-1'`);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: "draft-1", target_value: "3050" });
  });

  it("listDraftsForUser and deleteDraft scope drafts by organization and user", async () => {
    await upsertDraft(db, {
      id: "draft-mine",
      organizationId: "org-1",
      projectId: "project-1",
      parameterId: "param-1",
      userId: "user-1",
      targetValue: "3100",
      reason: "Mine."
    });
    await upsertDraft(db, {
      id: "draft-other-user",
      organizationId: "org-1",
      projectId: "project-1",
      parameterId: "param-1",
      userId: "user-2",
      targetValue: "3111",
      reason: "Someone else's."
    });
    await upsertDraft(db, {
      id: "draft-other-project",
      organizationId: "org-1",
      projectId: "project-2",
      parameterId: "param-2",
      userId: "user-1",
      targetValue: "69",
      reason: "Other project."
    });

    const drafts = await listDraftsForUser(db, {
      organizationId: "org-1",
      userId: "user-1",
      projectId: "project-1"
    });
    expect(drafts).toHaveLength(1);
    // Legacy drafts enrich name/module/currentValue from the flat identity graph.
    expect(drafts[0]).toMatchObject({
      id: "draft-mine",
      projectId: "project-1",
      parameterId: "param-1",
      targetValue: "3100",
      reason: "Mine.",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3200"
    });

    // Deleting under the wrong user leaves the row alone; the owner delete removes it.
    await deleteDraft(db, { organizationId: "org-1", userId: "user-1", draftId: "draft-other-user" });
    expect(await draftRows(`id = 'draft-other-user'`)).toHaveLength(1);
    await deleteDraft(db, { organizationId: "org-1", userId: "user-1", draftId: "draft-mine" });
    expect(await draftRows(`id = 'draft-mine'`)).toHaveLength(0);
    await expect(
      listDraftsForUser(db, { organizationId: "org-1", userId: "user-1", projectId: "project-1" })
    ).resolves.toEqual([]);
  });

  it("keeps trusted Agent correlation out of the public draft DTO", async () => {
    const agentAttribution = trustedDomainAttribution(
      createAgentInvocation(
        {
          user: {
            id: "user-1",
            organizationId: "org-1",
            name: "Riley Chen",
            email: "riley@example.com",
            title: "Engineer",
            isActive: true
          },
          organization: { id: "org-1", name: "ChargeLab" },
          roles: [],
          permissions: ["parameter:view"]
        },
        {
          sessionId: "draft-public-session",
          toolCallId: "draft-public-tool",
          approval: { required: true, approvalId: "draft-public-approval" }
        }
      )
    );
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, initiator_type, initiator_session_id,
         initiator_tool_call_id, initiator_approval_id
       ) values ($1, 'org-1', 'project-1', 'param-1', $2, '3150', 'Agent public projection', 'manual', $3, $4, $5, $6)`,
      [
        "draft-public-agent",
        agentAttribution.userId,
        agentAttribution.initiatorType,
        agentAttribution.sessionId,
        agentAttribution.toolCallId,
        agentAttribution.approvalId
      ]
    );

    const [draft] = await listDraftsForUser(db, {
      organizationId: "org-1",
      projectId: "project-1",
      owner: agentAttribution
    });
    expect(draft).toMatchObject({ id: "draft-public-agent", targetValue: "3150" });
    expect(draft).not.toHaveProperty("initiatorType");
    expect(draft).not.toHaveProperty("initiatorSessionId");
    expect(draft).not.toHaveProperty("initiatorToolCallId");
    expect(draft).not.toHaveProperty("initiatorApprovalId");
    expect(JSON.stringify(draft)).not.toContain("draft-public-session");
    expect(JSON.stringify(draft)).not.toContain("draft-public-tool");
    expect(JSON.stringify(draft)).not.toContain("draft-public-approval");
  });

  it("listDraftsForUser maps binding identity, candidate revision, and locked base value", async () => {
    await seedBindingGraph({ revisionIds: ["base-rev-1", "rev-shared-tip"] });
    await db.query(
      `insert into project_parameter_binding_revisions (id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value)
       values ('bpr-1', 'binding-1', 'base-rev-1', 'psv-thermal', '"3000"', '3000')`
    );
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, project_parameter_binding_id, candidate_config_revision_id,
         binding_revision_id, updated_at
       ) values (
         'draft-1', 'org-1', 'project-1', 'param-1', 'user-1',
         '3200', 'Align thermal limit.', 'binding-1', 'rev-shared-tip',
         'bpr-1', '2026-07-23T02:00:00.000Z'
       )`
    );

    const drafts = await listDraftsForUser(db, {
      organizationId: "org-1",
      userId: "user-1",
      projectId: "project-1"
    });

    expect(drafts).toEqual([
      {
        id: "draft-1",
        projectId: "project-1",
        parameterId: "binding-1",
        targetValue: "3200",
        action: "set",
        reason: "Align thermal limit.",
        updatedAt: "2026-07-23T02:00:00.000Z",
        projectParameterBindingId: "binding-1",
        candidateConfigRevisionId: "rev-shared-tip",
        parameterSpecId: "spec-thermal",
        name: "thermal-limit",
        module: "Power",
        currentValue: "3000"
      }
    ]);
  });

  it("lists drafts by parameter value with origin metadata ordered by recency", async () => {
    await db.query(
      `insert into project_parameter_files (id, organization_id, project_id, file_name, format)
       values ('file-1', 'org-1', 'project-1', 'board.dts', 'dts')`
    );
    await db.query(
      `insert into project_parameter_file_versions (id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id)
       values ('version-1', 'file-1', 1, 'org-1/files/board.dts', 'checksum-1', 100, '{}', 'upload', 'user-1')`
    );
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, origin_file_version_id, updated_at
       ) values
         ('draft-file', 'org-1', 'project-1', 'param-1', 'user-sync', '85', 'file sync draft', 'file_sync', 'version-1', '2026-07-11T10:00:00.000Z'),
         ('draft-ui', 'org-1', 'project-1', 'param-1', 'user-ui', '82', 'ui draft', 'manual', null, '2026-07-11T10:01:00.000Z'),
         ('draft-elsewhere', 'org-1', 'project-2', 'param-2', 'user-ui', '69', 'other parameter', 'manual', null, '2026-07-11T10:02:00.000Z')`
    );

    const drafts = await listDraftsForParameterValue(db, { projectParameterValueId: "param-1" });

    expect(drafts).toEqual([
      {
        id: "draft-ui",
        userId: "user-ui",
        projectId: "project-1",
        projectParameterValueId: "param-1",
        targetValue: "82",
        action: "set",
        origin: "manual",
        originFileVersionId: undefined,
        updatedAt: "2026-07-11T10:01:00.000Z"
      },
      {
        id: "draft-file",
        userId: "user-sync",
        projectId: "project-1",
        projectParameterValueId: "param-1",
        targetValue: "85",
        action: "set",
        origin: "file_sync",
        originFileVersionId: "version-1",
        updatedAt: "2026-07-11T10:00:00.000Z"
      }
    ]);
  });

  it("listOpenBindingDraftsForUser returns binding and enablement drafts ordered by updated_at desc then id asc", async () => {
    await seedBindingGraph({ revisionIds: ["rev-new", "rev-old", "rev-x"], logicalNodeIds: ["node-a"] });
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, edit_subject_kind, logical_node_id,
         project_parameter_binding_id, candidate_config_revision_id, updated_at
       ) values
         ('draft-b', 'org-1', 'project-1', null, 'user-1', '<3000>', 'binding edit', 'binding', null, 'binding-b', 'rev-new', '2026-07-23T02:00:00.000Z'),
         ('draft-a', 'org-1', 'project-1', null, 'user-1', '"disabled"', 'disable node', 'node-enablement', 'node-a', null, 'rev-old', '2026-07-23T01:00:00.000Z'),
         ('draft-z-same-time', 'org-1', 'project-1', null, 'user-2', '<9>', 'other user', 'binding', null, 'binding-1', 'rev-x', '2026-07-23T03:00:00.000Z')`
    );

    const drafts = await listOpenBindingDraftsForUser(db, {
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1"
    });

    // Enablement drafts ride the same pipeline as binding drafts; another user's draft stays out.
    expect(drafts).toEqual([
      {
        id: "draft-b",
        candidateConfigRevisionId: "rev-new",
        projectParameterBindingId: "binding-b",
        editSubjectKind: "binding",
        logicalNodeId: null,
        updatedAt: "2026-07-23T02:00:00.000Z"
      },
      {
        id: "draft-a",
        candidateConfigRevisionId: "rev-old",
        projectParameterBindingId: null,
        editSubjectKind: "node-enablement",
        logicalNodeId: "node-a",
        updatedAt: "2026-07-23T01:00:00.000Z"
      }
    ]);
  });

  it("rebaseOpenBindingDraftCandidates moves stale sibling drafts (including enablement) to the shared tip", async () => {
    await seedBindingGraph({ revisionIds: ["rev-fresh", "rev-old", "rev-shared"], logicalNodeIds: ["node-a"] });
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, edit_subject_kind, logical_node_id,
         project_parameter_binding_id, candidate_config_revision_id
       ) values
         ('draft-current', 'org-1', 'project-1', null, 'user-1', '<1>', 'current edit', 'binding', null, 'binding-1', 'rev-fresh'),
         ('draft-stale-binding', 'org-1', 'project-1', null, 'user-1', '<2>', 'stale binding', 'binding', null, 'binding-b', 'rev-old'),
         ('draft-stale-enablement', 'org-1', 'project-1', null, 'user-1', '"okay"', 'stale enablement', 'node-enablement', 'node-a', null, 'rev-old'),
         ('draft-already-shared', 'org-1', 'project-1', 'param-1', 'user-1', '<4>', 'already on tip', 'binding', null, null, 'rev-shared'),
         ('draft-other-user', 'org-1', 'project-1', null, 'user-2', '<5>', 'not mine', 'binding', null, 'binding-1', 'rev-old')`
    );

    const rebasedIds = await rebaseOpenBindingDraftCandidates(db, {
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      candidateConfigRevisionId: "rev-shared",
      excludeDraftId: "draft-current"
    });

    expect([...rebasedIds].sort()).toEqual(["draft-stale-binding", "draft-stale-enablement"]);
    const after = await draftRows(`organization_id = 'org-1' and project_id = 'project-1'`);
    expect(
      Object.fromEntries(after.map((row) => [row.id, row.candidate_config_revision_id]))
    ).toEqual({
      "draft-current": "rev-fresh",
      "draft-stale-binding": "rev-shared",
      "draft-stale-enablement": "rev-shared",
      "draft-already-shared": "rev-shared",
      "draft-other-user": "rev-old"
    });
  });
});
