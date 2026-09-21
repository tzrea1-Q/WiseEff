/**
 * Issue #849 C4 — real PostgreSQL evidence for the canonical pending-draft owner.
 *
 * The invariant under test: creating, listing or removing a pending canonical
 * value draft must leave the canonical current ProjectValue, the binding's
 * current-value pointer and the active config revision completely untouched.
 * Before this change the draft route wrote the canonical current value directly.
 */
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { writeTrustedGovernanceAudit } from "../../parameter-topology/governanceAudit";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { parseDts } from "../../dts/parser";
import { resolveDts } from "../../dts/resolver";
import type { ConfigRevisionManifest } from "../../parameter-topology/types";
import {
  asValueClient,
  exportCanonicalBindingSource,
  findCatalogBindingRow,
  verifyCanonicalSourceReimport,
  loadPublishedCatalog,
  readCanonicalBindingChangeHistory,
  syncPublishedCatalogProjectValuesInTransaction
} from "../catalogProjectValueSync";
import { createLocalObjectStore, type ObjectStore } from "../../logs/objectStore";
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

const createPreparedDraft = (
  db: Parameters<typeof createCanonicalValueDraft>[0],
  auth: Parameters<typeof createCanonicalValueDraft>[1],
  input: Parameters<typeof createCanonicalValueDraft>[2],
  objectStore: ObjectStore,
  rootDb: RootDatabase = db as RootDatabase,
): ReturnType<typeof createCanonicalValueDraft> => createCanonicalValueDraft(db, auth, input, {
  objectStore,
  invocation: createUserInvocation(auth),
  requestId: `draft:${randomUUID()}`,
  refusalSink: createTrustedRefusalAuditSink(rootDb)
});

const reviewOptions = async (db: RootDatabase, objectStore: ObjectStore, auth: Parameters<typeof reviewCanonicalValueChange>[1], traceId: string) => {
  const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
  if (!snapshot) throw new Error("Published fixture is unavailable");
  return { objectStore, snapshot, invocation: createUserInvocation(auth), traceId, refusalSink: createTrustedRefusalAuditSink(db) };
};

