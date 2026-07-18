import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { DtsToolchainRunner } from "../parameter-files/dtsToolchain";
import { ApiError } from "../../shared/http/errors";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createOrReuseBinding, upsertBindingRevisionValues } from "./bindingService";
import { createBindingDraft, unchangedSourceBytes } from "./editService";
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

const failToolchain: DtsToolchainRunner = {
  async validate() {
    return {
      ok: false,
      mode: "release",
      compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" },
      diagnostics: [
        {
          file: "edit-overlay.dts",
          severity: "error",
          code: "schema-failed",
          message: "dt-validate: property iin_max fails schema",
          stage: "dt-validate",
        },
      ],
      failureCode: "schema-failed",
      artifacts: {},
    };
  },
  async probe() {
    return passToolchain.probe();
  },
};

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

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
        },
        reason: "Raise current limit for board variant",
      },
      { toolchain: passToolchain },
    );

    expect(draft.writeTarget).toMatchObject({ role: "overlay", propertyKey: "iin_max" });
    expect(draft.projectParameterBindingId).toBe(fixture.binding.id);
    expect(draft.parameterId).toBeTruthy();
    expect(draft.parameterSpecId).toBe(SPEC_ID);
    expect(draft.candidateRevisionId).toBeTruthy();
    expect(draft.rawText).toBe("<3000>");
    expect(await unchangedSourceBytes(draft)).toBe(true);

    const stored = await db!.query<{
      project_parameter_binding_id: string | null;
      candidate_config_revision_id: string | null;
      target_value: string;
    }>(
      `select project_parameter_binding_id, candidate_config_revision_id, target_value
       from parameter_drafts where id = $1`,
      [draft.draftId],
    );
    expect(stored.rows[0]?.project_parameter_binding_id).toBe(fixture.binding.id);
    expect(stored.rows[0]?.candidate_config_revision_id).toBe(draft.candidateRevisionId);
    expect(stored.rows[0]?.target_value).toBe("<3000>");
  });

  it("returns the persisted draft identity when the same binding draft is recreated", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    const create = (raw: string, reason: string) =>
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw, value: raw }]],
          },
          reason,
        },
        { toolchain: passToolchain },
      );

    const first = await create("3000", "Initial binding draft");
    const second = await create("3100", "Replacement binding draft");

    const stored = await db!.query<{
      id: string;
      candidate_config_revision_id: string | null;
      target_value: string;
    }>(
      `select id, candidate_config_revision_id, target_value
       from parameter_drafts
       where organization_id = $1
         and project_id = $2
         and user_id = $3
         and project_parameter_binding_id = $4`,
      [ORG_ID, PROJECT_ID, USER_ID, fixture.binding.id],
    );

    expect(stored.rows).toHaveLength(1);
    expect(second.draftId).toBe(first.draftId);
    expect(second.draftId).toBe(stored.rows[0]!.id);
    expect(stored.rows[0]!.candidate_config_revision_id).toBe(second.candidateRevisionId);
    expect(stored.rows[0]!.target_value).toBe("<3100>");
  });

  it("rejects stale base revision with structured conflict", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    const staleId = randomUUID();

    await expect(
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: staleId,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
          },
          reason: "stale edit",
        },
        { toolchain: passToolchain },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({ reason: "stale-revision" }),
    } satisfies Partial<ApiError>);
  });

  it("rejects needs_review manifest with manifest-needs-review failureCode", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    await db!.query(`update dts_config_revisions set manifest_state = 'needs_review' where id = $1`, [
      fixture.revision.id,
    ]);

    await expect(
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
          },
          reason: "blocked manifest",
        },
        { toolchain: passToolchain },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        reason: "manifest-needs-review",
        failureCode: "manifest-needs-review",
      }),
    } satisfies Partial<ApiError>);
  });

  it("creates project overlay instead of mutating shared base", async () => {
    const fixture = await seedConfigAndBinding(db!, auth, { overlayContent: OVERLAY_EMPTY });

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3100", value: "3100" }]],
        },
        reason: "Board variant override from shared base",
      },
      { toolchain: passToolchain },
    );

    expect(draft.writeTarget).toMatchObject({ role: "overlay", propertyKey: "iin_max" });
    expect(await unchangedSourceBytes(draft)).toBe(true);
    expect(draft.candidateOverlayContent).toContain("iin_max");
    expect(draft.candidateOverlayContent).toContain("3100");
    expect(draft.baseContent).toBe(fixture.baseContent);
  });

  it("supports delete action via overlay delete-property", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        action: "delete",
        reason: "Remove board override",
      },
      { toolchain: passToolchain },
    );

    expect(draft.writeTarget).toMatchObject({ role: "overlay", propertyKey: "iin_max" });
    expect(draft.rawText).toBe("");
    expect(draft.candidateOverlayContent).toMatch(/\/delete-property\/\s*iin_max/);
    expect(await unchangedSourceBytes(draft)).toBe(true);
  });

  it("rejects cell-count schema failures from vendor constraints", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);
    await db!.query(`update dts_property_specs set constraints = '{"cells":3}'::jsonb where property_key = 'iin_max'`);

    await expect(
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "2700", value: "2700" }]],
          },
          reason: "Wrong cell count",
        },
        { toolchain: passToolchain },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      message: "cell count must be 3",
      details: expect.objectContaining({ reason: "schema-failure", code: "SCHEMA_CELL_COUNT" }),
    });
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
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "99999", value: "99999" }]],
          },
          reason: "Out of range",
        },
        { toolchain: passToolchain },
      ),
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
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
          },
          reason: "Blocked by mapping",
        },
        { toolchain: passToolchain },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: expect.objectContaining({ reason: "unresolved-mapping" }),
    });
  });

  it("fail-closed when candidate toolchain validation fails", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    const before = await db!.query<{ raw_value: string | null }>(
      `
      select raw_value from project_parameter_binding_revisions
      where binding_id = $1 and config_revision_id = $2
      `,
      [fixture.binding.id, fixture.revision.id],
    );

    await expect(
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
          },
          reason: "Schema compile must block draft",
        },
        { toolchain: failToolchain },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: expect.objectContaining({
        reason: "toolchain-failure",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "schema-failed", severity: "error" }),
        ]),
      }),
    } satisfies Partial<ApiError>);

    const drafts = await db!.query<{ id: string }>(
      `select id from parameter_drafts where project_parameter_binding_id = $1`,
      [fixture.binding.id],
    );
    expect(drafts.rows).toHaveLength(0);

    const after = await db!.query<{ raw_value: string | null }>(
      `
      select raw_value from project_parameter_binding_revisions
      where binding_id = $1 and config_revision_id = $2
      `,
      [fixture.binding.id, fixture.revision.id],
    );
    expect(after.rows[0]?.raw_value).toBe(before.rows[0]?.raw_value);

    const runs = await db!.query<{ status: string; stage: string }>(
      `
      select status, stage from dts_validation_runs
      where stage = 'toolchain'
        and config_revision_id in (
          select id from dts_config_revisions
          where config_set_id = $1 and id <> $2
        )
      order by created_at desc
      limit 1
      `,
      [CONFIG_SET_ID, fixture.revision.id],
    );
    expect(runs.rows[0]).toMatchObject({ status: "failed", stage: "toolchain" });

    const candidateStatuses = await db!.query<{ status: string }>(
      `
      select status from dts_config_revisions
      where config_set_id = $1 and id <> $2
      order by revision_number desc
      limit 1
      `,
      [CONFIG_SET_ID, fixture.revision.id],
    );
    expect(candidateStatuses.rows[0]?.status).toBe("invalid");
    expect(candidateStatuses.rows[0]?.status).not.toBe("draft");
  });

  it("never overwrites candidate needs_mapping to draft when continuity is ambiguous", async () => {
    const ambiguousBase = `/dts-v1/;
/ {
	amba: amba {
		charging_core: charging_core@0 {
			compatible = "wiseeff,charging_core";
			reg = <0x0>;
			iin_max = <2300>;
		};
		twin: twin@0 {
			compatible = "wiseeff,charging_core";
			reg = <0x0>;
		};
	};
};
`;
    const fixture = await seedConfigAndBinding(db!, auth, {
      overlayContent: OVERLAY_OVERRIDE,
      baseContent: ambiguousBase,
    });

    await expect(
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
          },
          reason: "Must not promote needs_mapping",
        },
        { toolchain: passToolchain },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: expect.objectContaining({
        reason: "unresolved-mapping",
        candidateStatus: "needs_mapping",
      }),
    });

    const drafts = await db!.query<{ id: string }>(
      `select id from parameter_drafts where project_parameter_binding_id = $1`,
      [fixture.binding.id],
    );
    expect(drafts.rows).toHaveLength(0);

    const candidate = await db!.query<{ status: string }>(
      `
      select status from dts_config_revisions
      where config_set_id = $1 and id <> $2
      order by revision_number desc
      limit 1
      `,
      [CONFIG_SET_ID, fixture.revision.id],
    );
    expect(candidate.rows[0]?.status).toBe("needs_mapping");
  });

  it("toolchain pass is not enough when candidate has open spec review / unmatched occurrence", async () => {
    const unmatchedOverlay = `/dts-v1/;
/plugin/;

&charging_core {
	iin_max = <2700>;
	mystery_unmatched_gate = <1>;
};
`;
    const fixture = await seedConfigAndBinding(db!, auth, {
      overlayContent: unmatchedOverlay,
    });

    await expect(
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
          },
          reason: "Semantic gate must block despite toolchain pass",
        },
        { toolchain: passToolchain },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: expect.objectContaining({
        reason: expect.stringMatching(/open-spec-review|unmatched-occurrence/),
      }),
    });

    const drafts = await db!.query<{ id: string }>(
      `select id from parameter_drafts where project_parameter_binding_id = $1`,
      [fixture.binding.id],
    );
    expect(drafts.rows).toHaveLength(0);

    const candidate = await db!.query<{ status: string }>(
      `
      select status from dts_config_revisions
      where config_set_id = $1 and id <> $2
      order by revision_number desc
      limit 1
      `,
      [CONFIG_SET_ID, fixture.revision.id],
    );
    expect(candidate.rows[0]?.status).not.toBe("draft");
    expect(["resolved", "needs_mapping", "invalid"]).toContain(candidate.rows[0]?.status);
  });

  it("edits charging_core.iin_max without modifying sibling &amba or other overlay nodes", async () => {
    const multiNodeOverlay = `/dts-v1/;
/plugin/;

&amba {
};

&charging_core {
	iin_max = <2700>;
};
`;
    const multiNodeBase = `/dts-v1/;
/ {
	amba: amba {
		charging_core: charging_core {
			compatible = "wiseeff,charging_core";
			iin_max = <2300>;
		};
	};
};
`;
    const fixture = await seedConfigAndBinding(db!, auth, {
      overlayContent: multiNodeOverlay,
      baseContent: multiNodeBase,
    });

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
        },
        reason: "Raise charging_core only",
      },
      { toolchain: passToolchain },
    );

    expect(draft.candidateOverlayContent).toContain("iin_max = <3000>");
    expect(draft.candidateOverlayContent).toMatch(/&amba\s*\{\s*\}/s);
    expect(draft.candidateOverlayContent).not.toMatch(/&amba\s*\{[^}]*iin_max/s);
    expect(await unchangedSourceBytes(draft)).toBe(true);
    expect(draft.baseContent).toBe(multiNodeBase);
    expect(draft.baseChecksumBefore).toBe(fixture.baseChecksum);
    expect(draft.baseChecksumAfter).toBe(fixture.baseChecksum);
  });

  it("preserves includes, sibling overlays, and entry when building candidate revision", async () => {
    const includeContent = `/dts-v1/;
/ {
	shared: shared {
	};
};
`;
    const overlayA = `/dts-v1/;
/plugin/;

&shared {
};
`;
    const overlayB = `/dts-v1/;
/plugin/;

&charging_core {
	iin_max = <2700>;
};
`;
    const baseContent = `/dts-v1/;
/include/ "edit-include.dtsi"

/ {
	charging_core: charging_core {
		compatible = "wiseeff,charging_core";
		iin_max = <2300>;
	};
};
`;

    const includeFileId = `file-include-${randomUUID().slice(0, 8)}`;
    const overlayAFileId = `file-overlay-a-${randomUUID().slice(0, 8)}`;
    const overlayBFileId = `file-overlay-b-${randomUUID().slice(0, 8)}`;
    const baseFileId = `file-base-${randomUUID().slice(0, 8)}`;
    const includeVersionId = `fv-include-${randomUUID().slice(0, 8)}`;
    const overlayAVersionId = `fv-overlay-a-${randomUUID().slice(0, 8)}`;
    const overlayBVersionId = `fv-overlay-b-${randomUUID().slice(0, 8)}`;
    const baseVersionId = `fv-base-${randomUUID().slice(0, 8)}`;

    const baseChecksum = await insertPinnedMember(db!, {
      fileId: baseFileId,
      fileName: "edit-base.dts",
      versionId: baseVersionId,
      content: baseContent,
      role: "base",
      sortOrder: 0,
    });
    await insertPinnedMember(db!, {
      fileId: includeFileId,
      fileName: "edit-include.dtsi",
      versionId: includeVersionId,
      content: includeContent,
      role: "include",
      sortOrder: 1,
    });
    await insertPinnedMember(db!, {
      fileId: overlayAFileId,
      fileName: "edit-overlay-a.dts",
      versionId: overlayAVersionId,
      content: overlayA,
      role: "overlay",
      sortOrder: 2,
    });
    await insertPinnedMember(db!, {
      fileId: overlayBFileId,
      fileName: "edit-overlay-b.dts",
      versionId: overlayBVersionId,
      content: overlayB,
      role: "overlay",
      sortOrder: 3,
    });

    const manifest: ConfigRevisionManifest = {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      configSetId: CONFIG_SET_ID,
      entryFile: "edit-base.dts",
      includeSearchPaths: ["."],
      overlayOrder: ["edit-overlay-a.dts", "edit-overlay-b.dts"],
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
          fileId: includeFileId,
          fileVersionId: includeVersionId,
          fileName: "edit-include.dtsi",
          role: "include",
          sortOrder: 1,
          content: includeContent,
        },
        {
          fileId: overlayAFileId,
          fileVersionId: overlayAVersionId,
          fileName: "edit-overlay-a.dts",
          role: "overlay",
          sortOrder: 2,
          content: overlayA,
        },
        {
          fileId: overlayBFileId,
          fileVersionId: overlayBVersionId,
          fileName: "edit-overlay-b.dts",
          role: "overlay",
          sortOrder: 3,
          content: overlayB,
        },
      ],
    };

    const revision = await ingestConfigRevision(db!, manifest, auth);
    const logical = await db!.query<{ logical_node_id: string }>(
      `
      select logical_node_id
      from dts_logical_node_revisions
      where config_revision_id = $1 and node_locator like '%charging_core%'
      limit 1
      `,
      [revision.id],
    );
    const binding = await createOrReuseBinding(db!, {
      organizationId: ORG_ID,
      key: {
        projectId: PROJECT_ID,
        logicalNodeId: logical.rows[0]!.logical_node_id,
        parameterSpecId: SPEC_ID,
      },
    });
    await upsertBindingRevisionValues(db!, {
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

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: binding.id,
        baseRevisionId: revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3200", value: "3200" }]],
        },
        reason: "Preserve full config set members",
      },
      { toolchain: passToolchain },
    );

    const candidateMembers = await db!.query<{
      file_name: string;
      role: string;
      file_version_id: string;
      sort_order: number;
    }>(
      `
      select f.file_name, m.role, m.file_version_id, m.sort_order
      from dts_config_revision_members m
      join project_parameter_files f on f.id = m.file_id
      where m.config_revision_id = $1
      order by m.sort_order asc
      `,
      [draft.candidateRevisionId],
    );
    expect(candidateMembers.rows.map((row) => row.file_name)).toEqual([
      "edit-base.dts",
      "edit-include.dtsi",
      "edit-overlay-a.dts",
      "edit-overlay-b.dts",
    ]);
    expect(candidateMembers.rows.map((row) => row.role)).toEqual(["base", "include", "overlay", "overlay"]);
    expect(candidateMembers.rows[0]?.file_version_id).toBe(baseVersionId);
    expect(candidateMembers.rows[1]?.file_version_id).toBe(includeVersionId);
    expect(candidateMembers.rows[2]?.file_version_id).toBe(overlayAVersionId);
    expect(candidateMembers.rows[3]?.file_version_id).not.toBe(overlayBVersionId);
    expect(draft.candidateOverlayContent).toContain("3200");
    expect(draft.candidateOverlayContent).not.toContain("status = \"disabled\"");
    expect(await unchangedSourceBytes(draft)).toBe(true);
    expect(draft.baseChecksumAfter).toBe(baseChecksum);
  });

  it("enforces schema by default without an enforceSchema opt-in", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    await expect(
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "99999", value: "99999" }]],
          },
          reason: "Out of range without enforceSchema flag",
        },
        { toolchain: passToolchain },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: expect.objectContaining({ reason: "schema-failure" }),
    });
  });

  it("loads member bytes from object store by file version storage key", async () => {
    const entries = new Map<string, Buffer>();
    const objectStore = {
      async put(input: { organizationId: string; fileName: string; contentType: string; bytes: Buffer }) {
        const checksum = createHash("sha256").update(input.bytes).digest("hex");
        const storageKey = `${input.organizationId}/${checksum}-${input.fileName}`;
        entries.set(storageKey, Buffer.from(input.bytes));
        return {
          storageKey,
          fileName: input.fileName,
          contentType: input.contentType,
          fileSizeBytes: input.bytes.byteLength,
          checksumSha256: checksum,
        };
      },
      async get(storageKey: string) {
        const value = entries.get(storageKey);
        if (!value) throw new Error(`Missing object: ${storageKey}`);
        return Buffer.from(value);
      },
    };

    const baseFileId = `file-base-${randomUUID().slice(0, 8)}`;
    const overlayFileId = `file-overlay-${randomUUID().slice(0, 8)}`;
    const baseVersionId = `fv-base-${randomUUID().slice(0, 8)}`;
    const overlayVersionId = `fv-overlay-${randomUUID().slice(0, 8)}`;
    const baseStored = await objectStore.put({
      organizationId: ORG_ID,
      fileName: "edit-base.dts",
      contentType: "text/plain",
      bytes: Buffer.from(BASE_WITH_IIN, "utf8"),
    });
    const overlayStored = await objectStore.put({
      organizationId: ORG_ID,
      fileName: "edit-overlay.dts",
      contentType: "text/plain",
      bytes: Buffer.from(OVERLAY_OVERRIDE, "utf8"),
    });

    await db!.query(
      `
      insert into project_parameter_files (
        id, organization_id, project_id, file_name, format, enabled,
        config_set_id, config_set_role, config_set_sort_order
      ) values ($1, $2, $3, $4, 'dts', true, $5, 'base', 0)
      `,
      [baseFileId, ORG_ID, PROJECT_ID, "edit-base.dts", CONFIG_SET_ID],
    );
    await db!.query(
      `
      insert into project_parameter_files (
        id, organization_id, project_id, file_name, format, enabled,
        config_set_id, config_set_role, config_set_sort_order
      ) values ($1, $2, $3, $4, 'dts', true, $5, 'overlay', 1)
      `,
      [overlayFileId, ORG_ID, PROJECT_ID, "edit-overlay.dts", CONFIG_SET_ID],
    );
    await db!.query(
      `
      insert into project_parameter_file_versions (
        id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
      ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)
      `,
      [
        baseVersionId,
        baseFileId,
        baseStored.storageKey,
        baseStored.checksumSha256,
        Buffer.byteLength(BASE_WITH_IIN, "utf8"),
        USER_ID,
      ],
    );
    await db!.query(
      `
      insert into project_parameter_file_versions (
        id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
      ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)
      `,
      [
        overlayVersionId,
        overlayFileId,
        overlayStored.storageKey,
        overlayStored.checksumSha256,
        Buffer.byteLength(OVERLAY_OVERRIDE, "utf8"),
        USER_ID,
      ],
    );
    await db!.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      baseVersionId,
      baseFileId,
    ]);
    await db!.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      overlayVersionId,
      overlayFileId,
    ]);

    const revision = await ingestConfigRevision(
      db!,
      {
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
            content: BASE_WITH_IIN,
          },
          {
            fileId: overlayFileId,
            fileVersionId: overlayVersionId,
            fileName: "edit-overlay.dts",
            role: "overlay",
            sortOrder: 1,
            content: OVERLAY_OVERRIDE,
          },
        ],
      },
      auth,
    );
    const logical = await db!.query<{ logical_node_id: string }>(
      `
      select logical_node_id from dts_logical_node_revisions
      where config_revision_id = $1 and node_locator like '%charging_core%'
      limit 1
      `,
      [revision.id],
    );
    const binding = await createOrReuseBinding(db!, {
      organizationId: ORG_ID,
      key: {
        projectId: PROJECT_ID,
        logicalNodeId: logical.rows[0]!.logical_node_id,
        parameterSpecId: SPEC_ID,
      },
    });
    await upsertBindingRevisionValues(db!, {
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

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: binding.id,
        baseRevisionId: revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3050", value: "3050" }]],
        },
        reason: "Object-store backed edit",
      },
      { toolchain: passToolchain, objectStore },
    );

    expect(draft.rawText).toBe("<3050>");
    expect(draft.candidateOverlayContent).toContain("3050");
    expect(await unchangedSourceBytes(draft)).toBe(true);
  });
});

