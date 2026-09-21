import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogSubjectId } from "../parameter-catalog-contract/index";
import type { RegisterSubjectCommand } from "../parameter-governance/registration/command";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { createAgentInvocation, createUserInvocation } from "../auth/trustedInvocation";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { withTempDatabase } from "../../testing/tempDatabase";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerCatalogProjectValueConsumerRoutes } from "./catalogProjectValueRoutes";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../shared/database/client";
import { asAuditTx, withAuditedWrite } from "../audit/auditedWrite";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { createImportPreview } from "../parameters/service";
import {
  asValueClient,
  loadPublishedCatalog,
  importTextToDtsValue,
  listCatalogBindingRowsForProject,
  listCatalogBindingsForImport,
  saveCanonicalProjectValue,
  syncPublishedCatalogProjectValues,
  syncPublishedCatalogProjectValuesInTransaction,
} from "./catalogProjectValueSync";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { createLocalObjectStore } from "../logs/objectStore";
import { exportCanonicalBindingSource } from "./catalogProjectValueSync";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { preparePinnedSourceChange } from "../parameter-files/canonicalSource";
import { commitCanonicalSourceRevision } from "../parameter-files/canonicalSourceCommit";
import { catalogBindingExportDtoSchema } from "../contracts/dtoSchemas/parameterCatalog";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "catalog project-value sync requires a reachable real PostgreSQL server; skipping is forbidden",
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
    "catalog project-value sync requires pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const ORG = "org-min-upg-val";
