import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import {
  insertReleaseBaseline,
  insertReleaseBaselineMember,
  updateBaselineStatus
} from "./baselineRepository";
import { insertFileVersion, insertProjectParameterFile, setCurrentVersion } from "./repository";
import type { ValidationGateResult } from "./validationGate";
import { assertReleaseGateAllows, evaluateReleaseReadiness } from "./releaseReadinessService";

const databaseAvailable = await isTestDatabaseAvailable();

function adminAuth(): AuthContext {
  return makeTestAuthContext({ userId: "user-1", organizationId: "org-1", name: "Riley Chen" });
}

function viewerAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "user-1",
    organizationId: "org-1",
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions: ["parameter:view"]
  });
}

/** The validation gate wraps the external DTC toolchain — it stays an injected port. */
function gateOk(): ValidationGateResult {
  return { ok: true, mode: "block", requiresConfirmation: false, diagnostics: [], compiler: "dtc" };
}

function gateWarn(): ValidationGateResult {
  return {
    ok: true,
    mode: "warn",
    requiresConfirmation: true,
    diagnostics: [{ file: "board.dts", severity: "warning", message: "dtc unavailable" }],
    compiler: "unavailable"
  };
}

describe.skipIf(!databaseAvailable)("evaluateReleaseReadiness", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "user-1", name: "Riley Chen" },
        { id: "user-sync", name: "Sync Bot" },
        { id: "user-ui", name: "UI Editor" }
      ],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });
    await seedSpecBindingGraph(db, {
      organizationId: "org-1",
      configSets: [{ id: "cs-1", projectId: "project-1", name: "board-a" }]
    });

    await insertProjectParameterFile(db, {
      id: "file-base",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "board.dts",
      format: "dts"
    });
    await insertFileVersion(db, {
      id: "ver-1",
      fileId: "file-base",
      versionNumber: 1,
      storageKey: "org-1/files/board-v1.dts",
      checksum: "checksum-1",
      sizeBytes: 100,
      parsedIndex: {},
      origin: "upload",
      createdByUserId: "user-1"
    });
    await setCurrentVersion(db, { fileId: "file-base", versionId: "ver-1" });
    await attachToConfigSet("file-base", "base", 0);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function attachToConfigSet(fileId: string, role: string, sortOrder: number) {
    await db.query(
      `update project_parameter_files
       set config_set_id = 'cs-1', config_set_role = $2, config_set_sort_order = $3
       where id = $1`,
      [fileId, role, sortOrder]
    );
  }

  async function seedReleasedBaseline(memberVersionId: string) {
    await insertReleaseBaseline(db, {
      id: "bl-released",
      organizationId: "org-1",
      configSetId: "cs-1",
      name: "v1",
      createdByUserId: "user-1"
    });
    await updateBaselineStatus(db, { baselineId: "bl-released", status: "released" });
    await insertReleaseBaselineMember(db, {
      id: "blm-1",
      baselineId: "bl-released",
      fileId: "file-base",
      fileVersionId: memberVersionId,
      versionNumber: 1
    });
  }

  it("rejects non-admin auth", async () => {
    await expect(evaluateReleaseReadiness(db, viewerAuth(), { configSetId: "cs-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("returns ready with gate token when no blockers or warnings", async () => {
    // Conflicts and pending change requests come from the real (empty) tables.
    const result = await evaluateReleaseReadiness(db, adminAuth(), { configSetId: "cs-1" }, {
      validationGate: gateOk()
    });

    expect(result.available).toBe(true);
    expect(result.level).toBe("ready");
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.canCreateBaseline).toBe(true);
    expect(result.canRelease).toBe(true);
    expect(result.gateToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns in-sync when working members match the released tip", async () => {
    await seedReleasedBaseline("ver-1");

    const result = await evaluateReleaseReadiness(db, adminAuth(), { configSetId: "cs-1" }, {
      validationGate: gateOk()
    });

    expect(result.level).toBe("in-sync");
    expect(result.releasedBaselineId).toBe("bl-released");
  });

  it("stays ready (not in-sync) when a released tip exists but working has drifted", async () => {
    await seedReleasedBaseline("ver-1");
    // New working version with a different storage key: content drifted.
    await insertFileVersion(db, {
      id: "ver-2",
      fileId: "file-base",
      versionNumber: 2,
      storageKey: "org-1/files/board-v2.dts",
      checksum: "checksum-2",
      sizeBytes: 120,
      parsedIndex: {},
      origin: "upload",
      createdByUserId: "user-1"
    });
    await setCurrentVersion(db, { fileId: "file-base", versionId: "ver-2" });

    const result = await evaluateReleaseReadiness(db, adminAuth(), { configSetId: "cs-1" }, {
      validationGate: gateOk()
    });

    expect(result.level).toBe("ready");
    expect(result.releasedBaselineId).toBe("bl-released");
  });

  it("treats conflict-lookup infrastructure failure as readiness unavailable, not open-conflict", async () => {
    // A genuinely missing relation, not a mock: the conflict enrichment join
    // fails exactly like the incident that motivated CW-B2.
    await db.query(`drop table project_parameter_values cascade`);

    const result = await evaluateReleaseReadiness(db, adminAuth(), { configSetId: "cs-1" }, {
      validationGate: gateOk()
    });

    expect(result.available).toBe(false);
    expect(result.canCreateBaseline).toBe(false);
    expect(result.canRelease).toBe(false);
    expect(result.unavailableReason).toBe("Release readiness could not load open conflicts.");
    expect(result.blockers).toEqual([
      expect.objectContaining({
        code: "readiness-unavailable",
        message: "Release readiness could not load open conflicts.",
        remediation: { kind: "retry-evaluation", label: "Retry readiness evaluation" }
      })
    ]);
    expect(result.blockers.some((item) => item.code === "open-conflict")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("project_parameter_values");
  });

  it("orders blockers for missing member version, conflicts, pending changes, and governance", async () => {
    // Both members lose their current version (missing-primary + missing-member).
    await db.query(`update project_parameter_files set current_version_id = null where id = 'file-base'`);
    await insertProjectParameterFile(db, {
      id: "file-overlay",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "overlay.dts",
      format: "dts"
    });
    await attachToConfigSet("file-overlay", "overlay", 1);

    // Real open conflict hanging off the legacy identity graph and ver-1.
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values ('pd-1', 'org-1', 'demo', 'demo parameter', 'demo', 'ENV', 'battery', '0-100', 'C', 'High')`
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values ('ppv-1', 'org-1', 'project-1', 'pd-1', '1', '1', 1, 'user-1')`
    );
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, origin_file_version_id
       ) values
         ('draft-file', 'org-1', 'project-1', 'ppv-1', 'user-sync', '1', 'file sync', 'file_sync', 'ver-1'),
         ('draft-ui', 'org-1', 'project-1', 'ppv-1', 'user-ui', '2', 'ui edit', 'manual', null)`
    );
    await db.query(
      `insert into parameter_file_sync_conflicts (
         id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
         file_version_id, file_draft_id, ui_draft_id, file_value, ui_draft_value, status
       ) values ('conflict-1', 'org-1', 'project-1', 'ppv-1', 'pd-1', 'ver-1', 'draft-file', 'draft-ui', '1', '2', 'open')`
    );

    // Real pending change request (status inside the pending set).
    await db.query(
      `insert into parameter_change_requests (
         id, organization_id, project_id, parameter_definition_id, base_version,
         current_value, target_value, status, submitter_user_id
       ) values ('cr-1', 'org-1', 'project-1', 'pd-1', 1, '1', '2', 'submitted', 'user-1')`
    );

    // Real config revision with two open blocking governance tasks.
    await db.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       values ('rev-1', 'org-1', 'project-1', 'cs-1', 1, 'resolved')`
    );
    await db.query(
      `insert into identity_mapping_tasks (id, organization_id, project_id, config_revision_id, status, task_kind)
       values
         ('task-1', 'org-1', 'project-1', 'rev-1', 'open', 'identity-ambiguity'),
         ('task-2', 'org-1', 'project-1', 'rev-1', 'open', 'identity-ambiguity')`
    );

    const result = await evaluateReleaseReadiness(db, adminAuth(), { configSetId: "cs-1" }, {
      validationGate: gateOk()
    });

    expect(result.level).toBe("blocked");
    expect(result.canCreateBaseline).toBe(false);
    expect(result.canRelease).toBe(false);
    expect(result.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "missing-primary-version",
        "missing-member-version",
        "open-conflict",
        "pending-change",
        "publish-blocking-governance"
      ])
    );
    const conflict = result.blockers.find((item) => item.code === "open-conflict");
    expect(conflict?.message).toContain("demo");
    expect(conflict?.target).toMatchObject({
      conflictId: "conflict-1",
      fileId: "file-base",
      fileName: "board.dts"
    });
    expect(conflict?.remediation.kind).toBe("resolve-conflict");
    const governance = result.blockers.find((item) => item.code === "publish-blocking-governance");
    expect(governance?.message).toContain("2 publish-blocking");
    const pending = result.blockers.find((item) => item.code === "pending-change");
    expect(pending?.message).toContain("1 server-visible");
  });

  it("surfaces policy warnings with acknowledgement state and blocks release until acknowledged", async () => {
    const result = await evaluateReleaseReadiness(db, adminAuth(), { configSetId: "cs-1" }, {
      validationGate: gateWarn()
    });
    expect(result.level).toBe("warning");
    expect(result.canCreateBaseline).toBe(true);
    expect(result.canRelease).toBe(false);
    expect(result.warnings[0]).toMatchObject({
      code: "toolchain-warning",
      acknowledgementRequired: true,
      acknowledged: false,
      remediation: { kind: "acknowledge-warning" }
    });

    const warningId = result.warnings[0].id;
    const acknowledged = await evaluateReleaseReadiness(
      db,
      adminAuth(),
      { configSetId: "cs-1", acknowledgedWarningIds: [warningId] },
      { validationGate: gateWarn() }
    );
    expect(acknowledged.level).toBe("ready");
    expect(acknowledged.canRelease).toBe(true);
    expect(acknowledged.warnings[0].acknowledged).toBe(true);
  });

  it("assertReleaseGateAllows rejects missing, stale, and blocked tokens", async () => {
    const ready = await evaluateReleaseReadiness(db, adminAuth(), { configSetId: "cs-1" }, {
      validationGate: gateOk()
    });

    await expect(
      assertReleaseGateAllows(db, adminAuth(), { configSetId: "cs-1", action: "create" }, { validationGate: gateOk() })
    ).rejects.toMatchObject({ details: expect.objectContaining({ code: "readiness-gate-required" }) });

    await expect(
      assertReleaseGateAllows(
        db,
        adminAuth(),
        { configSetId: "cs-1", gateToken: "stale-token", action: "create" },
        { validationGate: gateOk() }
      )
    ).rejects.toMatchObject({ details: expect.objectContaining({ code: "readiness-gate-stale" }) });

    await expect(
      assertReleaseGateAllows(
        db,
        adminAuth(),
        { configSetId: "cs-1", gateToken: ready.gateToken, action: "create" },
        { validationGate: gateOk() }
      )
    ).resolves.toMatchObject({ level: "ready" });

    // The base member loses its current version: readiness flips to blocked and
    // even a fresh token cannot authorize a release.
    await db.query(`update project_parameter_files set current_version_id = null where id = 'file-base'`);
    const blocked = await evaluateReleaseReadiness(db, adminAuth(), { configSetId: "cs-1" }, {
      validationGate: gateOk()
    });
    expect(blocked.level).toBe("blocked");
    await expect(
      assertReleaseGateAllows(
        db,
        adminAuth(),
        { configSetId: "cs-1", gateToken: blocked.gateToken, action: "release" },
        { validationGate: gateOk() }
      )
    ).rejects.toMatchObject({ details: expect.objectContaining({ code: "readiness-blocked" }) });
  });
});