describe.skipIf(!databaseAvailable)("precise occurrence CST writeback", () => {
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

  it("updates only the effective duplicate &same_label occurrence", async () => {
    const baseContent = `/dts-v1/;
/ {
	same_label: charging_core {
		compatible = "wiseeff,charging_core";
		iin_max = <2300>;
	};
};
`;
    // Two identical &same_label fragments; effective value is the later occurrence.
    const overlayContent = `/dts-v1/;
/plugin/;

&same_label {
	/* first fragment */
	iin_max = <1000>;
};

&same_label {
	/* effective fragment */
	iin_max = <2000>;
};
`;
    const fixture = await seedConfigAndBinding(db!, auth, { overlayContent, baseContent });

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3333", value: "3333" }]],
        },
        reason: "Edit effective duplicate label only",
      },
      { toolchain: passToolchain },
    );

    expect(draft.writeTarget).toMatchObject({
      role: "overlay",
      propertyKey: "iin_max",
      occurrenceId: expect.any(String),
      occurrenceSpan: expect.objectContaining({
        start: expect.any(Number),
        end: expect.any(Number),
      }),
      checksum: expect.any(String),
      fileVersionId: expect.any(String),
      targetRef: "same_label",
    });
    expect(draft.candidateOverlayContent).toContain("iin_max = <1000>");
    expect(draft.candidateOverlayContent).toContain("/* first fragment */");
    expect(draft.candidateOverlayContent).toContain("/* effective fragment */");
    expect(draft.candidateOverlayContent).toContain("iin_max = <3333>");
    expect(draft.candidateOverlayContent).not.toContain("iin_max = <2000>");
    expect(draft.candidateOverlayContent).not.toContain("&charging_core");
    expect(await unchangedSourceBytes(draft)).toBe(true);
  });

  it("updates the selected node when the same property key exists on multiple nodes", async () => {
    const baseContent = `/dts-v1/;
/ {
	amba: amba {
		compatible = "wiseeff,charging_core";
		iin_max = <1111>;
	};
	charging_core: charging_core {
		compatible = "wiseeff,charging_core";
		iin_max = <2300>;
	};
};
`;
    const overlayContent = `/dts-v1/;
/plugin/;

&amba {
	iin_max = <1111>;
};

&charging_core {
	iin_max = <2700>;
};
`;
    const fixture = await seedConfigAndBinding(db!, auth, { overlayContent, baseContent });

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
        },
        reason: "Edit charging_core only among multi-node keys",
      },
      { toolchain: passToolchain },
    );

    expect(draft.candidateOverlayContent).toMatch(/&amba\s*\{[^}]*iin_max\s*=\s*<1111>/s);
    expect(draft.candidateOverlayContent).toContain("iin_max = <3000>");
    expect(draft.candidateOverlayContent).not.toContain("iin_max = <2700>");
  });

  it("deletes via /delete-property/ into the target occurrence node only", async () => {
    const baseContent = `/dts-v1/;
/ {
	amba: amba {
		compatible = "wiseeff,charging_core";
		iin_max = <1111>;
	};
	charging_core: charging_core {
		compatible = "wiseeff,charging_core";
		iin_max = <2300>;
	};
};
`;
    const overlayContent = `/dts-v1/;
/plugin/;

&amba {
	/delete-property/ iin_max;
};

&charging_core {
	iin_max = <2700>;
};
`;
    const fixture = await seedConfigAndBinding(db!, auth, { overlayContent, baseContent });

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        action: "delete",
        reason: "Delete target occurrence despite existing delete-property elsewhere",
      },
      { toolchain: passToolchain },
    );

    const ambaBlock = draft.candidateOverlayContent.match(/&amba\s*\{[\s\S]*?\};/)?.[0] ?? "";
    const coreBlock = draft.candidateOverlayContent.match(/&charging_core\s*\{[\s\S]*?\};/)?.[0] ?? "";
    expect(ambaBlock).toMatch(/\/delete-property\/\s*iin_max/);
    expect(coreBlock).toMatch(/\/delete-property\/\s*iin_max/);
    expect(coreBlock).not.toContain("iin_max = <2700>");
    expect(draft.candidateOverlayContent.match(/\/delete-property\/\s*iin_max/g)?.length).toBe(2);
  });

  it("rejects stale occurrence span without guessing another match", async () => {
    const fixture = await seedConfigAndBinding(db!, auth);

    await db!.query(
      `
      update dts_property_occurrences
      set start_offset = start_offset + 50, end_offset = end_offset + 50
      where id in (
        select oe.property_occurrence_id
        from dts_occurrence_effects oe
        where oe.config_revision_id = $1
          and oe.property_name = 'iin_max'
          and oe.property_occurrence_id is not null
      )
      `,
      [fixture.revision.id],
    );

    await expect(
      createBindingDraft(
        db!,
        auth,
        {
          bindingId: fixture.binding.id,
          baseRevisionId: fixture.revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
          },
          reason: "Stale span must conflict",
        },
        { toolchain: passToolchain },
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({ reason: "stale-span" }),
    } satisfies Partial<ApiError>);
  });

  it("creates base-only override on the selected overlay target node", async () => {
    const fixture = await seedConfigAndBinding(db!, auth, { overlayContent: OVERLAY_EMPTY });

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: fixture.binding.id,
        baseRevisionId: fixture.revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3100", value: "3100" }]],
        },
        reason: "Base-only value → project overlay override",
      },
      { toolchain: passToolchain },
    );

    expect(draft.writeTarget).toMatchObject({
      role: "overlay",
      propertyKey: "iin_max",
      targetRef: "charging_core",
      fileName: "edit-overlay.dts",
    });
    expect(draft.candidateOverlayContent).toMatch(/&charging_core\s*\{[\s\S]*iin_max\s*=\s*<3100>/);
    expect(draft.baseContent).toBe(fixture.baseContent);
    expect(await unchangedSourceBytes(draft)).toBe(true);
  });

  it("preserves includes, comments, whitespace, and sibling overlays on round trip", async () => {
    const includeContent = `/dts-v1/;
/ {
	shared: shared {
	};
};
`;
    const overlayA = `/dts-v1/;
/plugin/;

&shared {
};
`;
    const overlayB = `/dts-v1/;
/plugin/;

&charging_core {
	/* keep comment */
	iin_max = <2700>;
};
`;
    const baseContent = `/dts-v1/;
/include/ "edit-include.dtsi"

/ {
	charging_core: charging_core {
		compatible = "wiseeff,charging_core";
		iin_max = <2300>;
	};
};
`;

    const includeFileId = `file-include-${randomUUID().slice(0, 8)}`;
    const overlayAFileId = `file-overlay-a-${randomUUID().slice(0, 8)}`;
    const overlayBFileId = `file-overlay-b-${randomUUID().slice(0, 8)}`;
    const baseFileId = `file-base-${randomUUID().slice(0, 8)}`;
    const includeVersionId = `fv-include-${randomUUID().slice(0, 8)}`;
    const overlayAVersionId = `fv-overlay-a-${randomUUID().slice(0, 8)}`;
    const overlayBVersionId = `fv-overlay-b-${randomUUID().slice(0, 8)}`;
    const baseVersionId = `fv-base-${randomUUID().slice(0, 8)}`;

    await insertPinnedMember(db!, {
      fileId: baseFileId,
      fileName: "edit-base.dts",
      versionId: baseVersionId,
      content: baseContent,
      role: "base",
      sortOrder: 0,
    });
    await insertPinnedMember(db!, {
      fileId: includeFileId,
      fileName: "edit-include.dtsi",
      versionId: includeVersionId,
      content: includeContent,
      role: "include",
      sortOrder: 1,
    });
    await insertPinnedMember(db!, {
      fileId: overlayAFileId,
      fileName: "edit-overlay-a.dts",
      versionId: overlayAVersionId,
      content: overlayA,
      role: "overlay",
      sortOrder: 2,
    });
    await insertPinnedMember(db!, {
      fileId: overlayBFileId,
      fileName: "edit-overlay-b.dts",
      versionId: overlayBVersionId,
      content: overlayB,
      role: "overlay",
      sortOrder: 3,
    });

    const revision = await ingestConfigRevision(
      db!,
      {
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        configSetId: CONFIG_SET_ID,
        entryFile: "edit-base.dts",
        includeSearchPaths: ["."],
        overlayOrder: ["edit-overlay-a.dts", "edit-overlay-b.dts"],
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
            fileId: includeFileId,
            fileVersionId: includeVersionId,
            fileName: "edit-include.dtsi",
            role: "include",
            sortOrder: 1,
            content: includeContent,
          },
          {
            fileId: overlayAFileId,
            fileVersionId: overlayAVersionId,
            fileName: "edit-overlay-a.dts",
            role: "overlay",
            sortOrder: 2,
            content: overlayA,
          },
          {
            fileId: overlayBFileId,
            fileVersionId: overlayBVersionId,
            fileName: "edit-overlay-b.dts",
            role: "overlay",
            sortOrder: 3,
            content: overlayB,
          },
        ],
      },
      auth,
    );

    const logical = await db!.query<{ logical_node_id: string }>(
      `
      select logical_node_id
      from dts_logical_node_revisions
      where config_revision_id = $1 and node_locator like '%charging_core%'
      limit 1
      `,
      [revision.id],
    );
    const binding = await createOrReuseBinding(db!, {
      organizationId: ORG_ID,
      key: {
        projectId: PROJECT_ID,
        logicalNodeId: logical.rows[0]!.logical_node_id,
        parameterSpecId: SPEC_ID,
      },
    });
    await upsertBindingRevisionValues(db!, {
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

    const draft = await createBindingDraft(
      db!,
      auth,
      {
        bindingId: binding.id,
        baseRevisionId: revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "3200", value: "3200" }]],
        },
        reason: "Round-trip preserve non-target text",
      },
      { toolchain: passToolchain },
    );

    expect(draft.candidateOverlayContent).toContain("/* keep comment */");
    expect(draft.candidateOverlayContent).toContain("iin_max = <3200>");
    expect(draft.candidateOverlayContent.replace(/\s+/g, " ")).toContain("iin_max = <3200>");

    const withoutTargetValue = (text: string) =>
      text.replace(/iin_max\s*=\s*<\d+>/, "iin_max = <VALUE>");
    expect(withoutTargetValue(draft.candidateOverlayContent)).toBe(withoutTargetValue(overlayB));

    const candidateMembers = await db!.query<{ file_name: string; file_version_id: string }>(
      `
      select f.file_name, m.file_version_id
      from dts_config_revision_members m
      join project_parameter_files f on f.id = m.file_id
      where m.config_revision_id = $1
      order by m.sort_order asc
      `,
      [draft.candidateRevisionId],
    );
    expect(candidateMembers.rows.map((row) => row.file_name)).toEqual([
      "edit-base.dts",
      "edit-include.dtsi",
      "edit-overlay-a.dts",
      "edit-overlay-b.dts",
    ]);
    expect(candidateMembers.rows[0]?.file_version_id).toBe(baseVersionId);
    expect(candidateMembers.rows[1]?.file_version_id).toBe(includeVersionId);
    expect(candidateMembers.rows[2]?.file_version_id).toBe(overlayAVersionId);
    expect(candidateMembers.rows[3]?.file_version_id).not.toBe(overlayBVersionId);
  });
});