describe("canonical pending value drafts", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;
  let bindingId: string;
  let configRevisionId: string;
  let storageDirectory: string;
  let objectStore: ReturnType<typeof createLocalObjectStore>;
  let changeRequestId: string;
  let submittedDraftId: string;

  const submitChange = (auth: Parameters<typeof submitCanonicalValueChange>[1], input: Omit<Parameters<typeof submitCanonicalValueChange>[2], "invocation" | "requestId" | "refusalSink">) =>
    submitCanonicalValueChange(root, auth, {
      ...input,
      invocation: createUserInvocation(auth),
      requestId: `submit:${randomUUID()}`,
      refusalSink: createTrustedRefusalAuditSink(root)
    });

  const reviewChange = (
    auth: Parameters<typeof reviewCanonicalValueChange>[1],
    input: Parameters<typeof reviewCanonicalValueChange>[2],
    options?: Parameters<typeof reviewCanonicalValueChange>[3]
  ) => reviewCanonicalValueChange(root, auth, input, {
    invocation: createUserInvocation(auth),
    traceId: `review:${randomUUID()}`,
    refusalSink: createTrustedRefusalAuditSink(root),
    ...options
  });

  const withdrawChange = (
    auth: Parameters<typeof withdrawCanonicalValueChange>[1],
    input: Omit<Parameters<typeof withdrawCanonicalValueChange>[2], "invocation" | "refusalSink" | "traceId">
  ) => withdrawCanonicalValueChange(root, auth, {
    ...input,
    invocation: createUserInvocation(auth),
    refusalSink: createTrustedRefusalAuditSink(root),
    traceId: `withdraw:${randomUUID()}`
  });

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
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-849-drafts-"));
    objectStore = createLocalObjectStore(storageDirectory);
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
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values
         ('urb-849-admin', $1, $2, null, 'admin'),
         ('urb-849-editor', $3, $2, $4, 'software-user'),
         ('urb-849-reviewer', $5, $2, $4, 'software-committer')`,
      [USER, ORG, USER, PROJECT, REVIEWER]
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
    // Historical empty search paths are effectively ["."], but their raw
    // historical manifest identity must survive pinning and export.
    await root.query("update dts_config_revisions set include_search_paths='[]' where id=$1",[revision.id]);

    const syncSnapshot = await loadPublishedCatalog(pool);
    if (!syncSnapshot) throw new Error("Published fixture is unavailable");
    const written = await withAuditedWrite(root, adminAuth, { requestId: "req-849-drafts-sync" }, async (tx) => {
      const count = await syncPublishedCatalogProjectValuesInTransaction(
        asValueClient(tx),syncSnapshot,
        {
          organizationId: ORG,
          projectId: PROJECT,
          configSetId: CONFIG_SET,
          configRevisionId: revision.id
        }
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
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("exports and reimports a historical empty include-path manifest without normalizing its identity", async () => {
    const exported = await exportCanonicalBindingSource(root,objectStore,editorAuth,{ projectId: PROJECT,bindingId });
    expect(exported!.manifest.includeSearchPaths).toEqual([]);
    expect(await verifyCanonicalSourceReimport(root,objectStore,editorAuth,{ projectId: PROJECT,bindingId,source: exported! })).toEqual(exported);
    expect((await root.query("select include_search_paths from dts_config_revisions where id=$1",[configRevisionId])).rows)
      .toEqual([{ include_search_paths: [] }]);
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
      const created = await createPreparedDraft(tx, editorAuth, {
        projectId: PROJECT,
        bindingId,
        action: "set",
        targetValue: targetValue("2000"),
        reason: "raise published input current",
        baseRevisionId: configRevisionId
      }, objectStore, root);
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

    const removed = await removeCanonicalValueDraft(
      root,
      editorAuth,
      { projectId: PROJECT, draftId },
      { requestId: "req-849-draft-remove" }
    );
    expect(removed.id).toBe(draftId);
    expect(await listCanonicalValueDraftsForUser(root, editorAuth, { projectId: PROJECT })).toHaveLength(0);
    expect(
      (await root.query(
        `select action, project_id, target_type, target_id, trace_id
           from audit_events
          where action = 'value-draft-removed' and target_id = $1`,
        [draftId]
      )).rows
    ).toEqual([{
      action: "value-draft-removed",
      project_id: PROJECT,
      target_type: "project-parameter-value-draft",
      target_id: draftId,
      trace_id: "req-849-draft-remove"
    }]);

    const after = await readCurrentValue();
    expect(after.value).toEqual(1000);
  });

  it("rejects a stale base revision, an unknown binding and a cross-project actor", async () => {
    await expect(
      createPreparedDraft(root, editorAuth, {
        projectId: PROJECT,
        bindingId,
        action: "set",
        targetValue: targetValue("3000"),
        reason: "stale base",
        baseRevisionId: "crev-does-not-exist"
      }, objectStore)
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "stale-base-revision" } });

    await expect(
      createPreparedDraft(root, editorAuth, {
        projectId: PROJECT,
        bindingId: "pbind-does-not-exist",
        action: "set",
        targetValue: targetValue("3000"),
        reason: "unknown binding",
        baseRevisionId: configRevisionId
      }, objectStore)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const otherProjectEditor = makeTestAuthContext({
      userId: USER,
      organizationId: ORG,
      roles: [{ projectId: "project-other", roleId: "software-user" }]
    });
    await expect(
      createPreparedDraft(root, otherProjectEditor, {
        projectId: PROJECT,
        bindingId,
        action: "set",
        targetValue: targetValue("3000"),
        reason: "cross project",
        baseRevisionId: configRevisionId
      }, objectStore)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await readCurrentValue()).value).toEqual(1000);
  });

  it("submits a pending draft into a change request without changing the current value", async () => {
    const before = await readCurrentValue();
    const draft = await createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2500"),
      reason: "submitted pending change",
      baseRevisionId: configRevisionId
    }, objectStore);

    const submitted = await submitChange(editorAuth, {
      projectId: PROJECT,
      draftId: draft.id,
      assignedToUserId: REVIEWER
    });
    expect(submitted.status).toBe("pending");
    expect(submitted.draftId).toBe(draft.id);
    expect(submitted.bindingId).toBe(bindingId);
    expect(submitted.effectiveRevisionId).toBe(draft.effectiveRevisionId);
    expect(submitted.appliedValueId).toBeNull();
    expect(submitted.assignedToUserId).toBe(REVIEWER);

    // Submission freezes pending work; it never writes a value.
    const after = await readCurrentValue();
    expect(after.current_value_id).toBe(before.current_value_id);
    expect(after.value).toEqual(1000);

    // A second submission of the same draft is refused while one is open.
    await expect(
      submitChange(editorAuth, { projectId: PROJECT, draftId: draft.id })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    changeRequestId = submitted.id;
    submittedDraftId = draft.id;
    expect(await listCanonicalValueDraftsForUser(root, editorAuth, { projectId: PROJECT })).toEqual([]);
  });

  it("refuses self-approval and a non-reviewer approval", async () => {
    await expect(
      reviewChange(editorAuth, {
        projectId: PROJECT,
        requestId: changeRequestId,
        decision: "approve"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      reviewChange(editorAuth, {
        projectId: PROJECT,
        requestId: changeRequestId,
        decision: "reject"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const plainEditor = makeTestAuthContext({
      userId: "user-849-plain",
      organizationId: ORG,
      roles: [{ projectId: PROJECT, roleId: "software-user" }]
    });
    await pool.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Plain editor','Engineer',true)`, [plainEditor.user.id,ORG]);
    await expect(
      reviewChange(plainEditor, {
        projectId: PROJECT,
        requestId: changeRequestId,
        decision: "approve"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await readCurrentValue()).value).toEqual(1000);
  });

  it("requires an assigned reviewer to be an active project software committer", async () => {
    await expect(submitChange(editorAuth, {
      projectId: PROJECT,
      draftId: submittedDraftId,
      assignedToUserId: "missing-or-ineligible-reviewer"
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await pool.query(
      `delete from user_role_bindings
        where organization_id = $1 and project_id = $2 and user_id = $3 and role_id = 'software-committer'`,
      [ORG, PROJECT, REVIEWER]
    );
    await expect(submitChange(editorAuth, {
      projectId: PROJECT,
      draftId: submittedDraftId
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { roleId: "software-committer" } });
    await pool.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ('urb-849-reviewer', $1, $2, $3, 'software-committer')`,
      [REVIEWER, ORG, PROJECT]
    );
  });

  it("serializes selected reviewer revocation before creating a change request", async () => {
    const raceEditorId = "user-849-race-editor";
    const raceEditorAuth = makeTestAuthContext({
      userId: raceEditorId,
      organizationId: ORG,
      name: "Race editor",
      email: "race-editor-849@example.com",
      organizationName: "Draft org",
      roles: [{ projectId: PROJECT, roleId: "software-user" }]
    });
    await pool.query(
      `insert into users(id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Race editor', 'race-editor-849@example.com', 'Engineer', true)
       on conflict (id) do nothing`,
      [raceEditorId, ORG]
    );
    await pool.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ('urb-849-race-editor', $1, $2, $3, 'software-user')
       on conflict (id) do nothing`,
      [raceEditorId, ORG, PROJECT]
    );
    const draft = await createPreparedDraft(root, raceEditorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2510"),
      reason: "selected reviewer revocation race",
      baseRevisionId: (await readCurrentValue()).config_revision_id
    }, objectStore);
    const revocation = await pool.connect();
    let submitted: ReturnType<typeof submitChange> | undefined;
    let revocationCommitted = false;
    try {
      await revocation.query("begin");
      const pid = Number((await revocation.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid);
      await revocation.query(
        `select id from users where organization_id = $1 and id = $2 for no key update`,
        [ORG, REVIEWER]
      );
      await revocation.query(
        `delete from user_role_bindings
          where organization_id = $1 and project_id = $2 and user_id = $3 and role_id = 'software-committer'`,
        [ORG, PROJECT, REVIEWER]
      );
      // The pre-fix implementation read eligibility and then waited here,
      // leaving a window to insert the revoked reviewer after commit.
      await revocation.query(
        `select id from dts_config_set where organization_id = $1 and project_id = $2 for update`,
        [ORG, PROJECT]
      );

      submitted = submitChange(raceEditorAuth, {
        projectId: PROJECT,
        draftId: draft.id,
        assignedToUserId: REVIEWER
      });

      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        waiting = (await pool.query<{ waiting: boolean }>(
          `select exists (
             select 1
               from pg_stat_activity
              where datname = current_database()
                and wait_event_type = 'Lock'
                and pid <> $1
                and $1 = any(pg_blocking_pids(pid))
           ) as waiting`,
          [pid]
        )).rows[0]!.waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      await revocation.query("commit");
      revocationCommitted = true;

      await expect(submitted).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { assignedToUserId: REVIEWER, projectId: PROJECT }
      });
    } finally {
      // Release the blocker before awaiting a possibly still-blocked submit.
      if (!revocationCommitted) await revocation.query("rollback").catch(() => undefined);
      revocation.release();
      if (submitted) await submitted.catch(() => undefined);
      await pool.query(
        `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
         values ('urb-849-reviewer', $1, $2, $3, 'software-committer')
         on conflict (id) do nothing`,
        [REVIEWER, ORG, PROJECT]
      );
    }

    const request = await pool.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_value_change_requests where draft_id = $1`,
      [draft.id]
    );
    expect(request.rows[0]!.count).toBe("0");
  });

  it("approves and applies through the canonical owner in one transaction", async () => {
    const before = await readCurrentValue();
    const historyBefore = await pool.query<{ c: string }>(
      `select count(*)::text as c from parameter_catalog.binding_history_events where binding_id = $1`,
      [bindingId]
    );

    const applied = await reviewChange(reviewerAuth, {
      projectId: PROJECT,
      requestId: changeRequestId,
      decision: "approve",
      note: "reviewed and applied"
    }, await reviewOptions(root, objectStore, reviewerAuth, "req-849-approve"));

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

  it("checks the current database role and active state before replaying an approved request", async () => {
    await pool.query(
      `delete from user_role_bindings
        where organization_id = $1 and project_id = $2 and user_id = $3 and role_id = 'software-committer'`,
      [ORG, PROJECT, REVIEWER]
    );
    await expect(
      reviewChange(reviewerAuth, {
        projectId: PROJECT,
        requestId: changeRequestId,
        decision: "approve"
      }, await reviewOptions(root, objectStore, reviewerAuth, "req-849-revoked-replay"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await pool.query(
      `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
       values ('urb-849-reviewer', $1, $2, $3, 'software-committer')`,
      [REVIEWER, ORG, PROJECT]
    );
    await pool.query(`update users set is_active = false where organization_id = $1 and id = $2`, [ORG, REVIEWER]);
    await expect(
      reviewChange(reviewerAuth, {
        projectId: PROJECT,
        requestId: changeRequestId,
        decision: "approve"
      }, await reviewOptions(root, objectStore, reviewerAuth, "req-849-inactive-replay"))
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pool.query(`update users set is_active = true where organization_id = $1 and id = $2`, [ORG, REVIEWER]);
  });

  it("refuses pending approve and reject after a reviewer role is revoked from the database", async () => {
    const draft = await createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2525"),
      reason: "live role revocation",
      baseRevisionId: (await readCurrentValue()).config_revision_id
    }, objectStore);
    const request = await submitChange(editorAuth, { projectId: PROJECT, draftId: draft.id });
    const beforeValue = await readCurrentValue();

    await pool.query(
      `delete from user_role_bindings
        where organization_id = $1 and project_id = $2 and user_id = $3 and role_id = 'software-committer'`,
      [ORG, PROJECT, REVIEWER]
    );
    try {
      await expect(
        reviewChange(reviewerAuth, {
          projectId: PROJECT,
          requestId: request.id,
          decision: "approve"
        }, await reviewOptions(root, objectStore, reviewerAuth, "req-849-pending-revoked-approve"))
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        reviewChange(reviewerAuth, {
          projectId: PROJECT,
          requestId: request.id,
          decision: "reject"
        }, await reviewOptions(root, objectStore, reviewerAuth, "req-849-pending-revoked-reject"))
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await pool.query(
        `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
         values ('urb-849-reviewer', $1, $2, $3, 'software-committer')`,
        [REVIEWER, ORG, PROJECT]
      );
    }

    const afterValue = await readCurrentValue();
    const afterRequest = await pool.query<{ status: string; applied_value_id: string | null }>(
      `select status, applied_value_id
         from project_parameter_value_change_requests
        where id = $1`,
      [request.id]
    );
    expect(afterValue).toEqual(beforeValue);
    expect(afterRequest.rows[0]).toEqual({ status: "pending", applied_value_id: null });
    await expect(withdrawChange(editorAuth, {
      projectId: PROJECT,
      requestId: request.id
    })).resolves.toMatchObject({ status: "withdrawn" });
  });

  it("waits for a committed user deactivation before refusing a pending review", async () => {
    const draft = await createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2535"),
      reason: "serialize live role revocation",
      baseRevisionId: (await readCurrentValue()).config_revision_id
    }, objectStore);
    const request = await submitChange(editorAuth, { projectId: PROJECT, draftId: draft.id });
    const beforeValue = await readCurrentValue();
    const options = await reviewOptions(root, objectStore, reviewerAuth, "req-849-serialized-revocation");
    const revocation = await pool.connect();
    let reviewPromise: ReturnType<typeof reviewChange> | undefined;
    try {
      await revocation.query("begin");
      await revocation.query(
        `update users set is_active = false where organization_id = $1 and id = $2`,
        [ORG, REVIEWER]
      );
      reviewPromise = reviewChange(reviewerAuth, {
        projectId: PROJECT,
        requestId: request.id,
        decision: "approve"
      }, options);

      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt += 1) {
        waiting = (await pool.query(`select exists (
          select 1
            from pg_stat_activity
           where datname = current_database()
             and wait_event_type = 'Lock'
             and query ilike '%for no key update%'
        ) as waiting`)).rows[0]!.waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      await revocation.query("commit");
      await expect(reviewPromise).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await revocation.query("rollback").catch(() => undefined);
      revocation.release();
      await pool.query(
        `update users set is_active = true where organization_id = $1 and id = $2`,
        [ORG, REVIEWER]
      );
    }

    const afterValue = await readCurrentValue();
    const afterRequest = await pool.query<{ status: string; applied_value_id: string | null }>(
      `select status, applied_value_id
         from project_parameter_value_change_requests
        where id = $1`,
      [request.id]
    );
    expect(afterValue).toEqual(beforeValue);
    expect(afterRequest.rows[0]).toEqual({ status: "pending", applied_value_id: null });
    await expect(withdrawChange(editorAuth, {
      projectId: PROJECT,
      requestId: request.id
    })).resolves.toMatchObject({ status: "withdrawn" });
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
    expect(exported!.configRevisionId).toBe(current.config_revision_id);
    expect(exported!.configRevisionId).not.toBe(configRevisionId);
    const bindingRow = await pool.query<{ effective_revision_id: string }>(
      `select effective_revision_id from parameter_catalog.project_parameter_bindings where id = $1`,
      [bindingId]
    );
    expect(exported!.definitionRevisionId).toBe(bindingRow.rows[0]!.effective_revision_id);
    // A value written from a `.dts` occurrence records the exact file location as its
    // provenance (so identity correction and property-key cutover can rewrite it),
    // while the export still resolves the config set the bytes come from.
    expect(exported!.sourceRef).toBe("charger.dts!/charger");
    expect(exported!.configSetId).toBe(CONFIG_SET);
    expect(exported!.files).toHaveLength(1);
    expect(exported!.manifest.includeSearchPaths).toEqual(["."]);

    const file = exported!.files[0]!;
    expect(file.name).toBe("charger.dts");
    expect(file.format).toBe("dts");
    // The exported bytes are the stored source, not a re-render of the value.
    expect(file.content).toBe(DTS.replace("<1000>", "<2500>"));

    // Reimport fidelity: the exported bytes parse back to the same declared value.
    const reimported = resolveDts(parseDts(file.content));
    const node = reimported.nodes.find((entry) => entry.nodePath === "charger");
    expect(node, file.content).toBeDefined();
    expect((node?.properties ?? []).map((property) => property.name)).toContain("iin_max");
    expect(node?.properties.find((property) => property.name === "iin_max")?.rawText).toBe("<2500>");
    expect(await verifyCanonicalSourceReimport(root,objectStore,editorAuth,{ projectId: PROJECT,bindingId,source: exported! })).toEqual(exported);

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

    const replay = await reviewChange(reviewerAuth, {
      projectId: PROJECT,
      requestId: changeRequestId,
      decision: "approve"
    }, await reviewOptions(root, objectStore, reviewerAuth, "req-849-replay"));
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
    const staleDraft = await createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2600"),
      reason: "will go stale",
      baseRevisionId: (await readCurrentValue()).config_revision_id
    }, objectStore);
    const staleRequest = await submitChange(editorAuth, {
      projectId: PROJECT,
      draftId: staleDraft.id
    });

    // Another editor's fully reviewed source change wins; no unpinned SQL value
    // insertion can stand in for a legitimate concurrent source commit.
    const otherEditor = makeTestAuthContext({ userId: "user-849-other-editor", organizationId: ORG,
      roles: [{ projectId: PROJECT, roleId: "software-user" }] });
    await pool.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Other editor','Engineer',true)`, [otherEditor.user.id,ORG]);
    const otherDraft = await createPreparedDraft(root, otherEditor, {
      projectId: PROJECT, bindingId, action: "set", targetValue: targetValue("2550"),
      reason: "concurrent approved source change", baseRevisionId: (await readCurrentValue()).config_revision_id,
    }, objectStore);
    const otherRequest = await submitChange(otherEditor, { projectId: PROJECT, draftId: otherDraft.id });
    await reviewChange(reviewerAuth, { projectId: PROJECT, requestId: otherRequest.id, decision: "approve" },
      await reviewOptions(root, objectStore, reviewerAuth, "req-849-concurrent"));
    const concurrentValue = await readCurrentValue();
    expect(concurrentValue.value).toBe(2550);

    await expect(
      reviewChange(reviewerAuth, {
        projectId: PROJECT,
        requestId: staleRequest.id,
        decision: "approve"
      }, await reviewOptions(root, objectStore, reviewerAuth, "req-849-stale"))
    ).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "stale-base-value" } });
    expect(await readCurrentValue()).toEqual(concurrentValue);

    const stillPending = await listCanonicalValueChangesForAuth(root, editorAuth, {
      projectId: PROJECT,
      status: "pending"
    });
    expect(stillPending.some((row) => row.id === staleRequest.id)).toBe(true);

    // A stale request must be resubmitted, not force-overwritten; close it so the
    // next scenario starts from a clean open-request state.
    const cleaned = await withdrawChange(editorAuth, {
      projectId: PROJECT,
      requestId: staleRequest.id
    });
    expect(cleaned.status).toBe("withdrawn");
  });

  it("submission waits for source locks before locking the draft, avoiding an editor-submit deadlock", async () => {
    const draft = await createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,bindingId,action: "set",targetValue: targetValue("2650"),reason: "lock order",
      baseRevisionId: (await readCurrentValue()).config_revision_id,
    },objectStore);
    const editor = await pool.connect();
    let submitted: ReturnType<typeof submitCanonicalValueChange> | undefined;
    try {
      await editor.query("begin");
      const pid = (await editor.query(`select pg_backend_pid() as pid`)).rows[0]!.pid;
      await editor.query(`select id from dts_config_set where id=$1 for update`, [CONFIG_SET]);
      await editor.query(`select id from parameter_catalog.project_parameter_bindings where id=$1 for update`, [bindingId]);
      submitted = submitChange(editorAuth,{ projectId: PROJECT,draftId: draft.id });
      void submitted.catch(() => undefined);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await pool.query(`select exists(select 1 from pg_stat_activity
          where datname=current_database() and $1=any(pg_blocking_pids(pid))) as waiting`, [pid])).rows[0]!.waiting;
        if (!waiting) await delay(10);
      }
      expect(waiting).toBe(true);
      // The source editor must still be able to lock its draft while submit is
      // waiting. Inverted draft-first locking fails NOWAIT with 55P03.
      await editor.query(`select id from project_parameter_value_drafts where id=$1 for update nowait`, [draft.id]);
    } finally {
      await editor.query("rollback");
      editor.release();
      if (submitted) {
        const request = await submitted;
        await withdrawChange(editorAuth,{ projectId: PROJECT,requestId: request.id });
      }
    }
  });

  it("rejects and withdraws without writing a value", async () => {
    const rejectedDraft = await createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2700"),
      reason: "to be rejected",
      baseRevisionId: (await readCurrentValue()).config_revision_id
    }, objectStore);
    const rejectedRequest = await submitChange(editorAuth, {
      projectId: PROJECT,
      draftId: rejectedDraft.id
    });
    const rejected = await reviewChange(reviewerAuth, {
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

    const withdrawnDraft = await createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("2800"),
      reason: "to be withdrawn",
      baseRevisionId: (await readCurrentValue()).config_revision_id
    }, objectStore);
    const withdrawnRequest = await submitChange(editorAuth, {
      projectId: PROJECT,
      draftId: withdrawnDraft.id
    });
    await expect(
      withdrawChange(reviewerAuth, {
        projectId: PROJECT,
        requestId: withdrawnRequest.id
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const withdrawn = await withdrawChange(editorAuth, {
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

  it("deletes a pinned DTS property through review, preserves its historical export, and fails closed on replay tampering", async () => {
    const before = await readCurrentValue();
    const beforeFile = (await pool.query<{ current_version_id: string }>(
      `select current_version_id from project_parameter_files where id = (select file_id from parameter_catalog.project_parameter_source_occurrences where id = (select source_occurrence_id from parameter_catalog.project_parameter_bindings where id = $1))`,
      [bindingId]
    )).rows[0]!;
    const draft = await createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "delete",
      reason: "remove obsolete DTS property",
      baseRevisionId: before.config_revision_id
    }, objectStore);

    expect((await readCurrentValue()).current_value_id).toBe(before.current_value_id);
    const submitted = await submitChange(editorAuth, { projectId: PROJECT, draftId: draft.id });
    expect(submitted).toMatchObject({ action: "delete", status: "pending", targetValue: "", sourceFormat: "dts" });
    expect(await readCurrentValue()).toEqual(before);

    await pool.query(`create function public.t11_fail_dts_delete_audit() returns trigger language plpgsql as $$
      begin
        if new.trace_id = 't11-dts-delete-audit-failure' and new.action = 'value-change-applied' then
          raise exception 't11-injected-dts-delete-audit-failure';
        end if;
        return new;
      end $$`);
    await pool.query(`create trigger t11_fail_dts_delete_audit before insert on audit_events for each row execute function public.t11_fail_dts_delete_audit()`);
    try {
      await expect(reviewChange(reviewerAuth, {
        projectId: PROJECT,
        requestId: submitted.id,
        decision: "approve"
      }, { ...(await reviewOptions(root, objectStore, reviewerAuth, "t11-dts-delete-audit-failure")), traceId: "t11-dts-delete-audit-failure" })).rejects.toThrow("t11-injected-dts-delete-audit-failure");
      expect(await readCurrentValue()).toEqual(before);
      const rolledBack = await pool.query<{ status: string; applied_value_id: string | null }>(
        `select status, applied_value_id from project_parameter_value_change_requests where id = $1`, [submitted.id]
      );
      expect(rolledBack.rows[0]).toEqual({ status: "pending", applied_value_id: null });
      expect((await pool.query<{ current_version_id: string }>(
        `select current_version_id from project_parameter_files where id = (select file_id from parameter_catalog.project_parameter_source_occurrences where id = (select source_occurrence_id from parameter_catalog.project_parameter_bindings where id = $1))`,
        [bindingId]
      )).rows[0]!.current_version_id).toBe(beforeFile.current_version_id);
    } finally {
      await pool.query(`drop trigger t11_fail_dts_delete_audit on audit_events`);
      await pool.query(`drop function public.t11_fail_dts_delete_audit()`);
    }

    // A second effect at the same maximum order is ambiguous, even if both
    // effects delete the same property. Inject it before the first source pin.
    await pool.query(`create function public.t11_duplicate_delete_effect() returns trigger language plpgsql as $$
      begin
        if new.effect_kind='delete' and new.property_name='iin_max' and pg_trigger_depth()=1 then
          insert into dts_occurrence_effects
            (id,config_revision_id,logical_node_revision_id,property_name,effect_kind,node_occurrence_id,property_occurrence_id,source_order)
          values (new.id || '-tied',new.config_revision_id,new.logical_node_revision_id,new.property_name,new.effect_kind,
            new.node_occurrence_id,new.property_occurrence_id,new.source_order);
        end if;
        return new;
      end $$`);
    await pool.query(`create trigger t11_duplicate_delete_effect after insert on dts_occurrence_effects
      for each row execute function public.t11_duplicate_delete_effect()`);
    try {
      await expect(reviewChange(reviewerAuth, { projectId: PROJECT, requestId: submitted.id, decision: "approve" },
        await reviewOptions(root, objectStore, reviewerAuth, "t11-dts-delete-tied-order")))
        .rejects.toMatchObject({ code: "CONFLICT" });
      expect(await readCurrentValue()).toEqual(before);
      expect((await pool.query(`select status,applied_value_id from project_parameter_value_change_requests where id=$1`, [submitted.id])).rows)
        .toEqual([{ status: "pending", applied_value_id: null }]);
    } finally {
      await pool.query(`drop trigger t11_duplicate_delete_effect on dts_occurrence_effects`);
      await pool.query(`drop function public.t11_duplicate_delete_effect()`);
    }

    const applied = await reviewChange(reviewerAuth, {
      projectId: PROJECT,
      requestId: submitted.id,
      decision: "approve"
    }, await reviewOptions(root, objectStore, reviewerAuth, "t11-dts-delete-approve"));
    expect(applied).toMatchObject({ status: "approved", applyOutcome: "committed", action: "delete", appliedValueId: expect.any(String) });
    const deletedValueId = applied.appliedValueId!;
    const deleted = await pool.query<{
      current_value_id: string; value_state: string; pin_state: string; base_source_pin_id: string;
      delete_request_id: string; locator: Record<string, unknown>; delete_proof: Record<string, unknown>;
    }>(`select b.current_value_id, value.value_state, pin.value_state as pin_state,
          pin.base_source_pin_id, pin.delete_request_id, pin.locator, pin.delete_proof
       from parameter_catalog.project_parameter_bindings b
       join parameter_catalog.project_parameter_values value on value.id = b.current_value_id
       join parameter_catalog.project_value_source_pins pin on pin.project_value_id = value.id and pin.binding_id = b.id
      where b.organization_id = $1 and b.project_id = $2 and b.id = $3`, [ORG, PROJECT, bindingId]);
    expect(deleted.rows[0]).toMatchObject({
      current_value_id: deletedValueId,
      value_state: "deleted",
      pin_state: "deleted",
      base_source_pin_id: expect.any(String),
      delete_request_id: submitted.id,
      locator: { kind: "dts-delete", propertyName: "iin_max", fileVersionId: expect.any(String), nodeOccurrenceId: expect.any(String) },
      delete_proof: {
        kind: "dts-delete-v1",
        scannerVersion: "dts-cst-v1",
        propertyName: "iin_max",
        nodeOccurrenceId: expect.any(String),
        beforeValueDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        beforeSourceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        afterSourceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
      }
    });

    const currentExport = await exportCanonicalBindingSource(root, objectStore, editorAuth, { projectId: PROJECT, bindingId, projectValueId: deletedValueId });
    expect(currentExport).toMatchObject({ valueState: "deleted", currentValueId: deletedValueId });
    await expect(findCatalogBindingRow(root, { organizationId: ORG, projectId: PROJECT, bindingId }))
      .rejects.toMatchObject({ code: "CONFLICT", details: { reason: "deleted-value-is-terminal" } });
    expect(currentExport!.files[0]!.content).toContain("/delete-property/ iin_max;");
    expect(currentExport!.files[0]!.content).not.toContain("iin_max =");
    const historicalExport = await exportCanonicalBindingSource(root, objectStore, editorAuth, { projectId: PROJECT, bindingId, projectValueId: before.current_value_id });
    expect(historicalExport).toMatchObject({ valueState: "present", currentValueId: before.current_value_id });
    expect(historicalExport!.files[0]!.content).toBe(DTS.replace("<1000>", "<2550>"));
    expect(historicalExport!.manifest.locator).toMatchObject({ kind: "dts-property", propertyName: "iin_max" });

    const currentSource = currentExport!.files[currentExport!.manifest.members.findIndex((member) => member.fileId === currentExport!.manifest.fileId)]!;
    const storageKey = (await pool.query<{ storage_key: string }>(
      `select storage_key from project_parameter_file_versions where id = $1`, [currentExport!.manifest.fileVersionId]
    )).rows[0]!.storage_key;
    const tamperedStorage = {
      ...objectStore,
      getBounded: async (key: string, limit: number) => key === storageKey
        ? Buffer.from(currentSource.content.replace("/delete-property/ iin_max;", "/delete-property/ other_property;"), "utf8")
        : objectStore.getBounded!(key, limit)
    };
    const replayBefore = await readCurrentValue();
    await expect(reviewChange(reviewerAuth, {
      projectId: PROJECT,
      requestId: submitted.id,
      decision: "approve"
    }, { ...(await reviewOptions(root, objectStore, reviewerAuth, "t11-dts-delete-replay-tampered")), objectStore: tamperedStorage, traceId: "t11-dts-delete-replay-tampered" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readCurrentValue()).toEqual(replayBefore);

    await expect(createPreparedDraft(root, editorAuth, {
      projectId: PROJECT,
      bindingId,
      action: "set",
      targetValue: targetValue("3000"),
      reason: "cannot revive deleted property",
      baseRevisionId: replayBefore.config_revision_id
    }, objectStore)).rejects.toMatchObject({ code: "CONFLICT" });

    const deletedPinId = (await pool.query<{ id: string }>(
      `select pin.id from parameter_catalog.project_value_source_pins pin where pin.project_value_id = $1 and pin.binding_id = $2`, [deletedValueId, bindingId]
    )).rows[0]!.id;
    const tamper = await pool.connect();
    try {
      await tamper.query("begin");
      await expect(tamper.query(
        `update parameter_catalog.project_value_source_pins
            set delete_proof = jsonb_set(delete_proof, '{afterSourceDigest}', '"sha256:0000000000000000000000000000000000000000000000000000000000000000"'::jsonb)
          where id = $1`, [deletedPinId]
      )).rejects.toThrow();
    } finally {
      await tamper.query("rollback").catch(() => undefined);
      tamper.release();
    }
  });
});
