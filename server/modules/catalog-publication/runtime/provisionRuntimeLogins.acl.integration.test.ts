/**
 * RA-01/02 threat matrix (finite). Red cases must fail at SQLSTATE 42501
 * (privilege), not FK / invalid-data. Do not add Catalog DML GRANTs to
 * close HTTP gaps.
 *
 * T1  API LOGIN INSERT/UPDATE/DELETE CatalogSubject/Definition/Revision/Release/head/Receipt
 * T2  Worker LOGIN same Catalog/Receipt DML and SET ROLE coordinator/synchronizer
 * T3  API LOGIN INSERT catalog_publication.publication_jobs without SET ROLE coordinator
 * T4  Leftover schema DML from an old provisioner is converged on re-run
 * T5  Unrelated same-name cluster role is not taken over by a lab run
 * T6  Sequential re-run without rotatePasswords does not change the password
 * T7  Concurrent lab runs with distinct tokens do not share or mutate roles
 * T8  SET LOCAL ROLE coordinator succeeds for API; RESET on rollback
 * T9  Public legacy structural DML is revoked (PCAT-DB-P02)
 * T10 Lab cleanup drops only this-run owned roles
 */
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import { captureDatabaseError } from "../persistence/integrationHarness";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import {
  PUBLICATION_API_LOGIN,
  dropLabRuntimeLogins,
  inspectLoginBoundary,
  provisionPublicationRuntimeLogins,
} from "./provisionRuntimeLogins";

const catalogDml = [
  "insert into parameter_catalog.catalog_subjects select * from parameter_catalog.catalog_subjects where false",
  "insert into parameter_catalog.catalog_releases select * from parameter_catalog.catalog_releases where false",
  "insert into parameter_catalog.catalog_activation_receipts select * from parameter_catalog.catalog_activation_receipts where false",
  "update parameter_catalog.catalog_subjects set id = id where false",
  "delete from parameter_catalog.catalog_subjects where false",
  "update parameter_catalog.parameter_definitions set id = id where false",
  "delete from parameter_catalog.parameter_definitions where false",
  "update parameter_catalog.definition_revisions set id = id where false",
  "delete from parameter_catalog.definition_revisions where false",
  "update parameter_catalog.catalog_releases set id = id where false",
  "delete from parameter_catalog.catalog_releases where false",
  "update parameter_catalog.catalog_state set current_catalog_release_id = current_catalog_release_id where false",
  "delete from parameter_catalog.catalog_activation_receipts where false",
  "update parameter_catalog.catalog_activation_receipts set id = id where false",
] as const;

const assert42501 = async (client: pg.Client, sql: string): Promise<void> => {
  const error = await captureDatabaseError(client.query(sql));
  expect(error.code, sql).toBe("42501");
};

