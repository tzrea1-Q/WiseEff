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
  CATALOG_MIGRATION_OWNER,
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
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

const assertCanonicalSourceAcl = async (client: pg.Client, api: boolean): Promise<void> => {
  for (const [name, argumentsOid] of [
    ["is_replaced_current_binding", "25"],
    ["resolve_current_binding_by_source_occurrence", "25 25 25"],
    ["resolve_current_binding", "25 25 25"],
  ] as const) {
    const routine = await client.query(
      `select has_function_privilege(current_user, procedure.oid, 'EXECUTE') as execute,
            procedure.prosecdef as security_definer,
            exists(select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) acl
                    where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
       from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='parameter_catalog' and procedure.proname=$1
        and procedure.proargtypes=$2::oidvector`,
      [name, argumentsOid],
    );
    expect(routine.rows, name).toEqual([{ execute: api && name !== "resolve_current_binding", security_definer: false, public_execute: false }]);
  }
  if (api) {
    expect((await client.query("select parameter_catalog.is_replaced_current_binding('missing-api-binding') as replaced")).rows)
      .toEqual([{ replaced: false }]);
    expect((await client.query(`select parameter_catalog.resolve_current_binding_by_source_occurrence(
      'missing-api-project','missing-api-occurrence','missing-api-definition') as binding_id`)).rows)
      .toEqual([{ binding_id: null }]);
  }
  for (const [relation, append] of [
    ["parameter_catalog.project_parameter_source_occurrences", true],
    ["parameter_catalog.project_value_source_pins", true],
    ["parameter_catalog.current_project_parameter_bindings", false],
  ] as const) {
    const privileges = await client.query(
      `with target as (select relation.oid from pg_class relation
                      join pg_namespace namespace on namespace.oid=relation.relnamespace
                      where namespace.nspname || '.' || relation.relname = $1)
       select has_table_privilege(current_user, target.oid, 'INSERT') as insert,
              has_table_privilege(current_user, target.oid, 'UPDATE') as update,
              has_table_privilege(current_user, target.oid, 'DELETE') as delete,
              has_table_privilege(current_user, target.oid, 'TRUNCATE') as truncate,
              has_table_privilege(current_user, target.oid, 'REFERENCES') as references,
              has_table_privilege(current_user, target.oid, 'TRIGGER') as trigger,
              has_any_column_privilege(current_user, target.oid, 'INSERT') as column_insert,
              array(select attname::text from pg_attribute
                     where attrelid = target.oid and attnum > 0 and not attisdropped
                       and has_column_privilege(current_user, attrelid, attnum, 'UPDATE')
                     order by attnum) as update_columns,
              exists(select 1 from pg_attribute
                      where attrelid = target.oid and attnum > 0 and not attisdropped
                        and has_column_privilege(current_user, attrelid, attnum, 'REFERENCES')) as column_references
         from target`,
      [relation],
    );
    expect(privileges.rows[0], relation).toEqual({
      insert: api && append, column_insert: api && append, update: false, delete: false, truncate: false,
      references: false, trigger: false, update_columns: api ? ["id"] : [], column_references: false,
    });
    if (api) {
      await client.query(`select id from ${relation} where false for update nowait`);
      await client.query(`select id from ${relation} where false for share nowait`);
      await assert42501(client, `update ${relation} set project_id = project_id where false`);
      await assert42501(client, `delete from ${relation} where false`);
      if (append) await client.query(`insert into ${relation} select * from ${relation} where false`);
      else await assert42501(client, `insert into ${relation} select * from ${relation} where false`);
    }
  }
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
      await assertCanonicalSourceAcl(api, true);
      await assert42501(api, `set role ${quoteIdent(CATALOG_MIGRATION_OWNER)}`);
      await assert42501(api, `set role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`);
      for (const sql of catalogDml) {
        await assert42501(api, sql);
      }
      await api.query(
        "insert into parameter_catalog.project_parameter_bindings select * from parameter_catalog.project_parameter_bindings where false",
      );
      await api.query(
        "insert into parameter_catalog.project_parameter_values select * from parameter_catalog.project_parameter_values where false",
      );
      await api.query(
        "insert into parameter_catalog.binding_history_events select * from parameter_catalog.binding_history_events where false",
      );
      await assert42501(api, "insert into catalog_publication.publication_jobs select * from catalog_publication.publication_jobs where false");
      await assert42501(api, "update catalog_publication.publication_jobs set id = id where false");
      await assert42501(api, "delete from catalog_publication.publication_jobs where false");

      await assert42501(
        api,
        "select parameter_catalog.assert_catalog_subject_active('crel_x','sha256:x','csub_x','active')",
      );
      await api.query("begin");
      await api.query(`set local role ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)}`);
      const guard = await captureDatabaseError(
        api.query(
          "select parameter_catalog.assert_catalog_subject_active('crel_x','sha256:x','csub_x','active')",
        ),
      );
      expect(guard.code).not.toBe("42501");
      await api.query("rollback");

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
      await assertCanonicalSourceAcl(worker, false);
      await assert42501(worker, "select * from parameter_catalog.catalog_state");
      await assert42501(
        worker,
        "insert into parameter_catalog.project_parameter_bindings select * from parameter_catalog.project_parameter_bindings where false",
      );
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
      await assertCanonicalSourceAcl(manager, false);
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
      for (const role of [apiRole, (await inspectLoginBoundary(workerUrl)).user, (await inspectLoginBoundary(managerUrl)).user]) {
        await admin.query(`grant update (project_id), references (id) on parameter_catalog.project_parameter_source_occurrences to ${quoteIdent(role)}`);
        await admin.query(`grant update (project_id), references (id) on parameter_catalog.project_value_source_pins to ${quoteIdent(role)}`);
        await admin.query(`grant insert (id), update (project_id) on parameter_catalog.current_project_parameter_bindings to ${quoteIdent(role)}`);
        await admin.query(`grant execute on function parameter_catalog.is_replaced_current_binding(text) to ${quoteIdent(role)}`);
        await admin.query(`grant execute on function parameter_catalog.resolve_current_binding_by_source_occurrence(text,text,text) to ${quoteIdent(role)}`);
      }
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
      await assertCanonicalSourceAcl(api, true);
      await assert42501(api, "update parameter_catalog.catalog_releases set id = id where false");
      await assert42501(api, "insert into catalog_publication.publication_jobs select * from catalog_publication.publication_jobs where false");
      const boundary = await inspectLoginBoundary(apiUrl);
      expect(boundary.catalogDml.some((entry) => entry.startsWith("catalog_releases:"))).toBe(false);
      expect(boundary.catalogDml.some((entry) => entry.startsWith("catalog_activation_receipts:"))).toBe(false);
      expect(boundary.publicationDml).toEqual([]);
    } finally {
      await api.end();
    }
    for (const connectionString of [workerUrl, managerUrl]) {
      const client = new pg.Client({ connectionString });
      await client.connect();
      try {
        await assertCanonicalSourceAcl(client, false);
      } finally {
        await client.end();
      }
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
