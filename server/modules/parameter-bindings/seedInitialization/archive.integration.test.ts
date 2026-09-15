/**
 * Issue #849 scope item 4: the offline archive of a project's legacy parameter plane.
 *
 * The archive is capture only - nothing here deletes or rewrites the archived rows -
 * so the assertions are about what was preserved, that re-capturing an unchanged plane
 * is idempotent, and that the rebuild guard refuses a missing or truncated archive.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ARCHIVE_ROW_CAP,
  assertProjectParameterPlaneArchived,
  captureProjectParameterPlane
} from "./archive";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createMemoryObjectStore } from "../../../testing/objectStore";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase
} from "../../../shared/database/client";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "parameter plane archive tests require a reachable real PostgreSQL server; skipping is forbidden",
  );
}

const ORG = "org-plane-archive";
const PROJECT = "atlas";
const OTHER_PROJECT = "aurora";

describe("legacy parameter plane archive", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;

  const editorAuth = makeTestAuthContext({
    userId: "user-plane-archive",
    organizationId: ORG,
    name: "Plane archive editor",
    email: "plane-archive@example.com",
    permissions: ["parameter:view", "parameter:edit"]
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("plane");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    await pool.query(`insert into public.organizations (id, name) values ($1, 'Plane archive')`, [ORG]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ('user-plane-archive', $1, 'Editor', 'plane-archive@example.com', 'Editor', true)`,
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
       values ('pdraft_1', $1, $2, '1000', 'legacy draft one'),
              ('pdraft_2', $1, $2, '2000', 'legacy draft two'),
              ('pdraft_other', $1, $3, '3000', 'belongs to another project')`,
      [ORG, PROJECT, OTHER_PROJECT],
    );
    await pool.query(
      `insert into public.project_parameter_files (id, organization_id, project_id, file_name, format)
       values ('pfile_1', $1, $2, 'charging-thermal.dts', 'dts'),
              ('pfile_other', $1, $3, 'other.dts', 'dts')`,
      [ORG, PROJECT, OTHER_PROJECT],
    );
    await pool.query(
      `insert into public.project_parameter_file_versions
         (id, file_id, version_number, storage_key, checksum, size_bytes, origin)
       values ('pfv_1', 'pfile_1', 1, 'org/atlas/charging-thermal.dts', 'abc', 10, 'upload'),
              ('pfv_2', 'pfile_1', 2, 'org/atlas/charging-thermal.dts', 'def', 12, 'upload'),
              ('pfv_other', 'pfile_other', 1, 'org/aurora/other.dts', 'ghi', 5, 'upload')`,
    );
  }, 120_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("captures the project's plane with per-relation counts and no cross-project bleed", async () => {
    const store = createMemoryObjectStore();
    const archive = await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT,
      capturedAt: "2026-09-15T00:00:00.000Z"
    });

    expect(archive.reused).toBe(false);
    expect(archive.truncated).toBe(false);
    expect(archive.archiveDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(archive.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(archive.counts.parameter_drafts).toBe(2);
    expect(archive.counts.project_parameter_files).toBe(1);
    // File-scoped child rows are reached through their parent, not by project_id.
    expect(archive.counts.project_parameter_file_versions).toBe(2);
    // Relations with no rows for this project are still accounted for.
    expect(archive.counts.parameter_change_requests).toBe(0);

    // The archived document is the offline artifact and must actually carry the rows.
    const stored = store.entries.get(archive.objectRef);
    expect(stored).toBeDefined();
    const document = JSON.parse(stored!.toString("utf8"));
    expect(document.schemaVersion).toBe("project-parameter-plane-archive/v1");
    expect(document.projectId).toBe(PROJECT);
    expect(document.capturedAt).toBe("2026-09-15T00:00:00.000Z");
    expect(document.relations.parameter_drafts.map((row: { id: string }) => row.id).sort()).toEqual([
      "pdraft_1",
      "pdraft_2"
    ]);
    expect(
      document.relations.project_parameter_file_versions
        .map((row: { id: string }) => row.id)
        .sort(),
    ).toEqual(["pfv_1", "pfv_2"]);
    // Nothing from the other project leaked into this project's archive.
    expect(JSON.stringify(document.relations)).not.toContain("pdraft_other");
    expect(JSON.stringify(document.relations)).not.toContain("pfile_other");
    expect(JSON.stringify(document.relations)).not.toContain("pfv_other");

    // Every declared relation is accounted for, even when it is empty.
    expect(Object.keys(archive.counts).length).toBe(14);
  }, 120_000);

  it("reuses an identical archive instead of writing a second object", async () => {
    const store = createMemoryObjectStore();
    const first = await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT,
      capturedAt: "2026-09-15T00:00:00.000Z"
    });
    const second = await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT,
      capturedAt: "2026-09-15T00:00:00.000Z"
    });
    expect(second.archiveDigest).toBe(first.archiveDigest);
    expect(second.reused).toBe(true);

    const ledger = await pool.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_plane_archives
        where organization_id = $1 and project_id = $2`,
      [ORG, PROJECT],
    );
    expect(Number(ledger.rows[0]?.count)).toBe(1);
  }, 120_000);

  it("refuses the rebuild guard when no archive exists or the archive is truncated", async () => {
    await expect(
      assertProjectParameterPlaneArchived(pool, { organizationId: ORG, projectId: OTHER_PROJECT }),
    ).rejects.toThrow(/not been archived offline/);

    await pool.query(
      `insert into project_parameter_plane_archives
         (id, organization_id, project_id, scope, object_ref, content_digest, archive_digest, counts, truncated, created_by)
       values ('pppa_truncated', $1, $2, 'legacy-parameter-plane', 'ref', $3, $4, '{}'::jsonb, true, 'user-plane-archive')`,
      [ORG, OTHER_PROJECT, `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`],
    );
    await expect(
      assertProjectParameterPlaneArchived(pool, { organizationId: ORG, projectId: OTHER_PROJECT }),
    ).rejects.toThrow(/truncated/);

    // The cap is a real bound, not a claim.
    expect(ARCHIVE_ROW_CAP).toBeGreaterThan(0);
  }, 120_000);

  it("refuses capture for an actor without parameter edit for the project", async () => {
    const viewerAuth = makeTestAuthContext({
      userId: "user-plane-viewer",
      organizationId: ORG,
      name: "Viewer",
      email: "viewer@example.com",
      permissions: ["parameter:view"]
    });
    await expect(
      captureProjectParameterPlane(root, createMemoryObjectStore(), viewerAuth, {
        projectId: PROJECT
      }),
    ).rejects.toThrow(/edit role is required/);
  }, 120_000);
});
