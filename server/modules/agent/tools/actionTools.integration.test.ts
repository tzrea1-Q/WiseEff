import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPostgresDatabase, type Database } from "../../../shared/database/client";
import { withTempDatabase } from "../../../testing/tempDatabase";
import type { AuthContext } from "../../auth/types";
import {
  createAgentInvocation,
  createSystemInvocation,
  createUserInvocation
} from "../../auth/trustedInvocation";
import { testRefusalAuditSink } from "../../audit/testRefusalSink";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import type { DtsToolchainRunner } from "../../parameter-files/dtsToolchain";
import type { InMemoryTestDatabase } from "../../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { resolveParameterIdentityMode, setParameterIdentityMode } from "../../parameter-kernel/parameterIdentityMode";
import { resolveModuleIdForBinding } from "../../parameter-modules/resolveModuleForBinding";
import { submitParameterChanges } from "../../parameters/service";
import { createOrReuseBinding, upsertBindingRevisionValues } from "../../parameter-topology/bindingService";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { createBindingDraft } from "../../parameter-topology/service";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import type { AgentToolExecutionContext } from "../toolRegistry";
import { createActionTools } from "./actionTools";

/**
 * Non-mocked regression for TD-078: the Xiaoze mutating tool must complete a
 * real post-cutover submission — typed binding draft, candidate revision, and
 * change request — against a real schema, with no parameters-module mocks.
 * Fixture mirrors server/modules/parameter-topology/editService.test.ts.
 */

const passToolchain: DtsToolchainRunner = {
  async validate() {
    return {
      ok: true,
      mode: "release",
      compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" },
      diagnostics: [],
      artifacts: {}
    };
  },
  async probe() {
    return {
      dtc: { path: "/usr/bin/dtc", version: "1.8.1" },
      fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "1.8.1" },
      dtschema: { path: "/usr/bin/dt-validate", version: "2026.6" }
    };
  }
};

const ORG_ID = "org-agent-action";
const PROJECT_ID = "project-agent-action";
const USER_ID = "user-agent-action";
const CONFIG_SET_ID = "dcs-agent-action";
const SPEC_ID = "spec-agent-iin-max";
const SPEC_VERSION_ID = "specver-agent-iin-max-1";

const databaseAvailable = await isTestDatabaseAvailable();

/**
 * The semantic submission path is only meaningful on a post-cutover database.
 * CI's shared test database intentionally stays legacy for the identity
 * migration suites (TD-079), so this file self-skips there and runs against
 * post-cutover databases (local dev, and CI once TD-079 lands).
 */
function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Agent Action Admin",
      email: "agent-action@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: ORG_ID, name: "Agent Action Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  };
}

const BASE_WITH_IIN = `/dts-v1/;
/ {
\tcharging_core: charging_core {
\t\tcompatible = "wiseeff,charging_core";
\t\tiin_max = <2300>;
\t};
};
`;

const OVERLAY_OVERRIDE = `/dts-v1/;
/plugin/;

&charging_core {
\tiin_max = <2700>;
};
`;

