import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { DtsToolchainRunner, DtsToolchainResult } from "../parameter-files/dtsToolchain";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
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
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Topo Validate Admin",
      email: "topo-validate@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: ORG_ID, name: "Topo Validate Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]
  };
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
});
