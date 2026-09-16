/**
 * Issue #849 scope item 4: the offline archive of a project's legacy parameter plane.
 *
 * The archive is capture only - nothing here deletes or rewrites the archived rows -
 * so the assertions are about what was preserved, that re-capturing an unchanged plane
 * is idempotent, and that the rebuild guard refuses a missing or truncated archive.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ARCHIVE_ROW_CAP,
  ARCHIVE_OBJECT_BYTES_CAP,
  archiveDigestOf,
  assertProjectParameterPlaneArchived,
  captureProjectParameterPlane
} from "./archive";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createMemoryObjectStore, type MemoryObjectStore } from "../../../testing/objectStore";
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
const VERSION_ONE = Buffer.from("version one", "utf8");
const VERSION_TWO = Buffer.from("version two!", "utf8");
const CANDIDATE_BYTES = Buffer.from("candidate source", "utf8");
const checksum = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const archiveStore = (): MemoryObjectStore => {
  const store = createMemoryObjectStore();
  store.entries.set("org/atlas/charging-thermal-v1.dts", VERSION_ONE);
  store.entries.set("org/atlas/charging-thermal-v2.dts", VERSION_TWO);
  store.entries.set("org/atlas/charging-candidate.dts", CANDIDATE_BYTES);
  return store;
};

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
       values ('pfv_1', 'pfile_1', 1, 'org/atlas/charging-thermal-v1.dts', $1, $2, 'upload'),
              ('pfv_2', 'pfile_1', 2, 'org/atlas/charging-thermal-v2.dts', $3, $4, 'upload'),
              ('pfv_other', 'pfile_other', 1, 'org/aurora/other.dts', 'ghi', 5, 'upload')`,
      [checksum(VERSION_ONE), VERSION_ONE.byteLength, checksum(VERSION_TWO), VERSION_TWO.byteLength],
    );
    await pool.query(
      `insert into public.dts_config_set (id, organization_id, project_id, name)
       values ('dcs_1', $1, $2, 'default')`,
      [ORG, PROJECT],
    );
    await pool.query(
      `update public.project_parameter_files set config_set_id = 'dcs_1' where id = 'pfile_1'`,
    );
    await pool.query(
      `insert into public.dts_release_baseline
         (id, organization_id, config_set_id, name, status)
       values ('baseline_1', $1, 'dcs_1', 'release-1', 'released')`,
      [ORG],
    );
    await pool.query(
      `insert into public.dts_release_baseline_members
         (id, baseline_id, file_id, file_version_id, version_number)
       values ('baseline_member_1', 'baseline_1', 'pfile_1', 'pfv_2', 2)`,
    );
    await pool.query(
      `insert into public.dts_config_revisions
         (id, organization_id, project_id, config_set_id, revision_number, status)
       values ('revision_1', $1, $2, 'dcs_1', 1, 'resolved')`,
      [ORG, PROJECT],
    );
    await pool.query(
      `insert into public.dts_config_revision_members
         (id, config_revision_id, file_id, file_version_id, role, sort_order)
       values ('revision_member_1', 'revision_1', 'pfile_1', 'pfv_2', 'base', 0)`,
    );
    await pool.query(
      `insert into public.dts_logical_nodes (id, organization_id, project_id, config_set_id)
       values ('logical_1', $1, $2, 'dcs_1')`,
      [ORG, PROJECT],
    );
    await pool.query(
      `insert into public.dts_logical_node_revisions
         (id, logical_node_id, config_revision_id, node_locator, name)
       values ('logical_revision_1', 'logical_1', 'revision_1', '/soc/node', 'node')`,
    );
    await pool.query(
      `insert into public.project_parameter_file_candidates (
         id, organization_id, project_id, file_id, file_name, format, status,
         base_version_id, storage_key, checksum, size_bytes
       ) values (
         'candidate_1', $1, $2, 'pfile_1', 'charging-candidate.dts', 'dts', 'ready',
         'pfv_2', 'org/atlas/charging-candidate.dts', $3, $4
       )`,
      [ORG, PROJECT, checksum(CANDIDATE_BYTES), CANDIDATE_BYTES.byteLength],
    );
    await pool.query(
      `begin;
       set constraints all deferred;
       insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, origin, source_key
       ) values ('asub_archive', 'org-plane-archive', 'driver-registration', 'Archive driver', 'curated', 'compatible:acme,archive');
       insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ('asub_archive', 'physical-device', 'multiple');
       insert into public.parameter_modules (
         id, organization_id, name, path, kind, origin, source_key, attribution_subject_id
       ) values (
         'pmod_archive', 'org-plane-archive', 'Archive driver', 'pmod_archive', 'driver-group', 'curated',
         'compatible:acme,archive', 'asub_archive'
       );
       insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest, compiled_model_digest,
         toolchain_digest, published_at
       ) values (
         'crel_archive', 9001, 'archive-test', 'sha256:archive-release',
         'sha256:archive-compiled', 'sha256:archive-toolchain', '2026-09-15T00:00:00Z'
       );
       insert into parameter_catalog.catalog_subjects (
         id, introduced_release_id, kind, canonical_key
       ) values ('csub_archive', 'crel_archive', 'driver', 'acme,archive');
       insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
       values ('csub_archive', 'physical-device', 'multiple');
       insert into parameter_catalog.catalog_release_subjects (
         release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
       ) values (
         'crel_archive', 'csub_archive', 'active',
         '{"kind":"driver-compatible","value":"acme,archive"}', '{}'
       );
       insert into parameter_catalog.parameter_definitions (
         id, introduced_release_id, subject_id, property_key, current_revision_id
       ) values ('pdef_archive', 'crel_archive', 'csub_archive', 'limit', 'drev_archive');
       insert into parameter_catalog.definition_revisions (
         id, definition_id, revision_number, catalog_release_id, content_digest, content
       ) values ('drev_archive', 'pdef_archive', 1, 'crel_archive', 'sha256:archive-definition', '{}');
       insert into parameter_catalog.catalog_release_definition_heads (
         release_id, definition_id, revision_id
       ) values ('crel_archive', 'pdef_archive', 'drev_archive');
       insert into parameter_catalog.catalog_materializations (
         release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
       ) values (
         'crel_archive', 'sha256:archive-compiled-fingerprint',
         'sha256:archive-database-fingerprint', 'archive-attempt', 'archive-audit'
       );
       insert into parameter_catalog.organization_subject_registrations (
         id, organization_id, subject_id, status, registration_method, proof, current_placement_id
       ) values ('reg_archive', 'org-plane-archive', 'csub_archive', 'active', 'explicit', '{}', 'placement_archive');
       insert into parameter_catalog.subject_placements (
         id, registration_id, organization_id, module_id, origin
       ) values ('placement_archive', 'reg_archive', 'org-plane-archive', 'pmod_archive', 'curated');
       insert into parameter_catalog.project_parameter_bindings (
         id, organization_id, catalog_release_id, project_id, logical_node_id,
         registration_id, subject_id, definition_id, effective_revision_id, current_value_id
       ) values (
         'binding_archive', 'org-plane-archive', 'crel_archive', 'atlas', 'logical_archive', 'reg_archive',
         'csub_archive', 'pdef_archive', 'drev_archive', 'pvalue_archive'
       );
       insert into parameter_catalog.project_parameter_values (
         id, binding_id, definition_id, definition_revision_id, source_ref,
         config_revision_id, value_digest, value_kind, value
       ) values (
         'pvalue_archive', 'binding_archive', 'pdef_archive', 'drev_archive',
         'charging-thermal.dts:/soc/node:limit', 'revision_1', 'sha256:archive-value', 'number', '1000'
       );
       insert into public.project_parameter_value_drafts (
         id, organization_id, project_id, binding_id, definition_id, definition_revision_id,
         catalog_release_id, base_current_value_id, config_revision_id, source_ref,
         action, target_value, reason, user_id
       ) values (
         'value_draft_archive', 'org-plane-archive', 'atlas', 'binding_archive', 'pdef_archive', 'drev_archive',
         'crel_archive', 'pvalue_archive', 'revision_1', 'charging-thermal.dts:/soc/node:limit',
         'set', '1100', 'archive the pending draft', 'user-plane-archive'
       );
       insert into public.project_parameter_value_change_requests (
         id, organization_id, project_id, draft_id, binding_id, definition_id,
         definition_revision_id, catalog_release_id, base_current_value_id,
         config_revision_id, source_ref, action, target_value, reason, status, submitter_user_id
       ) values (
         'value_request_archive', 'org-plane-archive', 'atlas', 'value_draft_archive', 'binding_archive', 'pdef_archive',
         'drev_archive', 'crel_archive', 'pvalue_archive', 'revision_1',
         'charging-thermal.dts:/soc/node:limit', 'set', '1100', 'archive the review request',
         'pending', 'user-plane-archive'
       );
       insert into parameter_catalog.binding_history_events (
         id, binding_id, old_effective_revision_id, new_effective_revision_id,
         old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
       ) values (
         'binding_history_archive', 'binding_archive', 'drev_archive', 'drev_archive',
         null, 'pvalue_archive', 'archive the binding history', 'archive-history-audit', 'crel_archive'
       );
       set constraints all immediate;
       commit;`,
    );
  }, 120_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("captures the project's plane with per-relation counts and no cross-project bleed", async () => {
    const store = archiveStore();
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
    expect(archive.counts.dts_config_set).toBe(1);
    expect(archive.counts.dts_release_baseline_members).toBe(1);
    expect(archive.counts.dts_config_revision_members).toBe(1);
    expect(archive.counts.dts_logical_node_revisions).toBe(1);
    expect(archive.counts.project_parameter_value_drafts).toBe(1);
    expect(archive.counts.project_parameter_value_change_requests).toBe(1);
    expect(archive.counts.binding_history_events).toBe(1);
    expect(archive.counts.canonical_values).toBe(1);

    // The archived document is the offline artifact and must actually carry the rows.
    const stored = store.entries.get(archive.objectRef);
    expect(stored).toBeDefined();
    const document = JSON.parse(stored!.toString("utf8"));
    expect(document.schemaVersion).toBe("project-parameter-plane-archive/v2");
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
    expect(Buffer.from(document.objects["org/atlas/charging-thermal-v1.dts"].bytesBase64, "base64")).toEqual(
      VERSION_ONE,
    );
    expect(document.objects["org/atlas/charging-thermal-v2.dts"]).toMatchObject({
      checksumSha256: checksum(VERSION_TWO),
      sizeBytes: VERSION_TWO.byteLength,
    });
    expect(Buffer.from(document.objects["org/atlas/charging-candidate.dts"].bytesBase64, "base64")).toEqual(
      CANDIDATE_BYTES,
    );
    expect(document.relations.project_parameter_value_drafts[0].id).toBe("value_draft_archive");
    expect(document.relations.project_parameter_value_change_requests[0].id).toBe("value_request_archive");
    expect(document.relations.binding_history_events[0].id).toBe("binding_history_archive");
    // Nothing from the other project leaked into this project's archive.
    expect(JSON.stringify(document.relations)).not.toContain("pdraft_other");
    expect(JSON.stringify(document.relations)).not.toContain("pfile_other");
    expect(JSON.stringify(document.relations)).not.toContain("pfv_other");

    // Every declared relation is accounted for, even when it is empty.
    expect(Object.keys(archive.counts).length).toBe(24);
    const retainedDrafts = await pool.query<{ count: string }>(
      `select count(*)::text as count from public.parameter_drafts
        where organization_id = $1 and project_id = $2`,
      [ORG, PROJECT],
    );
    expect(retainedDrafts.rows[0]?.count).toBe("2");
  }, 120_000);

  it("refuses capture when a referenced file-version object is missing", async () => {
    const store = archiveStore();
    store.entries.delete("org/atlas/charging-thermal-v2.dts");

    await expect(
      captureProjectParameterPlane(root, store, editorAuth, { projectId: PROJECT }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "parameter-source-object-unavailable" },
    });
  }, 120_000);

  it("refuses capture before object reads when aggregate source bytes exceed the archive cap", async () => {
    await pool.query(
      `update public.project_parameter_file_candidates
          set size_bytes = $1
        where id = 'candidate_1'`,
      [ARCHIVE_OBJECT_BYTES_CAP + 1],
    );
    try {
      await expect(
        captureProjectParameterPlane(root, archiveStore(), editorAuth, { projectId: PROJECT }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        details: {
          maxBytes: ARCHIVE_OBJECT_BYTES_CAP,
          reason: "parameter-source-archive-too-large",
        },
      });
    } finally {
      await pool.query(
        `update public.project_parameter_file_candidates
            set size_bytes = $1
          where id = 'candidate_1'`,
        [CANDIDATE_BYTES.byteLength],
      );
    }
  }, 120_000);

  it("reuses an identical archive instead of writing a second object", async () => {
    const store = archiveStore();
    const first = await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT
    });
    const afterFirst = await pool.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_plane_archives
        where organization_id = $1 and project_id = $2`,
      [ORG, PROJECT],
    );
    const second = await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT
    });
    expect(second.archiveDigest).toBe(first.archiveDigest);
    expect(second.reused).toBe(true);

    const ledger = await pool.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_plane_archives
        where organization_id = $1 and project_id = $2`,
      [ORG, PROJECT],
    );
    expect(ledger.rows[0]?.count).toBe(afterFirst.rows[0]?.count);
  }, 120_000);

  it("refuses the rebuild guard when no archive exists or the archive is truncated", async () => {
    await expect(
      assertProjectParameterPlaneArchived(pool, createMemoryObjectStore(), {
        organizationId: ORG,
        projectId: OTHER_PROJECT,
        archiveId: "pppa_missing",
        archiveDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow(/not been archived offline/);

    await pool.query(
      `insert into project_parameter_plane_archives
         (id, organization_id, project_id, scope, object_ref, content_digest, archive_digest, counts, truncated, created_by)
       values ('pppa_truncated', $1, $2, 'legacy-parameter-plane', 'ref', $3, $4, '{}'::jsonb, true, 'user-plane-archive')`,
      [ORG, OTHER_PROJECT, `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`],
    );
    await expect(
      assertProjectParameterPlaneArchived(pool, createMemoryObjectStore(), {
        organizationId: ORG,
        projectId: OTHER_PROJECT,
        archiveId: "pppa_truncated",
        archiveDigest: `sha256:${"b".repeat(64)}`,
      }),
    ).rejects.toThrow(/truncated/);

    // The cap is a real bound, not a claim.
    expect(ARCHIVE_ROW_CAP).toBeGreaterThan(0);
  }, 120_000);

  it("refuses the rebuild guard when the archived object no longer matches its ledger digest", async () => {
    const store = archiveStore();
    const archive = await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT,
      capturedAt: "2026-09-15T00:00:01.000Z"
    });
    store.entries.set(archive.objectRef, Buffer.from("null", "utf8"));

    await expect(
      assertProjectParameterPlaneArchived(pool, store, {
        organizationId: ORG,
        projectId: PROJECT,
        archiveId: archive.archiveId,
        archiveDigest: archive.archiveDigest,
      }),
    ).rejects.toThrow(/integrity check failed/);
  }, 120_000);

  it("validates the exact captured archive instead of substituting a newer valid one", async () => {
    const store = archiveStore();
    const captured = await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT,
      capturedAt: "2026-09-15T00:00:02.000Z",
    });
    await pool.query(
      `insert into public.parameter_drafts (id, organization_id, project_id, target_value, reason)
       values ('pdraft_later', $1, $2, '4000', 'forces a distinct later archive')`,
      [ORG, PROJECT],
    );
    await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT,
      capturedAt: "2026-09-15T00:00:03.000Z",
    });
    await pool.query(`delete from public.parameter_drafts where id = 'pdraft_later'`);
    store.entries.set(captured.objectRef, Buffer.from("{}", "utf8"));

    await expect(
      assertProjectParameterPlaneArchived(pool, store, {
        organizationId: ORG,
        projectId: PROJECT,
        archiveId: captured.archiveId,
        archiveDigest: captured.archiveDigest,
      }),
    ).rejects.toThrow(/integrity check failed/);
  }, 120_000);

  it("refuses a self-consistent artifact whose relation rows do not match its declared counts", async () => {
    const store = archiveStore();
    const captured = await captureProjectParameterPlane(root, store, editorAuth, {
      projectId: PROJECT,
      capturedAt: "2026-09-15T00:00:04.000Z",
    });
    const original = JSON.parse(store.entries.get(captured.objectRef)!.toString("utf8"));
    original.relations.parameter_drafts = original.relations.parameter_drafts.slice(0, 1);
    const bytes = Buffer.from(`${JSON.stringify(original, null, 1)}\n`, "utf8");
    const contentDigest = `sha256:${checksum(bytes)}`;
    const archiveDigest = archiveDigestOf({
      scope: "legacy-parameter-plane",
      counts: original.counts,
      contentDigest,
    });
    const objectRef = "forged/torn-archive.json";
    store.entries.set(objectRef, bytes);
    await pool.query(
      `insert into project_parameter_plane_archives
         (id, organization_id, project_id, scope, object_ref, content_digest, archive_digest, counts, truncated, created_by)
       values ('pppa_torn', $1, $2, 'legacy-parameter-plane', $3, $4, $5, $6::jsonb, false, 'user-plane-archive')`,
      [ORG, PROJECT, objectRef, contentDigest, archiveDigest, JSON.stringify(original.counts)],
    );

    await expect(
      assertProjectParameterPlaneArchived(pool, store, {
        organizationId: ORG,
        projectId: PROJECT,
        archiveId: "pppa_torn",
        archiveDigest,
      }),
    ).rejects.toThrow(/integrity check failed/);
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

  it("installs retention-safe ledger and journal constraints", async () => {
    const constraints = await pool.query<{ table_name: string; definition: string }>(
      `select c.conrelid::regclass::text as table_name, pg_get_constraintdef(c.oid) as definition
         from pg_constraint c
        where c.conrelid in (
          'public.project_parameter_plane_archives'::regclass,
          'public.seed_initialization_runs'::regclass
        )`,
    );
    const definitions = constraints.rows.map((row) => `${row.table_name}: ${row.definition}`);

    expect(definitions).toContain(
      "project_parameter_plane_archives: FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT",
    );
    expect(definitions).toContain(
      "project_parameter_plane_archives: FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT",
    );
    expect(definitions).toContain(
      "seed_initialization_runs: FOREIGN KEY (started_by_user_id) REFERENCES users(id) ON DELETE SET NULL",
    );
    expect(definitions).toContain(
      "seed_initialization_runs: PRIMARY KEY (organization_id, seed_digest)",
    );

    const disposalColumns = await pool.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'project_parameter_plane_archives'
          and column_name in ('disposed_at', 'deleted_at')`,
    );
    expect(disposalColumns.rows).toEqual([]);
  }, 120_000);
});
