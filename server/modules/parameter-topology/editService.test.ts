import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { DtsToolchainRunner } from "../parameter-files/dtsToolchain";
import { resolveDtsNodeCompatible } from "../parameter-kernel/sensitiveNode";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { resolveModuleIdForBinding } from "../parameter-modules/resolveModuleForBinding";
import { createTestParameterSubmissionContext } from "../parameters/testSubmissionContext";
import { createOrReuseBinding, upsertBindingRevisionValues } from "./bindingService";
import {
  createNodeEnablementDraft,
} from "./editService";
import { applyLockedEnablementWriteback, applyLockedOverlayWriteback } from "./overlayWriteback";
import { resolveBindingWriteLock, resolveEnablementWriteLock } from "./writeLock";
import { ingestConfigRevision } from "./ingestService";
import type { ConfigRevisionManifest } from "./types";

/** Pass-through runner so unit tests do not require host dtc/fdtoverlay/dtschema. */
const passToolchain: DtsToolchainRunner = {
  async validate() {
    return {
      ok: true,
      mode: "release",
      compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" },
      diagnostics: [],
      artifacts: {},
    };
  },
  async probe() {
    return {
      dtc: { path: "/usr/bin/dtc", version: "1.8.1" },
      fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "1.8.1" },
      dtschema: { path: "/usr/bin/dt-validate", version: "2026.6" },
    };
  },
};


const ORG_ID = "org-topo-edit";
const PROJECT_ID = "project-topo-edit";
const USER_ID = "user-topo-edit";
const CONFIG_SET_ID = "dcs-topo-edit";
const SPEC_ID = "spec-iin-max";
const SPEC_VERSION_ID = "specver-iin-max-1";

const databaseAvailable = await isTestDatabaseAvailable();

async function expectCandidateIdentity(db: InMemoryTestDatabase, revisionId: string, fileName: string, compatible: string | null) {
  const version = await db.query<{ file_version_id: string }>(`
    select m.file_version_id from dts_config_revision_members m
    join project_parameter_files f on f.id = m.file_id
    where m.config_revision_id = $1 and f.file_name = $2`, [revisionId, fileName]);
  await expect(resolveDtsNodeCompatible(db, {
    organizationId: ORG_ID, projectId: PROJECT_ID,
    sourceFileName: fileName, sourceFileVersionId: version.rows[0].file_version_id,
    sourcePath: { kind: "node-locator", value: "/charging_core" },
  })).resolves.toBe(compatible);
}

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORG_ID,
    name: "Topo Edit Admin",
    email: "topo-edit@example.com",
    organizationName: "Topo Edit Org",
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  });
}

async function seedGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Topo Edit Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Topo Edit Admin', 'topo-edit@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_ID],
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, 'Topo Edit', 'TPE', 'initialized')
    on conflict (id) do update set name = excluded.name
    `,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `
    insert into dts_config_set (id, organization_id, project_id, name, description)
    values ($1, $2, $3, 'edit-power', 'Task 10 edit fixture')
    on conflict (id) do update set name = excluded.name
    `,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
  );
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'dts', 'charging_core/iin_max')
    on conflict (id) do nothing
    `,
    [SPEC_ID, ORG_ID],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values (
      $1, $2, 1, 'iin_max', 'Input current limit',
      '{"kind":"cells","bits":32}'::jsonb,
      '{"kind":"cells","bits":32,"groups":[[{"kind":"integer","raw":"2300","value":"2300"}]]}'::jsonb,
      '{"kind":"cells","bits":32,"groups":[[{"kind":"integer","raw":"3000","value":"3000"}]]}'::jsonb,
      'active'
    )
    on conflict (id) do nothing
    `,
    [SPEC_VERSION_ID, SPEC_ID],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, property_key, schema_namespace, constraints
    ) values ($1, $2, 'iin_max', 'vendor', '{"max":12000,"min":0}'::jsonb)
    on conflict (id) do nothing
    `,
    ["dps-iin-max", SPEC_ID],
  );
}

/**
 * No module mapping rows are seeded in this fixture, so every direct
 * createOrReuseBinding call must resolve to the same deterministic org-scoped
 * unclassified module that ingestConfigRevision resolves internally — otherwise
 * the 4-tuple key would create a second, disconnected binding for the same property.
 */
async function unclassifiedModuleId(db: InMemoryTestDatabase): Promise<string> {
  return resolveModuleIdForBinding(db, {
    organizationId: ORG_ID,
    driverModule: null,
    compatible: null,
    nodeType: null,
  });
}