const PROJECT = "project-min-upg-val";
const USER = "user-min-upg-val";
const ATTR = "attr-min-upg-val";
const MODULE = "pmod-min-upg-val";
const CONFIG_SET = "dcs-min-upg-val";
const SUBJECT_ID = CatalogSubjectId("csub_acme_power");
const DTS = `/dts-v1/;
/ {
\tcharger {
\t\tiin_max = <999>;
\t};
};
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
    releases: [first],
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

describe("published catalog project values", () => {
  let database: EphemeralTestDatabase;
  let root: RootDatabase;
  let pool: pg.Pool;
  let registrationId: string;
  let storageDirectory: string;
  let objectStore: ReturnType<typeof createLocalObjectStore>;
  let refusalSink: ReturnType<typeof createTrustedRefusalAuditSink>;

  const auth = makeTestAuthContext({
    userId: USER,
    organizationId: ORG,
    name: "Minimal upgrade admin",
    email: "min-upg@example.com",
    organizationName: "Minimal upgrade org",
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  });

  const registerCommand = (expectedRelease: {
    id: string;
    digest: string;
  }): RegisterSubjectCommand => ({
    kind: "register",
    organizationId: ORG,
    subjectId: SUBJECT_ID,
    subjectKind: "driver",
    expectedRelease,
    placement: { mode: "use-default" },
    destinationModuleId: MODULE,
    method: "explicit",
    proof: { reason: "minimal-upgrade-published-definition" },
    idempotencyKey: `reg:${ORG}:${randomUUID()}`,
    context: { actorKind: "org-admin", principalId: USER },
  });

  beforeAll(async () => {
    storageDirectory = await mkdtemp(join(tmpdir(), "wiseeff-t11-source-"));
    objectStore = createLocalObjectStore(storageDirectory);
    await objectStore.put({ organizationId: ORG, fileName: "charger.dts", contentType: "text/plain", bytes: Buffer.from(DTS) });
    database = await createEphemeralTestDatabase("upgval");
    root = createPostgresDatabase(database.url);
    refusalSink = createTrustedRefusalAuditSink(root);
    pool = getRootPostgresPool(root)!;
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);

    await pool.query(`insert into public.organizations (id, name) values ($1, 'Minimal upgrade')`, [ORG]);
    await pool.query(
      `insert into public.users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Minimal upgrade admin', 'min-upg@example.com', 'Admin', true)`,
      [USER, ORG],
    );
    await pool.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ('t11-sync-admin-role',$1,$2,null,'admin')`,
      [USER, ORG],
    );
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ($1, $2, 'Minimal upgrade', 'MINV', 'initialized')`,
      [PROJECT, ORG],
    );
    await pool.query(
      `insert into public.attribution_subjects (
         id, organization_id, subject_kind, display_name, source_key
       ) values ($1, $2, 'driver-registration', 'Acme power', 'compatible:acme,power')`,
      [ATTR, ORG],
    );
    await pool.query(
      `insert into public.driver_registrations (
         attribution_subject_id, driver_nature, instance_cardinality
       ) values ($1, 'physical-device', 'multiple')`,
      [ATTR],
    );
    await pool.query(
      `insert into public.parameter_modules (
         id, organization_id, name, path, depth, kind, origin, attribution_subject_id
       ) values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`,
      [MODULE, ORG, ATTR],
    );
    await pool.query(
      `insert into dts_config_set (id, organization_id, project_id, name, description)
       values ($1, $2, $3, 'default', 'minimal catalog values')`,
      [CONFIG_SET, ORG, PROJECT],
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
      registrationId = written.value.registrationId;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    expect(registrationId.length).toBeGreaterThan(0);
  }, 60_000);

  afterAll(async () => {
    await root?.close();
    await database?.drop();
    if (storageDirectory) await rm(storageDirectory, { recursive: true, force: true });
  });

  it("returns zero for an empty Catalog without starving a single-connection pool", async () => {
    await withTempDatabase({ prefix: "sync_one_connection" },async ({ connectionString }) => {
      const single = new pg.Pool({ connectionString,max: 1,connectionTimeoutMillis: 2_000 });
      try {
        expect(await loadPublishedCatalog(single)).toBeNull();
        expect(await syncPublishedCatalogProjectValues(single,{
          organizationId: ORG,projectId: PROJECT,configSetId: CONFIG_SET,configRevisionId: "empty-catalog",
        })).toBe(0);
        expect(single.waitingCount).toBe(0);
        expect(single.idleCount).toBe(single.totalCount);
        expect((await single.query("select 1 as healthy")).rows).toEqual([{ healthy: 1 }]);
      } finally { await single.end(); }
    });
  });

  it("materializes an exactly pinned published value and refuses value-only saves", async () => {
    const fileId = randomUUID();
    const versionId = randomUUID();
    const checksum = createHash("sha256").update(DTS, "utf8").digest("hex");
    await pool.query(
      `insert into project_parameter_files (
         id, organization_id, project_id, file_name, format, enabled,
         config_set_id, config_set_role, config_set_sort_order
       ) values ($1, $2, $3, 'charger.dts', 'dts', true, $4, 'base', 0)`,
      [fileId, ORG, PROJECT, CONFIG_SET],
    );
    await pool.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
       ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)`,
      [versionId, fileId, `${ORG}/${checksum}-charger.dts`, checksum, Buffer.byteLength(DTS, "utf8"), USER],
    );
    await pool.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      versionId,
      fileId,
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
          content: DTS,
        },
      ],
    };

    const revision = await ingestConfigRevision(root, manifest, auth);
    expect(revision.status).toBe("resolved");
    const syncSnapshot = await loadPublishedCatalog(pool);
    if (!syncSnapshot) throw new Error("Published fixture is unavailable");
    const written = await withAuditedWrite(root, auth, { requestId: "req-min-upg-sync" }, async (tx) => {
      const count = await syncPublishedCatalogProjectValuesInTransaction(
        asValueClient(tx),syncSnapshot,
        {
          organizationId: ORG,
          projectId: PROJECT,
          configSetId: CONFIG_SET,
          configRevisionId: revision.id,
        },
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
          metadata: { written: count, configRevisionId: revision.id },
        },
      };
    });
    expect(written).toBe(1);

    const specs = await pool.query<{ c: string }>(
      `select count(*)::text as c
         from parameter_specs ps
         left join dts_property_specs dps on dps.parameter_spec_id = ps.id
        where coalesce(ps.property_key, dps.property_key) = 'iin_max'`,
    );
    expect(Number(specs.rows[0]?.c ?? 1)).toBe(0);

    const values = await pool.query<{ value: unknown; source_ref: string; config_revision_id: string }>(
      `select v.value, v.source_ref, v.config_revision_id
         from parameter_catalog.project_parameter_bindings b
         join parameter_catalog.project_parameter_values v on v.id = b.current_value_id
        where b.organization_id = $1 and b.project_id = $2`,
      [ORG, PROJECT],
    );
    expect(values.rows).toHaveLength(1);
    // The value records the real `.dts` source it came from, not the opaque
    // config-set write, so identity correction and property-key cutover see a
    // rewriteable source location.
    expect(values.rows[0]?.source_ref).toBe("charger.dts!/charger");
    expect(values.rows[0]?.config_revision_id).toBe(revision.id);
    expect(values.rows[0]?.value).toEqual(1000);
    const pins = await pool.query(
      `select pin.file_id, pin.file_version_id, pin.config_revision_id, pin.locator,
              occurrence.logical_node_id
       from parameter_catalog.project_value_source_pins pin
       join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=pin.source_occurrence_id
       where pin.organization_id=$1 and pin.project_id=$2`, [ORG, PROJECT],
    );
    expect(pins.rows).toEqual([expect.objectContaining({
      file_id: fileId, file_version_id: versionId, config_revision_id: revision.id,
      locator: expect.objectContaining({ kind: "dts-property", propertyName: "iin_max", fileVersionId: versionId }),
    })]);

    const syncAudits = await pool.query<{ action: string; target_id: string }>(
      `select action, target_id from audit_events where trace_id = $1`,
      ["req-min-upg-sync"],
    );
    expect(syncAudits.rows).toEqual([{ action: "binding-edited", target_id: revision.id }]);

    const listed = await listCatalogBindingRowsForProject(root, auth, {
      projectId: PROJECT,
      revisionId: revision.id,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.propertyKey).toBe("iin_max");
    expect(listed[0]?.rawValue).toBe("<1000>");
    expect(listed[0]?.parameterSpecId).toBe("pdef_acme_power_iin_max");
    const replayCounts = async () => (await pool.query(`select
      (select count(*) from parameter_catalog.project_parameter_values) as values,
      (select count(*) from parameter_catalog.binding_history_events) as histories,
      (select count(*) from parameter_catalog.project_value_source_pins) as pins`)).rows[0];
    const once = await replayCounts();
    expect(await syncPublishedCatalogProjectValues(pool, {
      organizationId: ORG,projectId: PROJECT,configSetId: CONFIG_SET,configRevisionId: revision.id,
    })).toBe(1);
    expect(await replayCounts()).toEqual(once);
    expect((await listCatalogBindingRowsForProject(root,auth,{ projectId: PROJECT }))[0]?.currentValueId).toBe(listed[0]?.currentValueId);
    const single = new pg.Pool({ connectionString: database.url,max: 1,connectionTimeoutMillis: 2_000 });
    try {
      const input = { organizationId: ORG,projectId: PROJECT,configSetId: CONFIG_SET,configRevisionId: revision.id };
      expect(await Promise.all(Array.from({ length: 4 },() => syncPublishedCatalogProjectValues(single,input)))).toEqual([1,1,1,1]);
      const pinned = await loadPublishedCatalog(single);
      if (!pinned) throw new Error("Published fixture is unavailable");
      const tx = await single.connect();
      try {
        await tx.query("begin");
        expect(await syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx),pinned,input)).toBe(1);
        await tx.query("rollback");
      } finally { tx.release(); }
      expect(single.waitingCount).toBe(0);
      expect(single.idleCount).toBe(1);
      expect(await replayCounts()).toEqual(once);
    } finally { await single.end(); }

    // The page reads this route with an org-wide business role after topology
    // loads. Exercise the real route and persisted binding, not a mocked list.
    const reader = makeTestAuthContext({ userId: USER, organizationId: ORG, roleId: "hardware-user" });
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, { db: root, getCurrentAuthContext: () => reader });
    const response = await requestJson<{ items: Array<{ id: string; propertyKey: string }> }>(
      createHttpServer(router),
      `/api/v2/projects/${PROJECT}/parameter-bindings?revisionId=${revision.id}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: listed[0]!.id, propertyKey: "iin_max" }),
    ]));

    await expect(withAuditedWrite(root, auth, { requestId: "req-min-upg-val" }, async (tx) => {
      const result = await saveCanonicalProjectValue(
        pool,
        {
          organizationId: ORG,
          projectId: PROJECT,
          bindingId: listed[0]!.id,
          configRevisionId: revision.id,
          targetValue: {
            kind: "cells",
            bits: 32,
            groups: [[{ kind: "integer", raw: "2000", value: "2000" }]],
          },
        },
        asValueClient(tx),
      );
      await writeTrustedGovernanceAudit(
        asAuditTx(tx),
        createUserInvocation(auth),
        {
          action: "binding-edited",
          organizationId: ORG,
          projectId: PROJECT,
          targetType: "project-parameter-binding",
          targetId: listed[0]!.id,
          metadata: { currentValueId: result.currentValueId },
        },
        "req-min-upg-val",
      );
      return { result, audit: null };
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "invalid-command" } });

    const audits = await pool.query<{ kind: string; action: string; target_id: string }>(
      `select kind, action, target_id
         from audit_events
        where target_id = $1
          and action = 'binding-edited'`,
      [listed[0]!.id],
    );
    expect(audits.rows).toEqual([]);

    const after = await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT });
    expect(after[0]?.rawValue).toBe("<1000>");

    const imported = await listCatalogBindingsForImport(root, {
      organizationId: ORG,
      projectId: PROJECT,
      names: ["iin_max"],
      definitionIds: [],
    });
    expect(imported).toHaveLength(1);
    expect(imported[0]?.currentValue).toBe("1000");
    await expect(saveCanonicalProjectValue(pool, {
      organizationId: ORG,
      projectId: PROJECT,
      bindingId: imported[0]!.projectParameterValueId,
      configRevisionId: revision.id,
      targetValue: importTextToDtsValue("iin_max", "3000"),
    })).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "invalid-command" } });
    const afterImport = await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT });
    expect(afterImport[0]?.rawValue).toBe("<1000>");
  }, 60_000);

  it("prepares a server-owned exact DTS candidate without advancing source or value tips", async () => {
    const binding = (await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT }))[0]!;
    const before = (await pool.query(`select current_version_id from project_parameter_files where project_id=$1 and file_name='charger.dts'`, [PROJECT])).rows[0]!;
    const prepared = await root.transaction((tx) => preparePinnedSourceChange(tx, objectStore, auth, {
      projectId: PROJECT, bindingId: binding.id, expectedValueId: binding.currentValueId,
      target: { format: "dts", sourceText: "<2000>" },
      invocation: createUserInvocation(auth), requestId: "t11-prepare-dts", refusalSink,
    }));
    const candidate = (await pool.query(`select storage_key,base_digest,proposed_digest,frozen_member_manifest from project_parameter_file_candidates where id=$1`, [prepared.candidateId])).rows[0]!;
    expect((await objectStore.get(candidate.storage_key)).toString()).toBe(DTS.replace("<1000>", "<2000>"));
    expect(candidate.base_digest).toBe(createHash("sha256").update(DTS).digest("hex"));
    expect(candidate.proposed_digest).toBe(prepared.proposedDigest);
    expect(candidate.frozen_member_manifest).toHaveLength(1);
    expect((await pool.query(`select current_version_id from project_parameter_files where project_id=$1 and file_name='charger.dts'`, [PROJECT])).rows[0]?.current_version_id).toBe(before.current_version_id);
    expect((await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT }))[0]?.currentValueId).toBe(binding.currentValueId);
  });

  it("refuses injected DTS, stale bases and unapproved Agent preparation without staging candidates", async () => {
    const binding = (await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT }))[0]!;
    const before = (await pool.query(`select count(*)::int as count from project_parameter_file_candidates where project_id=$1`, [PROJECT])).rows[0]!.count;
    const input = {
      projectId: PROJECT, bindingId: binding.id, expectedValueId: binding.currentValueId,
      target: { format: "dts" as const, sourceText: "<2000>" }, invocation: createUserInvocation(auth), requestId: "t11-prepare-negative", refusalSink,
    };
    const refusalBefore = (await pool.query<{ count: string }>(`select count(*)::text as count from audit_events where kind='parameter-source-user-required' and trace_id='t11-prepare-agent'`)).rows[0]!.count;
    for (const attempted of [
      { ...input, target: { format: "dts" as const, sourceText: '<2000>; injected = <3>' } },
      { ...input, expectedValueId: "nonexistent-value" },
      { ...input, requestId: "t11-prepare-agent", invocation: createAgentInvocation(auth, { sessionId: "session-t11", toolCallId: "tool-t11", approval: { required: true, approvalId: "approval-t11" } }) },
    ]) {
      await expect(root.transaction((tx) => preparePinnedSourceChange(tx, objectStore, auth, attempted))).rejects.toThrow();
    }
    expect((await pool.query<{ count: string }>(`select count(*)::text as count from audit_events where kind='parameter-source-user-required' and trace_id='t11-prepare-agent'`)).rows[0]!.count).toBe(String(Number(refusalBefore) + 1));
    expect((await pool.query(`select count(*)::int as count from project_parameter_file_candidates where project_id=$1`, [PROJECT])).rows[0]!.count).toBe(before);
  });

  it("refuses legacy upload activation on a canonical-backed source", async () => {
    const before = (await pool.query(`select id,current_version_id from project_parameter_files where project_id=$1 and file_name='charger.dts'`, [PROJECT])).rows[0]!;
    await expect(uploadProjectParameterFile(root, objectStore, auth, {
      projectId: PROJECT, fileName: "charger.dts", bytes: Buffer.from(DTS.replace("<1000>", "<7000>")),
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await pool.query(`select current_version_id from project_parameter_files where id=$1`, [before.id])).rows[0]?.current_version_id).toBe(before.current_version_id);
    expect((await pool.query(`select count(*)::int as count from project_parameter_file_versions where file_id=$1`, [before.id])).rows[0]?.count).toBe(1);
  });

  it("applies only the winning repeated DTS occurrence and resolves a fresh property pin for the same source identity", async () => {
    const binding = (await listCatalogBindingRowsForProject(root,auth,{ projectId: PROJECT }))[0]!;
    const prepared = await root.transaction((tx) => preparePinnedSourceChange(tx,objectStore,auth, {
      projectId: PROJECT,bindingId: binding.id,expectedValueId: binding.currentValueId,target: { format: "dts",sourceText: "<2000>" },
      invocation: createUserInvocation(auth),requestId: "t11-dts-apply-prepare",refusalSink,
    }));
    const requestId = randomUUID();
    await pool.query(`insert into project_parameter_value_change_requests
      (id,organization_id,project_id,binding_id,definition_id,definition_revision_id,catalog_release_id,
       base_current_value_id,config_revision_id,source_ref,action,target_value,reason,status,submitter_user_id,
       source_pin_id,candidate_id,candidate_base_digest,candidate_proposed_digest,candidate_diff_digest,candidate_member_manifest,candidate_binding_manifest)
      select $1,binding.organization_id,binding.project_id,binding.id,binding.definition_id,binding.effective_revision_id,binding.catalog_release_id,
       value.id,value.config_revision_id,value.source_ref,'set',$2::jsonb,'raise DTS limit','pending',$3,
       $4,$5,$6,$7,$8,$9::jsonb,$10::jsonb
      from parameter_catalog.project_parameter_bindings binding join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
      where binding.id=$11`, [requestId,JSON.stringify(importTextToDtsValue("iin_max","2000")),USER,prepared.sourcePinId,prepared.candidateId,prepared.baseDigest,
      prepared.proposedDigest,prepared.diffDigest,JSON.stringify(prepared.members),JSON.stringify(prepared.bindings),binding.id]);
    const reviewer = makeTestAuthContext({ userId: "reviewer-t11-dts",organizationId: ORG,permissions: ["parameter:view","parameter:edit","parameter:review"] });
    await pool.query(`insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Reviewer','Admin',true)`, [reviewer.user.id,ORG]);
    await pool.query(
      `insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
       values ('t11-sync-reviewer-role',$1,$2,$3,'software-committer')`,
      [reviewer.user.id, ORG, PROJECT],
    );
    const snapshot = await loadPublishedCatalog(pool);
    if (!snapshot) throw new Error("Published fixture is unavailable");
    // A newer external parse is not the approved request's continuity baseline.
    // It cannot materialize over already pinned current values without review.
    const baseRevisionId = (await pool.query(`select config_revision_id from parameter_catalog.project_value_source_pins where id=$1`, [prepared.sourcePinId])).rows[0]!.config_revision_id;
    const baseNodes = (await pool.query(`select logical_node_id from dts_logical_node_revisions where config_revision_id=$1 order by logical_node_id`, [baseRevisionId])).rows;
    const newer = await ingestConfigRevision(root, {
      organizationId: ORG,projectId: PROJECT,configSetId: CONFIG_SET,entryFile: "charger.dts",includeSearchPaths: ["."],overlayOrder: [],
      members: prepared.members.map((member) => ({ ...member,fileName: "charger.dts",role: "base" as const,content: DTS })),
    },auth);
    await expect(syncPublishedCatalogProjectValues(pool, { organizationId: ORG,projectId: PROJECT,configSetId: CONFIG_SET,configRevisionId: newer.id }))
      .rejects.toThrow("reviewed source change");
    const applied = await root.transaction((tx) => commitCanonicalSourceRevision(tx,objectStore,reviewer,snapshot, {
      projectId: PROJECT,requestId,invocation: createUserInvocation(reviewer),traceId: "t11-dts-apply",refusalSink,
    }));
    expect(applied.status).toBe("approved");
    const exported = await exportCanonicalBindingSource(root,objectStore,auth,{ projectId: PROJECT,bindingId: binding.id });
    expect(exported?.files[0]?.content).toBe(DTS.replace("<1000>","<2000>"));
    expect(exported?.manifest.locator.propertyOccurrenceId).not.toBe(prepared.bindings[0]?.locator.propertyOccurrenceId);
    expect(exported?.manifest.sourceOccurrenceId).toBe(prepared.bindings[0]?.sourceOccurrenceId);
    expect((await pool.query(`select logical_node_id from dts_logical_node_revisions where config_revision_id=$1 order by logical_node_id`, [exported!.configRevisionId])).rows).toEqual(baseNodes);
    expect((await listCatalogBindingRowsForProject(root,auth,{ projectId: PROJECT }))[0]?.rawValue).toBe("<2000>");
  });

  it("exports the pinned historical bytes after the file tip advances and refuses damaged storage", async () => {
    const binding = (await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT }))[0]!;
    const file = (await pool.query(`select id, current_version_id from project_parameter_files where project_id=$1 and file_name='charger.dts'`, [PROJECT])).rows[0]!;
    const changed = DTS.replace("<1000>", "<5000>");
    const stored = await objectStore.put({ organizationId: ORG, fileName: "charger.dts", contentType: "text/plain", bytes: Buffer.from(changed) });
    const versionId = randomUUID();
    await pool.query(`insert into project_parameter_file_versions
      (id,file_id,version_number,storage_key,checksum,size_bytes,parsed_index,origin,created_by_user_id)
      values ($1,$2,3,$3,$4,$5,'{}'::jsonb,'upload',$6)`,
    [versionId,file.id,stored.storageKey,stored.checksumSha256,stored.fileSizeBytes,USER]);
    await pool.query(`update project_parameter_files set current_version_id=$2 where id=$1`, [file.id, versionId]);
    await pool.query(`update project_parameter_files set file_name='renamed-display.dts' where id=$1`, [file.id]);
    const exported = await exportCanonicalBindingSource(root, objectStore, auth, { projectId: PROJECT, bindingId: binding.id });
    await pool.query(`update project_parameter_files set file_name='charger.dts' where id=$1`, [file.id]);
    expect(exported?.files).toEqual([expect.objectContaining({ name: "charger.dts", content: DTS.replace("<1000>","<2000>"), versionNumber: 2 })]);
    expect(exported?.manifest.members).toEqual([expect.objectContaining({ fileId: file.id, fileVersionId: file.current_version_id, sourceName: "charger.dts" })]);
    expect(exported?.manifest).toMatchObject({ entryFile: "charger.dts", includeSearchPaths: ["."], overlayOrder: [] });
    expect(catalogBindingExportDtoSchema.parse(exported)).toHaveProperty("manifest", exported?.manifest);

    const damagedStore = { ...objectStore, getBounded: async () => Buffer.from(changed) };
    await expect(exportCanonicalBindingSource(root, damagedStore, auth, { projectId: PROJECT, bindingId: binding.id })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rolls published-value sync back with the outer transaction", async () => {
    const rollbackSetId = randomUUID();
    await pool.query(`insert into dts_config_set(id,organization_id,project_id,name) values ($1,$2,$3,'Rollback initialization')`, [rollbackSetId,ORG,PROJECT]);
    const fileId = randomUUID();
    const versionId = randomUUID();
    const checksum = createHash("sha256").update(DTS, "utf8").digest("hex");
    await pool.query(
      `insert into project_parameter_files (
         id, organization_id, project_id, file_name, format, enabled,
         config_set_id, config_set_role, config_set_sort_order
       ) values ($1, $2, $3, 'charger-rollback.dts', 'dts', true, $4, 'base', 1)`,
      [fileId, ORG, PROJECT, rollbackSetId],
    );
    await pool.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
       ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)`,
      [versionId, fileId, `${ORG}/${checksum}-charger-rollback.dts`, checksum, Buffer.byteLength(DTS, "utf8"), USER],
    );
    await pool.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      versionId,
      fileId,
    ]);
    const revision = await ingestConfigRevision(
      root,
      {
        organizationId: ORG,
        projectId: PROJECT,
        configSetId: rollbackSetId,
        entryFile: "charger-rollback.dts",
        includeSearchPaths: ["."],
        overlayOrder: [],
        members: [
          {
            fileId,
            fileVersionId: versionId,
            fileName: "charger-rollback.dts",
            role: "base",
            sortOrder: 1,
            content: DTS,
          },
        ],
      },
      auth,
    );
    expect(revision.status).toBe("resolved");
    const before = await pool.query<{ c: string }>(
      `select count(*)::text as c
         from parameter_catalog.project_parameter_values
        where config_revision_id = $1`,
      [revision.id],
    );
    const syncSnapshot = await loadPublishedCatalog(pool);
    if (!syncSnapshot) throw new Error("Published fixture is unavailable");
    await expect(
      withAuditedWrite(root, auth, { requestId: "req-min-upg-sync-rollback" }, async (tx) => {
        const count = await syncPublishedCatalogProjectValuesInTransaction(
          asValueClient(tx),syncSnapshot,
          {
            organizationId: ORG,
            projectId: PROJECT,
            configSetId: rollbackSetId,
            configRevisionId: revision.id,
          },
        );
        expect(count).toBeGreaterThan(0);
        throw new Error("force-sync-rollback");
      }),
    ).rejects.toThrow("force-sync-rollback");
    const after = await pool.query<{ c: string }>(
      `select count(*)::text as c
         from parameter_catalog.project_parameter_values
        where config_revision_id = $1`,
      [revision.id],
    );
    expect(after.rows[0]?.c).toBe(before.rows[0]?.c);
    const audits = await pool.query<{ c: string }>(
      `select count(*)::text as c from audit_events where trace_id = $1`,
      ["req-min-upg-sync-rollback"],
    );
    expect(audits.rows[0]?.c).toBe("0");
  }, 60_000);

  it("rolls a catalog import-preview rewrite back with the outer transaction", async () => {
    await expect(
      withAuditedWrite(root, auth, { requestId: "req-min-upg-preview-rollback" }, async (tx) => {
        const item = await createImportPreview(
          tx,
          auth,
          {
            projectId: PROJECT,
            sourceName: "pasted-import.txt",
            items: [
              {
                name: "iin_max",
                module: "Driver",
                risk: "Low",
                unit: "A",
                range: "0-10",
                currentValue: "3000"
              }
            ]
          },
          { requestId: "req-min-upg-preview-rollback" }
        );
        await tx.query(
          `update parameter_import_batches set summary = $2::jsonb where id = $1`,
          [item.id, JSON.stringify({ added: 0, updated: 1, unchanged: 0, conflict: 0, highRisk: 0 })]
        );
        throw new Error("force-preview-rollback");
      }),
    ).rejects.toThrow("force-preview-rollback");
    const leftover = await pool.query<{ c: string }>(
      `select count(*)::text as c from parameter_import_batches where project_id = $1 and source_name = 'pasted-import.txt'`,
      [PROJECT],
    );
    expect(leftover.rows[0]?.c).toBe("0");
    const audits = await pool.query<{ c: string }>(
      `select count(*)::text as c from audit_events where trace_id = $1`,
      ["req-min-upg-preview-rollback"],
    );
    expect(audits.rows[0]?.c).toBe("0");
  }, 60_000);

  it("rejects canonical saves whose config revision is not the value source", async () => {
    const listed = await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT });
    expect(listed[0]?.id).toBeTruthy();
    const bindingId = listed[0]!.id;
    const beforeTip = await pool.query<{ id: string; raw: string }>(
      `select v.id, v.source_ref as raw
         from parameter_catalog.project_parameter_bindings b
         join parameter_catalog.project_parameter_values v on v.id = b.current_value_id
        where b.id = $1`,
      [bindingId],
    );
    const currentTip = beforeTip.rows[0]?.id;
    expect(currentTip).toBeTruthy();

    await expect(
      saveCanonicalProjectValue(pool, {
        organizationId: ORG,
        projectId: PROJECT,
        bindingId,
        configRevisionId: randomUUID(),
        targetValue: importTextToDtsValue("iin_max", "9999"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const otherSet = "dcs-other-source";
    const otherRev = randomUUID();
    await pool.query(
      `insert into dts_config_set (id, organization_id, project_id, name, description)
       values ($1, $2, $3, 'other', 'other source')`,
      [otherSet, ORG, PROJECT],
    );
    await pool.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       values ($1, $2, $3, $4, 1, 'resolved')`,
      [otherRev, ORG, PROJECT, otherSet],
    );
    await expect(
      saveCanonicalProjectValue(pool, {
        organizationId: ORG,
        projectId: PROJECT,
        bindingId,
        configRevisionId: otherRev,
        targetValue: importTextToDtsValue("iin_max", "8888"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const foreignProject = "project-min-upg-foreign";
    const foreignSet = "dcs-foreign";
    const foreignRev = randomUUID();
    await pool.query(
      `insert into public.projects (id, organization_id, name, code, status)
       values ($1, $2, 'Foreign', 'FOR', 'initialized')`,
      [foreignProject, ORG],
    );
    await pool.query(
      `insert into dts_config_set (id, organization_id, project_id, name, description)
       values ($1, $2, $3, 'foreign', 'foreign source')`,
      [foreignSet, ORG, foreignProject],
    );
    await pool.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       values ($1, $2, $3, $4, 1, 'resolved')`,
      [foreignRev, ORG, foreignProject, foreignSet],
    );
    await expect(
      saveCanonicalProjectValue(pool, {
        organizationId: ORG,
        projectId: PROJECT,
        bindingId,
        configRevisionId: foreignRev,
        targetValue: importTextToDtsValue("iin_max", "7777"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const afterTip = await pool.query<{ id: string }>(
      `select current_value_id as id from parameter_catalog.project_parameter_bindings where id = $1`,
      [bindingId],
    );
    expect(afterTip.rows[0]?.id).toBe(currentTip);
    const audits = await pool.query<{ c: string }>(
      `select count(*)::text as c from audit_events where action = 'binding-edited' and target_id = $1 and trace_id like 'req-min-upg-bad-rev%'`,
      [bindingId],
    );
    expect(audits.rows[0]?.c).toBe("0");
  }, 60_000);
});
