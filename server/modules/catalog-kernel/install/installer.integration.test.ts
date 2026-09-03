import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../compiler/index";
import {
  refreshReleaseAggregateDigest,
  validCatalogReleaseBundle,
} from "../compiler/__fixtures__/catalogReleaseBundle";
import type {
  CatalogReleaseBundle,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseNode,
} from "../compiler/types";
import { jsonCatalogReleaseSource } from "../interface";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import {
  createCatalogInstaller,
  installPublishedRelease,
  switchBackBeforeTraffic,
  THREAT_MATRIX,
} from "./installer";
import { acquireCurrentPointerLockExclusive } from "./lockProtocol";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S3-INS installer tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S3-INS installer tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

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
    throw new Error(`fixture failed to compile: ${compiled.error.kind}`);
  }
  return compiled.value;
};

const sha256 = (bytes: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const refreshReleaseSource = (release: CatalogReleaseNode): void => {
  for (const document of release.documents) {
    if (document.kind === "definition") {
      const revision = document.content.revision;
      const model: Record<string, ContractJsonValue> = {
        "/lifecycle": revision.lifecycle,
        "/displayName": revision.displayName,
        "/documentation": revision.documentation,
        "/valueSchema": revision.valueSchema,
        "/matching": revision.matching,
      };
      if (revision.unit !== undefined) model["/unit"] = revision.unit;
      document.content.revision.contentDigest = sha256(serializeContract(model));
    }
    document.normalizedDigest = sha256(
      serializeContract(document.content as unknown as ContractJsonValue),
    );
  }
  const bytes = Buffer.from(
    stringify(
      {
        schemaVersion: "1.0.0",
        documents: release.documents.map((document) => ({
          kind: document.kind,
          content: document.content,
        })),
      },
      { lineWidth: 0 },
    ),
    "utf8",
  );
  const digest = sha256(bytes);
  const path = release.manifest.files[0]?.path ?? "schemas/dts/vendor/acme-power.yaml";
  release.sources = [
    {
      path,
      mediaType: "application/yaml",
      encoding: "base64",
      bytes: bytes.toString("base64"),
    },
  ];
  release.manifest.files = [{ path, mediaType: "application/yaml", digest }];
  for (const document of release.documents) {
    document.source = { path, mediaType: "application/yaml", digest };
  }
  release.manifest.documents = release.documents.map((document) => ({
    sourcePath: document.source.path,
    kind: document.kind,
    documentId: document.content.id,
    normalizedDigest: document.normalizedDigest,
  }));
  refreshReleaseAggregateDigest(release);
};

const competingSuccessorBundle = (
  id: string,
  version: string,
  publishedAt: string,
): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!target) throw new Error("successor target missing");
  target.manifest.release.id = id;
  target.manifest.release.version = version;
  target.manifest.release.publishedAt = publishedAt;
  bundle.targetReleaseId = id;
  refreshReleaseAggregateDigest(target);
  return bundle;
};

const extraDefinitionSuccessorBundle = (): CatalogReleaseBundle => {
  const bundle = validCatalogReleaseBundle();
  const target = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!target) throw new Error("successor target missing");
  const definition = target.documents.find(
    (document): document is CatalogReleaseDefinitionDocument =>
      document.kind === "definition",
  );
  if (!definition) throw new Error("successor definition missing");
  const extra = structuredClone(definition);
  extra.content.id = "pdef_acme_power_iin_min";
  extra.content.propertyKey = "iin_min";
  extra.content.revision = {
    ...extra.content.revision,
    id: "drev_acme_power_iin_min_1",
    displayName: "Input current minimum",
    documentation: "Minimum accepted input current.",
    matching: {
      ...extra.content.revision.matching,
      sourceProperty: "iin_min",
    },
  };
  target.documents.push(extra);
  refreshReleaseSource(target);
  return bundle;
};

async function insertOpenCutoverRun(
  client: pg.Client,
  input: { id: string; digest: string; closed?: boolean },
): Promise<void> {
  await client.query(
    `insert into parameter_catalog.parameter_catalog_cutover_runs (
       id, source_snapshot_fingerprint, target_artifact_sha, target_catalog_release_digest,
       migration_contract_version, plan_digest, current_phase, state, pointer_rollback_closed_at
     ) values ($1, $2, $3, $4, 'v1', $5, 'P6', 'running', $6::timestamptz)`,
    [
      input.id,
      `sha256:snapshot-${input.id}`,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      input.digest,
      `sha256:plan-${input.id}`,
      input.closed ? "2026-09-03T00:00:00Z" : null,
    ],
  );
}