async function insertPinnedMember(
  db: InMemoryTestDatabase,
  input: {
    fileId: string;
    fileName: string;
    versionId: string;
    content: string;
    role: "base" | "overlay" | "include";
    sortOrder: number;
  },
) {
  const checksum = createHash("sha256").update(input.content, "utf8").digest("hex");
  await db.query(
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, $4, 'dts', true, $5, $6, $7)
    `,
    [input.fileId, ORG_ID, PROJECT_ID, input.fileName, CONFIG_SET_ID, input.role, input.sortOrder],
  );
  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, $6::jsonb, 'upload', $7)
    `,
    [
      input.versionId,
      input.fileId,
      `${ORG_ID}/${checksum}-${input.fileName}`,
      checksum,
      Buffer.byteLength(input.content, "utf8"),
      JSON.stringify({ sourceText: input.content }),
      USER_ID,
    ],
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    input.versionId,
    input.fileId,
  ]);
  return checksum;
}

const BASE_WITH_IIN = `/dts-v1/;
/ {
	charging_core: charging_core {
		compatible = "wiseeff,charging_core";
		iin_max = <2300>;
	};
};
`;

const OVERLAY_OVERRIDE = `/dts-v1/;
/plugin/;

&charging_core {
	iin_max = <2700>;
};
`;




async function seedConfigAndBinding(
  db: InMemoryTestDatabase,
  auth: AuthContext,
  options: { overlayContent: string; baseContent?: string } = { overlayContent: OVERLAY_OVERRIDE },
) {
  const baseFileId = `file-base-${randomUUID().slice(0, 8)}`;
  const overlayFileId = `file-overlay-${randomUUID().slice(0, 8)}`;
  const baseVersionId = `fv-base-${randomUUID().slice(0, 8)}`;
  const overlayVersionId = `fv-overlay-${randomUUID().slice(0, 8)}`;
  const baseContent = options.baseContent ?? BASE_WITH_IIN;

  const baseChecksum = await insertPinnedMember(db, {
    fileId: baseFileId,
    fileName: "edit-base.dts",
    versionId: baseVersionId,
    content: baseContent,
    role: "base",
    sortOrder: 0,
  });
  await insertPinnedMember(db, {
    fileId: overlayFileId,
    fileName: "edit-overlay.dts",
    versionId: overlayVersionId,
    content: options.overlayContent,
    role: "overlay",
    sortOrder: 1,
  });

  // Trusted typed-draft preflight resolves compatible from the exact locked
  // source version. This fixture writes the structural node explicitly so
  // the overlay's complete locator is represented in the same way as a
  // production structural-ingest row (the overlay has no own compatible).
  await db.query(
    `insert into dts_nodes (id, file_version_id, name, node_path, compatible)
     values ($1, $2, 'charging_core', '/charging_core', null)`,
    [`dts-node-overlay-${randomUUID().slice(0, 8)}`, overlayVersionId],
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
        content: baseContent,
      },
      {
        fileId: overlayFileId,
        fileVersionId: overlayVersionId,
        fileName: "edit-overlay.dts",
        role: "overlay",
        sortOrder: 1,
        content: options.overlayContent,
      },
    ],
  };

  const revision = await ingestConfigRevision(db, manifest, auth);

  const logical = await db.query<{ id: string; logical_node_id: string; node_locator: string }>(
    `
    select id, logical_node_id, node_locator
    from dts_logical_node_revisions
    where config_revision_id = $1 and node_locator like '%charging_core%'
    limit 1
    `,
    [revision.id],
  );
  const logicalNodeId = logical.rows[0]?.logical_node_id;
  expect(logicalNodeId).toBeTruthy();

  const binding = await createOrReuseBinding(db, {
    organizationId: ORG_ID,
    key: {
      projectId: PROJECT_ID,
      logicalNodeId: logicalNodeId!,
      parameterSpecId: SPEC_ID,
      moduleId: await unclassifiedModuleId(db),
    },
  });

  await upsertBindingRevisionValues(db, {
    bindingId: binding.id,
    configRevisionId: revision.id,
    parameterSpecVersionId: SPEC_VERSION_ID,
    values: {
      typedValue: {
        kind: "cells",
        bits: 32,
        groups: [[{ kind: "integer", raw: "2700", value: "2700" }]],
      },
      rawValue: "<2700>",
      schemaState: "valid",
      policyState: "pass",
    },
  });

  return {
    revision,
    binding,
    // The binding is created with exactly this logical node id, so expose it here
    // instead of letting callers re-read the legacy binding table for it.
    logicalNodeId: logicalNodeId!,
    baseFileId,
    overlayFileId,
    baseChecksum,
    baseContent,
    overlayContent: options.overlayContent,
  };
}






