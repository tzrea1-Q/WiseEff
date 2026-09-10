import { createHash, randomUUID } from "node:crypto";

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
import { createUserInvocation } from "../auth/trustedInvocation";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../shared/database/client";
import { asAuditTx, withAuditedWrite } from "../audit/auditedWrite";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { createImportPreview } from "../parameters/service";
import {
  asValueClient,
  importTextToDtsValue,
  listCatalogBindingRowsForProject,
  listCatalogBindingsForImport,
  saveCanonicalProjectValue,
  syncPublishedCatalogProjectValues,
} from "./catalogProjectValueSync";
import type { ConfigRevisionManifest } from "../parameter-topology/types";

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
    database = await createEphemeralTestDatabase("upgval");
    root = createPostgresDatabase(database.url);
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
  });

  it("creates, reads, and saves a ProjectValue from a published definition without a new spec", async () => {
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
    const written = await withAuditedWrite(root, auth, { requestId: "req-min-upg-sync" }, async (tx) => {
      const count = await syncPublishedCatalogProjectValues(
        pool,
        {
          organizationId: ORG,
          projectId: PROJECT,
          configSetId: CONFIG_SET,
          configRevisionId: revision.id,
        },
        asValueClient(tx),
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
    expect(values.rows[0]?.source_ref).toBe(`config-set:${CONFIG_SET}`);
    expect(values.rows[0]?.config_revision_id).toBe(revision.id);
    expect(values.rows[0]?.value).toEqual(1000);

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

    const saved = await withAuditedWrite(root, auth, { requestId: "req-min-upg-val" }, async (tx) => {
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
    });
    expect(saved.rawText).toBe("<2000>");

    const audits = await pool.query<{ kind: string; action: string; target_id: string }>(
      `select kind, action, target_id
         from audit_events
        where target_id = $1
          and action = 'binding-edited'`,
      [listed[0]!.id],
    );
    expect(audits.rows).toEqual([
      {
        kind: "parameter-topology-governance",
        action: "binding-edited",
        target_id: listed[0]!.id,
      },
    ]);

    const after = await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT });
    expect(after[0]?.rawValue).toBe("<2000>");

    const imported = await listCatalogBindingsForImport(root, {
      organizationId: ORG,
      projectId: PROJECT,
      names: ["iin_max"],
      definitionIds: [],
    });
    expect(imported).toHaveLength(1);
    expect(imported[0]?.currentValue).toBe("2000");
    await saveCanonicalProjectValue(pool, {
      organizationId: ORG,
      projectId: PROJECT,
      bindingId: imported[0]!.projectParameterValueId,
      configRevisionId: revision.id,
      targetValue: importTextToDtsValue("iin_max", "3000"),
    });
    const afterImport = await listCatalogBindingRowsForProject(root, auth, { projectId: PROJECT });
    expect(afterImport[0]?.rawValue).toBe("<3000>");
  }, 60_000);

  it("rolls published-value sync back with the outer transaction", async () => {
    const fileId = randomUUID();
    const versionId = randomUUID();
    const checksum = createHash("sha256").update(DTS, "utf8").digest("hex");
    await pool.query(
      `insert into project_parameter_files (
         id, organization_id, project_id, file_name, format, enabled,
         config_set_id, config_set_role, config_set_sort_order
       ) values ($1, $2, $3, 'charger-rollback.dts', 'dts', true, $4, 'base', 1)`,
      [fileId, ORG, PROJECT, CONFIG_SET],
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
        configSetId: CONFIG_SET,
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
    await expect(
      withAuditedWrite(root, auth, { requestId: "req-min-upg-sync-rollback" }, async (tx) => {
        const count = await syncPublishedCatalogProjectValues(
          pool,
          {
            organizationId: ORG,
            projectId: PROJECT,
            configSetId: CONFIG_SET,
            configRevisionId: revision.id,
          },
          asValueClient(tx),
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
});
