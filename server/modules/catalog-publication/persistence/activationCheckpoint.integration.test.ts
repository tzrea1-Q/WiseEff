import pg from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { buildCatalogInstallProof } from "../../catalog-kernel/compiler/installChain";
import { createDatabase } from "../../../shared/database/client";
import { checkDriverSpellingHistory } from "../builder/identitySnapshot";
import { ACTIVATION_CHECKPOINT_VERSION } from "../builder/capabilities";
import { hasUnrenamedDriverHistory } from "./driverIdentityHistory";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { bootstrapFirstAcme, buildAuthorizedJob, persistPredecessorArtifact } from "../../catalog-kernel/install/publicationTestHarness";
import { CATALOG_BASELINE_READER_ROLE, CATALOG_PUBLICATION_COORDINATOR_ROLE, CATALOG_SYNCHRONIZER_ROLE } from "../../catalog-kernel/security/catalogRoleManifest";
import {
  CorruptActivationCheckpoint, hasAvailableAppendIdentities, lockCheckpointEpoch,
  putActivationCheckpoint, readActivationCheckpoint, readCheckpointEpoch,
} from "./activationCheckpoint";
import { asQueryable, openEphemeralClient, requirePgvectorTestDatabase, sha256Digest, withCommittedRole, withProductionLogin } from "./integrationHarness";

