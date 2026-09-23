import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRouter } from "../../../shared/http/router";
import { createHttpServer } from "../../../shared/http/server";
import { requestJson } from "../../../test/testClient";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../../testing/testDatabase";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";
import { makeTestAuthContext } from "../../../testing/authContext";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { addConfigSetFile, createConfigSet } from "../../parameter-files/configSetService";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { loadCanonicalSourceSnapshot } from "../../parameter-files/canonicalSource";
import { createCandidate } from "../../parameter-files/candidateService";
import { previewCanonicalCandidate, submitCanonicalCandidate } from "../../parameter-files/canonicalFileWorkflow";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { createLocalObjectStore, type ObjectStore } from "../../logs/objectStore";
import { loadPublishedCatalog } from "../catalogProjectValueSync";
import { registerCatalogProjectValueConsumerRoutes } from "../catalogProjectValueRoutes";

const ORG = "org-906-non-agent";
const PROJECT = "project-906-non-agent";
const USER = "user-906-non-agent";
const REVIEWER = "reviewer-906-non-agent";
const SUBJECT = "csub_906_non_agent";
const MODEL = "wiseeff.906.non-agent";
const DEFINITION = "pdef_acme_power_iin_max";
const SOURCE = '{ "a/b":{"":{"limit":36.5,"enabled":false}}, "untouched":[1,2] }\n';

