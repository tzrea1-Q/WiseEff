import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  assertProjectParameterPlaneArchived,
  captureProjectParameterPlane,
} from "./archive";
import {
  disposeProjectParameterPlaneResidue,
  planProjectParameterPlaneDisposal,
  retrieveProjectParameterPlaneArchive,
} from "./dispose";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createMemoryObjectStore } from "../../../testing/objectStore";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../../shared/database/client";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "plane disposal tests require a reachable real PostgreSQL server; skipping is forbidden",
  );
}

const ORG = "org-plane-dispose";
const PROJECT = "atlas";
const OTHER = "aurora";
const operator = { role: "cutover-operator" as const, approvalRef: "dispose-approval-1" };

describe("project parameter plane residue disposal", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;

  const editorAuth = makeTestAuthContext({
    userId: "user-plane-dispose",
    organizationId: ORG,
    name: "Dispose editor",
    email: "dispose@example.com",
    permissions: ["parameter:view", "parameter:edit"],
  });
  const viewerAuth = makeTestAuthContext({
    userId: "user-plane-dispose-viewer",
    organizationId: ORG,
    name: "Dispose viewer",
    email: "dispose-viewer@example.com",
    permissions: ["parameter:view"],
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("pdisp");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Dispose org')`, [ORG]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ('user-plane-dispose', $1, 'Editor', 'dispose@example.com', 'Editor', true),
              ('user-plane-dispose-viewer', $1, 'Viewer', 'dispose-viewer@example.com', 'Viewer', true)`,
      [ORG],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ('atlas', $1, 'Atlas', 'ATL-Intl', 'initialized'),
              ('aurora', $1, 'Aurora', 'AUR-Prod', 'initialized')`,
      [ORG],
    );
    await pool.query(
      `insert into public.parameter_drafts (id, organization_id, project_id, target_value, reason)
       values ('pdraft_dispose_1', $1, $2, '1000', 'residue draft'),
              ('pdraft_other', $1, $3, '3000', 'other project')`,
      [ORG, PROJECT, OTHER],
    );
    await pool.query(
      `insert into public.parameter_definitions (
         id, organization_id, name, description, explanation, config_format,
         module, default_range, unit, risk
       ) values (
         'legacy_definition_dispose', $1, 'Legacy limit', 'Legacy limit', 'Legacy limit',
         'number', 'Dispose', '0..2000', 'mA', 'Medium'
       )`,
      [ORG],
    );
    await pool.query(
      `insert into public.project_parameter_values (
         id, organization_id, project_id, parameter_definition_id, current_value, recommended_value
       ) values (
         'legacy_value_dispose', $1, $2, 'legacy_definition_dispose', '1000', '1100'
       )`,
      [ORG, PROJECT],
    );
  }, 120_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("refuses viewers and non-target projects", async () => {
    const store = createMemoryObjectStore();
    const archive = await captureProjectParameterPlane(root, store, editorAuth, { projectId: PROJECT });
    await expect(
      disposeProjectParameterPlaneResidue(root, store, viewerAuth, operator, {
        projectId: PROJECT,
        archiveId: archive.archiveId,
        archiveDigest: archive.archiveDigest,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      disposeProjectParameterPlaneResidue(
        root,
        store,
        editorAuth,
        { role: "cutover-operator", approvalRef: "" },
        { projectId: PROJECT, archiveId: archive.archiveId, archiveDigest: archive.archiveDigest },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      planProjectParameterPlaneDisposal(root, store, editorAuth, operator, {
        projectId: "acme",
        archiveId: archive.archiveId,
        archiveDigest: archive.archiveDigest,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("deletes snapshot residue, keeps other projects and post-cutover writes, and replays", async () => {
    const store = createMemoryObjectStore();
    const archive = await captureProjectParameterPlane(root, store, editorAuth, { projectId: PROJECT });
    await assertProjectParameterPlaneArchived(root, store, {
      organizationId: ORG,
      projectId: PROJECT,
      archiveId: archive.archiveId,
      archiveDigest: archive.archiveDigest,
    });
    await pool.query(
      `insert into public.parameter_drafts (id, organization_id, project_id, target_value, reason)
       values ('pdraft_after', $1, $2, '4000', 'post-cutover')`,
      [ORG, PROJECT],
    );
    const plan = await planProjectParameterPlaneDisposal(root, store, editorAuth, operator, {
      projectId: PROJECT,
      archiveId: archive.archiveId,
      archiveDigest: archive.archiveDigest,
    });
    expect(plan.residue.parameter_drafts).toEqual(expect.arrayContaining(["pdraft_dispose_1"]));
    expect(plan.residue.parameter_drafts).not.toContain("pdraft_after");
    expect(plan.residue.legacy_parameter_values).toEqual(["legacy_value_dispose"]);

    const first = await disposeProjectParameterPlaneResidue(root, store, editorAuth, operator, {
      projectId: PROJECT,
      archiveId: archive.archiveId,
      archiveDigest: archive.archiveDigest,
    });
    expect(first.phase).toBe("residue-deleted");
    const remaining = await pool.query<{ id: string }>(
      `select id from public.parameter_drafts where organization_id = $1 order by id`,
      [ORG],
    );
    expect(remaining.rows.map((row) => row.id)).toEqual(["pdraft_after", "pdraft_other"]);
    const leftoverValue = await pool.query(
      `select id from public.project_parameter_values where id = 'legacy_value_dispose'`,
    );
    expect(leftoverValue.rows).toHaveLength(0);

    const replay = await disposeProjectParameterPlaneResidue(root, store, editorAuth, operator, {
      projectId: PROJECT,
      archiveId: archive.archiveId,
      archiveDigest: archive.archiveDigest,
    });
    expect(replay.phase).toBe("residue-deleted");
    const retrieved = await retrieveProjectParameterPlaneArchive(root, store, operator, {
      archiveId: archive.archiveId,
    });
    expect(retrieved.schemaVersion).toBe("project-parameter-plane-archive/v2");
    expect(retrieved.relations.parameter_drafts.some((row) => (row as { id: string }).id === "pdraft_dispose_1")).toBe(
      true,
    );
  });

  it("refuses truncated or tampered archives before any delete", async () => {
    const store = createMemoryObjectStore();
    await pool.query(
      `insert into public.parameter_drafts (id, organization_id, project_id, target_value, reason)
       values ('pdraft_tamper', $1, $2, '9', 'tamper')`,
      [ORG, PROJECT],
    );
    const archive = await captureProjectParameterPlane(root, store, editorAuth, { projectId: PROJECT });
    await pool.query(`update project_parameter_plane_archives set truncated = true where id = $1`, [
      archive.archiveId,
    ]);
    await expect(
      disposeProjectParameterPlaneResidue(root, store, editorAuth, operator, {
        projectId: PROJECT,
        archiveId: archive.archiveId,
        archiveDigest: archive.archiveDigest,
      }),
    ).rejects.toMatchObject({ details: { reason: "parameter-plane-archive-truncated" } });
    expect(
      (await pool.query(`select id from public.parameter_drafts where id = 'pdraft_tamper'`)).rows,
    ).toHaveLength(1);
  });

  it("deletes unreferenced old files but preserves parents of retained historical revisions", async () => {
    const store = createMemoryObjectStore();
    const currentBytes = Buffer.from("current source", "utf8");
    const residueBytes = Buffer.from("residue source", "utf8");
    const historyBytes = Buffer.from("retained historical source", "utf8");
    store.entries.set("org/atlas/current.dts", currentBytes);
    store.entries.set("org/atlas/residue.dts", residueBytes);
    store.entries.set("org/atlas/history.dts", historyBytes);
    const checksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    await pool.query(
      `insert into public.dts_config_set (id, organization_id, project_id, name)
       values ('dcs_dispose', $1, $2, 'default')`,
      [ORG, PROJECT],
    );
    await pool.query(
      `insert into public.project_parameter_files (id, organization_id, project_id, file_name, format, config_set_id)
       values ('pfile_current', $1, $2, 'current.dts', 'dts', 'dcs_dispose'),
              ('pfile_residue', $1, $2, 'residue.dts', 'dts', null),
              ('pfile_history', $1, $2, 'history.dts', 'dts', null)`,
      [ORG, PROJECT],
    );
    await pool.query(
      `insert into public.project_parameter_file_versions
         (id, file_id, version_number, storage_key, checksum, size_bytes, origin)
       values ('pfv_current', 'pfile_current', 1, 'org/atlas/current.dts', $1, $2, 'upload'),
              ('pfv_residue', 'pfile_residue', 1, 'org/atlas/residue.dts', $3, $4, 'upload'),
              ('pfv_history', 'pfile_history', 1, 'org/atlas/history.dts', $5, $6, 'upload')`,
      [checksum(currentBytes), currentBytes.byteLength, checksum(residueBytes), residueBytes.byteLength,
        checksum(historyBytes), historyBytes.byteLength],
    );
    await pool.query(`update public.project_parameter_files file
      set current_version_id = version.id
      from public.project_parameter_file_versions version
      where version.file_id = file.id and file.id in ('pfile_current', 'pfile_residue', 'pfile_history')`);
    await pool.query(
      `insert into public.dts_config_revisions
         (id, organization_id, project_id, config_set_id, revision_number, status)
       values ('revision_dispose', $1, $2, 'dcs_dispose', 1, 'resolved'),
              ('revision_history', $1, $2, 'dcs_dispose', 2, 'resolved')`,
      [ORG, PROJECT],
    );
    await pool.query(
      `insert into public.dts_config_revision_members
         (id, config_revision_id, file_id, file_version_id, role, sort_order, source_name)
       values ('rev_member_dispose', 'revision_dispose', 'pfile_current', 'pfv_current', 'base', 0, 'current.dts'),
              ('rev_member_history', 'revision_history', 'pfile_history', 'pfv_history', 'base', 0, 'history.dts')`,
    );
    await pool.query(
      `insert into public.dts_nodes (id, file_version_id, name, node_path, sort_order)
       values ('node_residue', 'pfv_residue', 'soc', '/soc', 0)`,
    );
    const archive = await captureProjectParameterPlane(root, store, editorAuth, { projectId: PROJECT });
    const plan = await planProjectParameterPlaneDisposal(root, store, editorAuth, operator, {
      projectId: PROJECT,
      archiveId: archive.archiveId,
      archiveDigest: archive.archiveDigest,
    });
    expect(plan.residue.project_parameter_files).toEqual(expect.arrayContaining(["pfile_residue"]));
    expect(plan.residue.project_parameter_files).not.toContain("pfile_current");
    expect(plan.residue.project_parameter_files).not.toContain("pfile_history");
    expect(plan.residue.project_parameter_file_versions).toEqual(expect.arrayContaining(["pfv_residue"]));
    expect(plan.residue.project_parameter_file_versions).not.toContain("pfv_current");
    expect(plan.residue.project_parameter_file_versions).not.toContain("pfv_history");
    expect(plan.residue.dts_config_set).not.toContain("dcs_dispose");
    await disposeProjectParameterPlaneResidue(root, store, editorAuth, operator, {
      projectId: PROJECT,
      archiveId: archive.archiveId,
      archiveDigest: archive.archiveDigest,
    });
    expect(
      (await pool.query(`select id from public.project_parameter_files where id in ('pfile_current', 'pfile_residue') order by id`))
        .rows.map((row: { id: string }) => row.id),
    ).toEqual(["pfile_current"]);
    expect((await pool.query(`select id from public.dts_nodes where id = 'node_residue'`)).rows).toHaveLength(0);
    expect((await pool.query(`select id from public.dts_config_set where id = 'dcs_dispose'`)).rows).toHaveLength(1);
    expect((await pool.query(`select config_set_id, current_version_id from public.project_parameter_files where id = 'pfile_history'`)).rows)
      .toEqual([{ config_set_id: null, current_version_id: "pfv_history" }]);
    expect((await pool.query(`select id from public.dts_config_revision_members where id = 'rev_member_history'`)).rows)
      .toHaveLength(1);
    expect(await store.get("org/atlas/history.dts")).toEqual(historyBytes);
  });

  it("rejects relations outside the closed disposer list", async () => {
    await expect(
      pool.query(`select parameter_catalog.dispose_plane_residue($1, $2, $3, $4::text[])`, [
        "missing-archive",
        "public.organizations",
        "id",
        ["org-plane-dispose"],
      ]),
    ).rejects.toThrow(/closed list/);
  });

  it("keeps DELETE-raising triggers allow-list-aware", async () => {
    const triggers = await pool.query<{ proname: string; src: string }>(
      `select proc.proname, pg_get_functiondef(proc.oid) as src
         from pg_proc proc
         join pg_namespace nsp on nsp.oid = proc.pronamespace
        where nsp.nspname = 'parameter_catalog'
          and proc.proname in (
            'protect_binding_identity',
            'protect_project_parameter_binding_source_identity',
            'protect_source_occurrence_identity',
            'reject_immutable_catalog_change',
            'reject_immutable_project_value_source_pin',
            'protect_pinned_source_provenance',
            'protect_pinned_source_file',
            'protect_submitted_source_request'
          )`,
    );
    expect(triggers.rows).toHaveLength(8);
    for (const row of triggers.rows) {
      expect(row.src, row.proname).toContain("plane_disposal_allows_delete");
    }
    expect(
      triggers.rows.find((row) => row.proname === "protect_source_occurrence_identity")?.src,
    ).toContain("root_pointer_digest");
  });
});