describe.skipIf(!databaseAvailable)("applyLockedOverlayWriteback", () => {
  let db: InMemoryTestDatabase | undefined;
  let auth: AuthContext;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
    auth = makeAuth();
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  it("indexes exact source identity after enablement merge writeback", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    const lock = await resolveEnablementWriteLock(db!, auth, {
      projectId: PROJECT_ID, logicalNodeId: fixture.logicalNodeId, baseRevisionId: fixture.revision.id,
    });
    const applied = await applyLockedEnablementWriteback(db!, auth, {
      lock, mergedValue: '"disabled"',
    }, { toolchain: passToolchain, skipSemanticGates: true });
    await expectCandidateIdentity(db!, applied.candidateRevisionId, "edit-overlay.dts", null);
  });

  it("persists product schema_state and policy_state enums on merge writeback", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    const writeLock = await resolveBindingWriteLock(db!, auth, { bindingId: fixture.binding.id });

    const applied = await applyLockedOverlayWriteback(
      db!,
      auth,
      {
        lock: writeLock,
        bindingId: fixture.binding.id,
        parameterSpecId: SPEC_ID,
        parameterSpecVersionId: SPEC_VERSION_ID,
        mergedValue: "<3100>",
      },
      { toolchain: passToolchain, skipSemanticGates: true },
    );

    expect(applied.bindingRevisionId).toBeTruthy();
    await expectCandidateIdentity(db!, applied.candidateRevisionId, "edit-overlay.dts", null);

    const stored = await db!.query<{ schema_state: string; policy_state: string }>(
      `select schema_state, policy_state
       from project_parameter_binding_revisions
       where id = $1`,
      [applied.bindingRevisionId],
    );
    expect(stored.rows[0]).toEqual({
      schema_state: "valid",
      policy_state: "not_applicable",
    });
  });
});

