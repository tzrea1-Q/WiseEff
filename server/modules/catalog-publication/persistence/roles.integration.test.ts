import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CATALOG_BASELINE_READER_ROLE,
  CATALOG_MIGRATION_OWNER,
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
  PUBLICATION_GUARD_FUNCTION_IDENTITY,
  REVISE_PUBLICATION_POLICY_FUNCTION_IDENTITY,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import {
  captureDatabaseError,
  captureRoleStatementError,
  captureSavepointError,
  openEphemeralClient,
  requirePgvectorTestDatabase,
  sha256Digest,
  uniqueToken,
  withLocalRole,
  withProductionLogin,
} from "./integrationHarness";

await requirePgvectorTestDatabase();

const assertSqlstate42501 = (error: pg.DatabaseError): void => {
  expect(error.code).toBe("42501");
  expect(error.message.toLowerCase()).toContain("permission denied");
};

describe("catalog publication role isolation T03.a", () => {
  let client: pg.Client;
  let url: string;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openEphemeralClient("cp02rol");
    client = opened.client;
    url = opened.url;
    drop = opened.drop;
  }, 120_000);

  afterAll(async () => {
    await drop?.();
  });

  it("creates NOLOGIN nosuperuser publication roles", async () => {
    const roles = await client.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolinherit: boolean;
    }>(
      `select rolname, rolcanlogin, rolsuper, rolinherit
       from pg_catalog.pg_roles
       where rolname = any($1::text[])
       order by rolname`,
      [[CATALOG_PUBLICATION_COORDINATOR_ROLE, CATALOG_BASELINE_READER_ROLE]],
    );
    expect(roles.rows).toEqual([
      {
        rolname: CATALOG_BASELINE_READER_ROLE,
        rolcanlogin: false,
        rolsuper: false,
        rolinherit: false,
      },
      {
        rolname: CATALOG_PUBLICATION_COORDINATOR_ROLE,
        rolcanlogin: false,
        rolsuper: false,
        rolinherit: false,
      },
    ]);
  });

  it("ordinary application LOGIN cannot write Catalog/publication/receipts or SET ROLE writers", async () => {
    await withProductionLogin(client, url, "app", async (login) => {
      const catalog = await captureDatabaseError(
        login.query("select * from parameter_catalog.catalog_releases"),
      );
      assertSqlstate42501(catalog);

      const publication = await captureDatabaseError(
        login.query("select * from catalog_publication.publication_policies"),
      );
      assertSqlstate42501(publication);

      const receipt = await captureDatabaseError(
        login.query("select * from parameter_catalog.catalog_activation_receipts"),
      );
      assertSqlstate42501(receipt);

      for (const writer of [
        CATALOG_MIGRATION_OWNER,
        CATALOG_SYNCHRONIZER_ROLE,
        CATALOG_PUBLICATION_COORDINATOR_ROLE,
        PARAMETER_GOVERNANCE_WRITER_ROLE,
      ]) {
        const setRole = await captureDatabaseError(
          login.query(`set role ${quoteIdent(writer)}`),
        );
        assertSqlstate42501(setRole);
      }
    });
  });

  it("coordinator inserts artifacts/candidates and cannot mutate them or write Catalog/receipts", async () => {
    const token = uniqueToken("coord");
    const aggregate = sha256Digest(`agg-${token}`);
    const bytes = Buffer.from(token);

    await withLocalRole(client, CATALOG_PUBLICATION_COORDINATOR_ROLE, async () => {
      const inserted = await client.query(
        `insert into catalog_publication.release_artifacts (
           id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
           target_release_id, target_release_digest, toolchain
         ) values ($1, $2, $3, $4, 'typed-changeset', 'crel_target', $5, '{}'::jsonb)`,
        [`cart_${token}`, aggregate, sha256Digest(bytes), bytes, sha256Digest("target")],
      );
      expect(inserted.rowCount).toBe(1);

      const candidate = await client.query(
        `insert into catalog_publication.candidates (
           id, artifact_id, artifact_digest, expected_base_release_id,
           expected_base_release_digest, identity_allocation, impact_report_digest,
           capability_contract
         ) values ($1, $2, $3, 'crel_base', $4, '{}'::jsonb, $5, '{}'::jsonb)`,
        [
          `ccand_${token}`,
          `cart_${token}`,
          aggregate,
          sha256Digest("base"),
          sha256Digest("impact"),
        ],
      );
      expect(candidate.rowCount).toBe(1);
    });

    const update = await captureRoleStatementError(
      client,
      CATALOG_PUBLICATION_COORDINATOR_ROLE,
      `update catalog_publication.release_artifacts set source_kind = source_kind where false`,
    );
    expect(["42501", "55000"]).toContain(update.code);

    const deleted = await captureRoleStatementError(
      client,
      CATALOG_PUBLICATION_COORDINATOR_ROLE,
      `delete from catalog_publication.candidates where false`,
    );
    expect(["42501", "55000"]).toContain(deleted.code);

    const catalogWrite = await captureRoleStatementError(
      client,
      CATALOG_PUBLICATION_COORDINATOR_ROLE,
      `insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values (
         'crel-coord-forbidden', 89300, 'coord-forbidden', 'sha256:coord-forbidden',
         'sha256:coord-forbidden-model', 'sha256:coord-forbidden-tool', now()
       )`,
    );
    assertSqlstate42501(catalogWrite);

    const receiptWrite = await captureRoleStatementError(
      client,
      CATALOG_PUBLICATION_COORDINATOR_ROLE,
      `insert into parameter_catalog.catalog_activation_receipts (
         id, kind, release_id, release_digest, verification_digest, actor_principal_id,
         adoption_evidence
       ) values (
         'crct_coord_forbidden', 'bootstrap', 'crel-x', $1, $1, 'coord', '{}'::jsonb
       )`,
      [sha256Digest("receipt")],
    );
    assertSqlstate42501(receiptWrite);

    const truncate = await captureRoleStatementError(
      client,
      CATALOG_PUBLICATION_COORDINATOR_ROLE,
      "truncate catalog_publication.release_artifacts",
    );
    assertSqlstate42501(truncate);
  });

  it("coordinator LOGIN cannot SET ROLE to synchronizer or migration owner or grant extra rights", async () => {
    await withProductionLogin(
      client,
      url,
      "coord",
      async (login) => {
        await login.query(`set role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
        const policy = await login.query<{ publication_enabled: boolean }>(
          `select publication_enabled from catalog_publication.publication_policies where singleton`,
        );
        expect(policy.rows).toEqual([{ publication_enabled: false }]);

        const toSynchronizer = await captureDatabaseError(
          login.query(`set role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`),
        );
        assertSqlstate42501(toSynchronizer);

        await login.query(`set role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
        const toOwner = await captureDatabaseError(
          login.query(`set role ${quoteIdent(CATALOG_MIGRATION_OWNER)}`),
        );
        assertSqlstate42501(toOwner);

        await login.query(`set role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
        const grantBackdoor = await captureDatabaseError(
          login.query(
            `grant insert on parameter_catalog.catalog_releases to ${quoteIdent(
              CATALOG_PUBLICATION_COORDINATOR_ROLE,
            )}`,
          ),
        );
        assertSqlstate42501(grantBackdoor);

        const definer = await captureDatabaseError(
          login.query(`
            create function catalog_publication.forged_writer()
            returns void
            language sql
            security definer
            as $$ insert into parameter_catalog.catalog_releases (
              id, release_sequence, release_version, release_digest,
              compiled_model_digest, toolchain_digest, published_at
            ) values (
              'forged-pub', 1, 'forged-pub', 'sha256:forged-pub',
              'sha256:forged-pub-model', 'sha256:forged-pub-tool', now()
            ) $$
          `),
        );
        assertSqlstate42501(definer);
      },
      CATALOG_PUBLICATION_COORDINATOR_ROLE,
    );
  });

  it("coordinator can EXECUTE policy revise and guard lock; synchronizer cannot enable policy", async () => {
    await withLocalRole(client, CATALOG_PUBLICATION_COORDINATOR_ROLE, async () => {
      await client.query(`select ${PUBLICATION_GUARD_FUNCTION_IDENTITY}`);
      const revision = await client.query<{ revise_publication_policy: string }>(
        `select catalog_publication.revise_publication_policy(false, false, 'catalog-capability/v1', 'coord-test')`,
      );
      expect(Number(revision.rows[0]?.revise_publication_policy)).toBeGreaterThan(1);
    });

    const syncPolicy = await captureRoleStatementError(
      client,
      CATALOG_SYNCHRONIZER_ROLE,
      `select catalog_publication.revise_publication_policy(true, true, 'catalog-capability/v1', 'sync')`,
    );
    assertSqlstate42501(syncPolicy);

    const writerPolicy = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `select ${REVISE_PUBLICATION_POLICY_FUNCTION_IDENTITY.replace(
        "boolean,boolean,text,text",
        "true, true, 'catalog-capability/v1', 'writer'",
      )}`,
    );
    assertSqlstate42501(writerPolicy);

    const readerExecute = await captureRoleStatementError(
      client,
      CATALOG_BASELINE_READER_ROLE,
      `select ${PUBLICATION_GUARD_FUNCTION_IDENTITY}`,
    );
    assertSqlstate42501(readerExecute);
  });

  it("synchronizer inserts receipts and cannot insert artifacts, jobs, or authorizations", async () => {
    const token = uniqueToken("sync");
    const releaseId = `crel_${token}`;
    const releaseDigest = sha256Digest(`rel-${token}`);
    await client.query(
      `insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values ($1, $2, $3, $4, $5, $6, '2026-09-12T00:00:00Z')`,
      [
        releaseId,
        89400 + (process.pid % 500),
        `${releaseId}-v`,
        releaseDigest,
        sha256Digest(`${token}-model`),
        sha256Digest(`${token}-tool`),
      ],
    );

    await withLocalRole(client, CATALOG_SYNCHRONIZER_ROLE, async () => {
      const receipt = await client.query(
        `insert into parameter_catalog.catalog_activation_receipts (
           id, kind, release_id, release_digest, verification_digest,
           actor_principal_id, adoption_evidence
         ) values ($1, 'adopted-preexisting', $2, $3, $4, 'sync', '{"source":"cp-02"}'::jsonb)`,
        [`crct_${token}`, releaseId, releaseDigest, sha256Digest(`verify-${token}`)],
      );
      expect(receipt.rowCount).toBe(1);
    });

    const artifact = await captureRoleStatementError(
      client,
      CATALOG_SYNCHRONIZER_ROLE,
      `insert into catalog_publication.release_artifacts (
         id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
         target_release_id, target_release_digest, toolchain
       ) values (
         'cart_sync_forbidden', $1, $1, $2, 'typed-changeset', 'crel_x', $1, '{}'::jsonb
       )`,
      [sha256Digest("sync-art"), Buffer.from("x")],
    );
    assertSqlstate42501(artifact);

    const job = await captureRoleStatementError(
      client,
      CATALOG_SYNCHRONIZER_ROLE,
      `insert into catalog_publication.publication_jobs (
         id, candidate_id, authorization_id, request_scope, idempotency_key,
         request_digest, status
       ) values ('cjob_sync_forbidden', 'ccand_x', 'cauth_x', 'scope', 'key', $1, 'queued')`,
      [sha256Digest("job")],
    );
    assertSqlstate42501(job);
  });

  it("baseline reader can SELECT catalog and publication relations but not write or TRUNCATE", async () => {
    await withLocalRole(client, CATALOG_BASELINE_READER_ROLE, async () => {
      const releases = await client.query("select count(*)::int as n from parameter_catalog.catalog_releases");
      expect(releases.rows[0]?.n).toBeGreaterThanOrEqual(0);
      const policies = await client.query(
        "select publication_enabled from catalog_publication.publication_policies where singleton",
      );
      expect(policies.rows).toEqual([{ publication_enabled: false }]);
    });

    const insert = await captureRoleStatementError(
      client,
      CATALOG_BASELINE_READER_ROLE,
      `insert into catalog_publication.publication_guard (singleton) values (true)`,
    );
    expect(["23505", "42501"]).toContain(insert.code);

    const update = await captureRoleStatementError(
      client,
      CATALOG_BASELINE_READER_ROLE,
      `update catalog_publication.publication_guard set epoch = epoch + 1`,
    );
    assertSqlstate42501(update);

    const truncate = await captureRoleStatementError(
      client,
      CATALOG_BASELINE_READER_ROLE,
      "truncate catalog_publication.publication_policies",
    );
    assertSqlstate42501(truncate);

    const disable = await captureRoleStatementError(
      client,
      CATALOG_BASELINE_READER_ROLE,
      "alter table catalog_publication.release_artifacts disable trigger all",
    );
    expect(disable.code).toBe("42501");
    expect(disable.message.toLowerCase()).toMatch(/permission denied|must be owner/);
  });

  it("governance writer has no publication schema DML and no receipts", async () => {
    const publication = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      "select * from catalog_publication.publication_policies",
    );
    assertSqlstate42501(publication);

    const receipt = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      "select * from parameter_catalog.catalog_activation_receipts",
    );
    assertSqlstate42501(receipt);

    const insert = await captureRoleStatementError(
      client,
      PARAMETER_GOVERNANCE_WRITER_ROLE,
      `insert into parameter_catalog.catalog_activation_receipts (
         id, kind, release_id, release_digest, verification_digest, actor_principal_id,
         adoption_evidence
       ) values ('crct_gov_forbidden', 'bootstrap', 'crel_x', $1, $1, 'gov', '{}'::jsonb)`,
      [sha256Digest("gov")],
    );
    assertSqlstate42501(insert);
  });

  it("coordinator job identity UPDATE is rejected while lease/fence UPDATE is allowed", async () => {
    const token = uniqueToken("jobacl");
    const aggregate = sha256Digest(`agg-${token}`);
    const bytes = Buffer.from(token);

    await client.query("begin");
    await client.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
    try {
      await client.query(
        `insert into catalog_publication.release_artifacts (
           id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
           target_release_id, target_release_digest, toolchain
         ) values ($1, $2, $3, $4, 'typed-changeset', 'crel_target', $5, '{}'::jsonb)`,
        [`cart_${token}`, aggregate, sha256Digest(bytes), bytes, sha256Digest("target")],
      );
      await client.query(
        `insert into catalog_publication.candidates (
           id, artifact_id, artifact_digest, expected_base_release_id,
           expected_base_release_digest, identity_allocation, impact_report_digest,
           capability_contract
         ) values ($1, $2, $3, 'crel_base', $4, '{}'::jsonb, $5, '{}'::jsonb)`,
        [`ccand_${token}`, `cart_${token}`, aggregate, sha256Digest("base"), sha256Digest("impact")],
      );
      await client.query(
        `insert into catalog_publication.publication_authorizations (
           id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
           expected_base_release_digest, impact_report_digest, capability_contract_digest,
           policy_revision, actor_principal_id
         ) values ($1, 'approve', $2, $3, 'crel_base', $4, $5, $6, 1, 'approver')`,
        [
          `cauth_${token}`,
          `ccand_${token}`,
          aggregate,
          sha256Digest("base"),
          sha256Digest("impact"),
          sha256Digest("{}"),
        ],
      );
      await client.query(
        `insert into catalog_publication.publication_jobs (
           id, candidate_id, authorization_id, request_scope, idempotency_key,
           request_digest, status
         ) values ($1, $2, $3, 'instance:test', $4, $5, 'queued')`,
        [`cjob_${token}`, `ccand_${token}`, `cauth_${token}`, token, sha256Digest(token)],
      );

      const identity = await captureSavepointError(client, () =>
        client.query(
          `update catalog_publication.publication_jobs set candidate_id = candidate_id where id = $1`,
          [`cjob_${token}`],
        ),
      );
      expect(["42501", "55000"]).toContain(identity.code);

      const execution = await client.query(
        `update catalog_publication.publication_jobs
         set lease_owner = 'worker-1', lease_until = now() + interval '30 seconds', fencing_token = 2
         where id = $1`,
        [`cjob_${token}`],
      );
      expect(execution.rowCount).toBe(1);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query("reset role").catch(() => undefined);
    }
  });
});
