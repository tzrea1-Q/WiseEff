import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CATALOG_MIGRATION_OWNER,
  PUBLICATION_MIGRATION,
  PUBLICATION_RELATIONS,
  SCHEMA_MIGRATION,
  VERIFICATION_MIGRATION,
} from "../../catalog-kernel/security/catalogRoleManifest";
import { applyMigrations } from "../../../shared/database/migrations";
import { migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import {
  captureSavepointError,
  openEphemeralClient,
  requirePgvectorTestDatabase,
  sha256Digest,
  uniqueToken,
} from "./integrationHarness";

await requirePgvectorTestDatabase();

const IMMUTABLE_MIGRATIONS = [
  "0137_canonical_parameter_catalog_schema.sql",
  "0138_canonical_parameter_catalog_roles.sql",
  "0139_parameter_catalog_verification_core.sql",
] as const;

const fileChecksum = async (name: string): Promise<string> =>
  createHash("sha256")
    .update(await fs.readFile(path.join(migrationsDir, name), "utf8"))
    .digest("hex");

const insertRelease = async (
  client: pg.Client,
  id: string,
  sequence: number,
  digest: string,
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.catalog_releases (
       id, release_sequence, release_version, release_digest,
       compiled_model_digest, toolchain_digest, published_at
     ) values ($1, $2, $3, $4, $5, $6, '2026-09-12T00:00:00Z')`,
    [id, sequence, `${id}-v`, digest, sha256Digest(`${id}-model`), sha256Digest(`${id}-tool`)],
  );
};

const insertArtifact = async (
  client: pg.Client,
  options: {
    id: string;
    aggregate: string;
    bytes: Buffer;
    targetId?: string;
    targetDigest?: string;
    predecessorId?: string | null;
    predecessorDigest?: string | null;
  },
) =>
  client.query(
    `insert into catalog_publication.release_artifacts (
       id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
       target_release_id, target_release_digest, predecessor_release_id,
       predecessor_release_digest, toolchain
     ) values ($1, $2, $3, $4, 'typed-changeset', $5, $6, $7, $8, '{}'::jsonb)`,
    [
      options.id,
      options.aggregate,
      sha256Digest(options.bytes),
      options.bytes,
      options.targetId ?? "crel_target_unmaterialized",
      options.targetDigest ?? sha256Digest("target-unmaterialized"),
      options.predecessorId ?? null,
      options.predecessorDigest ?? null,
    ],
  );

const insertCandidate = async (
  client: pg.Client,
  options: {
    id: string;
    artifactId: string;
    artifactDigest: string;
    baseId?: string;
    baseDigest?: string;
  },
) =>
  client.query(
    `insert into catalog_publication.candidates (
       id, artifact_id, artifact_digest, expected_base_release_id,
       expected_base_release_digest, identity_allocation, impact_report_digest,
       capability_contract
     ) values ($1, $2, $3, $4, $5, '{}'::jsonb, $6, '{}'::jsonb)`,
    [
      options.id,
      options.artifactId,
      options.artifactDigest,
      options.baseId ?? "crel_expected_base",
      options.baseDigest ?? sha256Digest("expected-base"),
      sha256Digest(`${options.id}-impact`),
    ],
  );

const insertApprove = async (
  client: pg.Client,
  options: {
    id: string;
    candidateId: string;
    artifactDigest: string;
    baseId?: string;
    baseDigest?: string;
  },
) =>
  client.query(
    `insert into catalog_publication.publication_authorizations (
       id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
       expected_base_release_digest, impact_report_digest, capability_contract_digest,
       policy_revision, actor_principal_id
     ) values ($1, 'approve', $2, $3, $4, $5, $6, $7, 1, 'user-approver')`,
    [
      options.id,
      options.candidateId,
      options.artifactDigest,
      options.baseId ?? "crel_expected_base",
      options.baseDigest ?? sha256Digest("expected-base"),
      sha256Digest(`${options.candidateId}-impact`),
      sha256Digest("{}"),
    ],
  );

describe("catalog publication schema constraints", () => {
  let client: pg.Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openEphemeralClient("cp02sch");
    client = opened.client;
    drop = opened.drop;
  }, 120_000);

  afterAll(async () => {
    await drop?.();
  });

  it("records pgvector evidence and owns publication relations", async () => {
    const version = await client.query<{ version: string; db: string }>(
      "select version() as version, current_database() as db",
    );
    expect(version.rows[0]?.version).toMatch(/PostgreSQL 16/);
    expect(version.rows[0]?.db).toMatch(/^wiseeff_test_wk_/);

    const owners = await client.query<{ tablename: string; tableowner: string }>(
      `select tablename, tableowner
       from pg_catalog.pg_tables
       where schemaname = 'catalog_publication'
       order by tablename`,
    );
    expect(new Set(owners.rows.map((row) => row.tableowner))).toEqual(
      new Set([CATALOG_MIGRATION_OWNER]),
    );
    expect(owners.rows.map((row) => row.tablename).sort()).toEqual(
      [...PUBLICATION_RELATIONS].sort(),
    );

    const receipt = await client.query<{ tableowner: string }>(
      `select tableowner
       from pg_catalog.pg_tables
       where schemaname = 'parameter_catalog' and tablename = 'catalog_activation_receipts'`,
    );
    expect(receipt.rows).toEqual([{ tableowner: CATALOG_MIGRATION_OWNER }]);

    const publicGrants = await client.query<{ count: string }>(
      `select count(*)::text as count
       from information_schema.role_table_grants
       where table_schema in ('catalog_publication', 'parameter_catalog')
         and table_name in (
           'release_artifacts', 'candidates', 'publication_authorizations',
           'publication_jobs', 'publication_policies', 'publication_policy_revisions',
           'publication_guard', 'catalog_activation_receipts'
         )
         and grantee = 'PUBLIC'`,
    );
    expect(publicGrants.rows).toEqual([{ count: "0" }]);
  });

  it("seeds publication_enabled=false and low_risk_single_actor_publish=false", async () => {
    const policy = await client.query<{
      publication_enabled: boolean;
      low_risk_single_actor_publish: boolean;
      revision: string;
      capability_contract_revision: string;
    }>(
      `select publication_enabled, low_risk_single_actor_publish, revision::text as revision,
              capability_contract_revision
       from catalog_publication.publication_policies
       where singleton`,
    );
    expect(policy.rows).toEqual([
      {
        publication_enabled: false,
        low_risk_single_actor_publish: false,
        revision: "1",
        capability_contract_revision: "catalog-capability/v1",
      },
    ]);
  });

  it("T07.a stores aggregate digest independently of bytes checksum and rejects digest reuse with different bytes", async () => {
    const token = uniqueToken("t07a");
    const bytes = Buffer.from(`artifact-bytes-${token}`);
    const aggregate = sha256Digest(`aggregate-${token}`);
    expect(aggregate).not.toBe(sha256Digest(bytes));

    await client.query("begin");
    try {
      await insertArtifact(client, {
        id: `cart_${token}`,
        aggregate,
        bytes,
        predecessorId: "crel_pred_missing",
        predecessorDigest: sha256Digest("pred-missing"),
      });
      const stored = await client.query<{ artifact_digest: string; bytes_checksum: string }>(
        `select artifact_digest, bytes_checksum
         from catalog_publication.release_artifacts where id = $1`,
        [`cart_${token}`],
      );
      expect(stored.rows[0]?.artifact_digest).toBe(aggregate);
      expect(stored.rows[0]?.bytes_checksum).toBe(sha256Digest(bytes));

      const conflict = await captureSavepointError(client, () =>
        insertArtifact(client, {
          id: `cart_${token}b`,
          aggregate,
          bytes: Buffer.from(`other-bytes-${token}`),
        }),
      );
      expect(conflict.code).toBe("23505");
    } finally {
      await client.query("rollback");
    }
  });

  it("does not FK artifact target or predecessor pins to catalog_releases", async () => {
    const token = uniqueToken("nofk");
    await client.query("begin");
    try {
      const inserted = await insertArtifact(client, {
        id: `cart_${token}`,
        aggregate: sha256Digest(`agg-${token}`),
        bytes: Buffer.from(token),
        targetId: "crel_does_not_exist",
        targetDigest: sha256Digest("does-not-exist"),
        predecessorId: "crel_pred_does_not_exist",
        predecessorDigest: sha256Digest("pred-does-not-exist"),
      });
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("rollback");
    }
  });

  it("rejects artifact and candidate mutation as append-only", async () => {
    const token = uniqueToken("immut");
    await client.query("begin");
    try {
      const aggregate = sha256Digest(`agg-${token}`);
      await insertArtifact(client, {
        id: `cart_${token}`,
        aggregate,
        bytes: Buffer.from(token),
      });
      const update = await captureSavepointError(client, () =>
        client.query(
          `update catalog_publication.release_artifacts set source_kind = source_kind where id = $1`,
          [`cart_${token}`],
        ),
      );
      expect(update.code).toBe("55000");
      const deleted = await captureSavepointError(client, () =>
        client.query(`delete from catalog_publication.release_artifacts where id = $1`, [
          `cart_${token}`,
        ]),
      );
      expect(deleted.code).toBe("55000");
    } finally {
      await client.query("rollback");
    }
  });

  it("rejects candidate artifact_id/digest mismatch via composite FK", async () => {
    const token = uniqueToken("candfk");
    await client.query("begin");
    try {
      const aggregate = sha256Digest(`agg-${token}`);
      await insertArtifact(client, {
        id: `cart_${token}`,
        aggregate,
        bytes: Buffer.from(token),
      });
      const mismatch = await captureSavepointError(client, () =>
        insertCandidate(client, {
          id: `ccand_${token}`,
          artifactId: `cart_${token}`,
          artifactDigest: sha256Digest("other-digest"),
        }),
      );
      expect(mismatch.code).toBe("23503");
    } finally {
      await client.query("rollback");
    }
  });

  it("blocks revoke of a different candidate and revoke-of-revoke", async () => {
    const token = uniqueToken("rev");
    await client.query("begin");
    try {
      const firstDigest = sha256Digest(`agg-${token}-1`);
      const secondDigest = sha256Digest(`agg-${token}-2`);
      await insertArtifact(client, {
        id: `cart_${token}1`,
        aggregate: firstDigest,
        bytes: Buffer.from(`${token}-1`),
      });
      await insertArtifact(client, {
        id: `cart_${token}2`,
        aggregate: secondDigest,
        bytes: Buffer.from(`${token}-2`),
      });
      await insertCandidate(client, {
        id: `ccand_${token}1`,
        artifactId: `cart_${token}1`,
        artifactDigest: firstDigest,
      });
      await insertCandidate(client, {
        id: `ccand_${token}2`,
        artifactId: `cart_${token}2`,
        artifactDigest: secondDigest,
      });
      await insertApprove(client, {
        id: `cauth_${token}1`,
        candidateId: `ccand_${token}1`,
        artifactDigest: firstDigest,
      });
      await insertApprove(client, {
        id: `cauth_${token}2`,
        candidateId: `ccand_${token}2`,
        artifactDigest: secondDigest,
      });

      const cross = await captureSavepointError(client, () =>
        client.query(
          `insert into catalog_publication.publication_authorizations (
             id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
             expected_base_release_digest, impact_report_digest, capability_contract_digest,
             policy_revision, actor_principal_id, approved_authorization_id
           ) values (
             $1, 'revoke', $2, $3, 'crel_expected_base', $4, $5, $6, 1, 'user-revoker', $7
           )`,
          [
            `cauth_${token}x`,
            `ccand_${token}2`,
            secondDigest,
            sha256Digest("expected-base"),
            sha256Digest(`ccand_${token}2-impact`),
            sha256Digest("{}"),
            `cauth_${token}1`,
          ],
        ),
      );
      expect(cross.code).toBe("23514");

      const legalRevoke = await client.query(
        `insert into catalog_publication.publication_authorizations (
           id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
           expected_base_release_digest, impact_report_digest, capability_contract_digest,
           policy_revision, actor_principal_id, approved_authorization_id
         ) values (
           $1, 'revoke', $2, $3, 'crel_expected_base', $4, $5, $6, 1, 'user-revoker', $7
         )`,
        [
          `cauth_${token}r`,
          `ccand_${token}1`,
          firstDigest,
          sha256Digest("expected-base"),
          sha256Digest(`ccand_${token}1-impact`),
          sha256Digest("{}"),
          `cauth_${token}1`,
        ],
      );
      expect(legalRevoke.rowCount).toBe(1);

      const revokeRevoke = await captureSavepointError(client, () =>
        client.query(
          `insert into catalog_publication.publication_authorizations (
             id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
             expected_base_release_digest, impact_report_digest, capability_contract_digest,
             policy_revision, actor_principal_id, approved_authorization_id
           ) values (
             $1, 'revoke', $2, $3, 'crel_expected_base', $4, $5, $6, 1, 'user-revoker', $7
           )`,
          [
            `cauth_${token}rr`,
            `ccand_${token}1`,
            firstDigest,
            sha256Digest("expected-base"),
            sha256Digest(`ccand_${token}1-impact`),
            sha256Digest("{}"),
            `cauth_${token}r`,
          ],
        ),
      );
      expect(revokeRevoke.code).toBe("23514");

      const mutate = await captureSavepointError(client, () =>
        client.query(
          `update catalog_publication.publication_authorizations
           set event_kind = 'revoke', approved_authorization_id = $2
           where id = $1`,
          [`cauth_${token}2`, `cauth_${token}1`],
        ),
      );
      expect(mutate.code).toBe("55000");
    } finally {
      await client.query("rollback");
    }
  });

  it("rejects job identity column UPDATE and allows lease/fence execution UPDATE", async () => {
    const token = uniqueToken("jobid");
    await client.query("begin");
    try {
      const aggregate = sha256Digest(`agg-${token}`);
      await insertArtifact(client, {
        id: `cart_${token}`,
        aggregate,
        bytes: Buffer.from(token),
      });
      await insertCandidate(client, {
        id: `ccand_${token}`,
        artifactId: `cart_${token}`,
        artifactDigest: aggregate,
      });
      await insertApprove(client, {
        id: `cauth_${token}`,
        candidateId: `ccand_${token}`,
        artifactDigest: aggregate,
      });
      await client.query(
        `insert into catalog_publication.publication_jobs (
           id, candidate_id, authorization_id, request_scope, idempotency_key,
           request_digest, status
         ) values ($1, $2, $3, 'instance:test', $4, $5, 'queued')`,
        [`cjob_${token}`, `ccand_${token}`, `cauth_${token}`, token, sha256Digest(token)],
      );

      const identity = await captureSavepointError(client, () =>
        client.query(
          `update catalog_publication.publication_jobs
           set request_digest = $2
           where id = $1`,
          [`cjob_${token}`, sha256Digest("other")],
        ),
      );
      expect(identity.code).toBe("55000");

      const execution = await client.query(
        `update catalog_publication.publication_jobs
         set status = 'running', lease_owner = 'worker-1', fencing_token = 1
         where id = $1`,
        [`cjob_${token}`],
      );
      expect(execution.rowCount).toBe(1);
    } finally {
      await client.query("rollback");
    }
  });

  it("rejects same scope/key with a different request digest at uniqueness", async () => {
    const token = uniqueToken("idemp");
    await client.query("begin");
    try {
      const aggregate = sha256Digest(`agg-${token}`);
      await insertArtifact(client, {
        id: `cart_${token}`,
        aggregate,
        bytes: Buffer.from(token),
      });
      await insertCandidate(client, {
        id: `ccand_${token}`,
        artifactId: `cart_${token}`,
        artifactDigest: aggregate,
      });
      await insertApprove(client, {
        id: `cauth_${token}`,
        candidateId: `ccand_${token}`,
        artifactDigest: aggregate,
      });
      await client.query(
        `insert into catalog_publication.publication_jobs (
           id, candidate_id, authorization_id, request_scope, idempotency_key,
           request_digest, status
         ) values ($1, $2, $3, 'instance:test', 'same-key', $4, 'queued')`,
        [`cjob_${token}a`, `ccand_${token}`, `cauth_${token}`, sha256Digest("req-a")],
      );
      const conflict = await captureSavepointError(client, () =>
        client.query(
          `insert into catalog_publication.publication_jobs (
             id, candidate_id, authorization_id, request_scope, idempotency_key,
             request_digest, status
           ) values ($1, $2, $3, 'instance:test', 'same-key', $4, 'queued')`,
          [`cjob_${token}b`, `ccand_${token}`, `cauth_${token}`, sha256Digest("req-b")],
        ),
      );
      expect(conflict.code).toBe("23505");
    } finally {
      await client.query("rollback");
    }
  });

  it("T07.b / T24: receipt kind CHECKs reject missing online refs, cross-candidate, and forged adoption/bootstrap jobs", async () => {
    const token = uniqueToken("rcpt");
    await client.query("begin");
    try {
      const releaseId = `crel_${token}`;
      const releaseDigest = sha256Digest(`rel-${token}`);
      await insertRelease(client, releaseId, 89100 + (process.pid % 1000), releaseDigest);

      const firstDigest = sha256Digest(`agg-${token}-1`);
      const secondDigest = sha256Digest(`agg-${token}-2`);
      await insertArtifact(client, {
        id: `cart_${token}1`,
        aggregate: firstDigest,
        bytes: Buffer.from(`${token}-1`),
      });
      await insertArtifact(client, {
        id: `cart_${token}2`,
        aggregate: secondDigest,
        bytes: Buffer.from(`${token}-2`),
      });
      await insertCandidate(client, {
        id: `ccand_${token}1`,
        artifactId: `cart_${token}1`,
        artifactDigest: firstDigest,
      });
      await insertCandidate(client, {
        id: `ccand_${token}2`,
        artifactId: `cart_${token}2`,
        artifactDigest: secondDigest,
      });
      await insertApprove(client, {
        id: `cauth_${token}1`,
        candidateId: `ccand_${token}1`,
        artifactDigest: firstDigest,
      });
      await insertApprove(client, {
        id: `cauth_${token}2`,
        candidateId: `ccand_${token}2`,
        artifactDigest: secondDigest,
      });
      await client.query(
        `insert into catalog_publication.publication_jobs (
           id, candidate_id, authorization_id, request_scope, idempotency_key,
           request_digest, status
         ) values ($1, $2, $3, 'instance:test', $4, $5, 'queued')`,
        [
          `cjob_${token}1`,
          `ccand_${token}1`,
          `cauth_${token}1`,
          `${token}-1`,
          sha256Digest(`${token}-1`),
        ],
      );
      await client.query(
        `insert into catalog_publication.publication_jobs (
           id, candidate_id, authorization_id, request_scope, idempotency_key,
           request_digest, status
         ) values ($1, $2, $3, 'instance:test', $4, $5, 'queued')`,
        [
          `cjob_${token}2`,
          `ccand_${token}2`,
          `cauth_${token}2`,
          `${token}-2`,
          sha256Digest(`${token}-2`),
        ],
      );

      const missingOnline = await captureSavepointError(client, () =>
        client.query(
          `insert into parameter_catalog.catalog_activation_receipts (
             id, kind, release_id, release_digest, verification_digest, actor_principal_id
           ) values ($1, 'online-publication', $2, $3, $4, 'sync')`,
          [`crct_${token}miss`, releaseId, releaseDigest, sha256Digest("verify")],
        ),
      );
      expect(missingOnline.code).toBe("23514");

      const cross = await captureSavepointError(client, () =>
        client.query(
          `insert into parameter_catalog.catalog_activation_receipts (
             id, kind, release_id, release_digest, verification_digest,
             publication_job_id, authorization_id, candidate_id, actor_principal_id
           ) values ($1, 'online-publication', $2, $3, $4, $5, $6, $7, 'sync')`,
          [
            `crct_${token}cross`,
            releaseId,
            releaseDigest,
            sha256Digest("verify"),
            `cjob_${token}1`,
            `cauth_${token}2`,
            `ccand_${token}2`,
          ],
        ),
      );
      expect(["23503", "23514"]).toContain(cross.code);

      const forgedAdoption = await captureSavepointError(client, () =>
        client.query(
          `insert into parameter_catalog.catalog_activation_receipts (
             id, kind, release_id, release_digest, verification_digest,
             publication_job_id, authorization_id, candidate_id, actor_principal_id,
             adoption_evidence
           ) values ($1, 'adopted-preexisting', $2, $3, $4, $5, $6, $7, 'sync', '{}'::jsonb)`,
          [
            `crct_${token}adoptj`,
            releaseId,
            releaseDigest,
            sha256Digest("verify"),
            `cjob_${token}1`,
            `cauth_${token}1`,
            `ccand_${token}1`,
          ],
        ),
      );
      expect(forgedAdoption.code).toBe("23514");

      const forgedBootstrap = await captureSavepointError(client, () =>
        client.query(
          `insert into parameter_catalog.catalog_activation_receipts (
             id, kind, release_id, release_digest, verification_digest,
             publication_job_id, actor_principal_id, adoption_evidence
           ) values ($1, 'bootstrap', $2, $3, $4, $5, 'sync', '{}'::jsonb)`,
          [
            `crct_${token}bootj`,
            releaseId,
            releaseDigest,
            sha256Digest("verify"),
            `cjob_${token}1`,
          ],
        ),
      );
      expect(forgedBootstrap.code).toBe("23514");

      const illegalAdoption = await captureSavepointError(client, () =>
        client.query(
          `insert into parameter_catalog.catalog_activation_receipts (
             id, kind, release_id, release_digest, verification_digest, actor_principal_id
           ) values ($1, 'adopted-preexisting', $2, $3, $4, 'operator')`,
          [`crct_${token}bad`, releaseId, releaseDigest, sha256Digest("verify-bad")],
        ),
      );
      expect(illegalAdoption.code).toBe("23514");

      const legalAdoption = await client.query(
        `insert into parameter_catalog.catalog_activation_receipts (
           id, kind, release_id, release_digest, verification_digest,
           actor_principal_id, adoption_evidence
         ) values ($1, 'adopted-preexisting', $2, $3, $4, 'operator', $5::jsonb)`,
        [
          `crct_${token}adopt`,
          releaseId,
          releaseDigest,
          sha256Digest("verify-adopt"),
          JSON.stringify({ bundleDigest: sha256Digest("bundle"), collectedAt: "2026-09-12" }),
        ],
      );
      expect(legalAdoption.rowCount).toBe(1);

      const online = await client.query(
        `insert into parameter_catalog.catalog_activation_receipts (
           id, kind, release_id, release_digest, verification_digest,
           publication_job_id, authorization_id, candidate_id, actor_principal_id
         ) values ($1, 'online-publication', $2, $3, $4, $5, $6, $7, 'sync')`,
        [
          `crct_${token}on`,
          releaseId,
          releaseDigest,
          sha256Digest("verify-on"),
          `cjob_${token}1`,
          `cauth_${token}1`,
          `ccand_${token}1`,
        ],
      );
      expect(online.rowCount).toBe(1);
    } finally {
      await client.query("rollback");
    }
  });

  it("replays applyMigrations without re-applying 0140 or changing old checksums", async () => {
    const checksumsBefore = await client.query<{ name: string; checksum: string }>(
      `select name, checksum
       from schema_migrations
       where name = any($1::text[])
       order by name`,
      [[...IMMUTABLE_MIGRATIONS, PUBLICATION_MIGRATION]],
    );
    expect(checksumsBefore.rows.map((row) => row.name)).toEqual([
      ...IMMUTABLE_MIGRATIONS,
      PUBLICATION_MIGRATION,
    ]);
    for (const row of checksumsBefore.rows) {
      expect(row.checksum).toBe(await fileChecksum(row.name));
    }

    const { createDatabase } = await import("../../../shared/database/client");
    const db = createDatabase({
      query: async (text, values = []) => {
        const result = await client.query(text, values);
        return { rows: result.rows, rowCount: result.rowCount };
      },
    });
    const applied = await applyMigrations(db, migrationsDir);
    expect(applied).toEqual([]);

    const checksumsAfter = await client.query<{ name: string; checksum: string }>(
      `select name, checksum
       from schema_migrations
       where name = any($1::text[])
       order by name`,
      [[...IMMUTABLE_MIGRATIONS, PUBLICATION_MIGRATION]],
    );
    expect(checksumsAfter.rows).toEqual(checksumsBefore.rows);
  });
});

describe("0140 migration on a populated catalog", () => {
  it("leaves catalog release IDs, digests, and business values unchanged", async () => {
    await withTempDatabase({ prefix: "cp02pop", migrate: false }, async ({ db }) => {
      const through139 = await applyMigrations(db, migrationsDir, {
        through: VERIFICATION_MIGRATION,
      });
      expect(through139.at(-1)).toBe(VERIFICATION_MIGRATION);
      expect(through139.includes(PUBLICATION_MIGRATION)).toBe(false);
      expect(through139[0]).toBeDefined();
      expect(SCHEMA_MIGRATION < VERIFICATION_MIGRATION).toBe(true);

      const fixture = {
        orgId: "org-cp02-pop",
        projectId: "prj-cp02-pop",
        projectCode: "CP02POP",
        attributionId: "asub-cp02-pop",
        moduleId: "pmod-cp02-pop",
        releaseId: "crel-cp02-pop",
        releaseDigest: "sha256:cp02-pop-release",
        subjectId: "csub-cp02-pop",
        definitionId: "pdef-cp02-pop",
        revisionId: "drev-cp02-pop",
        registrationId: "reg-cp02-pop",
        placementId: "place-cp02-pop",
        bindingId: "bind-cp02-pop",
        valueId: "pval-cp02-pop",
      };

      await db.transaction(async (tx) => {
      await tx.query(`
        insert into public.organizations (id, name) values ('${fixture.orgId}', 'CP-02 pop');
        insert into public.projects (id, organization_id, name, code)
        values ('${fixture.projectId}', '${fixture.orgId}', 'CP-02 pop', '${fixture.projectCode}');
        insert into public.attribution_subjects (
          id, organization_id, subject_kind, display_name, source_key
        ) values (
          '${fixture.attributionId}', '${fixture.orgId}', 'driver-registration',
          'CP-02 pop', 'compatible:cp02,pop'
        );
        insert into public.driver_registrations (
          attribution_subject_id, driver_nature, instance_cardinality
        ) values ('${fixture.attributionId}', 'physical-device', 'multiple');
        insert into public.parameter_modules (
          id, organization_id, name, path, depth, kind, origin, attribution_subject_id
        ) values (
          '${fixture.moduleId}', '${fixture.orgId}', 'CP-02 pop',
          '${fixture.moduleId}', 1, 'driver-group', 'curated', '${fixture.attributionId}'
        );
        insert into parameter_catalog.catalog_releases (
          id, release_sequence, release_version, release_digest,
          compiled_model_digest, toolchain_digest, published_at
        ) values (
          '${fixture.releaseId}', 89200, 'cp02-pop', '${fixture.releaseDigest}',
          'sha256:cp02-pop-model', 'sha256:cp02-pop-toolchain', '2026-09-12T00:00:00Z'
        );
        insert into parameter_catalog.catalog_subjects (
          id, introduced_release_id, kind, canonical_key
        ) values ('${fixture.subjectId}', '${fixture.releaseId}', 'driver', 'cp02,pop');
        insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
        values ('${fixture.subjectId}', 'physical-device', 'multiple');
        insert into parameter_catalog.catalog_release_subjects (
          release_id, subject_id, lifecycle, selector_snapshot, selector_provenance
        ) values ('${fixture.releaseId}', '${fixture.subjectId}', 'active', '{}', '{}');
        insert into parameter_catalog.organization_subject_registrations (
          id, organization_id, subject_id, status, registration_method, proof, current_placement_id
        ) values (
          '${fixture.registrationId}', '${fixture.orgId}', '${fixture.subjectId}',
          'active', 'explicit', '{}', '${fixture.placementId}'
        );
        insert into parameter_catalog.subject_placements (
          id, registration_id, organization_id, module_id, origin
        ) values (
          '${fixture.placementId}', '${fixture.registrationId}',
          '${fixture.orgId}', '${fixture.moduleId}', 'curated'
        );
        insert into parameter_catalog.parameter_definitions (
          id, introduced_release_id, subject_id, property_key, current_revision_id
        ) values (
          '${fixture.definitionId}', '${fixture.releaseId}',
          '${fixture.subjectId}', 'iin_max', '${fixture.revisionId}'
        );
        insert into parameter_catalog.definition_revisions (
          id, definition_id, revision_number, catalog_release_id, content_digest, content
        ) values (
          '${fixture.revisionId}', '${fixture.definitionId}', 1,
          '${fixture.releaseId}', 'sha256:cp02-pop-rev', '{}'
        );
        insert into parameter_catalog.catalog_release_definition_heads (
          release_id, definition_id, revision_id
        ) values (
          '${fixture.releaseId}', '${fixture.definitionId}', '${fixture.revisionId}'
        );
        insert into parameter_catalog.catalog_materializations (
          release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
        ) values (
          '${fixture.releaseId}',
          'sha256:cp02-pop-compiled-fp',
          'sha256:cp02-pop-database-fp',
          'cp02-pop-attempt',
          'cp02-pop-audit'
        );
        insert into parameter_catalog.project_parameter_bindings (
          id, organization_id, catalog_release_id, project_id, logical_node_id, registration_id,
          subject_id, definition_id, effective_revision_id, current_value_id
        ) values (
          '${fixture.bindingId}', '${fixture.orgId}', '${fixture.releaseId}',
          '${fixture.projectId}', 'logical-cp02', '${fixture.registrationId}',
          '${fixture.subjectId}', '${fixture.definitionId}',
          '${fixture.revisionId}', '${fixture.valueId}'
        );
        insert into parameter_catalog.project_parameter_values (
          id, binding_id, definition_id, definition_revision_id,
          source_ref, config_revision_id, value_digest, value_kind, value
        ) values (
          '${fixture.valueId}', '${fixture.bindingId}', '${fixture.definitionId}',
          '${fixture.revisionId}', 'source-cp02', 'config-cp02', 'sha256:cp02-value', 'number', '7'
        );
      `);
      await tx.query("set constraints all immediate");
      });

      const snapshot = await db.query<{
        release_id: string;
        release_digest: string;
        binding_id: string;
        value_id: string;
        value: string;
        release_count: string;
        value_count: string;
      }>(`
        select
          release.id as release_id,
          release.release_digest,
          binding.id as binding_id,
          value.id as value_id,
          value.value,
          (select count(*)::text from parameter_catalog.catalog_releases) as release_count,
          (select count(*)::text from parameter_catalog.project_parameter_values) as value_count
        from parameter_catalog.catalog_releases release
        join parameter_catalog.project_parameter_bindings binding
          on binding.catalog_release_id = release.id
        join parameter_catalog.project_parameter_values value
          on value.binding_id = binding.id
        where release.id = '${fixture.releaseId}'
      `);

      const applied140 = await applyMigrations(db, migrationsDir, {
        through: PUBLICATION_MIGRATION,
      });
      expect(applied140).toEqual([PUBLICATION_MIGRATION]);
      expect(await applyMigrations(db, migrationsDir, { through: PUBLICATION_MIGRATION })).toEqual(
        [],
      );

      const after = await db.query<{
        release_id: string;
        release_digest: string;
        binding_id: string;
        value_id: string;
        value: string;
        release_count: string;
        value_count: string;
      }>(`
        select
          release.id as release_id,
          release.release_digest,
          binding.id as binding_id,
          value.id as value_id,
          value.value,
          (select count(*)::text from parameter_catalog.catalog_releases) as release_count,
          (select count(*)::text from parameter_catalog.project_parameter_values) as value_count
        from parameter_catalog.catalog_releases release
        join parameter_catalog.project_parameter_bindings binding
          on binding.catalog_release_id = release.id
        join parameter_catalog.project_parameter_values value
          on value.binding_id = binding.id
        where release.id = '${fixture.releaseId}'
      `);
      expect(after.rows).toEqual(snapshot.rows);
      expect(after.rows[0]).toMatchObject({
        release_id: fixture.releaseId,
        release_digest: fixture.releaseDigest,
        binding_id: fixture.bindingId,
        value_id: fixture.valueId,
      });
      expect(String(after.rows[0]?.value)).toBe("7");

      const policy = await db.query<{ publication_enabled: boolean }>(
        `select publication_enabled from catalog_publication.publication_policies where singleton`,
      );
      expect(policy.rows).toEqual([{ publication_enabled: false }]);
    });
  }, 180_000);
});
