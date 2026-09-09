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
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { ingestConfigRevision } from "./ingestService";
import { createBindingDraft, listProjectBindings } from "./service";
import { importTextToDtsValue, listCatalogBindingsForImport, saveCanonicalProjectValue } from "./catalogProjectValueSync";
import type { ConfigRevisionManifest } from "./types";

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

    const listed = await listProjectBindings(root, auth, {
      projectId: PROJECT,
      revisionId: revision.id,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.propertyKey).toBe("iin_max");
    expect(listed.items[0]?.rawValue).toBe("<1000>");
    expect(listed.items[0]?.definitionId).toBe("pdef_acme_power_iin_max");

    const sink = createTrustedRefusalAuditSink(root);
    const saved = await createBindingDraft(
      root,
      auth,
      {
        projectId: PROJECT,
        bindingId: listed.items[0]!.id,
        baseRevisionId: revision.id,
        targetValue: {
          kind: "cells",
          bits: 32,
          groups: [[{ kind: "integer", raw: "2000", value: "2000" }]],
        },
        reason: "raise input current limit",
      },
      {},
      { invocation: createUserInvocation(auth), requestId: "req-min-upg-val", refusalSink: sink },
    );
    expect(saved.writeTarget.role).toBe("canonical-project-value");
    expect(saved.rawText).toBe("<2000>");

    const audits = await pool.query<{ kind: string; action: string; target_id: string }>(
      `select kind, action, target_id
         from audit_events
        where target_id = $1
          and action = 'binding-edited'`,
      [listed.items[0]!.id],
    );
    expect(audits.rows).toEqual([
      {
        kind: "parameter-topology-governance",
        action: "binding-edited",
        target_id: listed.items[0]!.id,
      },
    ]);

    const after = await listProjectBindings(root, auth, { projectId: PROJECT });
    expect(after.items[0]?.rawValue).toBe("<2000>");

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
    const afterImport = await listProjectBindings(root, auth, { projectId: PROJECT });
    expect(afterImport.items[0]?.rawValue).toBe("<3000>");
  }, 60_000);
});
