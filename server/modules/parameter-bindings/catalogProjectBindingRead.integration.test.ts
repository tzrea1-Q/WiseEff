/**
 * Issue #849 C4 — real PostgreSQL chronology for the canonical binding read.
 *
 * Source files and their topology revision exist before Catalog publication;
 * publication alone still has no project values. Only the existing source
 * sync owner materializes canonical rows, and the consumer route reads those
 * rows without synchronizing or falling back to legacy topology bindings.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import type { CatalogReleaseBundle } from "../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogSubjectId } from "../parameter-catalog-contract/index";
import type { RegisterSubjectCommand } from "../parameter-governance/registration/command";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createEphemeralTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase
} from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { getLatestConfigRevision } from "../parameter-topology/repository";
import { listCatalogBindingRowsForProject } from "./catalogProjectValueSync";
import { firstReleaseBundle } from "../../testing/parameterCatalog/cutoverPopulatedFixture";
import { registerCatalogProjectValueConsumerRoutes } from "./catalogProjectValueRoutes";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error("canonical binding read requires a reachable real PostgreSQL server; skipping is forbidden");
}

const ORG = "org-849-binding-read";
const FOREIGN_ORG = "org-849-binding-read-foreign";
const PROJECT = "project-849-binding-read";
const FOREIGN_PROJECT = "project-849-binding-read-foreign";
const MISSING_PROJECT = "project-849-binding-read-missing";
const USER = "user-849-binding-read";
const ATTR = "attr-849-binding-read";
const MODULE = "pmod-849-binding-read";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const RESIDUAL_SPEC = "spec-849-binding-read-residual";
const RESIDUAL_BINDING = "binding-849-binding-read-residual";
const DTS = `/dts-v1/;
/ {
	charger {
		compatible = "acme,power";
		iin_max = <1000>;
	};
};
`;

function compileOrThrow(bundle: CatalogReleaseBundle) {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(`fixture failed to compile: ${compiled.error.kind} ${JSON.stringify(compiled.error.violations)}`);
  }
  return compiled.value;
}

describe("canonical project binding read chronology", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let storageDirectory: string;
  let objectStore: ReturnType<typeof createLocalObjectStore>;
  let configSetId: string;
  let revisionId: string;
  let canonicalBindingId: string;

  const admin = makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Canonical read admin",
    email: "canonical-read@example.com",
    organizationName: "Canonical read org",
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"]
  });
  const projectReader = makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Canonical project reader",
    email: "canonical-read@example.com",
    organizationName: "Canonical read org",
    roles: [{ projectId: PROJECT, roleId: "hardware-user" }],
    permissions: ["parameter:view"]
  });
  const wrongProjectReader = makeTestAuthContext({
    userId: "user-849-binding-read-scoped",
    organizationId: ORG,
    name: "Wrong project reader",
    email: "wrong-project@example.com",
    organizationName: "Canonical read org",
    roles: [{ projectId: "project-849-binding-read-other", roleId: "hardware-user" }],
    permissions: ["parameter:view"]
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
    proof: { reason: "issue-849-canonical-binding-read" },
    idempotencyKey: `reg:${ORG}:${PROJECT}`,
    context: { actorKind: "org-admin", principalId: USER }
  });

  const makeServer = (auth: typeof projectReader) => {
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, {
      db: root,
      objectStore,
      getCurrentAuthContext: () => auth
    });
    return createHttpServer(router);
  };

  const read = (auth: typeof projectReader, projectId: string) =>
    requestJson<{ items: Array<{ id: string; projectId: string }> }>(
      makeServer(auth),
      `/api/v2/projects/${projectId}/parameter-bindings`
    );

  const state = async () => {
    const pool = getRootPostgresPool(root)!;
    const result = await pool.query<{
      canonical_bindings: string;
      canonical_values: string;
      canonical_pins: string;
      legacy_bindings: string;
      revisions: string;
      audits: string;
    }>(
      `select
         (select count(*)::text from parameter_catalog.project_parameter_bindings where project_id = $1) as canonical_bindings,
         (select count(*)::text
            from parameter_catalog.project_parameter_values value
            join parameter_catalog.project_parameter_bindings binding on binding.id = value.binding_id
           where binding.project_id = $1) as canonical_values,
         (select count(*)::text
            from parameter_catalog.project_value_source_pins pin
            join parameter_catalog.project_parameter_bindings binding on binding.id = pin.binding_id
           where binding.project_id = $1) as canonical_pins,
         (select count(*)::text from public.project_parameter_bindings where project_id = $1) as legacy_bindings,
         (select count(*)::text from dts_config_revisions where project_id = $1) as revisions,
         (select count(*)::text from audit_events where organization_id = $2) as audits`,
      [PROJECT, ORG]
    );
    return result.rows[0]!;
  };

  const canonicalIdentity = async (db: RootDatabase) => {
    const pool = getRootPostgresPool(db)!;
    const result = await pool.query<{
      binding_id: string;
      current_value_id: string;
      value: unknown;
      config_revision_id: string;
      pin_id: string;
      file_id: string;
      file_version_id: string;
      pin_config_revision_id: string;
    }>(
      `select binding.id as binding_id,
              binding.current_value_id,
              value.value,
              value.config_revision_id,
              pin.id as pin_id,
              pin.file_id,
              pin.file_version_id,
              pin.config_revision_id as pin_config_revision_id
         from parameter_catalog.current_project_parameter_bindings binding
         join parameter_catalog.project_parameter_values value
           on value.id = binding.current_value_id
          and value.binding_id = binding.id
         join parameter_catalog.project_value_source_pins pin
           on pin.project_value_id = value.id
          and pin.binding_id = binding.id
        where binding.organization_id = $1
          and binding.project_id = $2
        order by binding.id, pin.id
        limit 1`,
      [ORG, PROJECT]
    );
    return result.rows[0] ?? null;
  };

  const sourceState = async (db: RootDatabase) => {
    const pool = getRootPostgresPool(db)!;
    const result = await pool.query<{
      file_count: string;
      version_count: string;
      current_version_id: string | null;
      revision_count: string;
      latest_revision_id: string | null;
      latest_revision_status: string | null;
    }>(
      `select
         (select count(*)::text from project_parameter_files
           where organization_id = $1 and project_id = $2 and file_name = 'charger.dts') as file_count,
         (select count(*)::text
            from project_parameter_file_versions version
            join project_parameter_files file on file.id = version.file_id
           where file.organization_id = $1 and file.project_id = $2 and file.file_name = 'charger.dts') as version_count,
         (select current_version_id from project_parameter_files
           where organization_id = $1 and project_id = $2 and file_name = 'charger.dts'
           order by id limit 1) as current_version_id,
         (select count(*)::text from dts_config_revisions
           where organization_id = $1 and project_id = $2 and config_set_id = $3) as revision_count,
         (select id from dts_config_revisions
           where organization_id = $1 and project_id = $2 and config_set_id = $3
           order by revision_number desc, id desc limit 1) as latest_revision_id,
         (select status from dts_config_revisions
           where organization_id = $1 and project_id = $2 and config_set_id = $3
           order by revision_number desc, id desc limit 1) as latest_revision_status`,
      [ORG, PROJECT, configSetId]
    );
    return result.rows[0]!;
  };

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("catalogbindingread");
    root = createPostgresDatabase(database.url);
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-849-binding-read-"));
    objectStore = createLocalObjectStore(storageDirectory);
    const pool = getRootPostgresPool(root)!;

    await pool.query(`insert into organizations(id,name) values ($1,'Canonical read org'),($2,'Foreign org')`, [ORG, FOREIGN_ORG]);
    await pool.query(
      `insert into users(id,organization_id,name,email,title,is_active)
       values ($1,$2,'Canonical read admin','canonical-read@example.com','Admin',true)`,
      [USER, ORG]
    );
    await pool.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ('urb-849-binding-read-admin',$1,$2,null,'admin')`,
      [USER, ORG]
    );
    await pool.query(
      `insert into projects(id,organization_id,name,code,status)
       values ($1,$2,'Canonical read project','C849R','initialized'),
              ($3,$4,'Foreign project','F849R','initialized')`,
      [PROJECT, ORG, FOREIGN_PROJECT, FOREIGN_ORG]
    );
    await pool.query(
      `insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
       values ($1,$2,'driver-registration','Acme power','compatible:acme,power')`,
      [ATTR, ORG]
    );
    await pool.query(
      `insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
       values ($1,'physical-device','multiple')`,
      [ATTR]
    );
    await pool.query(
      `insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
       values ($1,$2,'Driver',$1,1,'driver-group','curated',$3)`,
      [MODULE, ORG, ATTR]
    );

    // Source-first chronology: create the config set and upload the source
    // before the Catalog release is installed.
    const configSet = await createConfigSet(root, admin, {
      projectId: PROJECT,
      name: "default",
      description: "canonical read chronology"
    }, { requestId: "req-849-binding-read-config-set" });
    configSetId = configSet.id;
    const firstUpload = await uploadProjectParameterFile(root, objectStore, admin, {
      projectId: PROJECT,
      fileName: "charger.dts",
      bytes: Buffer.from(DTS)
    }, { requestId: "req-849-binding-read-upload-1" });
    await addConfigSetFile(root, admin, {
      configSetId,
      fileId: firstUpload.file.id,
      role: "base",
      sortOrder: 0
    }, { requestId: "req-849-binding-read-member" });
    // Keep a genuine legacy topology row present so a route fallback would be
    // visible in the response after canonical materialization.
    await pool.query(
      `insert into parameter_specs(id,organization_id,source_kind,specification_key)
       values ($1,$2,'manual','legacy/iin_max')`,
      [RESIDUAL_SPEC, ORG]
    );
    await pool.query(
      `insert into public.project_parameter_bindings(id,organization_id,project_id,logical_node_id,parameter_spec_id,module_id)
       values ($1,$2,$3,null,$4,$5)`,
      [RESIDUAL_BINDING, ORG, PROJECT, RESIDUAL_SPEC, MODULE]
    );
  }, 60_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("follows unpublished → published empty → source-sync materialization without read-time writes", async () => {
    const beforeUnpublished = await state();
    const unpublished = await read(projectReader, PROJECT);
    expect(unpublished.status).toBe(200);
    expect(unpublished.body.items).toEqual([]);
    expect((await read(projectReader, MISSING_PROJECT)).status).toBe(404);
    expect((await read(projectReader, FOREIGN_PROJECT)).status).toBe(404);
    expect((await read(wrongProjectReader, PROJECT)).status).toBe(403);
    expect(await state()).toEqual(beforeUnpublished);

    const first = compileOrThrow(firstReleaseBundle());
    const pool = getRootPostgresPool(root)!;
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest
    });
    expect(installed.ok).toBe(true);

    const beforePublishedEmpty = await state();
    const publishedEmpty = await read(projectReader, PROJECT);
    expect(publishedEmpty.status).toBe(200);
    expect(publishedEmpty.body.items).toEqual([]);
    expect(await state()).toEqual(beforePublishedEmpty);

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set constraints all deferred");
    const written = await writeGuardedRegistration(client, registerCommand({ id: first.release.id, digest: first.release.digest }));
      if (!written.ok) throw new Error(`registration failed: ${written.error.kind}`);
      await client.query("set constraints all immediate");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    // The registered production upload route owns revision creation and then
    // invokes the existing published source-sync owner. This is deliberately
    // after publication and registration to prove the source-first chronology.
    const uploaded = await requestJson(
      makeServer(admin),
      `/api/v1/projects/${PROJECT}/parameter-files`,
      {
        method: "POST",
        body: JSON.stringify({
          fileName: "charger.dts",
          contentBase64: Buffer.from(DTS).toString("base64")
        })
      }
    );
    expect(uploaded.status).toBe(201);
    const revision = await getLatestConfigRevision(pool, {
      organizationId: ORG,
      projectId: PROJECT,
      configSetId
    });
    if (!revision || revision.status !== "resolved") {
      throw new Error("source-first HTTP upload did not produce a resolved config revision");
    }
    revisionId = revision.id;

    const canonicalRows = await listCatalogBindingRowsForProject(root, projectReader, { projectId: PROJECT });
    expect(canonicalRows).toHaveLength(1);
    canonicalBindingId = canonicalRows[0]!.id;
    expect(canonicalBindingId).not.toBe(RESIDUAL_BINDING);

    const beforeMaterializedRead = await state();
    const materialized = await read(projectReader, PROJECT);
    expect(materialized.status).toBe(200);
    expect(materialized.body.items).toEqual([
      expect.objectContaining({ id: canonicalBindingId, projectId: PROJECT })
    ]);
    expect(materialized.body.items.map((item) => item.id)).not.toContain(RESIDUAL_BINDING);
    expect(await state()).toEqual(beforeMaterializedRead);

    const identityBeforeReplay = await canonicalIdentity(root);
    expect(identityBeforeReplay).toEqual(expect.objectContaining({
      binding_id: canonicalBindingId,
      value: 1000,
      config_revision_id: revisionId,
      pin_config_revision_id: revisionId
    }));
    const sourceBeforeReplay = await sourceState(root);
    const replayUpload = await requestJson<{ error: { code: string } }>(
      makeServer(admin),
      `/api/v1/projects/${PROJECT}/parameter-files`,
      {
        method: "POST",
        headers: { "X-Request-Id": "req-849-binding-read-replay" },
        body: JSON.stringify({
          fileName: "charger.dts",
          contentBase64: Buffer.from(DTS).toString("base64")
        })
      }
    );
    expect(replayUpload.status).toBe(409);
    expect(replayUpload.body.error.code).toBe("CONFLICT");
    expect(await sourceState(root)).toEqual(sourceBeforeReplay);
    expect(await canonicalIdentity(root)).toEqual(identityBeforeReplay);
    const repeatedRead = await read(projectReader, PROJECT);
    expect(repeatedRead.status).toBe(200);
    expect(repeatedRead.body.items).toEqual(materialized.body.items);
    const reopened = createPostgresDatabase(database.url);
    try {
      expect(await canonicalIdentity(reopened)).toEqual(identityBeforeReplay);
    } finally {
      await reopened.close();
    }

    for (const projectId of [MISSING_PROJECT, FOREIGN_PROJECT]) {
      expect((await read(projectReader, projectId)).status).toBe(404);
    }
    expect((await read(wrongProjectReader, PROJECT)).status).toBe(403);
  });

  it("keeps missing, foreign and wrong-scope errors after publication", async () => {
    expect((await read(projectReader, MISSING_PROJECT)).status).toBe(404);
    expect((await read(projectReader, FOREIGN_PROJECT)).status).toBe(404);
    expect((await read(wrongProjectReader, PROJECT)).status).toBe(403);
    expect((await read(projectReader, PROJECT)).status).toBe(200);
  });
});
