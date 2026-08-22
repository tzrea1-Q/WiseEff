import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { insertReloadRun, insertReloadRunTarget, readLibraryFingerprint } from "./repository";
import { promoteReloadRunToDrafts, type PromoteBindingDraftFn } from "./promote";
import type { ReloadRunPurpose, ReloadRunStatus } from "./types";

vi.mock("../audit/repository", () => ({
  createAuditEvent: vi.fn(async () => undefined)
}));

import { createAuditEvent } from "../audit/repository";

const databaseAvailable = await isTestDatabaseAvailable();

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Hardware Committer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
    permissions: ["debugging:dts-reload", "debugging:view", "parameter:edit"],
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("promoteReloadRunToDrafts", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    vi.mocked(createAuditEvent).mockClear();
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "user-1", name: "Riley Chen", email: "riley@example.com" },
        { id: "user-2", name: "Other", email: "other@example.com" }
      ],
      projects: [{ id: "project-1" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedCandidate(input: {
    bindingId: string;
    nodePath?: string | null;
    configRevisionId?: string;
    baselineValue?: string | null;
  }) {
    const nodePath = input.nodePath === undefined ? "/amba/i2c@FDF5E000/sc8562@6E" : input.nodePath;
    const configRevisionId = input.configRevisionId ?? "rev-1";
    const propertyKey = "watchdog_time";

    await db.query(
      `insert into parameter_modules (id, organization_id, name, path)
       values ('mod-charger', 'org-1', 'charger', '/charger')
       on conflict (id) do nothing`
    );
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ('cs-1', 'org-1', 'project-1', 'primary') on conflict (id) do nothing`
    );
    await db.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       select $1, 'org-1', 'project-1', 'cs-1',
              coalesce((select max(revision_number) from dts_config_revisions where config_set_id = 'cs-1'), 0) + 1,
              'compiled'
       where not exists (select 1 from dts_config_revisions where id = $1)`,
      [configRevisionId]
    );
    await db.query(
      `insert into parameter_specs (id, organization_id, source_kind, specification_key)
       values ($1, 'org-1', 'dts', $2)`,
      [`spec-${input.bindingId}`, `reload/${input.bindingId}/${propertyKey}`]
    );
    await db.query(
      `insert into parameter_spec_versions (
         id, parameter_spec_id, version, display_name, description, documentation, value_shape, units, lifecycle
       ) values ($1, $2, 1, $3, '', $4, $5::jsonb, $6, 'active')`,
      [
        `psv-${input.bindingId}`,
        `spec-${input.bindingId}`,
        "Watchdog",
        "Watchdog timeout for charger safety.",
        JSON.stringify({ kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 }),
        "ms"
      ]
    );
    await db.query(
      `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
       values ($1, $2, $3, 'reload-test', $4::jsonb)`,
      [`dps-${input.bindingId}`, `spec-${input.bindingId}`, propertyKey, JSON.stringify({ min: 0, max: 20000, cells: 1 })]
    );
    if (nodePath !== null) {
      await db.query(
        `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
         values ($1, 'org-1', 'project-1', 'cs-1')`,
        [`node-${input.bindingId}`]
      );
      await db.query(
        `insert into dts_logical_node_revisions (id, logical_node_id, config_revision_id, node_locator, name, compatible)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          `lnr-${input.bindingId}`,
          `node-${input.bindingId}`,
          configRevisionId,
          nodePath,
          "sc8562@6E",
          "sc8562"
        ]
      );
    }
    await db.query(
      `insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
       values ($1, 'org-1', 'project-1', $2, $3, 'mod-charger')`,
      [input.bindingId, nodePath === null ? null : `node-${input.bindingId}`, `spec-${input.bindingId}`]
    );
    await db.query(
      `insert into project_parameter_binding_revisions (
         id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value
       ) values ($1, $2, $3, $4, '{}'::jsonb, $5)`,
      [
        `bpr-${input.bindingId}`,
        input.bindingId,
        configRevisionId,
        `psv-${input.bindingId}`,
        input.baselineValue === undefined ? "<6000>" : input.baselineValue
      ]
    );
  }

  async function seedRun(input: {
    id: string;
    status?: ReloadRunStatus;
    purpose?: ReloadRunPurpose;
    targets?: Array<{ bindingId: string; nodePath?: string; debugValue?: string; baselineValue?: string | null }>;
  }) {
    await insertReloadRun(db, {
      id: input.id,
      organizationId: "org-1",
      projectId: "project-1",
      configRevisionId: "rev-1",
      status: input.status ?? "verified",
      purpose: input.purpose ?? "ordinary",
      deviceId: null,
      restoresSourceRunId: null,
      failureCode: null,
      steps: [],
      diagnostics: [],
      toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
      overlaySourceStorageKey: "overlay.dts",
      overlaySourceSha256: "src-sha",
      overlayArtifactStorageKey: "overlay.dtbo",
      overlayArtifactSha256: "art-sha",
      overlayArtifactBytes: 32,
      createdByUserId: "user-1",
      completedAt: new Date().toISOString()
    });
    for (const [index, target] of (input.targets ?? []).entries()) {
      await insertReloadRunTarget(db, {
        id: `target-${input.id}-${index}`,
        reloadRunId: input.id,
        bindingId: target.bindingId,
        nodePath: target.nodePath ?? "/amba/i2c@FDF5E000/sc8562@6E",
        propertyKey: "watchdog_time",
        baselineValue: target.baselineValue === undefined ? "<6000>" : target.baselineValue,
        debugValue: target.debugValue ?? "<7000>",
        sortOrder: index
      });
    }
  }

  async function insertOpenDraft(input: {
    id: string;
    bindingId: string;
    targetValue: string;
    reason: string;
    userId?: string;
  }) {
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, user_id,
         target_value, reason, origin, action, project_parameter_binding_id
       ) values ($1, 'org-1', 'project-1', $2, $3, $4, 'manual', 'set', $5)`,
      [input.id, input.userId ?? "user-1", input.targetValue, input.reason, input.bindingId]
    );
  }

  function recordingCreateDraft(): {
    calls: Array<{ bindingId: string; baseRevisionId: string; reason: string; action: string }>;
    createBindingDraft: PromoteBindingDraftFn;
  } {
    const calls: Array<{ bindingId: string; baseRevisionId: string; reason: string; action: string }> = [];
    return {
      calls,
      createBindingDraft: vi.fn(async (_db, _auth, input) => {
        calls.push({
          bindingId: input.bindingId,
          baseRevisionId: input.baseRevisionId,
          reason: input.reason,
          action: input.action ?? "set"
        });
        const draftId = `draft-${input.bindingId}`;
        await db.query(
          `insert into parameter_drafts (
             id, organization_id, project_id, user_id,
             target_value, reason, origin, action, project_parameter_binding_id
           ) values ($1, 'org-1', $2, $3, $4, $5, 'manual', 'set', $6)`,
          [draftId, input.projectId, "user-1", "<7000>", input.reason, input.bindingId]
        );
        return {
          draftId,
          parameterId: input.bindingId,
          candidateRevisionId: "cand-1",
          workingCandidateRevisionId: "cand-1",
          rebasedDraftIds: [],
          rawText: "<7000>",
          action: "set",
          parameterSpecId: `spec-${input.bindingId}`,
          projectParameterBindingId: input.bindingId,
          writeTarget: { role: "overlay", propertyKey: "watchdog_time", fileId: "file-1", fileName: "overlay.dts" },
          overlayFileId: "file-1",
          overlayFileName: "overlay.dts"
        };
      })
    };
  }

  async function countChangeRequests() {
    const result = await db.query<{ count: string }>(
      `select count(*)::text as count from parameter_change_requests where organization_id = 'org-1'`
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  it("creates parameter drafts from a verified ordinary run and leaves the library working fingerprint and change-request table untouched", async () => {
    await seedCandidate({ bindingId: "binding-1" });
    await seedRun({
      id: "run-verified",
      status: "verified",
      targets: [{ bindingId: "binding-1", debugValue: "<7000>" }]
    });
    const recorder = recordingCreateDraft();
    const before = await readLibraryFingerprint(db, { organizationId: "org-1", projectId: "project-1" });

    const result = await promoteReloadRunToDrafts(
      db,
      auth(),
      { runId: "run-verified", bindingIds: ["binding-1"] },
      { createBindingDraft: recorder.createBindingDraft }
    );

    expect(result.drafts).toEqual([
      { bindingId: "binding-1", draftId: "draft-binding-1", outcome: "created" }
    ]);
    expect(result.workbenchHref).toBe("/parameters?project=project-1");
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      bindingId: "binding-1",
      baseRevisionId: "rev-1",
      action: "set"
    });
    expect(recorder.calls[0]!.reason).toContain("sourceReloadRunId=run-verified");
    expect(recorder.calls[0]!.reason).toContain("debug=<7000>");

    const after = await readLibraryFingerprint(db, { organizationId: "org-1", projectId: "project-1" });
    expect(after.bindingRevisionCount).toBe(before.bindingRevisionCount);
    expect(after.bindingRevisionChecksum).toBe(before.bindingRevisionChecksum);
    expect(after.baselineCount).toBe(before.baselineCount);
    expect(after.workingFileVersionTip).toBe(before.workingFileVersionTip);
    expect(after.draftCount).toBe(before.draftCount + 1);
    expect(await countChangeRequests()).toBe(0);

    const auditKinds = vi.mocked(createAuditEvent).mock.calls.map((call) => call[1].kind);
    expect(auditKinds).toContain("reload-value-promoted-to-draft");
    expect(auditKinds.some((kind) => String(kind).includes("parameter-submit"))).toBe(false);
  });

  it("refuses an empty selection with 400", async () => {
    await seedCandidate({ bindingId: "binding-1" });
    await seedRun({ id: "run-verified", targets: [{ bindingId: "binding-1" }] });

    await expect(
      promoteReloadRunToDrafts(db, auth(), { runId: "run-verified", bindingIds: [] })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
  });

  it("preserves server rejection copy and details for every promotion eligibility rejection", async () => {
    await seedCandidate({ bindingId: "binding-1" });
    const recorder = recordingCreateDraft();

    for (const [id, status, purpose, ack, message, details] of [
      [
        "run-contradicted",
        "contradicted",
        "ordinary",
        undefined,
        "Reload run status contradicted cannot be promoted to parameter drafts.",
        { code: "reload-promote-ineligible", purpose: "ordinary", status: "contradicted" }
      ],
      [
        "run-failed",
        "failed",
        "ordinary",
        undefined,
        "Reload run status failed cannot be promoted to parameter drafts.",
        { code: "reload-promote-ineligible", purpose: "ordinary", status: "failed" }
      ],
      [
        "run-restore",
        "verified",
        "restore-baseline",
        undefined,
        "restore-baseline runs cannot be promoted; those values are already the library baseline.",
        { code: "reload-promote-ineligible", purpose: "restore-baseline", status: "verified" }
      ],
      [
        "run-unv",
        "unverifiable",
        "ordinary",
        undefined,
        "Unverifiable reload runs require unverifiableAcknowledged: true before promotion.",
        { code: "reload-promote-unverifiable-ack-required", status: "unverifiable" }
      ]
    ] as const) {
      await seedRun({
        id,
        status,
        purpose,
        targets: [{ bindingId: "binding-1" }]
      });
      await expect(
        promoteReloadRunToDrafts(
          db,
          auth(),
          { runId: id, bindingIds: ["binding-1"], unverifiableAcknowledged: ack },
          { createBindingDraft: recorder.createBindingDraft }
        )
      ).rejects.toMatchObject({ code: "CONFLICT", status: 409, message, details });
    }
    expect(recorder.calls).toHaveLength(0);
  });

  it("promotes an unverifiable ordinary run only when unverifiableAcknowledged is true", async () => {
    await seedCandidate({ bindingId: "binding-1" });
    await seedRun({
      id: "run-unv",
      status: "unverifiable",
      targets: [{ bindingId: "binding-1" }]
    });
    const recorder = recordingCreateDraft();

    const result = await promoteReloadRunToDrafts(
      db,
      auth(),
      { runId: "run-unv", bindingIds: ["binding-1"], unverifiableAcknowledged: true },
      { createBindingDraft: recorder.createBindingDraft }
    );
    expect(result.drafts[0]?.outcome).toBe("created");
    expect(recorder.calls).toHaveLength(1);
  });

  it("refuses callers that lack parameter:edit or reload write/admin, and refuses Agent actors", async () => {
    await seedCandidate({ bindingId: "binding-1" });
    await seedRun({ id: "run-verified", targets: [{ bindingId: "binding-1" }] });
    const recorder = recordingCreateDraft();

    await expect(
      promoteReloadRunToDrafts(
        db,
        auth({ permissions: ["debugging:view", "parameter:edit"] }),
        { runId: "run-verified", bindingIds: ["binding-1"] },
        { createBindingDraft: recorder.createBindingDraft }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    await expect(
      promoteReloadRunToDrafts(
        db,
        auth({ permissions: ["debugging:dts-reload", "debugging:view"] }),
        { runId: "run-verified", bindingIds: ["binding-1"] },
        { createBindingDraft: recorder.createBindingDraft }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });

    await expect(
      promoteReloadRunToDrafts(
        db,
        auth(),
        { runId: "run-verified", bindingIds: ["binding-1"] },
        { createBindingDraft: recorder.createBindingDraft, actorType: "agent" }
      )
    ).rejects.toMatchObject({
      details: { code: "dts-reload-agent-refused", requireHuman: true }
    });
    expect(recorder.calls).toHaveLength(0);
  });

  it("lets an Admin without debugging:dts-reload promote when they hold parameter:edit and the read gate", async () => {
    await seedCandidate({ bindingId: "binding-1" });
    await seedRun({ id: "run-verified", targets: [{ bindingId: "binding-1" }] });
    const recorder = recordingCreateDraft();

    const result = await promoteReloadRunToDrafts(
      db,
      auth({
        roles: [{ projectId: "project-1", roleId: "admin" }],
        permissions: ["admin:access", "debugging:view", "parameter:edit"]
      }),
      { runId: "run-verified", bindingIds: ["binding-1"] },
      { createBindingDraft: recorder.createBindingDraft }
    );
    expect(result.drafts[0]?.draftId).toBe("draft-binding-1");
  });

  it("refuses a target whose node path has drifted from the current binding", async () => {
    await seedCandidate({ bindingId: "binding-1", nodePath: "/amba/i2c@FDF5E000/sc8562@6E" });
    await seedRun({
      id: "run-verified",
      targets: [{ bindingId: "binding-1", nodePath: "/amba/i2c@FDF5E000/sc8562@OLD" }]
    });
    const recorder = recordingCreateDraft();

    await expect(
      promoteReloadRunToDrafts(
        db,
        auth(),
        { runId: "run-verified", bindingIds: ["binding-1"] },
        { createBindingDraft: recorder.createBindingDraft }
      )
    ).rejects.toMatchObject({
      details: { code: "reload-promote-node-drift", bindingId: "binding-1" }
    });
    expect(recorder.calls).toHaveLength(0);
  });

  it("returns the existing draft when it already holds the same raw value from this run", async () => {
    await seedCandidate({ bindingId: "binding-1" });
    await seedRun({ id: "run-verified", targets: [{ bindingId: "binding-1", debugValue: "<7000>" }] });
    await insertOpenDraft({
      id: "draft-existing",
      bindingId: "binding-1",
      targetValue: "<7000>",
      reason: "reload-promote sourceReloadRunId=run-verified baseline=<6000> debug=<7000> verification=unbound"
    });
    const recorder = recordingCreateDraft();
    const before = await readLibraryFingerprint(db, { organizationId: "org-1", projectId: "project-1" });

    const result = await promoteReloadRunToDrafts(
      db,
      auth(),
      { runId: "run-verified", bindingIds: ["binding-1"] },
      { createBindingDraft: recorder.createBindingDraft }
    );

    expect(result.drafts).toEqual([
      { bindingId: "binding-1", draftId: "draft-existing", outcome: "unchanged" }
    ]);
    expect(recorder.calls).toHaveLength(0);
    const after = await readLibraryFingerprint(db, { organizationId: "org-1", projectId: "project-1" });
    expect(after.draftCount).toBe(before.draftCount);
    expect(await countChangeRequests()).toBe(0);
  });

  it("refuses to stack a different open draft or an in-flight change request on the same binding", async () => {
    await seedCandidate({ bindingId: "binding-1" });
    await seedRun({ id: "run-verified", targets: [{ bindingId: "binding-1" }] });
    await insertOpenDraft({
      id: "draft-other",
      bindingId: "binding-1",
      targetValue: "<8000>",
      reason: "manual edit"
    });
    const recorder = recordingCreateDraft();

    await expect(
      promoteReloadRunToDrafts(
        db,
        auth(),
        { runId: "run-verified", bindingIds: ["binding-1"] },
        { createBindingDraft: recorder.createBindingDraft }
      )
    ).rejects.toMatchObject({
      details: { code: "reload-promote-open-draft", bindingId: "binding-1" }
    });
    expect(recorder.calls).toHaveLength(0);
  });
});