describe("non-Agent canonical source attempt transactions", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let storageDirectory: string;
  let storage: ReturnType<typeof createLocalObjectStore>;
  let auth: ReturnType<typeof makeTestAuthContext>;
  let bindingId: string;
  let baseRevisionId: string;
  let fileId: string;
  let fileVersionId: string;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("t906nonagent");
    db = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(db)!;
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-906-non-agent-"));
    storage = createLocalObjectStore(storageDirectory);
    auth = makeTestAuthContext({
      userId: USER,
      organizationId: ORG,
      name: "Non-Agent admin",
      email: "non-agent@example.com",
      organizationName: "Non-Agent org",
      permissions: ["parameter:view", "parameter:edit", "admin:access"],
    });

    await db.query(`insert into organizations(id,name) values ($1,'Non-Agent org')`, [ORG]);
    await db.query(
      `insert into users(id,organization_id,name,email,title,is_active)
       values ($1,$2,'Non-Agent admin','non-agent@example.com','Admin',true)`,
      [USER, ORG],
    );
    await db.query(
      `insert into users(id,organization_id,name,title,is_active)
       values ($1,$2,'Non-Agent reviewer','Reviewer',true)`,
      [REVIEWER, ORG],
    );
    await db.query(
      `insert into projects(id,organization_id,name,code,status)
       values ($1,$2,'Non-Agent project','N906','initialized')`,
      [PROJECT, ORG],
    );
    await db.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ($1,$2,$3,null,'admin')`,
      [`role-${USER}`, USER, ORG],
    );
    await db.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ($1,$2,$3,$4,'software-committer')`,
      [`role-${REVIEWER}`, REVIEWER, ORG, PROJECT],
    );
    await installConfigurationSourceFixture(db, auth, { subjectId: SUBJECT, schemaId: MODEL });
    const configSet = await createConfigSet(db, auth, { projectId: PROJECT, name: "Non-Agent source" });
    const uploaded = await uploadProjectParameterFile(db, storage, auth, {
      projectId: PROJECT,
      fileName: "settings.json",
      bytes: Buffer.from(SOURCE),
    });
    fileId = uploaded.file.id;
    fileVersionId = uploaded.version.id;
    await addConfigSetFile(db, auth, {
      configSetId: configSet.id,
      fileId: uploaded.file.id,
      role: "base",
      sortOrder: 0,
    });
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, auth, snapshot, {
      projectId: PROJECT,
      configSetId: configSet.id,
      fileId: uploaded.file.id,
      fileVersionId: uploaded.version.id,
      configurationSchemaId: MODEL,
      rootPointer: "/a~1b/",
      mappings: [{ definitionId: DEFINITION, pointer: "/a~1b//limit" }],
      invocation: createUserInvocation(auth),
      requestId: "t906-register",
      refusalSink: createTrustedRefusalAuditSink(db),
    }));
    bindingId = registered.bindings[0]!.id;
    const source = await loadCanonicalSourceSnapshot(db, storage, {
      organizationId: ORG,
      projectId: PROJECT,
      bindingId,
      projectValueId: registered.bindings[0]!.currentValueId,
    });
    baseRevisionId = source.manifest.configRevisionId;
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  const serverFor = (objectStore: ObjectStore) => {
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, {
      db,
      objectStore,
      getCurrentAuthContext: () => auth,
    });
    return createHttpServer(router);
  };

  it("cleans a user-draft candidate after PostgreSQL audit failure and confirmed rollback", async () => {
    const storageKeys: string[] = [];
    const observedStorage: ObjectStore = {
      ...storage,
      put: async (input) => {
        const stored = await storage.put(input);
        storageKeys.push(stored.storageKey);
        return stored;
      },
    };
    await pool.query(`create function public.t906_fail_user_draft_audit() returns trigger language plpgsql as $$
      begin
        if new.trace_id='t906-http-draft-failure' and new.action='value-drafted' then
          raise exception 't906 injected user-draft audit failure';
        end if;
        return new;
      end $$`);
    await pool.query(`create trigger t906_fail_user_draft_audit before insert on audit_events
      for each row execute function public.t906_fail_user_draft_audit()`);
    try {
      const response = await requestJson(serverFor(observedStorage), `/api/v2/projects/${PROJECT}/parameter-bindings/${bindingId}/drafts`, {
        method: "POST",
        headers: { "X-Request-Id": "t906-http-draft-failure" },
        body: JSON.stringify({
          baseRevisionId,
          sourceTarget: { format: "json", sourceText: "92.625" },
          reason: "rollback failure injection",
        }),
      });
      expect(response.status).toBe(500);
      expect(storageKeys).toHaveLength(1);
      await expect(storage.get(storageKeys[0]!)).rejects.toThrow();
      expect((await db.query(
        `select count(*)::int as count from project_parameter_file_candidates where organization_id=$1 and project_id=$2`,
        [ORG, PROJECT],
      )).rows[0]!.count).toBe(0);
      expect((await db.query(
        `select count(*)::int as count from project_parameter_value_drafts where organization_id=$1 and project_id=$2`,
        [ORG, PROJECT],
      )).rows[0]!.count).toBe(0);
    } finally {
      await pool.query(`drop trigger t906_fail_user_draft_audit on audit_events`);
      await pool.query(`drop function public.t906_fail_user_draft_audit()`);
    }
  });

  it("cleans direct candidate-submit objects after PostgreSQL audit failure", async () => {
    const candidate = await createCandidate(db, storage, auth, {
      projectId: PROJECT,
      fileId,
      fileName: "settings.json",
      bytes: Buffer.from(SOURCE.replace("36.5", "37.5")),
    });
    const preview = await previewCanonicalCandidate(db, storage, auth, {
      projectId: PROJECT,
      candidateId: candidate.id,
    });
    expect(preview.canSubmit).toBe(true);
    const storageKeys: string[] = [];
    const observedStorage: ObjectStore = {
      ...storage,
      put: async (input) => {
        const stored = await storage.put(input);
        storageKeys.push(stored.storageKey);
        return stored;
      },
    };
    await pool.query(`create function public.t906_fail_source_submit_audit() returns trigger language plpgsql as $$
      begin
        if new.trace_id='t906-direct-submit-failure' then
          raise exception 't906 injected source-submit audit failure';
        end if;
        return new;
      end $$`);
    await pool.query(`create trigger t906_fail_source_submit_audit before insert on audit_events
      for each row execute function public.t906_fail_source_submit_audit()`);
    try {
      await expect(submitCanonicalCandidate(db, observedStorage, auth, {
        projectId: PROJECT,
        candidateId: candidate.id,
        expectedCurrentVersionId: fileVersionId,
        expectedProofToken: preview.proofToken!,
        reason: "direct source-submit rollback injection",
        requestId: "t906-direct-submit-failure",
        refusalSink: createTrustedRefusalAuditSink(db),
      })).rejects.toThrow("t906 injected source-submit audit failure");
      expect(storageKeys).toHaveLength(1);
      await expect(storage.get(storageKeys[0]!)).rejects.toThrow();
      expect((await db.query(`select count(*)::int as count from project_parameter_value_drafts where organization_id=$1 and project_id=$2`, [ORG, PROJECT])).rows[0]!.count).toBe(0);
      expect((await db.query(`select count(*)::int as count from project_parameter_value_change_requests where organization_id=$1 and project_id=$2`, [ORG, PROJECT])).rows[0]!.count).toBe(0);
    } finally {
      await pool.query(`drop trigger t906_fail_source_submit_audit on audit_events`);
      await pool.query(`drop function public.t906_fail_source_submit_audit()`);
    }
  });

  it("cleans import-stage candidates after PostgreSQL audit failure and confirmed rollback", async () => {
    const storageKeys: string[] = [];
    const observedStorage: ObjectStore = {
      ...storage,
      put: async (input) => {
        const stored = await storage.put(input);
        storageKeys.push(stored.storageKey);
        return stored;
      },
    };
    const server = serverFor(observedStorage);
    const preview = await requestJson<{ item: { id: string; items: Array<{ id: string }> } }>(server, "/api/v1/parameter-import-batches", {
      method: "POST",
      headers: { "X-Request-Id": "t906-import-preview" },
      body: JSON.stringify({
        projectId: PROJECT,
        sourceName: "t906 rollback import",
        items: [{
          id: bindingId,
          name: "iin_max",
          module: "Configuration",
          risk: "Low",
          unit: "A",
          range: ">=0",
          configFormat: "JSON",
          currentValue: "92.625",
        }],
      }),
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    const batchId = preview.body.item.id;
    const selectedItemIds = preview.body.item.items.map((item) => item.id);
    const before = await db.query<{ status: string; candidate_count: number; draft_count: number }>(
      `select batch.status,
        (select count(*)::int from project_parameter_file_candidates where organization_id=$1 and project_id=$2) as candidate_count,
        (select count(*)::int from project_parameter_value_drafts where organization_id=$1 and project_id=$2) as draft_count
       from parameter_import_batches batch where batch.id=$3`,
      [ORG, PROJECT, batchId],
    );
    await pool.query(`create function public.t906_fail_import_audit() returns trigger language plpgsql as $$
      begin
        if new.trace_id='t906-http-import-failure' and new.action='stage' then
          raise exception 't906 injected import audit failure';
        end if;
        return new;
      end $$`);
    await pool.query(`create trigger t906_fail_import_audit before insert on audit_events
      for each row execute function public.t906_fail_import_audit()`);
    try {
      const staged = await requestJson(server, `/api/v1/parameter-import-batches/${batchId}/apply`, {
        method: "POST",
        headers: { "X-Request-Id": "t906-http-import-failure" },
        body: JSON.stringify({ selectedItemIds }),
      });
      expect(staged.status).toBe(500);
      expect(storageKeys).toHaveLength(1);
      await expect(storage.get(storageKeys[0]!)).rejects.toThrow();
      const after = await db.query<{ status: string; candidate_count: number; draft_count: number }>(
        `select batch.status,
          (select count(*)::int from project_parameter_file_candidates where organization_id=$1 and project_id=$2) as candidate_count,
          (select count(*)::int from project_parameter_value_drafts where organization_id=$1 and project_id=$2) as draft_count
         from parameter_import_batches batch where batch.id=$3`,
        [ORG, PROJECT, batchId],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    } finally {
      await pool.query(`drop trigger t906_fail_import_audit on audit_events`);
      await pool.query(`drop function public.t906_fail_import_audit()`);
      await db.query(`delete from parameter_import_batches where id=$1`, [batchId]);
    }
  });
});
