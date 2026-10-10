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
import { createNodeEnablementDraft } from "../../parameter-topology/service";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import type { AgentToolExecutionContext } from "../toolRegistry";
import { createActionTools } from "./actionTools";

/**
 * Archived semantic-owner regression for TD-078. These cases intentionally
 * exercise the existing binding-draft and parameter-submission owners
 * directly, preserving their historical guards. Canonical Agent action
 * acceptance lives in canonicalParameterAction.integration.test.ts.
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
const SUBJECT_ID = "asub-agent-wiseeff-charging-core";
const DRIVER_SCHEMA_SPEC_ID = "pspec:driver:platform/wiseeff,charging_core";
const DRIVER_SCHEMA_VERSION_ID = "psv:driver:platform/wiseeff,charging_core:v1";
const DRIVER_SCHEMA_ID = "driver:platform/wiseeff,charging_core";
const DRIVER_SCHEMA_VERSION_ROW_ID = "driver:platform/wiseeff,charging_core:v1";
const DRIVER_SCHEMA_OVERLAY_ID = "dso-agent-wiseeff-charging-core";
const CATEGORY_MODULE_ID = "pmod-agent-power";
const DRIVER_GROUP_MODULE_ID = "pmod-agent-wiseeff-charging-core";

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
  // API-mode ingest only recognizes a DTS property after the complete
  // subject/schema/active-version/placement graph is present. This fixture
  // therefore models a real platform driver definition instead of relying on
  // the pre-cutover project/property continuity fallback.
  await db.query(
    `insert into attribution_subjects (
       id, organization_id, subject_kind, display_name, origin, source_key
     ) values ($1, null, 'driver-registration', 'wiseeff,charging_core', 'curated', 'compatible:wiseeff,charging_core')
     on conflict (id) do nothing`,
    [SUBJECT_ID]
  );
  await db.query(
    `insert into driver_registrations (
       attribution_subject_id, driver_nature, instance_cardinality, notes
     ) values ($1, 'physical-device', 'multiple', 'TD-078 semantic fixture')
     on conflict (attribution_subject_id) do nothing`,
    [SUBJECT_ID]
  );
  await db.query(
    `insert into parameter_modules (
       id, organization_id, parent_id, name, path, depth, sort_order,
       description, scope, kind, origin, source_key, attribution_subject_id
     ) values
       ($1, $2, null, 'Power', $1, 1, 0, '', '', 'business', 'curated', null, null),
       ($3, $2, $1, 'wiseeff,charging_core', $3, 2, 0, '', '', 'driver-group', 'curated',
        'compatible:wiseeff,charging_core', $4)
     on conflict (id) do nothing`,
    [CATEGORY_MODULE_ID, ORG_ID, DRIVER_GROUP_MODULE_ID, SUBJECT_ID]
  );
  await db.query(
    `insert into driver_registration_placements (
       id, organization_id, attribution_subject_id, driver_group_module_id,
       default_business_category_module_id
     ) values ($1, $2, $3, $4, $5)
     on conflict (organization_id, attribution_subject_id) do nothing`,
    ["drp-agent-wiseeff-charging-core", ORG_ID, SUBJECT_ID, DRIVER_GROUP_MODULE_ID, CATEGORY_MODULE_ID]
  );
  await db.query(
    `insert into parameter_specs (
       id, organization_id, source_kind, specification_key, definition_lifecycle,
       attribution_subject_id
     ) values ($1, null, 'dts', 'driver/platform/wiseeff,charging_core', 'active', $2)
     on conflict (id) do nothing`,
    [DRIVER_SCHEMA_SPEC_ID, SUBJECT_ID]
  );
  await db.query(
    `insert into parameter_spec_versions (
       id, parameter_spec_id, version, display_name, description, value_shape,
       lifecycle, version_status, documentation
     ) values ($1, $2, 1, 'wiseeff,charging_core', 'driver schema', '{"kind":"unknown"}'::jsonb,
       'active', 'active', 'TD-078 semantic fixture')
     on conflict (id) do nothing`,
    [DRIVER_SCHEMA_VERSION_ID, DRIVER_SCHEMA_SPEC_ID]
  );
  await db.query(
    `insert into driver_schemas (
       id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id
     ) values ($1, $2, null, 'platform/wiseeff,charging_core', $3)
     on conflict (id) do nothing`,
    [DRIVER_SCHEMA_ID, DRIVER_SCHEMA_SPEC_ID, SUBJECT_ID]
  );
  await db.query(
    `insert into driver_schema_versions (
       id, driver_schema_id, parameter_spec_version_id, version,
       compatible_patterns, parent_bus_constraints, source, lifecycle
     ) values ($1, $2, $3, 1, '["wiseeff,charging_core"]'::jsonb, '{}'::jsonb, 'manual', 'active')
     on conflict (id) do nothing`,
    [DRIVER_SCHEMA_VERSION_ROW_ID, DRIVER_SCHEMA_ID, DRIVER_SCHEMA_VERSION_ID]
  );
  await db.query(
    `insert into parameter_specs (
       id, organization_id, source_kind, specification_key, definition_lifecycle,
       attribution_subject_id, property_key
     ) values ($1, null, 'dts', 'platform/wiseeff,charging_core/iin_max', 'active', $2, 'iin_max')
     on conflict (id) do nothing`,
    [SPEC_ID, SUBJECT_ID]
  );
  await db.query(
    `insert into parameter_spec_versions (
       id, parameter_spec_id, version, display_name, description, value_shape,
       schema_default, example_value, lifecycle, version_status
     ) values (
       $1, $2, 1, 'iin_max', 'Input current limit',
       '{"kind":"cells","bits":32}'::jsonb,
       '{"kind":"cells","bits":32,"groups":[[{"kind":"integer","raw":"2300","value":"2300"}]]}'::jsonb,
       '{"kind":"cells","bits":32,"groups":[[{"kind":"integer","raw":"3000","value":"3000"}]]}'::jsonb,
       'active', 'active'
     )
     on conflict (id) do nothing`,
    [SPEC_VERSION_ID, SPEC_ID]
  );
  await db.query(
    `insert into dts_property_specs (
       id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, constraints
     ) values ($1, $2, $3, 'iin_max', 'platform/wiseeff,charging_core', '{"max":12000,"min":0}'::jsonb)
     on conflict (id) do nothing`,
    ["dps-agent-iin-max", SPEC_ID, DRIVER_SCHEMA_ID]
  );
  await db.query(
    `insert into driver_schema_overlays (
       id, organization_id, compatible, display_name, notes, lifecycle, version
     ) values ($1, null, 'wiseeff,charging_core', 'wiseeff,charging_core', 'TD-078 semantic fixture', 'active', 1)
     on conflict (id) do nothing`,
    [DRIVER_SCHEMA_OVERLAY_ID]
  );
  await db.query(
    `insert into driver_schema_overlay_properties (
       id, driver_schema_overlay_id, parameter_spec_id, property_key, sort_order
     ) values ($1, $2, $3, 'iin_max', 0)
     on conflict (id) do nothing`,
    ["dsop-agent-iin-max", DRIVER_SCHEMA_OVERLAY_ID, SPEC_ID]
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
  // The trusted typed-draft guard resolves the compatible token from the
  // exact locked overlay version. Keep this fixture's structural identity in
  // sync with production structural-ingest rows (the overlay itself has no
  // compatible property).
  await db.query(
    `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
     values ($1, $2, 'charging_core', '/charging_core', null)`,
    [`dts-node-overlay-${randomUUID().slice(0, 8)}`, overlayVersionId]
  );

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

  return {
    revision,
    binding,
    logicalNodeId: logicalNodeId!,
    nodeLocator: logical.rows[0]?.node_locator
  };
}

function contextFor(auth: AuthContext): AgentToolExecutionContext {
  const sessionId = `agent-session-${randomUUID().slice(0, 8)}`;
  const toolCallId = `tool-call-${randomUUID().slice(0, 8)}`;
  const approvalId = `approval-${randomUUID().slice(0, 8)}`;
  return {
    auth,
    invocation: createAgentInvocation(auth, {
      sessionId,
      toolCallId,
      approval: { required: true, approvalId }
    }),
    requestId: `req-${randomUUID().slice(0, 8)}`,
    sessionId,
    toolCallId,
    projectId: PROJECT_ID,
    approvalId
  };
}

describe.skipIf(!databaseAvailable)("archived semantic binding submission regression (TD-078)", () => {
  let db: InMemoryTestDatabase | undefined;
  const auth = makeAuth();

  beforeEach(async () => {
    setParameterIdentityMode("semantic");
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
    await resolveParameterIdentityMode(db);
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
    setParameterIdentityMode(null);
  });

  async function seedAgentAuditLineage(
    targetDb: Database,
    context: AgentToolExecutionContext,
    payload: Record<string, unknown> = {}
  ) {
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
                 $5::jsonb, true, 'approved')`,
      [context.toolCallId, context.sessionId, ORG_ID, PROJECT_ID, JSON.stringify(payload)]
    );
    await targetDb.query(
      `insert into agent_approvals (
         id, session_id, tool_call_id, organization_id, project_id, status, title, message,
         requested_by_user_id, decided_by_user_id, decided_at
       ) values ($1, $2, $3, $4, $5, 'approved', 'Approve', 'Approve', $6, $6, now())`,
      [context.approvalId, context.sessionId, context.toolCallId, ORG_ID, PROJECT_ID, USER_ID]
    );
  }






  it("canonicalizes exact-revision compatible for node-enablement Agent/System refusal and user success", async () => {
    await withTempDatabase({ prefix: "enablecompat" }, async ({ db: ownedDb, connectionString }) => {
      const root = createPostgresDatabase(connectionString);
      try {
        await seedGraph(ownedDb);
        await resolveParameterIdentityMode(ownedDb);
        const fixture = await seedConfigAndBinding(ownedDb, auth);
        await ownedDb.query(
          `insert into dts_sensitive_node_rules (
             id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
           ) values (
             'rule-enablement-compatible-critical', $1, $2, 'compatible',
             'wiseeff,charging_core', 'critical', 'parameter:edit-critical', true
           )`,
          [ORG_ID, PROJECT_ID]
        );
        const capableAuth: AuthContext = {
          ...auth,
          permissions: [...auth.permissions, "parameter:edit-critical"]
        };
        const refusalSink = createTrustedRefusalAuditSink(root);
        const draft = await createNodeEnablementDraft(
          ownedDb,
          capableAuth,
          {
            projectId: PROJECT_ID,
            logicalNodeId: fixture.logicalNodeId,
            baseRevisionId: fixture.revision.id,
            target: "force-disabled",
            reason: "Exact compatible enablement guard"
          },
          { toolchain: passToolchain },
          {
            invocation: createUserInvocation(capableAuth),
            requestId: "req-enablement-draft",
            refusalSink
          }
        );
        const item = {
          draftId: draft.draftId,
          editSubjectKind: "node-enablement" as const,
          logicalNodeId: fixture.logicalNodeId,
          action: draft.action,
          targetValue: draft.rawText,
          reason: "Exact compatible enablement guard"
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

        const agentContext = contextFor(capableAuth);
        await seedAgentAuditLineage(ownedDb, agentContext);
        await expect(
          root.transaction((tx) =>
            submitParameterChanges(
              tx,
              capableAuth,
              { projectId: PROJECT_ID, items: [item] },
              { invocation: agentContext.invocation, requestId: "req-enablement-agent", refusalSink }
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
              capableAuth,
              { projectId: PROJECT_ID, items: [item] },
              {
                invocation: createSystemInvocation({ kind: "job", name: "enablement-compatible-test" }),
                requestId: "req-enablement-system",
                refusalSink
              }
            )
          )
        ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403, details: { initiator: "system" } });
        expect(await snapshot()).toEqual(before);

        const submitted = await submitParameterChanges(
          root,
          capableAuth,
          { projectId: PROJECT_ID, items: [item] },
          {
            invocation: createUserInvocation(capableAuth),
            requestId: "req-enablement-user",
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
              trace_id: "req-enablement-agent",
              metadata: expect.objectContaining({ matchType: "compatible", initiator: "agent" })
            }),
            expect.objectContaining({
              actor_type: "system",
              actor_user_id: null,
              trace_id: "req-enablement-system",
              metadata: expect.objectContaining({ matchType: "compatible", initiator: "system" })
            })
          ])
        );
      } finally {
        await root.close();
      }
    });
  });


  it("returns 404 without residue when the binding does not exist", async () => {
    await seedConfigAndBinding(db!, auth);
    const context = contextFor(auth);
    const actionTool = createActionTools({
      db: db!,
      toolchain: passToolchain,
      refusalAuditSink: testRefusalAuditSink
    }).find((candidate) => candidate.name === "action.submitParameterChange")!;

    await expect(
      actionTool.prepareApproval!({
        auth: context.auth,
        requestId: context.requestId,
        sessionId: context.sessionId,
        projectId: context.projectId
      }, {
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