describe("durable activation proof", () => {
  let database: Awaited<ReturnType<typeof openEphemeralClient>>;
  let pool: pg.Pool;

  beforeAll(requirePgvectorTestDatabase);
  beforeEach(async () => {
    database = await openEphemeralClient("catproof");
    pool = new pg.Pool({ connectionString: database.url });
  });
  afterEach(async () => {
    await pool?.end();
    await database?.drop();
  });

  async function installBase() {
    const predecessor = await bootstrapFirstAcme(pool);
    const artifact = await persistPredecessorArtifact(database.client, predecessor);
    const epoch = await readCheckpointEpoch(asQueryable(database.client));
    if (!epoch) throw new Error("expected checkpoint migration");
    return {
      version: ACTIVATION_CHECKPOINT_VERSION, epoch, target: predecessor.first, proof: buildCatalogInstallProof(predecessor.compiled),
      artifactChecksum: artifact.bytesChecksum, compiledReleaseDigest: predecessor.compiled.compiledReleaseDigest,
      toolchainDigest: predecessor.compiled.toolchainDigest, materializationFingerprint: predecessor.compiled.materializationFingerprint,
    };
  }

  it("checks driver declarations against the verified install proof before preview persistence", async () => {
    const checkpoint = await installBase();
    const db = createDatabase(asQueryable(database.client));
    expect(await putActivationCheckpoint(db, checkpoint)).toBe(true);
    const check = (selector: string) => checkDriverSpellingHistory(db, checkpoint.target, [
      { subjectId: "csub_fresh", canonicalKey: `driver:${selector}` },
    ]);
    expect(await check("test,new")).toBe("available");
    expect(await check("acme,power")).toBe("occupied");
    await db.query("update catalog_publication.activation_checkpoints set proof_checksum=$1", [sha256Digest("other")]);
    await expect(check("test,new")).rejects.toThrow(CorruptActivationCheckpoint);
  });

  it("pins a populated legacy base with the production synchronizer and denies other runtime roles", async () => {
    const checkpoint = await installBase();
    const digest = checkpoint.target.manifest.release.digest;
    const { client, url } = database;
    await withProductionLogin(client, url, "sync", async login => {
      await withCommittedRole(login, CATALOG_SYNCHRONIZER_ROLE, async () => {
        const db = asQueryable(login);
        expect(await readActivationCheckpoint(db, digest, checkpoint.version)).toBeNull();
        expect(await putActivationCheckpoint(db, { ...checkpoint, materializationFingerprint: "unverified" })).toBe(false);
        expect(await putActivationCheckpoint(db, checkpoint)).toBe(true);
        expect(await putActivationCheckpoint(db, checkpoint)).toBe(true);
        expect(await readActivationCheckpoint(db, digest, "unsupported")).toBeNull();
        expect(await readActivationCheckpoint(db, digest, checkpoint.version)).toMatchObject({
          target: checkpoint.target, epoch: checkpoint.epoch, proof: checkpoint.proof,
        });
        const firstRelease = checkpoint.target.manifest.release;
        const fresh = { ...checkpoint.target, manifest: { ...checkpoint.target.manifest,
          release: { ...firstRelease, id: "new", version: "new", digest: "new" },
        } };
        const priorRevision = (await login.query<{ id: string }>("select id from parameter_catalog.definition_revisions limit 1")).rows[0]!.id;
        expect(await hasAvailableAppendIdentities(db, fresh, ["drev_fresh"])).toBe(true);
        expect(await hasAvailableAppendIdentities(db, fresh, [priorRevision])).toBe(false);
        expect(await hasAvailableAppendIdentities(db, fresh, [], ["csub_new_driver"])).toBe(true);
        expect(await hasAvailableAppendIdentities(db, fresh, [], ["csub_acme_power"])).toBe(false);
        expect(await hasUnrenamedDriverHistory(db, firstRelease.id, 1)).toBe(true);
        expect(await hasUnrenamedDriverHistory(db, firstRelease.id, 2)).toBe(false);
        expect(await hasUnrenamedDriverHistory(db, "missing-base")).toBe(false);
        for (const key of ["id", "version", "digest"] as const) {
          const release = { ...fresh.manifest.release, [key]: firstRelease[key] };
          expect(await hasAvailableAppendIdentities(db, { ...fresh, manifest: { ...fresh.manifest, release } }, [])).toBe(false);
        }
      });
      await login.query("set role catalog_synchronizer_role");
      await expect(login.query("update catalog_publication.checkpoint_epoch set singleton = true")).rejects.toMatchObject({ code: "42501" });
    }, CATALOG_SYNCHRONIZER_ROLE);
    for (const role of [CATALOG_PUBLICATION_COORDINATOR_ROLE, CATALOG_BASELINE_READER_ROLE]) {
      await withProductionLogin(client, url, "reader", async login => {
        await login.query(`set role ${role}`);
        await expect(login.query("select * from catalog_publication.activation_checkpoints")).rejects.toMatchObject({ code: "42501" });
        await expect(login.query("insert into catalog_publication.activation_checkpoints default values")).rejects.toMatchObject({ code: "42501" });
        await expect(login.query("select catalog_publication.lock_checkpoint_epoch()")).rejects.toMatchObject({ code: "42501" });
      }, role);
    }
  });

  it("detects changed proof or target bytes and rejects a conflicting replacement", async () => {
    const checkpoint = await installBase();
    const db = asQueryable(database.client);
    expect(await putActivationCheckpoint(db, checkpoint)).toBe(true);
    await expect(putActivationCheckpoint(db, { ...checkpoint, proof: { ...checkpoint.proof, sequence: 987 } })).rejects.toBeInstanceOf(CorruptActivationCheckpoint);
    for (const column of ["proof_bytes", "target_bytes"]) {
      await database.client.query("begin");
      try {
        await database.client.query(`update catalog_publication.activation_checkpoints set ${column} = decode('ff','hex')`);
        await expect(readActivationCheckpoint(db, checkpoint.target.manifest.release.digest, checkpoint.version)).rejects.toBeInstanceOf(CorruptActivationCheckpoint);
      } finally {
        await database.client.query("rollback");
      }
    }
  });

  it("rejects legacy producer capabilities on marked artifacts and v9 on unmarked artifacts", async () => {
    const base = await installBase();
    const { client, url } = database;
    const predecessorDigest = base.target.manifest.release.digest;
    const next = await buildAuthorizedJob(client, { predecessorDigest, propertyKey: "marked", compilerFormat: "install-chain" });
    const old = await buildAuthorizedJob(client, { predecessorDigest, propertyKey: "legacy", enablePolicy: false });
    await withProductionLogin(client, url, "producer", async login => {
      await login.query("set role catalog_publication_coordinator_role");
      const write = (artifactId: string, capability: object) => login.query(
        `insert into catalog_publication.candidates (id, artifact_id, artifact_digest, expected_base_release_id,
           expected_base_release_digest, identity_allocation, impact_report_digest, capability_contract)
         select 'ccand_upgrade_' || id, id, artifact_digest, predecessor_release_id,
           predecessor_release_digest, '{}'::jsonb, artifact_digest, $2::jsonb
           from catalog_publication.release_artifacts where id = $1`, [artifactId, JSON.stringify(capability)],
      );
      const mismatch = { code: "23514", constraint: "candidate_install_contract" };
      await expect(write(next.candidate.artifactId, { revision: "catalog-capability/v8" })).rejects.toMatchObject(mismatch);
      await expect(write(next.candidate.artifactId, {})).rejects.toMatchObject(mismatch);
      await expect(write(old.candidate.artifactId, { revision: "catalog-capability/v9" })).rejects.toMatchObject(mismatch);
      expect((await write(old.candidate.artifactId, {})).rowCount).toBe(1);
      for (const [key, compiler, sourceFormat] of [
        ["legacy_name", "wiseeff-catalog-install-chain/v2", "wiseeff-catalog-release@1"],
        ["invalid_v2", "other-compiler", "wiseeff-catalog-release@2"],
      ]) {
        const id = `cart_${key}`;
        const digest = sha256Digest(id);
        await login.query(
          `insert into catalog_publication.release_artifacts (id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
             target_release_id, target_release_digest, predecessor_release_id, predecessor_release_digest, toolchain)
           values ($1,$2,$2,$3,'typed-changeset',$1,$2,$4,$5,$6::jsonb)`,
          [id, digest, Buffer.from(id), base.target.manifest.release.id, predecessorDigest, JSON.stringify({ compiler, sourceFormat })],
        );
        await expect(write(id, { revision: "catalog-capability/v9" })).rejects.toMatchObject(mismatch);
        if (key === "legacy_name") expect((await write(id, { revision: "catalog-capability/v8" })).rowCount).toBe(1);
        else await expect(write(id, {})).rejects.toMatchObject(mismatch);
      }
    }, CATALOG_PUBLICATION_COORDINATOR_ROLE);
  });

  it("invalidates proofs of compact descendants after an ancestor rewrite and fences stale writers", async () => {
    const base = await installBase();
    const { client } = database;
    const db = asQueryable(client);
    const digest = base.target.manifest.release.digest;
    expect(await putActivationCheckpoint(db, base)).toBe(true);
    const next = await buildAuthorizedJob(client, { predecessorDigest: digest, propertyKey: "checkpoint", compilerFormat: "install-chain" });
    const installed = await installPublishedRelease(pool, next.command);
    expect(installed.ok).toBe(true);
    const targetDigest = next.candidate.artifactDigest;
    const nextProof = await readActivationCheckpoint(db, targetDigest, base.version);
    expect(nextProof?.target.manifest.release.digest).toBe(targetDigest);
    expect((await client.query(
      "select c.target_bytes is null as compact from catalog_publication.activation_checkpoints c where c.artifact_digest=$1", [targetDigest],
    )).rows).toEqual([{ compact: true }]);
    const ancestor = (await client.query<{ id: string }>("select id from catalog_publication.release_artifacts where artifact_digest=$1", [digest])).rows[0]!;
    async function rewrite() {
      await client.query("set local role catalog_migration_owner");
      await client.query("select parameter_catalog.definition_purge_mark('catalog_publication.release_artifacts', $1::jsonb, 'UPDATE')", [JSON.stringify([ancestor])]);
      await client.query("update catalog_publication.release_artifacts set artifact_bytes=artifact_bytes where id=$1", [ancestor.id]);
    }
    await client.query("begin");
    await rewrite();
    expect(await readActivationCheckpoint(db, targetDigest, base.version)).toBeNull();
    expect(await lockCheckpointEpoch(db, base.epoch)).toBe(false);
    await client.query("rollback");
    expect((await readActivationCheckpoint(db, targetDigest, base.version))?.epoch).toBe(base.epoch);
    await client.query("begin");
    await rewrite();
    await client.query("commit");
    expect(await lockCheckpointEpoch(db, base.epoch)).toBe(false);
    expect(await putActivationCheckpoint(db, base)).toBe(false);
    expect(await readActivationCheckpoint(db, targetDigest, base.version)).toBeNull();
    expect((await client.query("select count(*)::integer as proofs from catalog_publication.activation_checkpoints")).rows).toEqual([{ proofs: 0 }]);
  });
});