describe.skipIf(!databaseAvailable)("createNodeEnablementDraft", () => {
  let db: InMemoryTestDatabase | undefined;
  let auth: AuthContext;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
    auth = makeAuth();
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  it("creates enablement drafts with one working tip and submits their exact node identities", async () => {
    const fixture = await seedConfigAndBinding(db!, auth, {
      overlayContent: OVERLAY_OVERRIDE,
      baseContent: BASE_WITH_IIN.replace("/ {", '/ {\n\tpeer: peer { compatible = "wiseeff,peer"; status = "okay"; };'),
    });

    const logical = await db!.query<{ logical_node_id: string }>(
      `
      select logical_node_id
      from dts_logical_node_revisions
      where config_revision_id = $1 and node_locator like '%charging_core%'
      limit 1
      `,
      [fixture.revision.id],
    );
    const logicalNodeId = logical.rows[0]?.logical_node_id;
    expect(logicalNodeId).toBeTruthy();

    const enablement = await createNodeEnablementDraft(
      db!,
      auth,
      {
        projectId: PROJECT_ID,
        logicalNodeId: logicalNodeId!,
        baseRevisionId: fixture.revision.id,
        target: "force-disabled",
        reason: "Disable charging_core for board bring-up",
      },
      { toolchain: passToolchain },
      createTestParameterSubmissionContext(auth, "enablement-draft-shared-tip"),
    );

    expect(enablement.logicalNodeId).toBe(logicalNodeId);
    expect(enablement.action).toBe("set");
    expect(enablement.rawText).toBe('"disabled"');
    expect(enablement.target).toBe("force-disabled");
    expect(enablement.candidateRevisionId).toBeTruthy();
    await expectCandidateIdentity(db!, enablement.candidateRevisionId, "edit-overlay.dts", null);

    const storedEnablement = await db!.query<{
      edit_subject_kind: string;
      logical_node_id: string | null;
      project_parameter_binding_id: string | null;
      candidate_config_revision_id: string | null;
      target_value: string;
    }>(
      `select edit_subject_kind, logical_node_id, project_parameter_binding_id,
              candidate_config_revision_id, target_value
       from parameter_drafts where id = $1`,
      [enablement.draftId],
    );
    expect(storedEnablement.rows[0]).toMatchObject({
      edit_subject_kind: "node-enablement",
      logical_node_id: logicalNodeId,
      project_parameter_binding_id: null,
      candidate_config_revision_id: enablement.candidateRevisionId,
      target_value: '"disabled"',
    });

    const peerNode = await db!.query<{ logical_node_id: string }>(
      `select logical_node_id from dts_logical_node_revisions
       where config_revision_id = $1 and node_locator = '/peer'`,
      [enablement.candidateRevisionId],
    );
    const peerLogicalNodeId = peerNode.rows[0]!.logical_node_id;
    const peerEnablement = await createNodeEnablementDraft(
      db!,
      auth,
      {
        projectId: PROJECT_ID,
        logicalNodeId: peerLogicalNodeId,
        baseRevisionId: enablement.candidateRevisionId,
        target: "force-disabled",
        reason: "Disable peer after charging_core",
      },
      { toolchain: passToolchain },
      createTestParameterSubmissionContext(auth, "peer-enablement-draft-shared-tip"),
    );

    expect(peerEnablement.workingCandidateRevisionId).toBe(peerEnablement.candidateRevisionId);
    expect(peerEnablement.rebasedDraftIds).toEqual(expect.arrayContaining([enablement.draftId]));

    const tips = await db!.query<{ id: string; candidate_config_revision_id: string | null }>(
      `select id, candidate_config_revision_id from parameter_drafts
       where organization_id = $1 and project_id = $2 and user_id = $3
       order by id`,
      [ORG_ID, PROJECT_ID, USER_ID],
    );
    expect(tips.rows).toHaveLength(2);
    expect(new Set(tips.rows.map((row) => row.candidate_config_revision_id)).size).toBe(1);
    expect(tips.rows[0]!.candidate_config_revision_id).toBe(peerEnablement.candidateRevisionId);

    const { getEnablementDraftForSubmission } = await import(
      "../parameter-drafts/repository"
    );
    const forSubmit = await getEnablementDraftForSubmission(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      userId: USER_ID,
      draftId: enablement.draftId,
    });
    expect(forSubmit).not.toBeNull();
    expect(forSubmit?.candidateActionProven).toBe(true);
    expect(forSubmit?.logicalNodeId).toBe(logicalNodeId);
    expect(forSubmit?.targetValue).toBe('"disabled"');
    expect(forSubmit?.writeLockMatchesRevision).toBe(true);

    const peerForSubmit = await getEnablementDraftForSubmission(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      userId: USER_ID,
      draftId: peerEnablement.draftId,
    });
    expect(peerForSubmit).toMatchObject({
      candidateActionProven: true,
      candidateStatus: "draft",
      logicalNodeId: peerLogicalNodeId,
      targetValue: peerEnablement.rawText,
      writeLockMatchesRevision: true,
    });

    const { resolveParameterIdentityMode } = await import("../parameter-kernel/parameterIdentityMode");
    if ((await resolveParameterIdentityMode(db!)) !== "semantic") {
      // Enablement submission is post-cutover-only; tip sharing + write-lock proofs above still apply.
      return;
    }

    const { submitParameterChanges } = await import("../parameters/service");
    const round = await submitParameterChanges(db!, auth, {
      projectId: PROJECT_ID,
      items: [
        {
          draftId: enablement.draftId,
          editSubjectKind: "node-enablement",
          logicalNodeId: logicalNodeId!,
          action: "set",
          targetValue: '"disabled"',
          reason: "Disable charging_core for board bring-up",
        },
        {
          draftId: peerEnablement.draftId,
          editSubjectKind: "node-enablement",
          logicalNodeId: peerLogicalNodeId,
          action: "set",
          targetValue: peerEnablement.rawText,
          reason: "Disable peer after charging_core",
        },
      ],
    }, createTestParameterSubmissionContext(auth, "req-edit-service-submit"));
    expect(round.items.length).toBeGreaterThanOrEqual(2);
    expect(
      (
        await db!.query<{ status: string }>(
          `select status from dts_config_revisions where id = $1`,
          [peerEnablement.candidateRevisionId],
        )
      ).rows[0]?.status,
    ).toBe("pending_approval");
    expect(
      (await db!.query(`select 1 from parameter_drafts where user_id = $1 and project_id = $2`, [USER_ID, PROJECT_ID]))
        .rows,
    ).toHaveLength(0);
  });
});
