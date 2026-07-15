import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createOrReuseBinding, upsertBindingRevisionValues } from "./bindingService";
import { createBindingDraft, unchangedSourceBytes } from "./editService";
import { ingestConfigRevision } from "./ingestService";
import type { ConfigRevisionManifest } from "./types";

const ORG_ID = "org-topo-edit";
const PROJECT_ID = "project-topo-edit";
const USER_ID = "user-topo-edit";
const CONFIG_SET_ID = "dcs-topo-edit";
const SPEC_ID = "spec-iin-max";
const SPEC_VERSION_ID = "specver-iin-max-1";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Topo Edit Admin",
      email: "topo-edit@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Topo Edit Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
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

async function insertPinnedMember(
  db: InMemoryTestDatabase,
  input: {
    fileId: string;
    fileName: string;
    versionId: string;
    content: string;
    role: "base" | "overlay";
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

const OVERLAY_EMPTY = `/dts-v1/;
/plugin/;

&charging_core {
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
    baseFileId,
    overlayFileId,
    baseChecksum,
    baseContent,
    overlayContent: options.overlayContent,
  };
}

describe.skipIf(!databaseAvailable)("createBindingDraft", () => {
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

  it("patches overlay write target and preserves base source bytes", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    const draft = await createBindingDraft(db!, auth, {
      bindingId: fixture.binding.id,
      baseRevisionId: fixture.revision.id,
      targetValue: {
        kind: "cells",
        bits: 32,
        groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
      },
      reason: "Raise current limit for board variant",
    });

    expect(draft.writeTarget).toMatchObject({ role: "overlay", propertyKey: "iin_max" });
    expect(draft.projectParameterBindingId).toBe(fixture.binding.id);
    expect(draft.parameterSpecId).toBe(SPEC_ID);
    expect(draft.rawText).toBe("<3000>");
    expect(await unchangedSourceBytes(draft)).toBe(true);

    const stored = await db!.query<{
      project_parameter_binding_id: string | null;
      target_value: string;
    }>(
      `select project_parameter_binding_id, target_value from parameter_drafts where id = $1`,
      [draft.draftId],
    );
    expect(stored.rows[0]?.project_parameter_binding_id).toBe(fixture.binding.id);
    expect(stored.rows[0]?.target_value).toBe("<3000>");
  });

  it("rejects stale base revision with structured conflict", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    const staleId = randomUUID();

    await expect(
      createBindingDraft(db!, auth, {
        bindingId: fixture.binding.id,
        baseRevisionId: staleId,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
        },
        reason: "stale edit",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({ reason: "stale-revision" }),
    } satisfies Partial<ApiError>);
  });

  it("creates project overlay instead of mutating shared base", async () => {
    const fixture = await seedConfigAndBinding(db!, auth, { overlayContent: OVERLAY_EMPTY });

    const draft = await createBindingDraft(db!, auth, {
      bindingId: fixture.binding.id,
      baseRevisionId: fixture.revision.id,
      targetValue: {
        kind: "cells",
        bits: 32,
        groups: [[{ kind: "integer", raw: "3100", value: "3100" }]],
      },
      reason: "Board variant override from shared base",
    });

    expect(draft.writeTarget).toMatchObject({ role: "overlay", propertyKey: "iin_max" });
    expect(await unchangedSourceBytes(draft)).toBe(true);
    expect(draft.candidateOverlayContent).toContain("iin_max");
    expect(draft.candidateOverlayContent).toContain("3100");
    expect(draft.baseContent).toBe(fixture.baseContent);
  });

  it("supports delete action via overlay delete-property", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    const draft = await createBindingDraft(db!, auth, {
      bindingId: fixture.binding.id,
      baseRevisionId: fixture.revision.id,
      action: "delete",
      reason: "Remove board override",
    });

    expect(draft.writeTarget).toMatchObject({ role: "overlay", propertyKey: "iin_max" });
    expect(draft.rawText).toBe("");
    expect(draft.candidateOverlayContent).toMatch(/\/delete-property\/\s*iin_max/);
    expect(await unchangedSourceBytes(draft)).toBe(true);
  });

  it("returns schema diagnostics without updating released binding revision", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    const before = await db!.query<{ raw_value: string | null }>(
      `
      select raw_value from project_parameter_binding_revisions
      where binding_id = $1 and config_revision_id = $2
      `,
      [fixture.binding.id, fixture.revision.id],
    );

    await expect(
      createBindingDraft(db!, auth, {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "99999", value: "99999" }]],
        },
        reason: "Out of range",
        enforceSchema: true,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: expect.objectContaining({ reason: "schema-failure" }),
    });

    const after = await db!.query<{ raw_value: string | null }>(
      `
      select raw_value from project_parameter_binding_revisions
      where binding_id = $1 and config_revision_id = $2
      `,
      [fixture.binding.id, fixture.revision.id],
    );
    expect(after.rows[0]?.raw_value).toBe(before.rows[0]?.raw_value);
  });

  it("fail-closed when base revision has unresolved mapping", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    await db!.query(`update dts_config_revisions set status = 'needs_mapping' where id = $1`, [
      fixture.revision.id,
    ]);

    await expect(
      createBindingDraft(db!, auth, {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
        },
        reason: "Blocked by mapping",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: expect.objectContaining({ reason: "unresolved-mapping" }),
    });
  });
});