async function seedCandidateWrite(client: pg.Client, subjectId: string): Promise<void> {
  await client.query("begin");
  await client.query("set constraints all deferred");
  await client.query(`
    insert into public.organizations (id, name)
    values ('org-s3ins', 'S3-INS');
    insert into public.attribution_subjects (
      id, organization_id, subject_kind, display_name, source_key
    ) values (
      'attr-s3ins', 'org-s3ins', 'driver-registration', 'S3INS driver', 'compatible:acme,power'
    );
    insert into public.driver_registrations (
      attribution_subject_id, driver_nature, instance_cardinality
    ) values ('attr-s3ins', 'physical-device', 'multiple');
    insert into public.parameter_modules (
      id, organization_id, name, path, depth, kind, origin, attribution_subject_id
    ) values (
      'pmod-s3ins', 'org-s3ins', 'Driver', 'pmod-s3ins', 1, 'driver-group', 'curated', 'attr-s3ins'
    );
  `);
  await client.query(
    `insert into parameter_catalog.organization_subject_registrations (
       id, organization_id, subject_id, status, registration_method, proof, current_placement_id
     ) values (
       'oreg-s3ins', 'org-s3ins', $1, 'active', 'explicit', '{}', 'place-s3ins'
     )`,
    [subjectId],
  );
  await client.query(`
    insert into parameter_catalog.subject_placements (
      id, registration_id, organization_id, module_id, origin
    ) values (
      'place-s3ins', 'oreg-s3ins', 'org-s3ins', 'pmod-s3ins', 'curated'
    );
  `);
  await client.query("set constraints all immediate");
  await client.query("commit");
}

async function seedTrafficObservation(
  client: pg.Client,
  releaseId: string,
): Promise<void> {
  await client.query(`
    insert into public.organizations (id, name)
    values ('org-s3ins-traffic', 'S3-INS traffic')
    on conflict (id) do nothing
  `);
  await client.query(`
    insert into public.projects (id, organization_id, name, code)
    values ('project-s3ins', 'org-s3ins-traffic', 'S3INS', 'S3INS')
  `);
  await client.query(
    `insert into parameter_catalog.parameter_observations (
       id, organization_id, project_id, logical_node_id, config_revision_id,
       source_identity, source_locator, catalog_release_id, matcher_revision, evidence_fingerprint
     ) values (
       'obs-s3ins', 'org-s3ins-traffic', 'project-s3ins', 'node-1', 'cfg-1',
       'src-1', '{}', $1, 'matcher-1', 'sha256:evidence'
     )`,
    [releaseId],
  );
}

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function residue(client: pg.Client) {
  const result = await client.query<{
    releases: string;
    materializations: string;
    pointer: string;
    current: string | null;
    definitions: string;
    revisions: string;
  }>(`
    select
      (select count(*)::text from parameter_catalog.catalog_releases) as releases,
      (select count(*)::text from parameter_catalog.catalog_materializations) as materializations,
      (select count(*)::text from parameter_catalog.catalog_state) as pointer,
      (select current_catalog_release_id from parameter_catalog.catalog_state) as current,
      (select count(*)::text from parameter_catalog.parameter_definitions) as definitions,
      (select count(*)::text from parameter_catalog.definition_revisions) as revisions
  `);
  return result.rows[0]!;
}

