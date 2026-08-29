import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { DtsToolchainRunner, DtsToolchainResult } from "../parameter-files/dtsToolchain";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { ingestConfigRevision } from "./ingestService";
import { validateConfigRevision } from "./service";
import type { ConfigRevisionManifest } from "./types";

const ORG_ID = "org-topo-validate";
const PROJECT_ID = "project-topo-validate";
const USER_ID = "user-topo-validate";
const CONFIG_SET_ID = "dcs-topo-validate";

const databaseAvailable = await isTestDatabaseAvailable();

const BASE_DTS = `/dts-v1/;

/ {
	compatible = "wiseeff,test";
	model = "validate-fixture";
	amba: amba {
		compatible = "wiseeff,amba";
	};
};
`;

const OVERLAY_DTS = `/dts-v1/;
/plugin/;

&amba {
	status = "okay";
};
`;

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORG_ID,
    name: "Topo Validate Admin",
    email: "topo-validate@example.com",
    organizationName: "Topo Validate Org",
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  });
}

function toolchainResult(overrides: Partial<DtsToolchainResult> = {}): DtsToolchainResult {
  return {
    ok: true,
    mode: "release",
    compiler: { dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" },
    diagnostics: [],
    artifacts: {
      baseDtbSha256: "a".repeat(64),
      effectiveDtbSha256: "b".repeat(64),
      inputManifestSha256: "c".repeat(64)
    },
    ...overrides
  };
}

function makeToolchain(result: DtsToolchainResult | (() => DtsToolchainResult)): DtsToolchainRunner {
  return {
    async validate() {
      return typeof result === "function" ? result() : result;
    },
    async probe() {
      return {
        dtc: { path: "/usr/bin/dtc", version: "1.8.1" },
        fdtoverlay: { path: "/usr/bin/fdtoverlay", version: "1.8.1" },
        dtschema: { path: "/usr/bin/dt-validate", version: "2026.6" }
      };
    }
  };
}

async function seedGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Topo Validate Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID]
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Topo Validate Admin', 'topo-validate@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_ID]
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, 'Topo Validate', 'TPV', 'initialized')
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [PROJECT_ID, ORG_ID]
  );
  await db.query(
    `
    insert into dts_config_set (id, organization_id, project_id, name, description)
    values ($1, $2, $3, 'validate-set', 'Task 3 validate fixture')
    on conflict (id) do update set name = excluded.name
    `,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID]
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
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, $4, 'dts', true, $5, $6, $7)
    `,
    [input.fileId, ORG_ID, PROJECT_ID, input.fileName, CONFIG_SET_ID, input.role, input.sortOrder]
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
      USER_ID
    ]
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    input.versionId,
    input.fileId
  ]);
}

async function seedRevision(
  db: InMemoryTestDatabase,
  auth: AuthContext,
  options: { baseContent?: string; overlayContent?: string; withMembers?: boolean } = {}
) {
  if (options.withMembers === false) {
    const revisionId = randomUUID();
    await db.query(
      `
      insert into dts_config_revisions (
        id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
      ) values ($1, $2, $3, $4, 1, 'resolved', $5)
      `,
      [revisionId, ORG_ID, PROJECT_ID, CONFIG_SET_ID, USER_ID]
    );
    return { id: revisionId, status: "resolved" as const };
  }

  const baseFileId = `file-base-${randomUUID().slice(0, 8)}`;
  const overlayFileId = `file-overlay-${randomUUID().slice(0, 8)}`;
  const baseVersionId = `fv-base-${randomUUID().slice(0, 8)}`;
  const overlayVersionId = `fv-overlay-${randomUUID().slice(0, 8)}`;
  const baseContent = options.baseContent ?? BASE_DTS;
  const overlayContent = options.overlayContent ?? OVERLAY_DTS;

  await insertPinnedMember(db, {
    fileId: baseFileId,
    fileName: "validate-base.dts",
    versionId: baseVersionId,
    content: baseContent,
    role: "base",
    sortOrder: 0
  });
  await insertPinnedMember(db, {
    fileId: overlayFileId,
    fileName: "validate-overlay.dts",
    versionId: overlayVersionId,
    content: overlayContent,
    role: "overlay",
    sortOrder: 1
  });

  const manifest: ConfigRevisionManifest = {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    configSetId: CONFIG_SET_ID,
    entryFile: "validate-base.dts",
    includeSearchPaths: ["."],
    overlayOrder: ["validate-overlay.dts"],
    members: [
      {
        fileId: baseFileId,
        fileVersionId: baseVersionId,
        fileName: "validate-base.dts",
        role: "base",
        sortOrder: 0,
        content: baseContent
      },
      {
        fileId: overlayFileId,
        fileVersionId: overlayVersionId,
        fileName: "validate-overlay.dts",
        role: "overlay",
        sortOrder: 1,
        content: overlayContent
      }
    ]
  };

  return ingestConfigRevision(db, manifest, auth);
}

async function clearOpenReviews(db: InMemoryTestDatabase) {
  await db.query(`delete from parameter_spec_review_tasks where organization_id = $1`, [ORG_ID]);
}

async function revisionStatus(db: InMemoryTestDatabase, revisionId: string) {
  const result = await db.query<{ status: string }>(
    `select status from dts_config_revisions where id = $1`,
    [revisionId]
  );
  return result.rows[0]?.status;
}

async function latestRun(db: InMemoryTestDatabase, revisionId: string, stage = "toolchain") {
  const result = await db.query<{
    status: string;
    stage: string;
    toolchain: unknown;
    artifact_hashes: unknown;
  }>(
    `
    select status, stage, toolchain, artifact_hashes
    from dts_validation_runs
    where config_revision_id = $1
      and stage = $2
    order by created_at desc
    limit 1
    `,
    [revisionId, stage]
  );
  return result.rows[0];
}

describe.skipIf(!databaseAvailable)("validateConfigRevision fail-closed", () => {
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

  it("rejects an empty Config Set and does not mark validated", async () => {
    const revision = await seedRevision(db!, auth, { withMembers: false });
    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      { toolchain: makeToolchain(toolchainResult()) }
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ failureCode: "empty-config-set" });
    expect(await revisionStatus(db!, revision.id)).toBe("resolved");
    expect(await latestRun(db!, revision.id)).toMatchObject({ status: "failed" });
  });

  it("fails closed when manifest_state is needs_review", async () => {
    const revision = await seedRevision(db!, auth);
    await db!.query(`update dts_config_revisions set manifest_state = 'needs_review' where id = $1`, [
      revision.id,
    ]);

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      { toolchain: makeToolchain(toolchainResult()) },
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ failureCode: "manifest-needs-review" });
    expect(await revisionStatus(db!, revision.id)).not.toBe("validated");
    expect(await latestRun(db!, revision.id, "manifest")).toMatchObject({ status: "failed" });
  });

  it("fails when dtc is unavailable", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revisions set status = 'resolved' where id = $1`, [revision.id]);

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      {
        toolchain: makeToolchain(
          toolchainResult({
            ok: false,
            failureCode: "toolchain-unavailable",
            compiler: { dtc: null, fdtoverlay: "1.8.1", dtschema: "2026.6" },
            diagnostics: [
              {
                file: "<toolchain>",
                severity: "error",
                code: "toolchain-unavailable",
                stage: "toolchain",
                message: "DTS toolchain incomplete (need dtc, fdtoverlay, and dt-validate)."
              }
            ]
          })
        )
      }
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ failureCode: "toolchain-unavailable" });
    expect(await revisionStatus(db!, revision.id)).not.toBe("validated");
  });

  it("fails when fdtoverlay fails", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revisions set status = 'resolved' where id = $1`, [revision.id]);

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      {
        toolchain: makeToolchain(
          toolchainResult({
            ok: false,
            failureCode: "compile-failed",
            diagnostics: [
              {
                file: "<toolchain>",
                severity: "error",
                code: "compile-failed",
                stage: "fdtoverlay",
                message: "fdtoverlay failed to apply overlays."
              }
            ]
          })
        )
      }
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ failureCode: "compile-failed" });
    expect(await revisionStatus(db!, revision.id)).not.toBe("validated");
  });

  it("fails when dt-schema validation fails", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revisions set status = 'resolved' where id = $1`, [revision.id]);

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      {
        toolchain: makeToolchain(
          toolchainResult({
            ok: false,
            failureCode: "schema-failed",
            diagnostics: [
              {
                file: "effective.dtb",
                severity: "error",
                code: "schema-failed",
                stage: "dt-validate",
                message: "compatible is a required property"
              }
            ]
          })
        )
      }
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ failureCode: "schema-failed" });
    expect(await revisionStatus(db!, revision.id)).not.toBe("validated");
  });

  it("fails on compile error without marking validated", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revisions set status = 'resolved' where id = $1`, [revision.id]);

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      {
        toolchain: makeToolchain(
          toolchainResult({
            ok: false,
            failureCode: "compile-failed",
            diagnostics: [
              {
                file: "validate-base.dts",
                severity: "error",
                code: "compile-failed",
                stage: "dtc",
                message: "syntax error",
                line: 4
              }
            ]
          })
        )
      }
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ failureCode: "compile-failed" });
    expect(await revisionStatus(db!, revision.id)).not.toBe("validated");
  });

  it("fails when an open identity mapping task remains", async () => {
    const revision = await seedRevision(db!, auth);
    await db!.query(`update dts_config_revisions set status = 'needs_mapping' where id = $1`, [
      revision.id
    ]);
    await db!.query(
      `
      insert into identity_mapping_tasks (
        id, organization_id, project_id, config_revision_id, status,
        previous_logical_node_id, candidate_logical_node_ids, evidence
      ) values ($1, $2, $3, $4, 'open', null, '[]'::jsonb, '{}'::jsonb)
      `,
      [randomUUID(), ORG_ID, PROJECT_ID, revision.id]
    );

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      { toolchain: makeToolchain(toolchainResult()) }
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ failureCode: "open-mapping" });
    expect(await revisionStatus(db!, revision.id)).toBe("needs_mapping");
  });

  it("persists singleton-per-project evidence and blocks validation without dropping instances", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revisions set status = 'resolved' where id = $1`, [revision.id]);
    // Ingest may already have auto-created a subject for compatible:wiseeff,test
    // (provisional surface / ensure paths). Reuse it so curated singleton cardinality applies.
    const existingSubject = await db!.query<{ id: string }>(
      `
      select id
      from attribution_subjects
      where organization_id = $1 and source_key = 'compatible:wiseeff,test'
      limit 1
      `,
      [ORG_ID],
    );
    const subjectId = existingSubject.rows[0]?.id ?? "subject-singleton";
    if (!existingSubject.rows[0]) {
      await db!.query(
        `
        insert into attribution_subjects (
          id, organization_id, subject_kind, display_name, origin, source_key
        ) values ($1, $2, 'driver-registration', 'Singleton service', 'curated', 'compatible:wiseeff,test')
        `,
        [subjectId, ORG_ID],
      );
    }
    await db!.query(
      `
      insert into driver_registrations (
        attribution_subject_id, driver_nature, instance_cardinality, notes
      ) values ($1, 'logical-service', 'singleton-per-project', '')
      on conflict (attribution_subject_id) do update
        set driver_nature = excluded.driver_nature,
            instance_cardinality = excluded.instance_cardinality,
            notes = excluded.notes
      `,
      [subjectId],
    );
    await db!.query(
      `
      insert into parameter_modules (
        id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
        kind, origin
      ) values (
        'pmod-' || $1 || '-' || md5('未分类'), $1, null, '未分类',
        'pmod-' || $1 || '-' || md5('未分类'), 1, 0, '', '', 'unclassified', 'auto'
      )
      on conflict (id) do nothing
      `,
      [ORG_ID],
    );
    await db!.query(
      `
      insert into parameter_modules (
        id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
        kind, origin, attribution_subject_id
      ) values (
        'module-singleton', $1, 'pmod-' || $1 || '-' || md5('未分类'),
        'Singleton service', 'singleton/service', 2, 0, '', '',
        'driver-group', 'curated', $2
      )
      on conflict (id) do update
        set attribution_subject_id = excluded.attribution_subject_id,
            kind = excluded.kind,
            origin = excluded.origin
      `,
      [ORG_ID, subjectId],
    );
    await db!.query(
      `
      insert into parameter_module_mappings (
        id, organization_id, parameter_module_id, match_kind, match_value, priority
      ) values
        ('mapping-singleton-root', $1, 'module-singleton', 'compatible', 'wiseeff,test', 0),
        ('mapping-singleton-amba', $1, 'module-singleton', 'compatible', 'wiseeff,amba', 0)
      on conflict (id) do nothing
      `,
      [ORG_ID],
    );

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      { toolchain: makeToolchain(toolchainResult()) },
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "open-mapping" });
    const blocker = await db!.query<{
      task_kind: string;
      candidate_logical_node_ids: unknown;
      evidence: { attributionSubjectId?: string; instanceCount?: number };
    }>(
      `
      select task_kind, candidate_logical_node_ids, evidence
      from identity_mapping_tasks
      where config_revision_id = $1 and task_kind = 'singleton-cardinality'
      `,
      [revision.id],
    );
    expect(blocker.rows).toHaveLength(1);
    expect(blocker.rows[0]?.evidence).toMatchObject({
      attributionSubjectId: subjectId,
      instanceCount: 2,
    });
    expect(blocker.rows[0]?.candidate_logical_node_ids).toHaveLength(2);

    const instances = await db!.query<{ count: string }>(
      `select count(*)::text as count from dts_logical_node_revisions where config_revision_id = $1`,
      [revision.id],
    );
    expect(Number(instances.rows[0]?.count)).toBeGreaterThanOrEqual(2);
  });

  it("marks validated only on the full success path and persists toolchain hashes", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revisions set status = 'resolved' where id = $1`, [revision.id]);

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      { toolchain: makeToolchain(toolchainResult()) }
    );

    expect(result.status).toBe("passed");
    expect(result.toolchain).toEqual({ dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" });
    expect(result.artifactHashes).toMatchObject({
      effectiveDtbSha256: "b".repeat(64),
      revisionId: revision.id
    });
    expect(await revisionStatus(db!, revision.id)).toBe("validated");

    const run = await latestRun(db!, revision.id);
    expect(run).toMatchObject({ status: "passed", stage: "toolchain" });
    expect(run?.toolchain).toMatchObject({ dtc: "1.8.1", fdtoverlay: "1.8.1", dtschema: "2026.6" });
    expect(run?.artifact_hashes).toMatchObject({ effectiveDtbSha256: "b".repeat(64) });
  });

  it("blocks a dirty unreviewed driver binding even when its review row was removed", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revisions set status = 'resolved' where id = $1`, [revision.id]);

    const subjectId = "asub-validate-dirty-driver";
    const specId = "pspec-validate-dirty-driver";
    const versionId = "psv-validate-dirty-driver";
    const businessId = "module-validate-dirty-business";
    const groupId = "module-validate-dirty-driver";
    await db!.query(
      `
      insert into attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key)
      values ($1, $2, 'driver-registration', 'Dirty driver', 'auto', 'compatible:dirty-driver-649')
      `,
      [subjectId, ORG_ID],
    );
    await db!.query(
      `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality, notes)
       values ($1, 'physical-device', 'multiple', '')`,
      [subjectId],
    );
    await db!.query(
      `insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
       values ($1, $2, 'Dirty business', $1, 1, 'business', 'curated', null)`,
      [businessId, ORG_ID],
    );
    await db!.query(
      `insert into parameter_modules (id, organization_id, parent_id, name, path, depth, kind, origin, attribution_subject_id)
       values ($1, $2, $3, 'Dirty driver', $1, 2, 'driver-group', 'auto', $4)`,
      [groupId, ORG_ID, businessId, subjectId],
    );
    await db!.query(
      `insert into driver_registration_placements
       (id, organization_id, attribution_subject_id, driver_group_module_id, default_business_category_module_id)
       values ($1, $2, $3, $4, $5)`,
      [`drp-${subjectId}`, ORG_ID, subjectId, groupId, businessId],
    );
    await db!.query(
      `insert into parameter_specs
       (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key)
       values ($1, $2, 'manual', 'dirty/driver/property', 'draft', $3, 'dirty_property_649')`,
      [specId, ORG_ID, subjectId],
    );
    await db!.query(
      `insert into parameter_spec_versions
       (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
       values ($1, $2, 1, 'Dirty', 'Dirty', '{"kind":"cells"}'::jsonb, 'draft', 'draft', 'dirty')`,
      [versionId, specId],
    );
    await db!.query(
      `insert into project_parameter_bindings
       (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
       values ($1, $2, $3, null, $4, $5)`,
      ["binding-validate-dirty-driver", ORG_ID, PROJECT_ID, specId, groupId],
    );
    await db!.query(
      `insert into project_parameter_binding_revisions
       (id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value, schema_state)
       values ($1, $2, $3, $4, '{"kind":"cells"}'::jsonb, '<1>', 'unreviewed')`,
      ["binding-validate-dirty-driver:v1", "binding-validate-dirty-driver", revision.id, versionId],
    );

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      { toolchain: makeToolchain(toolchainResult()) },
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "unreviewed-driver-tip" });
  });

  it("revokes validated publishability when re-validation fails", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revisions set status = 'validated' where id = $1`, [revision.id]);

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      {
        toolchain: makeToolchain(
          toolchainResult({
            ok: false,
            failureCode: "compile-failed",
            diagnostics: [
              {
                file: "<toolchain>",
                severity: "error",
                code: "compile-failed",
                stage: "dtc",
                message: "dtc failed on re-validation"
              }
            ]
          })
        )
      }
    );

    expect(result.status).toBe("failed");
    const status = await revisionStatus(db!, revision.id);
    expect(status).not.toBe("validated");
    expect(["invalid", "validation_failed"]).toContain(status);
  });

  it("fail-closes when role=base / entryFile is missing instead of picking the first file", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(`update dts_config_revision_members set role = 'overlay' where config_revision_id = $1`, [
      revision.id,
    ]);
    await db!.query(`update dts_config_revisions set entry_file = null, status = 'resolved' where id = $1`, [
      revision.id,
    ]);

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      { toolchain: makeToolchain(toolchainResult()) }
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({ failureCode: "empty-config-set" });
    expect(await revisionStatus(db!, revision.id)).not.toBe("validated");
  });

  it("reloads persisted includeSearchPaths and overlay order for validate", async () => {
    const revision = await seedRevision(db!, auth);
    await clearOpenReviews(db!);
    await db!.query(
      `
      update dts_config_revisions
      set status = 'resolved',
          include_search_paths = '["include","."]'::jsonb,
          overlay_order = '["validate-overlay.dts"]'::jsonb
      where id = $1
      `,
      [revision.id]
    );

    const result = await validateConfigRevision(
      db!,
      auth,
      { projectId: PROJECT_ID, revisionId: revision.id },
      {},
      { toolchain: makeToolchain(toolchainResult()) }
    );

    expect(result.status).toBe("passed");
    const stored = await db!.query<{
      include_search_paths: unknown;
      overlay_order: unknown;
      entry_file: string | null;
    }>(
      `select entry_file, include_search_paths, overlay_order from dts_config_revisions where id = $1`,
      [revision.id]
    );
    expect(stored.rows[0]?.entry_file).toBe("validate-base.dts");
    expect(stored.rows[0]?.include_search_paths).toEqual(["include", "."]);
    expect(stored.rows[0]?.overlay_order).toEqual(["validate-overlay.dts"]);
  });
});
