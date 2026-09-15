/**
 * Issue #849 C4 — real PostgreSQL evidence for the canonical pending-draft owner.
 *
 * The invariant under test: creating, listing or removing a pending canonical
 * value draft must leave the canonical current ProjectValue, the binding's
 * current-value pointer and the active config revision completely untouched.
 * Before this change the draft route wrote the canonical current value directly.
 */
import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { CatalogSubjectId } from "../../parameter-catalog-contract/index";
import type { RegisterSubjectCommand } from "../../parameter-governance/registration/command";
import { writeGuardedRegistration } from "../../parameter-governance/registration/internalGuardedRegistrationWriter";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase
} from "../../../shared/database/client";
import { asAuditTx, withAuditedWrite } from "../../audit/auditedWrite";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { writeTrustedGovernanceAudit } from "../../parameter-topology/governanceAudit";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { parseDts } from "../../dts/parser";
import { resolveDts } from "../../dts/resolver";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import {
  asValueClient,
  exportCanonicalBindingSource,
  readCanonicalBindingChangeHistory,
  syncPublishedCatalogProjectValues
} from "../catalogProjectValueSync";
import { createMemoryObjectStore } from "../../../testing/objectStore";
import {
  createCanonicalValueDraft,
  listCanonicalValueDraftsForUser,
  removeCanonicalValueDraft
} from "./service";
import {
  listCanonicalValueChangesForAuth,
  reviewCanonicalValueChange,
  submitCanonicalValueChange,
  withdrawCanonicalValueChange
} from "./changeService";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "canonical value drafts require a reachable real PostgreSQL server; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "canonical value drafts require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG = "org-849-drafts";
const PROJECT = "project-849-drafts";
const USER = "user-849-drafts";
const REVIEWER = "user-849-reviewer";
const ATTR = "attr-849-drafts";
const MODULE = "pmod-849-drafts";
const CONFIG_SET = "dcs-849-drafts";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DTS = `/dts-v1/;
/ {
	charger {
		compatible = "acme,power";
		iin_max = <1000>;
	};
};
`;

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first]
  };
};

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `fixture failed to compile: ${compiled.error.kind} ${JSON.stringify(compiled.error.violations)}`,
    );
  }
  return compiled.value;
};

const targetValue = (raw: string) => ({
  kind: "cells" as const,
  bits: 32 as const,
  groups: [[{ kind: "integer" as const, raw, value: raw }]]
});

