import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../../auth/types";
import type { DtsToolchainRunner } from "../../parameter-files/dtsToolchain";
import type { InMemoryTestDatabase } from "../../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { probeCutoverComplete } from "../../parameter-kernel/parameterIdentityMode";
import { resolveModuleIdForBinding } from "../../parameter-modules/resolveModuleForBinding";
import { createOrReuseBinding, upsertBindingRevisionValues } from "../../parameter-topology/bindingService";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
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
const semanticMode = databaseAvailable
  ? await (async () => {
      const probe = await createInMemoryTestDatabase();
      try {
        return await probeCutoverComplete(probe);
      } finally {
        await probe.rollback();
      }
    })()
  : false;

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

async function seedGraph(db: InMemoryTestDatabase) {
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
}

async function insertPinnedMember(
  db: InMemoryTestDatabase,
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

async function seedConfigAndBinding(db: InMemoryTestDatabase, auth: AuthContext) {
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
  return { auth, requestId: `req-${randomUUID().slice(0, 8)}`, sessionId: "agent-session", projectId: PROJECT_ID };
}

describe.skipIf(!databaseAvailable || !semanticMode)("action.submitParameterChange integration (TD-078)", () => {
  let db: InMemoryTestDatabase | undefined;
  const auth = makeAuth();

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  function actionTool() {
    return createActionTools({ db: db!, toolchain: passToolchain }).find(
      (tool) => tool.name === "action.submitParameterChange"
    )!;
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
    expect(changeRequests.rows[0]).toMatchObject({ target_value: "<3700>" });
    expect(changeRequests.rows[1]).toMatchObject({ target_value: "<3600>", status: "rejected" });
  });

  it("refuses agent writes to critical sensitive nodes before creating any draft", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    await db!.query(
      `insert into dts_sensitive_node_rules (
         id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
       ) values ($1, $2, $3, 'path', $4, 'critical', 'parameter:edit-critical', true)`,
      [`snr-${randomUUID().slice(0, 8)}`, ORG_ID, PROJECT_ID, "*charging_core*"]
    );

    await expect(
      actionTool().run(contextFor(auth), {
        projectId: PROJECT_ID,
        parameterId: fixture.binding.id,
        targetValue: "<9999>",
        reason: "Agent tuning"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    const drafts = await db!.query(`select id from parameter_drafts where organization_id = $1`, [ORG_ID]);
    expect(drafts.rows).toHaveLength(0);
    const changeRequests = await db!.query(
      `select id from parameter_change_requests where organization_id = $1`,
      [ORG_ID]
    );
    expect(changeRequests.rows).toHaveLength(0);
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