it("upgrades an installed v1 base with an already authorized legacy job", async () => {
  await withTempDatabase({ prefix: "catproofupgrade", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { through: "0375_log_report_procedure_checks.sql" });
    const pool = new pg.Pool({ connectionString });
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const predecessor = await bootstrapFirstAcme(pool);
      const artifact = await persistPredecessorArtifact(client, predecessor);
      const pending = await buildAuthorizedJob(client, { predecessorDigest: predecessor.digest, propertyKey: "upgrade" });
      expect(await readActivationCheckpoint(db, predecessor.digest, ACTIVATION_CHECKPOINT_VERSION)).toBeNull();
      await applyMigrations(db, migrationsDir);
      expect(await readCheckpointEpoch(db)).toBeTruthy();
      expect((await db.query("select bytes_checksum from catalog_publication.release_artifacts where id = $1", [artifact.id])).rows)
        .toEqual([{ bytes_checksum: artifact.bytesChecksum }]);
      expect(await readActivationCheckpoint(db, predecessor.digest, ACTIVATION_CHECKPOINT_VERSION)).toBeNull();
      const outcome = await installPublishedRelease(pool, pending.command);
      expect(outcome.ok && outcome.value.status).toBe("installed");
      expect((await readActivationCheckpoint(db, pending.candidate.artifactDigest, ACTIVATION_CHECKPOINT_VERSION))?.compiledReleaseDigest)
        .toBe(pending.compiled.compiledReleaseDigest);
    } finally {
      await client.end();
      await pool.end();
    }
  });
}, 120_000);
