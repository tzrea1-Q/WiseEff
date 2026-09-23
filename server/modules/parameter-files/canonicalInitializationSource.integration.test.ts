import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { createLocalObjectStore } from "./../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "./configSetService";
import { uploadProjectParameterFile } from "./service";
import { insertProjectParameterFile } from "./repository";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import {
  asValueClient,
  exportCanonicalBindingSource,
  importTextToDtsValue,
  listCatalogBindingRowsForProject,
  loadPublishedCatalog,
  syncPublishedCatalogProjectValuesInTransaction,
} from "../parameter-bindings/catalogProjectValueSync";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { reviewCanonicalValueChange, submitCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import {
  approveReview,
  previewSnapshot,
  submitDraft,
  upsertDraft,
} from "../parameters/initializationService";
import { listSourceBindingCandidates } from "../parameters/initializationRepository";
import { cloneCanonicalInitializationSource } from "./canonicalInitializationSource";
import type { ObjectStore } from "../logs/objectStore";
import { canonicalSourceMemberMatchesCurrentFile, preparePinnedSourceChange } from "./canonicalSource";

const ORG = "org-init-dts";
const SOURCE = "project-init-dts-source";
const TARGET = "project-init-dts-target";
const FAILURE_TARGET = "project-init-dts-failure-target";
const DRIFT_TARGET = "project-init-dts-drift-target";
const USER = "user-init-dts";
const REVIEWER = "reviewer-init-dts";

const ENTRY = `/dts-v1/;
/include/ "base.dtsi";
`;
const INCLUDED = `/ {
  charger: device@0 {
    compatible = "acme,power";
    iin_max = <1000>;
  };
  charger2: device@1 {
    compatible = "acme,power";
    iin_max = <2000>;
  };
};
`;

describe("canonical DTS initialization source", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: ReturnType<typeof createPostgresDatabase>;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;

  const auth = makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
    roles: [{ roleId: "admin", projectId: null }],
  });
  const reviewerAuth = makeTestAuthContext({
    userId: REVIEWER,
    organizationId: ORG,
    permissions: ["parameter:view", "parameter:edit", "parameter:review"],
    roles: [{ roleId: "software-committer", projectId: TARGET }],
  });

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("init902dts");
    db = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-init902-dts-"));
    storage = createLocalObjectStore(storageDirectory);

    await db.query("insert into organizations(id,name) values ($1,'Initialization DTS')", [ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'DTS admin','Admin',true)", [USER, ORG]);
    await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'DTS reviewer','Admin',true)", [REVIEWER, ORG]);
    await db.query(
      "insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,null,'admin')",
      [`role-${USER}`, USER, ORG],
    );
    await db.query(
      "insert into projects(id,organization_id,name,code,status,initialization_status) values ($1,$2,'DTS source','DTS-S','initialized','initialized'),($3,$2,'DTS target','DTS-T','initialized','not_initialized'),($4,$2,'DTS failure target','DTS-F','initialized','not_initialized'),($5,$2,'DTS drift target','DTS-R','initialized','not_initialized')",
      [SOURCE, ORG, TARGET, FAILURE_TARGET, DRIFT_TARGET],
    );
    await db.query(
      "insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,'software-committer')",
      [`role-${REVIEWER}`, REVIEWER, ORG, TARGET],
    );

    const pool = getRootPostgresPool(db)!;
    await installDriverSourceFixture(db, auth, {
      subjectId: "csub_acme_power",
      compatible: "acme,power",
      businessName: "DTS initialization",
      driverName: "Acme power",
      idempotencyKey: "init902-dts-registration",
      reason: "Issue 902 DTS initialization",
    });

    const configSet = await createConfigSet(db, auth, { projectId: SOURCE, name: "DTS source" });
    const entry = await uploadProjectParameterFile(db, storage, auth, {
      projectId: SOURCE,
      fileName: "board.dts",
      bytes: Buffer.from(ENTRY),
    });
    const included = await uploadProjectParameterFile(db, storage, auth, {
      projectId: SOURCE,
      fileName: "base.dtsi",
      bytes: Buffer.from(INCLUDED),
    });
    await addConfigSetFile(db, auth, { configSetId: configSet.id, fileId: entry.file.id, role: "base", sortOrder: 0 });
    await addConfigSetFile(db, auth, { configSetId: configSet.id, fileId: included.file.id, role: "misc", sortOrder: 1 });
    const manifest: ConfigRevisionManifest = {
      organizationId: ORG,
      projectId: SOURCE,
      configSetId: configSet.id,
      entryFile: "board.dts",
      includeSearchPaths: ["."],
      overlayOrder: [],
      members: [
        { fileId: entry.file.id, fileVersionId: entry.version.id, fileName: "board.dts", sourceName: "board.dts", role: "base", sortOrder: 0, content: ENTRY },
        // Include resolution uses the entry/sourceName and search path; its
        // persisted config-set membership is the canonical `misc` role.
        { fileId: included.file.id, fileVersionId: included.version.id, fileName: "base.dtsi", sourceName: "base.dtsi", role: "include", sortOrder: 1, content: INCLUDED },
      ],
    };
    const revision = await ingestConfigRevision(db, manifest, auth, { legacyProjection: "skip" });
    expect(revision.status).toBe("resolved");
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("Published Catalog fixture is unavailable");
    const written = await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, {
      organizationId: ORG,
      projectId: SOURCE,
      configSetId: configSet.id,
      configRevisionId: revision.id,
    }));
    expect(written).toBe(2);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("clones one selected DTS instance and preserves an include source for target writeback", async () => {
    const pool = getRootPostgresPool(db)!;
    const candidates = await listSourceBindingCandidates(db, {
      organizationId: ORG,
      projectIds: [SOURCE],
    });
    expect(candidates).toHaveLength(2);
    const selected = candidates[0]!;
    const snapshots = await previewSnapshot(db, auth, {
      projectId: TARGET,
      primarySourceProjectId: SOURCE,
      supplementSourceProjectIds: [],
      selectedSourceBindingIds: [selected.sourceBindingId],
      selectedModuleIds: [],
      selectedRisks: [],
    });
    expect(snapshots).toHaveLength(1);
    const catalogSnapshot = await loadPublishedCatalog(pool);
    if (!catalogSnapshot) throw new Error("Published Catalog fixture is unavailable");
    const refusalSink = createTrustedRefusalAuditSink(db);
    const sourcePrepared = await db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: SOURCE,
      bindingId: selected.sourceBindingId,
      expectedValueId: selected.sourceProjectValueId,
      target: { format: "dts", sourceText: "<66>" },
      invocation: createUserInvocation(auth),
      requestId: "init902-dts-source-prepare",
      refusalSink,
    }));
    expect(sourcePrepared.diff.after).toContain("<66>");
    const result = await db.transaction((tx) => cloneCanonicalInitializationSource(
      tx,
      storage,
      auth,
      { targetProjectId: TARGET, snapshots },
      {
        requestId: "init902-dts-clone",
        invocation: createUserInvocation(auth),
        refusalSink,
        catalogSnapshot,
      },
    ));
    expect(result.bindingCount).toBe(1);
    const sourceBindings = await listCatalogBindingRowsForProject(db, auth, { projectId: SOURCE });
    const targetBindings = await listCatalogBindingRowsForProject(db, auth, { projectId: TARGET });
    expect(sourceBindings).toHaveLength(2);
    expect(targetBindings).toHaveLength(1);
    expect(targetBindings[0]!.definitionId).toBe(selected.parameterSpecId);
    expect(targetBindings[0]!.currentValueId).not.toBe(selected.sourceProjectValueId);

    const prepared = await db.transaction((tx) => preparePinnedSourceChange(tx, storage, auth, {
      projectId: TARGET,
      bindingId: targetBindings[0]!.id,
      expectedValueId: targetBindings[0]!.currentValueId,
      target: { format: "dts", sourceText: "<77>" },
      invocation: createUserInvocation(auth),
      requestId: "init902-dts-target-prepare",
      refusalSink,
    }));
    expect(prepared.diff.after).toContain("<77>");

    const sourceBefore = await exportCanonicalBindingSource(db, storage, auth, {
      projectId: SOURCE,
      bindingId: selected.sourceBindingId,
    });
    const targetBefore = await exportCanonicalBindingSource(db, storage, auth, {
      projectId: TARGET,
      bindingId: targetBindings[0]!.id,
    });
    if (!targetBefore) throw new Error("Expected target canonical binding source.");
    const draft = await createCanonicalValueDraft(db, auth, {
      projectId: TARGET,
      bindingId: targetBindings[0]!.id,
      targetValue: importTextToDtsValue("iin_max", "77"),
      reason: "Verify initialized DTS source writeback",
      baseRevisionId: targetBefore.configRevisionId,
      baseCurrentValueId: targetBefore.currentValueId,
    }, {
      objectStore: storage,
      invocation: createUserInvocation(auth),
      requestId: "init902-dts-value-draft",
      refusalSink,
    });
    const request = await submitCanonicalValueChange(db, auth, {
      projectId: TARGET,
      draftId: draft.id,
      assignedToUserId: REVIEWER,
      invocation: createUserInvocation(auth),
      requestId: "init902-dts-value-submit",
      refusalSink,
    });
    const applied = await reviewCanonicalValueChange(db, reviewerAuth, {
      projectId: TARGET,
      requestId: request.id,
      decision: "approve",
    }, {
      objectStore: storage,
      snapshot: catalogSnapshot,
      invocation: createUserInvocation(reviewerAuth),
      traceId: "init902-dts-value-approve",
      refusalSink,
    });
    expect(applied.status).toBe("approved");
    const sourceAfter = await exportCanonicalBindingSource(db, storage, auth, {
      projectId: SOURCE,
      bindingId: selected.sourceBindingId,
    });
    const targetAfter = await exportCanonicalBindingSource(db, storage, auth, {
      projectId: TARGET,
      bindingId: targetBindings[0]!.id,
    });
    expect(sourceAfter).toEqual(sourceBefore);
    expect(targetAfter?.files.some((file) => file.content.includes("<77>"))).toBe(true);
    expect(targetAfter?.files).not.toEqual(targetBefore?.files);
  }, 60_000);

  async function createPendingReview(projectId: string, requestId: string) {
    const candidates = await listSourceBindingCandidates(db, {
      organizationId: ORG,
      projectIds: [SOURCE],
    });
    const selected = candidates[0]!;
    const snapshots = await previewSnapshot(db, auth, {
      projectId,
      primarySourceProjectId: SOURCE,
      supplementSourceProjectIds: [],
      selectedSourceBindingIds: [selected.sourceBindingId],
      selectedModuleIds: [],
      selectedRisks: [],
    });
    const draft = await upsertDraft(db, auth, {
      projectId,
      projectName: projectId,
      projectCode: projectId.toUpperCase(),
      ownerUserId: USER,
      sourceProjectIds: [SOURCE],
      primarySourceProjectId: SOURCE,
      supplementSourceProjectIds: [],
      selectedModuleIds: [],
      selectedRisks: [],
      selectedSourceBindingIds: [selected.sourceBindingId],
      bindingSnapshots: snapshots,
      emptyLibrary: false,
      notes: "canonical initialization boundary",
    }, { requestId: `${requestId}:draft` });
    const review = await submitDraft(db, auth, { projectId }, { requestId: `${requestId}:submit` });
    return { selected, snapshots, draft, review };
  }

  async function approvalContext(requestId: string, objectStore: ObjectStore) {
    const catalogSnapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
    if (!catalogSnapshot) throw new Error("Published Catalog fixture is unavailable");
    return {
      requestId,
      invocation: createUserInvocation(auth),
      refusalSink: createTrustedRefusalAuditSink(db),
      objectStore,
      catalogSnapshot,
    };
  }

  it("cleans objects and rolls back the target when a later source object write fails", async () => {
    const pending = await createPendingReview(FAILURE_TARGET, "init902-dts-object-failure");
    const createdStorageKeys: string[] = [];
    let putCount = 0;
    const failingStore: ObjectStore = {
      ...storage,
      async put(input) {
        putCount += 1;
        if (putCount === 2) throw new Error("injected second initialization object failure");
        const stored = await storage.put(input);
        createdStorageKeys.push(stored.storageKey);
        return stored;
      },
    };

    await expect(approveReview(
      db,
      auth,
      { reviewId: pending.review.id },
      await approvalContext("init902-dts-object-failure-attempt", failingStore),
    )).rejects.toThrow("injected second initialization object failure");
    expect(putCount).toBe(2);
    expect(createdStorageKeys).toHaveLength(1);
    await expect(storage.get(createdStorageKeys[0]!)).rejects.toThrow();
    const afterFailure = await db.query<{ config_sets: number; files: number; bindings: number }>(
      `select
         (select count(*)::int from dts_config_set where organization_id=$1 and project_id=$2) as config_sets,
         (select count(*)::int from project_parameter_files where organization_id=$1 and project_id=$2) as files,
         (select count(*)::int from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2) as bindings`,
      [ORG, FAILURE_TARGET],
    );
    expect(afterFailure.rows[0]).toEqual({ config_sets: 0, files: 0, bindings: 0 });

    const approved = await approveReview(
      db,
      auth,
      { reviewId: pending.review.id },
      await approvalContext("init902-dts-object-failure-retry", storage),
    );
    expect(approved.status).toBe("approved");
    const afterRetry = await db.query<{ config_sets: number; files: number; bindings: number }>(
      `select
         (select count(*)::int from dts_config_set where organization_id=$1 and project_id=$2) as config_sets,
         (select count(*)::int from project_parameter_files where organization_id=$1 and project_id=$2) as files,
         (select count(*)::int from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2) as bindings`,
      [ORG, FAILURE_TARGET],
    );
    expect(afterRetry.rows[0]).toEqual({ config_sets: 1, files: 2, bindings: 1 });
  }, 60_000);

  it("rejects current source file and membership drift while the canonical Binding pin is unchanged", async () => {
    const pending = await createPendingReview(DRIFT_TARGET, "init902-dts-source-drift");
    const sourceValueBefore = (await db.query<{ current_value_id: string }>(
      `select current_value_id
         from parameter_catalog.current_project_parameter_bindings
        where organization_id=$1 and project_id=$2 and id=$3`,
      [ORG, SOURCE, pending.selected.sourceBindingId],
    )).rows[0]?.current_value_id;
    expect(sourceValueBefore).toBe(pending.selected.sourceProjectValueId);

    const sourceFile = (await db.query<{ id: string; current_version_id: string | null }>(
      `select id,current_version_id
         from project_parameter_files
        where organization_id=$1 and project_id=$2 and config_set_id=$3
        order by config_set_sort_order,id
        limit 1`,
      [ORG, SOURCE, pending.selected.sourceConfigSetId],
    )).rows[0];
    if (!sourceFile) throw new Error("DTS source fixture file is missing");
    expect(canonicalSourceMemberMatchesCurrentFile(
      {
        fileId: sourceFile.id,
        fileVersionId: sourceFile.current_version_id ?? "source-version",
        role: "include",
        sortOrder: 1,
        format: "dts",
      },
      {
        id: sourceFile.id,
        current_version_id: sourceFile.current_version_id,
        config_set_role: "thermal",
        config_set_sort_order: 1,
        format: "dts",
      },
    )).toBe(false);
    // current_version_id is intentionally changed to model a concurrent file-tip
    // drift; the pinned revision/value identity itself remains untouched.
    await db.query(
      `update project_parameter_files set current_version_id=null where organization_id=$1 and id=$2`,
      [ORG, sourceFile.id],
    );

    await expect(approveReview(
      db,
      auth,
      { reviewId: pending.review.id },
      await approvalContext("init902-dts-source-tip-drift", storage),
    )).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await db.query<{ count: number }>(
      `select count(*)::int as count from project_parameter_files where organization_id=$1 and project_id=$2`,
      [ORG, DRIFT_TARGET],
    )).rows[0]!.count).toBe(0);

    // Restore the pinned file tip, then exercise the separate phantom-member
    // branch against the same still-pending review.
    await db.query(
      `update project_parameter_files set current_version_id=$1 where organization_id=$2 and id=$3`,
      [sourceFile.current_version_id, ORG, sourceFile.id],
    );
    const phantom = await insertProjectParameterFile(db, {
      id: randomUUID(),
      organizationId: ORG,
      projectId: SOURCE,
      fileName: "drift-phantom.dtsi",
      format: "dts",
      enabled: true,
    });
    await db.query(
      `update project_parameter_files
          set config_set_id=$1, config_set_role='thermal', config_set_sort_order=99
        where organization_id=$2 and id=$3`,
      [pending.selected.sourceConfigSetId, ORG, phantom.id],
    );

    await expect(approveReview(
      db,
      auth,
      { reviewId: pending.review.id },
      await approvalContext("init902-dts-source-drift-approve", storage),
    )).rejects.toMatchObject({ code: "CONFLICT" });
    const afterRefusal = await db.query<{ config_sets: number; files: number; bindings: number; current_value_id: string }>(
      `select
         (select count(*)::int from dts_config_set where organization_id=$1 and project_id=$2) as config_sets,
         (select count(*)::int from project_parameter_files where organization_id=$1 and project_id=$2) as files,
         (select count(*)::int from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$2) as bindings,
         (select current_value_id from parameter_catalog.current_project_parameter_bindings where organization_id=$1 and project_id=$3 and id=$4) as current_value_id`,
      [ORG, DRIFT_TARGET, SOURCE, pending.selected.sourceBindingId],
    );
    expect(afterRefusal.rows[0]).toMatchObject({ config_sets: 0, files: 0, bindings: 0, current_value_id: sourceValueBefore });
  }, 60_000);
});