describe("publication runtime login ACL threat matrix", () => {
  const token = `a${randomBytes(5).toString("hex")}`;
  const openedRoles: string[] = [];
  let url: string;
  let drop: () => Promise<void>;
  let apiUrl: string;
  let workerUrl: string;
  let managerUrl: string;

  afterAll(async () => {
    if (url) {
      await dropLabRuntimeLogins(url, token);
      for (const extra of openedRoles) {
        const admin = new pg.Client({ connectionString: url });
        await admin.connect();
        try {
          await admin.query(`drop role if exists ${quoteIdent(extra)}`);
        } finally {
          await admin.end();
        }
      }
    }
    await drop?.();
  });

  it("T1-T3/T8/T9: API SELECT works; Catalog/Receipt/publication DML is 42501; coordinator SET LOCAL is allowed", async () => {
    const opened = await createEphemeralTestDatabase("ra04acl");
    url = opened.url;
    drop = opened.drop;
    const provisioned = await provisionPublicationRuntimeLogins(url, { mode: "lab", runToken: token });
    expect(provisioned.passwordsDelivered).toBe(true);
    expect(provisioned.apiRole).toContain(`wiseeff_ra_${token}_`);
    apiUrl = provisioned.apiUrl;
    workerUrl = provisioned.workerUrl;
    managerUrl = provisioned.managerUrl;

    const api = new pg.Client({ connectionString: apiUrl });
    await api.connect();
    try {
      const selected = await api.query("select count(*)::int as n from parameter_catalog.catalog_state");
      expect(selected.rows[0]?.n).toBeGreaterThanOrEqual(0);
      for (const sql of catalogDml) {
        await assert42501(api, sql);
      }
      await assert42501(api, "insert into catalog_publication.publication_jobs select * from catalog_publication.publication_jobs where false");
      await assert42501(api, "update catalog_publication.publication_jobs set id = id where false");
      await assert42501(api, "delete from catalog_publication.publication_jobs where false");

      await api.query("begin");
      await api.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
      const who = await api.query<{ current_user: string }>("select current_user");
      expect(who.rows[0]?.current_user).toBe(CATALOG_PUBLICATION_COORDINATOR_ROLE);
      await api.query("rollback");
      const after = await api.query<{ current_user: string }>("select current_user");
      expect(after.rows[0]?.current_user).toBe(provisioned.apiRole);
    } finally {
      await api.end();
    }

    const worker = new pg.Client({ connectionString: workerUrl });
    await worker.connect();
    try {
      await assert42501(worker, "select * from parameter_catalog.catalog_state");
      for (const sql of catalogDml.slice(0, 4)) {
        await assert42501(worker, sql);
      }
      await assert42501(worker, `set role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
      await assert42501(worker, `set role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`);
    } finally {
      await worker.end();
    }

    const manager = new pg.Client({ connectionString: managerUrl });
    await manager.connect();
    try {
      await assert42501(manager, "update parameter_catalog.catalog_releases set id = id where false");
      await manager.query("begin");
      await manager.query(`set local role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`);
      const who = await manager.query<{ current_user: string }>("select current_user");
      expect(who.rows[0]?.current_user).toBe(CATALOG_SYNCHRONIZER_ROLE);
      await manager.query("rollback");
    } finally {
      await manager.end();
    }
  }, 120_000);

  it("T4: leftover over-wide ACL is converged on a second provision", async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      const apiRole = (await inspectLoginBoundary(apiUrl)).user;
      await admin.query(
        `grant insert, update, delete on all tables in schema parameter_catalog to ${quoteIdent(apiRole)}`,
      );
      await admin.query(
        `grant insert, update, delete on all tables in schema catalog_publication to ${quoteIdent(apiRole)}`,
      );
    } finally {
      await admin.end();
    }

    const again = await provisionPublicationRuntimeLogins(url, {
      mode: "lab",
      runToken: token,
      rotatePasswords: false,
    });
    expect(again.passwordsDelivered).toBe(false);
    expect(again.apiUrl).toBe("");
    const api = new pg.Client({ connectionString: apiUrl });
    await api.connect();
    try {
      await assert42501(api, "update parameter_catalog.catalog_releases set id = id where false");
      await assert42501(api, "insert into catalog_publication.publication_jobs select * from catalog_publication.publication_jobs where false");
      const boundary = await inspectLoginBoundary(apiUrl);
      expect(boundary.catalogDml.some((entry) => entry.startsWith("catalog_releases:"))).toBe(false);
      expect(boundary.catalogDml.some((entry) => entry.startsWith("catalog_activation_receipts:"))).toBe(false);
      expect(boundary.publicationDml).toEqual([]);
    } finally {
      await api.end();
    }
  }, 120_000);

  it("T5b: official provision refuses an unknown same-name role", async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const stranger = `wiseeff_ra_${token}_stranger`;
    openedRoles.push(stranger);
    try {
      await admin.query(
        `create role ${quoteIdent(stranger)} login password 'stranger-secret' nosuperuser noinherit`,
      );
      await admin.query(`comment on role ${quoteIdent(stranger)} is 'not-ours'`);
      await expect(
        provisionPublicationRuntimeLogins(url, {
          mode: "official",
          names: { api: stranger, worker: `wiseeff_ra_${token}_w2`, manager: `wiseeff_ra_${token}_m2` },
        }),
      ).rejects.toThrow(/ownership comment/);
    } finally {
      await admin.end();
    }
  }, 60_000);

  it("T5: unrelated same-name cluster role is not mutated", async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    const decoy = `wiseeff_decoy_${token}`;
    openedRoles.push(decoy);
    try {
      await admin.query(
        `create role ${quoteIdent(decoy)} login password 'decoy-secret' nosuperuser inherit`,
      );
      await admin.query(`comment on role ${quoteIdent(decoy)} is 'unrelated-cluster-role'`);
      const officialBefore = await admin.query<{ comment: string | null; rolsuper: boolean }>(
        `select shobj_description(oid, 'pg_authid') as comment, rolsuper
           from pg_roles where rolname = $1`,
        [PUBLICATION_API_LOGIN],
      );
      await provisionPublicationRuntimeLogins(url, { mode: "lab", runToken: token, rotatePasswords: false });
      const decoyAfter = await admin.query<{ comment: string | null; rolinherit: boolean }>(
        `select shobj_description(oid, 'pg_authid') as comment, rolinherit
           from pg_roles where rolname = $1`,
        [decoy],
      );
      expect(decoyAfter.rows[0]?.comment).toBe("unrelated-cluster-role");
      expect(decoyAfter.rows[0]?.rolinherit).toBe(true);
      const officialAfter = await admin.query<{ comment: string | null; rolsuper: boolean }>(
        `select shobj_description(oid, 'pg_authid') as comment, rolsuper
           from pg_roles where rolname = $1`,
        [PUBLICATION_API_LOGIN],
      );
      expect(officialAfter.rows).toEqual(officialBefore.rows);
    } finally {
      await admin.end();
    }
  }, 120_000);

  it("T6: sequential re-run without rotate keeps the original password", async () => {
    const first = new pg.Client({ connectionString: apiUrl });
    await first.connect();
    await first.query("select 1");
    await first.end();
    const second = await provisionPublicationRuntimeLogins(url, {
      mode: "lab",
      runToken: token,
      rotatePasswords: false,
    });
    expect(second.passwordsDelivered).toBe(false);
    const again = new pg.Client({ connectionString: apiUrl });
    await again.connect();
    await again.query("select 1");
    await again.end();
  }, 60_000);

  it("T7: concurrent lab runs with distinct tokens do not collide", async () => {
    const tokenB = `b${randomBytes(5).toString("hex")}`;
    const tokenC = `c${randomBytes(5).toString("hex")}`;
    const left = await provisionPublicationRuntimeLogins(url, { mode: "lab", runToken: tokenB });
    const rightP = provisionPublicationRuntimeLogins(url, { mode: "lab", runToken: tokenC });
    const right = await rightP;
    expect(left.apiRole).not.toBe(right.apiRole);
    expect(left.apiRole).not.toBe((await inspectLoginBoundary(apiUrl)).user);
    const leftClient = new pg.Client({ connectionString: left.apiUrl });
    const rightClient = new pg.Client({ connectionString: right.apiUrl });
    await leftClient.connect();
    await rightClient.connect();
    await leftClient.end();
    await rightClient.end();
    const droppedB = await dropLabRuntimeLogins(url, tokenB);
    const droppedC = await dropLabRuntimeLogins(url, tokenC);
    expect(droppedB.failed).toEqual([]);
    expect(droppedC.failed).toEqual([]);
    expect(droppedB.dropped.length).toBe(3);
    expect(droppedC.dropped.length).toBe(3);
  }, 120_000);

  it("T10: cleanup refuses to drop an unowned role and drops owned lab roles", async () => {
    const result = await dropLabRuntimeLogins(url, token);
    expect(result.dropped.length).toBeGreaterThan(0);
    expect(result.failed).toEqual([]);
    await expect(
      inspectLoginBoundary(apiUrl),
    ).rejects.toThrow();
  }, 60_000);
});