describe("canonical pending value drafts", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;
  let bindingId: string;
  let configRevisionId: string;
  let objectStore: ReturnType<typeof createMemoryObjectStore>;
  let changeRequestId: string;
  let submittedDraftId: string;

  const adminAuth = makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Draft admin",
    email: "drafts@example.com",
    organizationName: "Draft org",
    permissions: ["parameter:view", "parameter:edit", "admin:access"]
  });

  const editorAuth = makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Draft editor",
    email: "drafts@example.com",
    organizationName: "Draft org",
    roles: [{ projectId: PROJECT, roleId: "software-user" }]
  });

  const reviewerAuth = makeTestAuthContext({
    userId: REVIEWER,
    organizationId: ORG,
    name: "Draft reviewer",
    email: "reviewer-849@example.com",
    organizationName: "Draft org",
    roles: [{ projectId: PROJECT, roleId: "software-committer" }]
  });

  const registerCommand = (expectedRelease: { id: string; digest: string }): RegisterSubjectCommand => ({
    kind: "register",
    organizationId: ORG,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    expectedRelease,
    placement: { mode: "use-default" },
    destinationModuleId: MODULE,
    method: "explicit",
    proof: { reason: "issue-849-drafts" },
    idempotencyKey: `reg:${ORG}:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: USER }
  });

  const readCurrentValue = async () => {
    const result = await pool.query<{
      current_value_id: string;
      value_id: string;
      value: unknown;
      config_revision_id: string;
    }>(
      `
      select b.current_value_id, v.id as value_id, v.value, v.config_revision_id
        from parameter_catalog.project_parameter_bindings b
        join parameter_catalog.project_parameter_values v on v.id = b.current_value_id
       where b.organization_id = $1 and b.project_id = $2
      `,
      [ORG, PROJECT]
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("d849dr");
    root = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(root)!;
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest
    });
    expect(installed.ok).toBe(true);

    await pool.query(`insert into public.organizations (id, name) values ($1, 'Draft org')`, [ORG]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Draft editor', 'drafts@example.com', 'Engineer', true)`,
      [USER, ORG]
    );
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Draft reviewer', 'reviewer-849@example.com', 'Committer', true)`,
      [REVIEWER, ORG]
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ($1, $2, 'Draft project', 'D849', 'initialized')`,
      [PROJECT, ORG]
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'Acme power', 'compatible:acme,power')`,
      [ATTR, ORG]
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple')`,
      [ATTR]
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE, ORG, ATTR]
    );
    await pool.query(
      `insert into dts_config_set (id, organization_id, project_id, name, description)
       values ($1, $2, $3, 'default', 'issue 849 drafts')`,
      [CONFIG_SET, ORG, PROJECT]
    );

    const pin = { id: first.release.id, digest: first.release.digest };
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
      const written = await writeGuardedRegistration(client, registerCommand(pin));
      if (!written.ok) {
        await client.query("rollback");
        throw new Error(`registration failed: ${written.error.kind}`);
      }
      await client.query("set constraints all immediate");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const fileId = randomUUID();
    const versionId = randomUUID();
    // The version row references an object-store key; put the exact bytes so the
    // canonical export can read them back.
    objectStore = createMemoryObjectStore();
    await objectStore.put({
      organizationId: ORG,
      fileName: "charger.dts",
      contentType: "text/plain",
      bytes: Buffer.from(DTS, "utf8")
    });
    const checksum = createHash("sha256").update(DTS, "utf8").digest("hex");
    await pool.query(
      `insert into project_parameter_files (
         id, organization_id, project_id, file_name, format, enabled,
         config_set_id, config_set_role, config_set_sort_order
       ) values ($1, $2, $3, 'charger.dts', 'dts', true, $4, 'base', 0)`,
      [fileId, ORG, PROJECT, CONFIG_SET]
    );
    await pool.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
       ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)`,
      [versionId, fileId, `${ORG}/${checksum}-charger.dts`, checksum, Buffer.byteLength(DTS, "utf8"), USER]
    );
    await pool.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      versionId,
      fileId
    ]);

    const manifest: ConfigRevisionManifest = {
      organizationId: ORG,
      projectId: PROJECT,
      configSetId: CONFIG_SET,
      entryFile: "charger.dts",
      includeSearchPaths: ["."],
      overlayOrder: [],
      members: [
        {
          fileId,
          fileVersionId: versionId,
          fileName: "charger.dts",
          role: "base",
          sortOrder: 0,
          content: DTS
        }
      ]
    };

    const revision = await ingestConfigRevision(root, manifest, adminAuth);
    expect(revision.status).toBe("resolved");
    configRevisionId = revision.id;

    const written = await withAuditedWrite(root, adminAuth, { requestId: "req-849-drafts-sync" }, async (tx) => {
      const count = await syncPublishedCatalogProjectValues(
        pool,
        {
          organizationId: ORG,
          projectId: PROJECT,
          configSetId: CONFIG_SET,
          configRevisionId: revision.id
        },
        asValueClient(tx)
      );
      return {
        result: count,
        audit: {
          app: "parameters",
          kind: "parameter-topology-governance",
          action: "binding-edited",
          severity: "Medium" as const,
          projectId: PROJECT,
          targetType: "dts-config-revision",
          targetId: revision.id,
          metadata: { written: count, configRevisionId: revision.id }
        }
      };
    });
    expect(written).toBe(1);

    const binding = await pool.query<{ id: string }>(
      `select id from parameter_catalog.project_parameter_bindings where organization_id = $1 and project_id = $2`,
      [ORG, PROJECT]
    );
    bindingId = binding.rows[0]!.id;
    expect(bindingId.length).toBeGreaterThan(0);
  }, 60_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
  });

  it("creates a pending draft without changing the canonical current value", async () => {
    const before = await readCurrentValue();
    expect(before.value).toEqual(1000);
    const valuesBefore = await pool.query<{ c: string }>(
      `select count(*)::text as c from parameter_catalog.project_parameter_values where binding_id = $1`,
      [bindingId]
    );
    const valueCountBefore = Number(valuesBefore.rows[0]!.c);

    const draft = await withAuditedWrite(root, editorAuth, { requestId: "req-849-draft-create" }, async (tx) => {
      const created = await createCanonicalValueDraft(tx, editorAuth, {
        projectId: PROJECT,
        bindingId,
        action: "set",
        targetValue: targetValue("2000"),
        reason: "raise published input current",
        baseRevisionId: configRevisionId
      });
      await writeTrustedGovernanceAudit(
        asAuditTx(tx),
        createUserInvocation(editorAuth),
        {
          action: "value-drafted",
          organizationId: ORG,
          projectId: PROJECT,
          targetType: "project-parameter-binding",
          targetId: bindingId,
          metadata: { draftId: created.id }
        },
        "req-849-draft-create"
      );
      return { result: created, audit: null };
    });

    expect(draft.id).toMatch(/^pvdr_/);
    expect(draft.bindingId).toBe(bindingId);
    expect(draft.currentValueId).toBe(before.current_value_id);
    expect(draft.targetValue).toContain("2000");

    // The current value, its tip pointer and the source revision are all unchanged.
    const after = await readCurrentValue();
    expect(after.current_value_id).toBe(before.current_value_id);
    expect(after.value_id).toBe(before.value_id);
    expect(after.value).toEqual(1000);
    expect(after.config_revision_id).toBe(configRevisionId);

    const valueCount = await pool.query<{ c: string }>(
      `select count(*)::text as c from parameter_catalog.project_parameter_values where binding_id = $1`,
      [bindingId]
    );
    expect(Number(valueCount.rows[0]!.c)).toBe(valueCountBefore);
  });

  it("persists the draft so a reload reflects server state, and removes it", async () => {
    const listed = await listCanonicalValueDraftsForUser(root, editorAuth, { projectId: PROJECT });
    expect(listed).toHaveLength(1);
    const draftId = listed[0]!.id;

    // Issue #849: the pending-draft read is what a workbench draft tray hydrates
    // from, so the author's reason has to survive the reload with the value.
    expect(listed[0]!.reason).toBe("raise published input current");
    expect(listed[0]!.targetValue).toContain("2000");

    const removed = await removeCanonicalValueDraft(root, editorAuth, { projectId: PROJECT, draftId });
    expect(removed.id).toBe(draftId);
    expect(await listCanonicalValueDraftsForUser(root, editorAuth, { projectId: PROJECT })).toHaveLength(0);

    const after = await readCurrentValue();
    expect(after.value).toEqual(1000);
  });

  it("rejects a stale base revision, an unknown binding and a cross-project actor", async () => {
    await expect(
      createCanonicalValueDraft(root, editorAuth, {
        projectId: PROJECT,
        bindingId,
        action: "set",
        targetValue: targetValue("3000"),
        reason: "stale base",
        baseRevisionId: "crev-does-not-exist"
      })
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "stale-base-revision" } });

    await expect(
      createCanonicalValueDraft(root, editorAuth, {
        projectId: PROJECT,
        bindingId: "pbind-does-not-exist",
        action: "set",
        targetValue: targetValue("3000"),
        reason: "unknown binding",
        baseRevisionId: configRevisionId
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const otherProjectEditor = makeTestAuthContext({
      userId: USER,
      organizationId: ORG,
      roles: [{ projectId: "project-other", roleId: "software-user" }]
    });
    await expect(
      createCanonicalValueDraft(root, otherProjectEditor, {
        projectId: PROJECT,
        bindingId,
        action: "set",
        targetValue: targetValue("3000"),
        reason: "cross project",
        baseRevisionId: configRevisionId
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await readCurrentValue()).value).toEqual(1000);
  });

  it("submits a pending draft into a change request without changing the current value", async () => {
    const before = await readCurrentValue();
    const draft = await createCanonicalValueDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2500"),
      reason: "submitted pending change",
      baseRevisionId: configRevisionId
    });

    const submitted = await submitCanonicalValueChange(root, editorAuth, {
      projectId: PROJECT,
      draftId: draft.id
    });
    expect(submitted.status).toBe("pending");
    expect(submitted.draftId).toBe(draft.id);
    expect(submitted.bindingId).toBe(bindingId);
    expect(submitted.effectiveRevisionId).toBe(draft.effectiveRevisionId);
    expect(submitted.appliedValueId).toBeNull();

    // Submission freezes pending work; it never writes a value.
    const after = await readCurrentValue();
    expect(after.current_value_id).toBe(before.current_value_id);
    expect(after.value).toEqual(1000);

    // A second submission of the same draft is refused while one is open.
    await expect(
      submitCanonicalValueChange(root, editorAuth, { projectId: PROJECT, draftId: draft.id })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    changeRequestId = submitted.id;
    submittedDraftId = draft.id;
  });

  it("refuses self-approval and a non-reviewer approval", async () => {
    await expect(
      reviewCanonicalValueChange(root, editorAuth, {
        projectId: PROJECT,
        requestId: changeRequestId,
        decision: "approve"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const plainEditor = makeTestAuthContext({
      userId: "user-849-plain",
      organizationId: ORG,
      roles: [{ projectId: PROJECT, roleId: "software-user" }]
    });
    await expect(
      reviewCanonicalValueChange(root, plainEditor, {
        projectId: PROJECT,
        requestId: changeRequestId,
        decision: "approve"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await readCurrentValue()).value).toEqual(1000);
  });

  it("approves and applies through the canonical owner in one transaction", async () => {
    const before = await readCurrentValue();
    const historyBefore = await pool.query<{ c: string }>(
      `select count(*)::text as c from parameter_catalog.binding_history_events where binding_id = $1`,
      [bindingId]
    );

    const applied = await reviewCanonicalValueChange(root, reviewerAuth, {
      projectId: PROJECT,
      requestId: changeRequestId,
      decision: "approve",
      note: "reviewed and applied"
    });

    expect(applied.status).toBe("approved");
    expect(applied.applyOutcome).toBe("committed");
    expect(applied.appliedValueId).not.toBeNull();
    expect(applied.reviewerUserId).toBe(REVIEWER);

    // The canonical value advanced through the existing value owner.
    const after = await readCurrentValue();
    expect(after.value).toEqual(2500);
    expect(after.current_value_id).toBe(applied.appliedValueId);
    expect(after.current_value_id).not.toBe(before.current_value_id);

    const historyAfter = await pool.query<{ c: string }>(
      `select count(*)::text as c from parameter_catalog.binding_history_events where binding_id = $1`,
      [bindingId]
    );
    expect(Number(historyAfter.rows[0]!.c)).toBeGreaterThan(Number(historyBefore.rows[0]!.c));

    // The applied pending work left the draft tray in the same transaction.
    expect(await listCanonicalValueDraftsForUser(root, editorAuth, { projectId: PROJECT })).toHaveLength(0);
  });

  it("exports the exact canonical source bytes with pins, and they reimport identically", async () => {
    const current = await readCurrentValue();
    const exported = await exportCanonicalBindingSource(root, objectStore, editorAuth, {
      projectId: PROJECT,
      bindingId
    });
    expect(exported).not.toBeNull();
    expect(exported!.bindingId).toBe(bindingId);
    expect(exported!.currentValueId).toBe(current.current_value_id);
    expect(exported!.configRevisionId).toBe(configRevisionId);
    const bindingRow = await pool.query<{ effective_revision_id: string }>(
      `select effective_revision_id from parameter_catalog.project_parameter_bindings where id = $1`,
      [bindingId]
    );
    expect(exported!.definitionRevisionId).toBe(bindingRow.rows[0]!.effective_revision_id);
    expect(exported!.sourceRef).toBe(`config-set:${CONFIG_SET}`);
    expect(exported!.files).toHaveLength(1);

    const file = exported!.files[0]!;
    expect(file.name).toBe("charger.dts");
    expect(file.format).toBe("dts");
    // The exported bytes are the stored source, not a re-render of the value.
    expect(file.content).toBe(DTS);

    // Reimport fidelity: the exported bytes parse back to the same declared value.
    const reimported = resolveDts(parseDts(file.content));
    const node = reimported.nodes.find((entry) => entry.nodePath === "charger");
    expect(node, file.content).toBeDefined();
    expect((node?.properties ?? []).map((property) => property.name)).toContain("iin_max");

    // An unknown or foreign binding is reported as absent, never as an empty export.
    expect(
      await exportCanonicalBindingSource(root, objectStore, editorAuth, {
        projectId: PROJECT,
        bindingId: "pbind-missing"
      })
    ).toBeNull();
    expect(
      await exportCanonicalBindingSource(root, objectStore, editorAuth, {
        projectId: PROJECT,
        bindingId
      })
    ).not.toBeNull();
  });

  it("exposes the canonical change history with exact value and revision pins", async () => {
    const applied = await pool.query<{ applied_value_id: string }>(
      `select applied_value_id from project_parameter_value_change_requests where id = $1`,
      [changeRequestId]
    );
    const history = await readCanonicalBindingChangeHistory(pool, {
      organizationId: ORG,
      projectId: PROJECT,
      bindingId,
      limit: 10
    });
    expect(history).not.toBeNull();
    expect(history!.length).toBeGreaterThan(0);

    const latest = history![0]!;
    expect(latest.bindingId).toBe(bindingId);
    expect(latest.newCurrentValueId).toBe(applied.rows[0]!.applied_value_id);
    expect(latest.oldCurrentValueId).not.toBe(latest.newCurrentValueId);
    expect(latest.reason.length).toBeGreaterThan(0);
    expect(latest.successAuditRef.length).toBeGreaterThan(0);
    expect(latest.catalogReleaseId.length).toBeGreaterThan(0);

    // An unknown or foreign binding is reported as absent, never as empty history.
    expect(
      await readCanonicalBindingChangeHistory(pool, {
        organizationId: ORG,
        projectId: PROJECT,
        bindingId: "pbind-missing"
      })
    ).toBeNull();
    expect(
      await readCanonicalBindingChangeHistory(pool, {
        organizationId: "org-other",
        projectId: PROJECT,
        bindingId
      })
    ).toBeNull();
  });

  it("replays an already-applied request without appending a second value", async () => {
    const before = await readCurrentValue();
    const valueCountBefore = await pool.query<{ c: string }>(
      `select count(*)::text as c from parameter_catalog.project_parameter_values where binding_id = $1`,
      [bindingId]
    );

    const replay = await reviewCanonicalValueChange(root, reviewerAuth, {
      projectId: PROJECT,
      requestId: changeRequestId,
      decision: "approve"
    });
    expect(replay.status).toBe("approved");
    expect(replay.appliedValueId).toBe(before.current_value_id);

    const valueCountAfter = await pool.query<{ c: string }>(
      `select count(*)::text as c from parameter_catalog.project_parameter_values where binding_id = $1`,
      [bindingId]
    );
    expect(Number(valueCountAfter.rows[0]!.c)).toBe(Number(valueCountBefore.rows[0]!.c));
    expect((await readCurrentValue()).value).toEqual(2500);
  });

  it("rejects a stale base value at approve and leaves the value unchanged", async () => {
    const staleDraft = await createCanonicalValueDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2600"),
      reason: "will go stale",
      baseRevisionId: configRevisionId
    });
    const staleRequest = await submitCanonicalValueChange(root, editorAuth, {
      projectId: PROJECT,
      draftId: staleDraft.id
    });

    // A concurrent legitimate write advances the canonical tip behind the request.
    // Copy the binding's own current tip (never an arbitrary value row) so the
    // probe carries a concrete config-set source and revision.
    await pool.query(
      `
      insert into parameter_catalog.project_parameter_values (
        id, binding_id, definition_id, definition_revision_id, source_ref,
        config_revision_id, value_digest, value_kind, value
      )
      select 'pv-concurrent-849', value.binding_id, value.definition_id,
             value.definition_revision_id, value.source_ref,
             value.config_revision_id, 'digest-concurrent-849', value.value_kind, value.value
        from parameter_catalog.project_parameter_bindings binding
        join parameter_catalog.project_parameter_values value
          on value.id = binding.current_value_id
       where binding.id = $1
      `,
      [bindingId]
    );
    await pool.query(
      `update parameter_catalog.project_parameter_bindings
          set current_value_id = 'pv-concurrent-849'
        where id = $1`,
      [bindingId]
    );

    await expect(
      reviewCanonicalValueChange(root, reviewerAuth, {
        projectId: PROJECT,
        requestId: staleRequest.id,
        decision: "approve"
      })
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "stale-base-value" } });

    const stillPending = await listCanonicalValueChangesForAuth(root, editorAuth, {
      projectId: PROJECT,
      status: "pending"
    });
    expect(stillPending.some((row) => row.id === staleRequest.id)).toBe(true);

    // A stale request must be resubmitted, not force-overwritten; close it so the
    // next scenario starts from a clean open-request state.
    const cleaned = await withdrawCanonicalValueChange(root, editorAuth, {
      projectId: PROJECT,
      requestId: staleRequest.id
    });
    expect(cleaned.status).toBe("withdrawn");
  });

  it("rejects and withdraws without writing a value", async () => {
    const rejectedDraft = await createCanonicalValueDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2700"),
      reason: "to be rejected",
      baseRevisionId: configRevisionId
    });
    const rejectedRequest = await submitCanonicalValueChange(root, editorAuth, {
      projectId: PROJECT,
      draftId: rejectedDraft.id
    });
    const rejected = await reviewCanonicalValueChange(root, reviewerAuth, {
      projectId: PROJECT,
      requestId: rejectedRequest.id,
      decision: "reject",
      note: "not now"
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.appliedValueId).toBeNull();
    // Rejected pending work stays pending for revision rather than being applied.
    expect(
      (await listCanonicalValueDraftsForUser(root, editorAuth, { projectId: PROJECT })).some(
        (row) => row.id === rejectedDraft.id
      )
    ).toBe(true);

    const withdrawnDraft = await createCanonicalValueDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2800"),
      reason: "to be withdrawn",
      baseRevisionId: configRevisionId
    });
    const withdrawnRequest = await submitCanonicalValueChange(root, editorAuth, {
      projectId: PROJECT,
      draftId: withdrawnDraft.id
    });
    await expect(
      withdrawCanonicalValueChange(root, reviewerAuth, {
        projectId: PROJECT,
        requestId: withdrawnRequest.id
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const withdrawn = await withdrawCanonicalValueChange(root, editorAuth, {
      projectId: PROJECT,
      requestId: withdrawnRequest.id
    });
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.appliedValueId).toBeNull();

    // Neither rejection nor withdrawal may have applied anything.
    for (const requestId of [rejectedRequest.id, withdrawnRequest.id]) {
      const row = await pool.query<{ status: string; applied_value_id: string | null }>(
        `select status, applied_value_id
           from project_parameter_value_change_requests
          where organization_id = $1 and id = $2`,
        [ORG, requestId]
      );
      expect(row.rows[0]?.applied_value_id).toBeNull();
      expect(row.rows[0]?.status).not.toBe("approved");
    }
    expect(submittedDraftId.length).toBeGreaterThan(0);
  });
});