describe("atomic Catalog install and pointer switch", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("s3insins");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("freezes the threat matrix with leftover assertions for every required row", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });

  it("bootstraps an empty catalog, then treats lost-response retry as already-current", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const installer = createCatalogInstaller(pool);
    const command = {
      mode: "bootstrap" as const,
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    };
    const installed = await installer.installPublishedRelease(command);
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(installed.value).toMatchObject({
      status: "installed",
      mode: "bootstrap",
      previous: null,
      current: { id: first.release.id, digest: first.release.digest },
    });

    const stored = await observer.query<{
      compiled_fingerprint: string;
      release_digest: string;
      release_version: string;
    }>(
      `select
         release.release_digest,
         release.release_version,
         materialization.compiled_fingerprint
       from parameter_catalog.catalog_releases release
       join parameter_catalog.catalog_materializations materialization
         on materialization.release_id = release.id
       where release.id = $1`,
      [first.release.id],
    );
    const replay = await installer.installPublishedRelease(command);
    expect(replay).toMatchObject({
      ok: true,
      value: {
        status: "already-current",
        current: {
          id: first.release.id,
          digest: stored.rows[0]?.release_digest,
          version: stored.rows[0]?.release_version,
        },
        materializationFingerprint: stored.rows[0]?.compiled_fingerprint,
      },
    });
    const counts = await residue(observer);
    expect(counts).toMatchObject({
      releases: "1",
      materializations: "1",
      pointer: "1",
      current: first.release.id,
      definitions: "1",
      revisions: "1",
    });
  });

  it("advances when expectedCurrent matches and keeps the predecessor projection", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const successor = compileOrThrow(validCatalogReleaseBundle());
    const bootstrap = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(bootstrap.ok).toBe(true);

    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.value).toMatchObject({
      status: "installed",
      mode: "advance",
      previous: { id: first.release.id, digest: first.release.digest },
      current: { id: successor.release.id, digest: successor.release.digest },
    });
    const counts = await residue(observer);
    expect(counts.releases).toBe("2");
    expect(counts.materializations).toBe("2");
    expect(counts.current).toBe(successor.release.id);
  });

  it("serializes concurrent bootstrap sessions into one install and one already-current replay", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const command = {
      mode: "bootstrap" as const,
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    };
    const [left, right] = await Promise.all([
      installPublishedRelease(pool, command),
      installPublishedRelease(pool, command),
    ]);
    const statuses = [left, right].map((result) =>
      result.ok ? result.value.status : result.error.kind,
    );
    expect(statuses.sort()).toEqual(["already-current", "installed"]);
    const counts = await residue(observer);
    expect(counts).toMatchObject({
      releases: "1",
      materializations: "1",
      pointer: "1",
      revisions: "1",
    });
  });

  it("waits on a shared governance lock then replays as already-current", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);

    const holder = await connect(database.url);
    try {
      await holder.query("begin");
      await holder.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
        [first.release.id, first.release.digest, "csub_acme_power", "active"],
      );
      const waiting = installPublishedRelease(pool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(firstReleaseBundle()),
        expectedTargetDigest: first.aggregateDigest,
      });
      const deadline = Date.now() + 2_000;
      let sawWait = false;
      while (Date.now() < deadline) {
        const waitingRow = await observer.query<{ waiting: boolean }>(
          `select exists (
             select 1
             from pg_catalog.pg_stat_activity
             where datname = current_database()
               and pid <> $1
               and pid <> pg_backend_pid()
               and wait_event_type = 'Lock'
               and wait_event = 'advisory'
           ) as waiting`,
          [holder.processID],
        );
        if (waitingRow.rows[0]?.waiting) {
          sawWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(sawWait).toBe(true);
      await holder.query("commit");
      await expect(waiting).resolves.toMatchObject({
        ok: true,
        value: { status: "already-current" },
      });
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
  });

  it.each(["before-write", "revisions", "heads", "pointer", "evidence"] as const)(
    "leaves zero residue when materialization fails after %s",
    async (stage) => {
      const first = compileOrThrow(firstReleaseBundle());
      const result = await installPublishedRelease(
        pool,
        {
          mode: "bootstrap",
          source: jsonCatalogReleaseSource(firstReleaseBundle()),
          expectedTargetDigest: first.aggregateDigest,
        },
        { failAfter: stage },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("storage-failure");
      expect(await residue(observer)).toMatchObject({
        releases: "0",
        materializations: "0",
        pointer: "0",
        current: null,
        definitions: "0",
        revisions: "0",
      });
    },
  );

  it("rejects a stale expectedCurrent without moving the pointer", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const successor = compileOrThrow(validCatalogReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    const stale = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: {
        id: CatalogReleaseId("crel_stale_pin"),
        digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
      },
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(stale).toMatchObject({
      ok: false,
      error: {
        kind: "unsupported-lineage",
        reason: "stale-expected-current",
        installed: { id: first.release.id },
      },
    });
    expect((await residue(observer)).current).toBe(first.release.id);
  });

  it("rejects same-id different-bytes as digest-conflict", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    const collidingBundle = firstReleaseBundle();
    const target = collidingBundle.releases[0]!;
    target.manifest.release.publishedAt = "2026-09-03T00:00:00Z";
    refreshReleaseAggregateDigest(target);
    const colliding = compileOrThrow(collidingBundle);
    const conflict = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(collidingBundle),
      expectedTargetDigest: colliding.aggregateDigest,
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: {
        kind: "digest-conflict",
        releaseId: first.release.id,
        expected: colliding.release.digest,
        actual: first.release.digest,
      },
    });
    expect((await residue(observer)).current).toBe(first.release.id);
  });

  it("serializes competing successor advances into one commit and unsupported-lineage", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    const leftBundle = competingSuccessorBundle(
      "crel_acme_2",
      "1.1.0",
      "2026-09-02T00:00:00Z",
    );
    const rightBundle = competingSuccessorBundle(
      "crel_acme_2_alt",
      "1.1.0-alt",
      "2026-09-02T01:00:00Z",
    );
    const left = compileOrThrow(leftBundle);
    const right = compileOrThrow(rightBundle);
    const [leftResult, rightResult] = await Promise.all([
      installPublishedRelease(pool, {
        mode: "advance",
        source: jsonCatalogReleaseSource(leftBundle),
        expectedCurrent: { id: first.release.id, digest: first.release.digest },
        expectedTargetDigest: left.aggregateDigest,
      }),
      installPublishedRelease(pool, {
        mode: "advance",
        source: jsonCatalogReleaseSource(rightBundle),
        expectedCurrent: { id: first.release.id, digest: first.release.digest },
        expectedTargetDigest: right.aggregateDigest,
      }),
    ]);
    const outcomes = [leftResult, rightResult].map((result) =>
      result.ok ? result.value.status : result.error.kind,
    );
    expect(outcomes.sort()).toEqual(["installed", "unsupported-lineage"]);
    const loser = [leftResult, rightResult].find((result) => !result.ok);
    expect(loser).toMatchObject({
      ok: false,
      error: { kind: "unsupported-lineage", reason: "stale-expected-current" },
    });
    const counts = await residue(observer);
    expect(counts.releases).toBe("2");
    expect(counts.materializations).toBe("2");
    expect([left.release.id, right.release.id]).toContain(counts.current);
    const successorRows = await observer.query<{ id: string }>(
      `select id
         from parameter_catalog.catalog_releases
        where id = any($1::text[])`,
      [[left.release.id, right.release.id]],
    );
    expect(successorRows.rows).toHaveLength(1);
    expect(successorRows.rows[0]?.id).toBe(counts.current);
    const currentHeads = await observer.query<{ revision_id: string }>(
      `select revision_id
         from parameter_catalog.catalog_release_definition_heads
        where release_id = $1
        order by definition_id`,
      [counts.current],
    );
    expect(currentHeads.rows).toEqual([{ revision_id: "drev_acme_power_iin_max_1" }]);
  });

  it("introduces an extra definition on the successor with current introduced_release_id", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const extraBundle = extraDefinitionSuccessorBundle();
    const successor = compileOrThrow(extraBundle);
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(extraBundle),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);
    const extra = await observer.query<{
      introduced_release_id: string;
      head_release_id: string;
    }>(
      `select
         definition.introduced_release_id,
         head.release_id as head_release_id
       from parameter_catalog.parameter_definitions definition
       join parameter_catalog.catalog_release_definition_heads head
         on head.definition_id = definition.id
       where definition.id = 'pdef_acme_power_iin_min'`,
    );
    expect(extra.rows).toEqual([
      {
        introduced_release_id: successor.release.id,
        head_release_id: successor.release.id,
      },
    ]);
    expect(extra.rows[0]?.introduced_release_id).not.toBe(first.release.id);
    const firstHead = await observer.query<{ count: string }>(
      `select count(*)::text as count
         from parameter_catalog.catalog_release_definition_heads
        where definition_id = 'pdef_acme_power_iin_min'
          and release_id = $1`,
      [first.release.id],
    );
    expect(firstHead.rows[0]?.count).toBe("0");
  });

  it("re-reads the installed fingerprint on replay and reports drift after tamper", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const command = {
      mode: "bootstrap" as const,
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    };
    const installed = await installPublishedRelease(pool, command);
    expect(installed.ok).toBe(true);
    const replay = await installPublishedRelease(pool, command);
    const stored = await observer.query<{ compiled_fingerprint: string }>(
      `select compiled_fingerprint
         from parameter_catalog.catalog_materializations
        where release_id = $1`,
      [first.release.id],
    );
    expect(replay).toMatchObject({
      ok: true,
      value: {
        status: "already-current",
        materializationFingerprint: stored.rows[0]?.compiled_fingerprint,
      },
    });

    await observer.query(
      "select pg_catalog.set_config('session_replication_role', 'replica', false)",
    );
    try {
      await observer.query(
        `update parameter_catalog.catalog_materializations
            set compiled_fingerprint = $1
          where release_id = $2`,
        [`sha256:${"b".repeat(64)}`, first.release.id],
      );
    } finally {
      await observer.query(
        "select pg_catalog.set_config('session_replication_role', 'origin', false)",
      );
    }

    const drifted = await installPublishedRelease(pool, command);
    expect(drifted).toMatchObject({
      ok: false,
      error: {
        kind: "drift",
        scope: "current",
        violations: [{ code: "materialization-fingerprint-mismatch" }],
      },
    });
    expect((await residue(observer)).current).toBe(first.release.id);
    expect((await residue(observer)).materializations).toBe("1");
  });

  it("forbids switch-back without an open cutover run and allows an open run", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const successor = compileOrThrow(validCatalogReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });

    const missing = await switchBackBeforeTraffic(pool, {
      maintenanceAttemptId: "maint_01KCUTOVER",
      expectedCurrent: { id: successor.release.id, digest: successor.release.digest },
      targetPrevious: { id: first.release.id, digest: first.release.digest },
    });
    expect(missing).toMatchObject({
      ok: false,
      error: { kind: "switch-back-forbidden", reason: "migration-incompatible" },
    });
    expect((await residue(observer)).current).toBe(successor.release.id);

    await insertOpenCutoverRun(observer, {
      id: "maint_01KCLOSED",
      digest: successor.release.digest,
      closed: true,
    });
    const closed = await switchBackBeforeTraffic(pool, {
      maintenanceAttemptId: "maint_01KCLOSED",
      expectedCurrent: { id: successor.release.id, digest: successor.release.digest },
      targetPrevious: { id: first.release.id, digest: first.release.digest },
    });
    expect(closed).toMatchObject({
      ok: false,
      error: { kind: "switch-back-forbidden", reason: "migration-incompatible" },
    });

    await insertOpenCutoverRun(observer, {
      id: "maint_01KCUTOVER",
      digest: successor.release.digest,
    });
    const switched = await switchBackBeforeTraffic(pool, {
      maintenanceAttemptId: "maint_01KCUTOVER",
      expectedCurrent: { id: successor.release.id, digest: successor.release.digest },
      targetPrevious: { id: first.release.id, digest: first.release.digest },
    });
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.value).toMatchObject({
      status: "switched-back",
      maintenanceAttemptId: "maint_01KCUTOVER",
      previousCurrent: { id: successor.release.id },
      current: { id: first.release.id },
    });
    expect((await residue(observer)).current).toBe(first.release.id);
    expect((await residue(observer)).releases).toBe("2");
  });

  it("forbids switch-back after candidate-write or traffic even with an open cutover run", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const successor = compileOrThrow(validCatalogReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });
    await insertOpenCutoverRun(observer, {
      id: "maint_01KWRITE",
      digest: successor.release.digest,
    });
    await seedCandidateWrite(observer, "csub_acme_power");
    const candidateWrite = await switchBackBeforeTraffic(pool, {
      maintenanceAttemptId: "maint_01KWRITE",
      expectedCurrent: { id: successor.release.id, digest: successor.release.digest },
      targetPrevious: { id: first.release.id, digest: first.release.digest },
    });
    expect(candidateWrite).toMatchObject({
      ok: false,
      error: { kind: "switch-back-forbidden", reason: "candidate-write-observed" },
    });
    expect((await residue(observer)).current).toBe(successor.release.id);
  });

  it("forbids switch-back after traffic observations", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const successor = compileOrThrow(validCatalogReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });
    await insertOpenCutoverRun(observer, {
      id: "maint_01KTRAFFIC",
      digest: successor.release.digest,
    });
    await seedTrafficObservation(observer, successor.release.id);
    const traffic = await switchBackBeforeTraffic(pool, {
      maintenanceAttemptId: "maint_01KTRAFFIC",
      expectedCurrent: { id: successor.release.id, digest: successor.release.digest },
      targetPrevious: { id: first.release.id, digest: first.release.digest },
    });
    expect(traffic).toMatchObject({
      ok: false,
      error: { kind: "switch-back-forbidden", reason: "traffic-observed" },
    });
    expect((await residue(observer)).current).toBe(successor.release.id);
  });

  it("returns synchronization-busy when the exclusive lock times out", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const holder = await connect(database.url);
    try {
      await holder.query("begin");
      await acquireCurrentPointerLockExclusive(holder);
      const startedAt = Date.now();
      const busy = await installPublishedRelease(pool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(firstReleaseBundle()),
        expectedTargetDigest: first.aggregateDigest,
      });
      expect(busy).toEqual({
        ok: false,
        error: { kind: "synchronization-busy", retryable: true },
      });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_500);
      await holder.query("rollback");
      expect((await residue(observer)).pointer).toBe("0");
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
  });
});
