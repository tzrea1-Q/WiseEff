import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { seedPublishedCatalog } from "../../testing/parameterCatalog/seedPublishedCatalog";
import { compileCatalogRelease } from "../catalog-kernel/compiler/index";
import { createCatalogKernel } from "../catalog-kernel/interface";
import { CatalogReleaseDigest, CatalogReleaseId, ParameterDefinitionId } from "../parameter-catalog-contract/index";
import { parseBundleBytes } from "./builder/bundleCodec";
import { prepareCatalogDefinitionErasure } from "./definitionErasure";
import { createPinCapturingCatalogRuntime } from "./runtime/pinCache";

describe("Catalog erasure from a native bootstrap without persisted artifacts", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let client: pg.PoolClient;
  beforeAll(async () => {
    database = await createEphemeralTestDatabase("catalog_erase_source");
    pool = new pg.Pool({ connectionString: database.url });
    await seedPublishedCatalog(pool);
    client = await pool.connect();
  }, 60_000);
  afterAll(async () => {
    client?.release();
    await pool?.end();
    await database?.drop();
  });

  it("verifies the populated seed and reconstructs all historical releases before erasing", async () => {
    const count = await client.query<{ count: string }>("select count(*)::text as count from catalog_publication.release_artifacts");
    expect(count.rows[0]?.count).toBe("0");
    await client.query("begin isolation level repeatable read read only");
    try {
      const plan = await prepareCatalogDefinitionErasure(client, "pdef_acme_power_iin_max");
      expect(plan.releases).toHaveLength(4);
      expect(plan.artifacts).toHaveLength(1);
      expect(plan.artifacts[0]!.create).toBe(true);
      const parsed = parseBundleBytes(Buffer.from(plan.artifacts[0]!.artifactBytesBase64, "base64"));
      if (!parsed.ok) throw new Error(parsed.detail);
      expect(parsed.bundle.releases).toHaveLength(4);
      for (const [index, node] of parsed.bundle.releases.entries()) {
        const compiled = compileCatalogRelease({ ...parsed.bundle, targetReleaseId: node.manifest.release.id, releases: parsed.bundle.releases.slice(0, index + 1) });
        expect(compiled.ok).toBe(true);
        if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
        expect(plan.releases[index]!.materializationFingerprint).toBe(compiled.value.materializationFingerprint);
        expect(node.documents.some((document) => document.content.id === "pdef_acme_power_iin_max")).toBe(false);
      }
    } finally {
      await client.query("rollback");
    }
  });

  it("refuses to use native source when actual database content disagrees with its stored fingerprint", async () => {
    await client.query("begin");
    try {
      await client.query("alter table parameter_catalog.definition_revisions disable trigger definition_revisions_immutable");
      await client.query(`update parameter_catalog.definition_revisions
        set content = jsonb_set(content, '{documentation}', '"corrupted database content"'::jsonb)
        where id = 'drev_acme_power_iin_max_1'`);
      const outcome = await prepareCatalogDefinitionErasure(client, "pdef_acme_power_iin_max")
        .then(() => "accepted", (error: unknown) => error instanceof Error ? error.message : String(error));
      expect(outcome).toContain("stored projection does not match");
    } finally {
      await client.query("rollback");
    }
  });

  it("commits a native erasure, rejects cached old pins, and preserves every unrelated revision", async () => {
    const definitionId = ParameterDefinitionId("pdef_acme_power_iin_max");
    const revisionsSql = `select id, content_digest, content from parameter_catalog.definition_revisions
      where definition_id <> $1 order by id`;
    const before = await client.query(revisionsSql, [definitionId]);
    const oldReleases = await client.query<{ id: string; release_digest: string }>(
      "select id, release_digest from parameter_catalog.catalog_releases order by release_sequence",
    );
    const runtime = createPinCapturingCatalogRuntime(pool, createCatalogKernel(pool));
    for (const release of oldReleases.rows) {
      const cached = await runtime.loadPinnedCatalog({ id: CatalogReleaseId(release.id), digest: CatalogReleaseDigest(release.release_digest) });
      expect(cached.ok).toBe(true);
    }
    await client.query("begin");
    try {
      await client.query("select parameter_catalog.lock_parameter_definition_purge($1)", [definitionId]);
      const plan = await prepareCatalogDefinitionErasure(client, definitionId);
      await client.query("set local role parameter_governance_writer_role");
      await client.query("select parameter_catalog.purge_parameter_definition($1,$2::jsonb,$3,$4)",
        [definitionId, JSON.stringify(plan), "catalog-erasure-test", "audit-catalog-erasure-test"]);
      await client.query("set constraints all immediate");
      await client.query("commit");
      for (const release of plan.releases) {
        const stale = await runtime.loadPinnedCatalog({ id: CatalogReleaseId(release.id), digest: CatalogReleaseDigest(release.oldDigest) });
        expect(stale.ok).toBe(false);
        if (!stale.ok) expect(stale.error.kind).toBe("digest-conflict");
        const rewritten = await runtime.loadPinnedCatalog({ id: CatalogReleaseId(release.id), digest: CatalogReleaseDigest(release.newDigest) });
        expect(rewritten.ok).toBe(true);
        if (rewritten.ok) expect(rewritten.value.getDefinitionById(definitionId)).toEqual({ status: "unknown", target: "definition" });
      }
      const after = await client.query(revisionsSql, [definitionId]);
      expect(after.rows).toEqual(before.rows);
      const artifact = await client.query<{ artifact_bytes: Buffer }>("select artifact_bytes from catalog_publication.release_artifacts");
      expect(artifact.rows).toHaveLength(1);
      const stored = parseBundleBytes(artifact.rows[0]!.artifact_bytes);
      if (!stored.ok) throw new Error(stored.detail);
      expect(stored.bundle.releases.flatMap((release) => release.documents).some((document) => document.content.id === definitionId)).toBe(false);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    await client.query("begin");
    try {
      await client.query("set local role catalog_synchronizer_role");
      await expect(client.query(`insert into parameter_catalog.parameter_definitions
        (id,introduced_release_id,subject_id,property_key,current_revision_id)
        values ($1,'crel_acme_1','csub_acme_power','iin_max','drev_acme_power_iin_max_1')`, [definitionId]))
        .rejects.toThrow("Parameter definition was permanently erased");
    } finally {
      await client.query("rollback");
    }
  });
});