async function seedGraph(db: Database) {
  await db.query(
    `insert into parameter_identity_migration_runs (
       id, mode, status, report, db_snapshot_id, object_snapshot_id, write_lock_confirmed, completed_at
     ) values ('migration-agent-action', 'apply', 'completed', '{}'::jsonb, 'db-snapshot', 'object-snapshot', true, now())
     on conflict (id) do nothing`
  );
  await db.query(
    `insert into parameter_identity_cutovers (id, migration_run_id)
     values ('cutover-agent-action', 'migration-agent-action')
     on conflict do nothing`
  );
  await db.query(
    `insert into organizations (id, name) values ($1, 'Agent Action Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID]
  );
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Agent Action Admin', 'agent-action@example.com', 'Admin', true)
     on conflict (id) do update set organization_id = excluded.organization_id`,
    [USER_ID, ORG_ID]
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Agent Action', 'AGA', 'initialized')
     on conflict (id) do update set name = excluded.name`,
    [PROJECT_ID, ORG_ID]
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'agent-power', 'TD-078 integration fixture')
     on conflict (id) do update set name = excluded.name`,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID]
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key)
     values ($1, $2, 'dts', 'charging_core/iin_max')
     on conflict (id) do nothing`,
    [SPEC_ID, ORG_ID]
  );
  await db.query(
    `insert into parameter_spec_versions (
       id, parameter_spec_id, version, display_name, description, value_shape,
       schema_default, example_value, lifecycle
     ) values (
       $1, $2, 1, 'iin_max', 'Input current limit',
       '{"kind":"cells","bits":32}'::jsonb,
       '{"kind":"cells","bits":32,"groups":[[{"kind":"integer","raw":"2300","value":"2300"}]]}'::jsonb,
       '{"kind":"cells","bits":32,"groups":[[{"kind":"integer","raw":"3000","value":"3000"}]]}'::jsonb,
       'active'
     )
     on conflict (id) do nothing`,
    [SPEC_VERSION_ID, SPEC_ID]
  );
  await db.query(
    `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
     values ($1, $2, 'iin_max', 'vendor', '{"max":12000,"min":0}'::jsonb)
     on conflict (id) do nothing`,
    ["dps-agent-iin-max", SPEC_ID]
  );

  // Mirror the workflow-column portion of the production identity cutover. This
  // fixture starts with no legacy workflow rows, so no backfill is required.
  await db.query(`
    alter table parameter_change_requests
      drop constraint if exists parameter_change_requests_parameter_definition_id_fkey,
      drop constraint if exists parameter_change_requests_project_parameter_value_id_fkey,
      drop column if exists parameter_definition_id,
      drop column if exists project_parameter_value_id;
    alter table parameter_submission_items
      drop constraint if exists parameter_submission_items_project_parameter_value_id_fkey,
      drop column if exists project_parameter_value_id;
    alter table parameter_drafts
      drop constraint if exists parameter_drafts_project_parameter_value_id_fkey,
      drop constraint if exists parameter_drafts_project_id_project_parameter_value_id_user_id_key,
      drop column if exists project_parameter_value_id;
  `);
}

async function insertPinnedMember(
  db: Database,
  input: {
    fileId: string;
    fileName: string;
    versionId: string;
    content: string;
    role: "base" | "overlay";
    sortOrder: number;
  }
) {
  const checksum = createHash("sha256").update(input.content, "utf8").digest("hex");
  await db.query(
    `insert into project_parameter_files (
       id, organization_id, project_id, file_name, format, enabled,
       config_set_id, config_set_role, config_set_sort_order
     ) values ($1, $2, $3, $4, 'dts', true, $5, $6, $7)`,
    [input.fileId, ORG_ID, PROJECT_ID, input.fileName, CONFIG_SET_ID, input.role, input.sortOrder]
  );
  await db.query(
    `insert into project_parameter_file_versions (
       id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
     ) values ($1, $2, 1, $3, $4, $5, $6::jsonb, 'upload', $7)`,
    [
      input.versionId,
      input.fileId,
      `${ORG_ID}/${checksum}-${input.fileName}`,
      checksum,
      Buffer.byteLength(input.content, "utf8"),
      JSON.stringify({ sourceText: input.content }),
      USER_ID
    ]
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    input.versionId,
    input.fileId
  ]);
}

async function seedConfigAndBinding(db: Database, auth: AuthContext) {
  const baseFileId = `file-base-${randomUUID().slice(0, 8)}`;
  const overlayFileId = `file-overlay-${randomUUID().slice(0, 8)}`;
  const baseVersionId = `fv-base-${randomUUID().slice(0, 8)}`;
  const overlayVersionId = `fv-overlay-${randomUUID().slice(0, 8)}`;

  await insertPinnedMember(db, {
    fileId: baseFileId,
    fileName: "edit-base.dts",
    versionId: baseVersionId,
    content: BASE_WITH_IIN,
    role: "base",
    sortOrder: 0
  });
  await insertPinnedMember(db, {
    fileId: overlayFileId,
    fileName: "edit-overlay.dts",
    versionId: overlayVersionId,
    content: OVERLAY_OVERRIDE,
    role: "overlay",
    sortOrder: 1
  });

  const manifest: ConfigRevisionManifest = {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    configSetId: CONFIG_SET_ID,
    entryFile: "edit-base.dts",
    includeSearchPaths: ["."],
    overlayOrder: ["edit-overlay.dts"],
    members: [
      {
        fileId: baseFileId,
        fileVersionId: baseVersionId,
        fileName: "edit-base.dts",
        role: "base",
        sortOrder: 0,
        content: BASE_WITH_IIN
      },
      {
        fileId: overlayFileId,
        fileVersionId: overlayVersionId,
        fileName: "edit-overlay.dts",
        role: "overlay",
        sortOrder: 1,
        content: OVERLAY_OVERRIDE
      }
    ]
  };

  const revision = await ingestConfigRevision(db, manifest, auth);

  const logical = await db.query<{ logical_node_id: string; node_locator: string }>(
    `select logical_node_id, node_locator
     from dts_logical_node_revisions
     where config_revision_id = $1 and node_locator like '%charging_core%'
     limit 1`,
    [revision.id]
  );
  const logicalNodeId = logical.rows[0]?.logical_node_id;
  expect(logicalNodeId).toBeTruthy();

  const moduleId = await resolveModuleIdForBinding(db, {
    organizationId: ORG_ID,
    driverModule: null,
    compatible: null,
    nodeType: null
  });
  const binding = await createOrReuseBinding(db, {
    organizationId: ORG_ID,
    key: {
      projectId: PROJECT_ID,
      logicalNodeId: logicalNodeId!,
      parameterSpecId: SPEC_ID,
      moduleId
    }
  });

  await upsertBindingRevisionValues(db, {
    bindingId: binding.id,
    configRevisionId: revision.id,
    parameterSpecVersionId: SPEC_VERSION_ID,
    values: {
      typedValue: {
        kind: "cells",
        bits: 32,
        groups: [[{ kind: "integer", raw: "2700", value: "2700" }]]
      },
      rawValue: "<2700>",
      schemaState: "valid",
      policyState: "pass"
    }
  });

  return { revision, binding, nodeLocator: logical.rows[0]?.node_locator };
}

function contextFor(auth: AuthContext): AgentToolExecutionContext {
  const toolCallId = `tool-call-${randomUUID().slice(0, 8)}`;
  const approvalId = `approval-${randomUUID().slice(0, 8)}`;
  return {
    auth,
    invocation: createAgentInvocation(auth, {
      sessionId: "agent-session",
      toolCallId,
      approval: { required: true, approvalId }
    }),
    requestId: `req-${randomUUID().slice(0, 8)}`,
    sessionId: "agent-session",
    toolCallId,
    projectId: PROJECT_ID,
    approvalId
  };
}

describe.skipIf(!databaseAvailable)("action.submitParameterChange integration (TD-078)", () => {
  let db: InMemoryTestDatabase | undefined;
  const auth = makeAuth();

  beforeEach(async () => {
    setParameterIdentityMode("semantic");
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
    setParameterIdentityMode(null);
  });

  function actionTool() {
    return createActionTools({ db: db!, toolchain: passToolchain, refusalAuditSink: testRefusalAuditSink }).find(
      (tool) => tool.name === "action.submitParameterChange"
    )!;
  }

  async function seedAgentAuditLineage(targetDb: Database, context: AgentToolExecutionContext) {
    await targetDb.query(
      `insert into agent_sessions (
         id, organization_id, project_id, actor_user_id, page_key, context, status, title
       ) values ($1, $2, $3, $4, 'parameters', '{}'::jsonb, 'active', 'Compatible refusal')`,
      [context.sessionId, ORG_ID, PROJECT_ID, USER_ID]
    );
    await targetDb.query(
      `insert into agent_tool_calls (
         id, session_id, organization_id, project_id, name, label, payload, requires_approval, status
       ) values ($1, $2, $3, $4, 'action.submitParameterChange', 'Submit parameter change',
                 '{}'::jsonb, true, 'approved')`,
      [context.toolCallId, context.sessionId, ORG_ID, PROJECT_ID]
    );
    await targetDb.query(
      `insert into agent_approvals (
         id, session_id, tool_call_id, organization_id, project_id, status, title, message,
         requested_by_user_id, decided_by_user_id, decided_at
       ) values ($1, $2, $3, $4, $5, 'approved', 'Approve', 'Approve', $6, $6, now())`,
      [context.approvalId, context.sessionId, context.toolCallId, ORG_ID, PROJECT_ID, USER_ID]
    );
  }

  it("submits a real post-cutover change request through a typed binding draft", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    const result = await actionTool().run(contextFor(auth), {
      projectId: PROJECT_ID,
      parameterId: fixture.binding.id,
      targetValue: "<3600>",
      reason: "Agent tuning after review"
    });

    expect(result.summary).toContain("Submitted parameter change request");
    expect(result.data).toMatchObject({ targetValue: "<3600>", projectId: PROJECT_ID });

    const changeRequests = await db!.query<{
      target_value: string;
      status: string;
      project_parameter_binding_id: string | null;
      parameter_spec_id: string | null;
      candidate_config_revision_id: string | null;
    }>(
      `select target_value, status, project_parameter_binding_id, parameter_spec_id, candidate_config_revision_id
       from parameter_change_requests
       where organization_id = $1 and project_id = $2`,
      [ORG_ID, PROJECT_ID]
    );
    expect(changeRequests.rows).toHaveLength(1);
    expect(changeRequests.rows[0]).toMatchObject({
      target_value: "<3600>",
      project_parameter_binding_id: fixture.binding.id,
      parameter_spec_id: SPEC_ID
    });
    expect(changeRequests.rows[0]!.candidate_config_revision_id).toBeTruthy();

    const drafts = await db!.query(`select id from parameter_drafts where organization_id = $1`, [ORG_ID]);
    expect(drafts.rows).toHaveLength(0);
  });

  it("refuses an approved Agent when only the exact binding revision compatible is critical", async () => {
    await withTempDatabase({ prefix: "agentcompat" }, async ({ db: ownedDb, connectionString }) => {
      const root = createPostgresDatabase(connectionString);
      try {
        await seedGraph(ownedDb);
        await resolveParameterIdentityMode(ownedDb);
        const fixture = await seedConfigAndBinding(ownedDb, auth);
        const context = contextFor(auth);
        await seedAgentAuditLineage(ownedDb, context);
        await ownedDb.query(
      `insert into dts_sensitive_node_rules (
         id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
       ) values (
         'rule-agent-compatible-critical', $1, $2, 'compatible',
         'wiseeff,charging_core', 'critical', 'parameter:edit-critical', true
       )`,
      [ORG_ID, PROJECT_ID]
    );

        const refusalSink = createTrustedRefusalAuditSink(root);
        await expect(
          root.transaction(async (tx) => {
            const tool = createActionTools({ db: tx, toolchain: passToolchain, refusalAuditSink: refusalSink }).find(
              (candidate) => candidate.name === "action.submitParameterChange"
            )!;
            return tool.run(context, {
              projectId: PROJECT_ID,
              parameterId: fixture.binding.id,
              targetValue: "<3600>",
              reason: "Compatible-only critical rule must require a human"
            });
          })
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          status: 403,
          details: { initiator: "agent", requireHuman: true }
        });

        const residue = await ownedDb.query<{
      drafts: string;
      candidates: string;
      rounds: string;
      requests: string;
      items: string;
      successAudits: string;
    }>(
      `select
         (select count(*)::text from parameter_drafts where organization_id = $1) as drafts,
         (select count(*)::text from dts_config_revisions
            where organization_id = $1 and status = 'draft') as candidates,
         (select count(*)::text from parameter_submission_rounds where organization_id = $1) as rounds,
         (select count(*)::text from parameter_change_requests where organization_id = $1) as requests,
         (select count(*)::text from parameter_submission_items where organization_id = $1) as items,
         (select count(*)::text from audit_events where organization_id = $1
            and kind in ('parameter-submit', 'parameter-structured-edit-submit')) as "successAudits"`,
      [ORG_ID]
    );
        expect(residue.rows[0]).toEqual({
          drafts: "0",
          candidates: "0",
          rounds: "0",
          requests: "0",
          items: "0",
          successAudits: "0"
        });
        const refusal = await ownedDb.query<{ actor_type: string; trace_id: string; metadata: Record<string, unknown> }>(
          `select actor_type, trace_id, metadata from audit_events
           where organization_id = $1 and kind = 'parameter-sensitive-node-denied'`,
          [ORG_ID]
        );
        expect(refusal.rows[0]).toMatchObject({
          actor_type: "agent",
          trace_id: context.requestId,
          metadata: {
            matchType: "compatible",
            pattern: "wiseeff,charging_core",
            initiator: "agent",
            sessionId: context.sessionId,
            toolCallId: context.toolCallId,
            approvalId: context.approvalId,
            requireHuman: true
          }
        });
      } finally {
        await root.close();
      }
    });
  });

  it("rechecks a pre-existing binding draft against its exact base revision without consuming it", async () => {
    await withTempDatabase({ prefix: "centralcompat" }, async ({ db: ownedDb, connectionString }) => {
      const root = createPostgresDatabase(connectionString);
      try {
        await seedGraph(ownedDb);
        await resolveParameterIdentityMode(ownedDb);
        const fixture = await seedConfigAndBinding(ownedDb, auth);
        await ownedDb.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
           ) values (
             'rule-central-compatible-critical', $1, $2, 'compatible',
             'wiseeff,charging_core', 'critical', 'parameter:edit-critical', true
           )`,
          [ORG_ID, PROJECT_ID]
        );
        const draft = await createBindingDraft(
          ownedDb,
          auth,
          {
            projectId: PROJECT_ID,
            bindingId: fixture.binding.id,
            baseRevisionId: fixture.revision.id,
            targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "3600", value: "3600" }]] },
            action: "set",
            reason: "Central compatible guard"
          },
          { toolchain: passToolchain },
          { requestId: "req-central-draft" }
        );
        const item = {
          draftId: draft.draftId,
          editSubjectKind: "binding" as const,
          projectParameterBindingId: draft.projectParameterBindingId,
          parameterSpecId: draft.parameterSpecId,
          action: draft.action,
          targetValue: draft.rawText,
          reason: "Central compatible guard"
        };
        const snapshot = async () => {
          const result = await ownedDb.query<{
            drafts: string;
            draftCandidates: string;
            pendingCandidates: string;
            rounds: string;
            requests: string;
            items: string;
            successAudits: string;
          }>(
            `select
               (select count(*)::text from parameter_drafts where organization_id = $1) as drafts,
               (select count(*)::text from dts_config_revisions
                  where organization_id = $1 and status = 'draft') as "draftCandidates",
               (select count(*)::text from dts_config_revisions
                  where organization_id = $1 and status = 'pending_approval') as "pendingCandidates",
               (select count(*)::text from parameter_submission_rounds where organization_id = $1) as rounds,
               (select count(*)::text from parameter_change_requests where organization_id = $1) as requests,
               (select count(*)::text from parameter_submission_items where organization_id = $1) as items,
               (select count(*)::text from audit_events where organization_id = $1
                  and kind in ('parameter-submit', 'parameter-structured-edit-submit')) as "successAudits"`,
            [ORG_ID]
          );
          return result.rows[0]!;
        };
        const before = await snapshot();
        expect(before).toMatchObject({
          drafts: "1",
          draftCandidates: "1",
          pendingCandidates: "0",
          rounds: "0",
          requests: "0",
          items: "0",
          successAudits: "0"
        });

        const agentContext = contextFor(auth);
        await seedAgentAuditLineage(ownedDb, agentContext);
        const refusalSink = createTrustedRefusalAuditSink(root);
        await expect(
          root.transaction((tx) =>
            submitParameterChanges(
              tx,
              auth,
              { projectId: PROJECT_ID, items: [item] },
              {
                invocation: agentContext.invocation,
                requestId: "req-central-agent",
                refusalSink
              }
            )
          )
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          status: 403,
          details: { initiator: "agent", requireHuman: true }
        });
        expect(await snapshot()).toEqual(before);

        await expect(
          root.transaction((tx) =>
            submitParameterChanges(
              tx,
              auth,
              { projectId: PROJECT_ID, items: [item] },
              {
                invocation: createSystemInvocation({ kind: "job", name: "central-compatible-test" }),
                requestId: "req-central-system",
                refusalSink
              }
            )
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403, details: { initiator: "system" } });
        expect(await snapshot()).toEqual(before);

        await expect(
          submitParameterChanges(
            root,
            auth,
            { projectId: PROJECT_ID, items: [item] },
            {
              invocation: createUserInvocation(auth),
              requestId: "req-central-incapable-user",
              refusalSink
            }
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
        expect(await snapshot()).toEqual(before);

        const capableAuth: AuthContext = {
          ...auth,
          permissions: [...auth.permissions, "parameter:edit-critical"]
        };
        const submitted = await submitParameterChanges(
          root,
          capableAuth,
          { projectId: PROJECT_ID, items: [item] },
          {
            invocation: createUserInvocation(capableAuth),
            requestId: "req-central-capable-user",
            refusalSink
          }
        );
        expect(submitted.items).toHaveLength(1);
        expect(await snapshot()).toMatchObject({
          drafts: "0",
          draftCandidates: "0",
          pendingCandidates: "1",
          rounds: "1",
          requests: "1",
          items: "1",
          successAudits: "1"
        });

        const refusals = await ownedDb.query<{
          actor_type: string;
          actor_user_id: string | null;
          trace_id: string;
          metadata: Record<string, unknown>;
        }>(
          `select actor_type, actor_user_id, trace_id, metadata
           from audit_events
           where organization_id = $1 and kind = 'parameter-sensitive-node-denied'
           order by trace_id`,
          [ORG_ID]
        );
        expect(refusals.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actor_type: "agent",
              actor_user_id: USER_ID,
              trace_id: "req-central-agent",
              metadata: expect.objectContaining({ matchType: "compatible", initiator: "agent" })
            }),
            expect.objectContaining({
              actor_type: "system",
              actor_user_id: null,
              trace_id: "req-central-system",
              metadata: expect.objectContaining({ matchType: "compatible", initiator: "system" })
            })
          ])
        );
      } finally {
        await root.close();
      }
    });
  });

  it("submits a second change after the first open request is rejected", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    const first = await actionTool().run(contextFor(auth), {
      projectId: PROJECT_ID,
      parameterId: fixture.binding.id,
      targetValue: "<3600>",
      reason: "First agent submission"
    });
    expect(first.summary).toContain("Submitted parameter change request");

    await db!.query(
      `
      update parameter_change_requests
      set status = 'rejected', reject_reason = 'action-tool sequential reset', updated_at = now()
      where organization_id = $1
        and project_id = $2
        and project_parameter_binding_id = $3
        and status not in ('merged', 'rejected')
      `,
      [ORG_ID, PROJECT_ID, fixture.binding.id]
    );

    const second = await actionTool().run(contextFor(auth), {
      projectId: PROJECT_ID,
      parameterId: fixture.binding.id,
      targetValue: "<3700>",
      reason: "Second agent submission after reject"
    });
    expect(second.summary).toContain("Submitted parameter change request");
    expect(second.data).toMatchObject({ targetValue: "<3700>", projectId: PROJECT_ID });

    const changeRequests = await db!.query<{ target_value: string; status: string }>(
      `select target_value, status
       from parameter_change_requests
       where organization_id = $1 and project_parameter_binding_id = $2
       order by created_at desc`,
      [ORG_ID, fixture.binding.id]
    );
    expect(changeRequests.rows).toHaveLength(2);
    expect(changeRequests.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target_value: "<3700>" }),
        expect.objectContaining({ target_value: "<3600>", status: "rejected" })
      ])
    );
  });

  it("returns 404 without residue when the binding does not exist", async () => {
    await seedConfigAndBinding(db!, auth);

    await expect(
      actionTool().run(contextFor(auth), {
        projectId: PROJECT_ID,
        parameterId: "missing-binding",
        targetValue: "<1>",
        reason: "Agent tuning"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    const drafts = await db!.query(`select id from parameter_drafts where organization_id = $1`, [ORG_ID]);
    expect(drafts.rows).toHaveLength(0);
  });
});
