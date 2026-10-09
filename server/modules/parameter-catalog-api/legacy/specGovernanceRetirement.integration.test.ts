import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import { createPostgresDatabase, type RootDatabase } from "../../../shared/database/client";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { createRetirementTestHarness } from "../../../testing/parameterCatalog/retirementHarness";
import { requestJson } from "../../../test/testClient";
import { createTokenVerifier } from "../../auth/tokenVerifier";

const legacyTables = [
  "parameter_specs", "parameter_spec_versions", "dts_property_specs",
  "parameter_spec_review_tasks", "parameter_spec_matcher_overrides",
  "parameter_spec_version_cutover_runs", "parameter_spec_version_cutover_items",
  "parameter_spec_property_key_cutover_runs", "parameter_spec_property_key_cutover_items",
];
const specPath = "/api/v2/parameter-specs/spec-t1063";
const actions = [
  "activate", "deprecate", "restore", "reattribute", "rename-property-key",
  "cutover/prepare", "cutover/finalize", "property-key-cutover/preview",
  "property-key-cutover/start", "property-key-cutover/prepare", "property-key-cutover/finalize",
];

describe("assembled spec-governance retirement on PostgreSQL", () => {
  let db: RootDatabase;
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let harness: ReturnType<typeof createRetirementTestHarness>;

  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("retired");
    db = createPostgresDatabase(fixture.url);
    await db.query("insert into organizations (id, name) values ('org-t1063', 'Retirement')");
    await db.query(`insert into users (id, organization_id, name, email, title, is_active)
      values ('user-t1063', 'org-t1063', 'Retirement Admin', 'retirement@example.com', 'Admin', true)`);
    await db.query(`insert into roles (id, name, level, permissions) values
      ('admin', 'Admin', 100, array['parameter:view','parameter:edit','admin:access']) on conflict (id) do nothing`);
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id, project_id)
      values ('role-t1063', 'user-t1063', 'org-t1063', 'admin', null)`);
    await db.query(`insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ('spec-t1063', 'org-t1063', 'manual', 'manual/retirement')`);
    await db.query(`insert into parameter_spec_versions
      (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle)
      values ('spec-t1063-v1', 'spec-t1063', 1, 'Retirement', 'Retirement', '{"kind":"u32"}', 'active')`);
    await db.query(`insert into dts_property_specs
      (id, parameter_spec_id, property_key, schema_namespace, constraints, documentation)
      values ('dps-t1063', 'spec-t1063', 'retirement', 'manual', '{}', 'Retirement')`);
    harness = createRetirementTestHarness({ db, legacyTables });
  });

  afterAll(async () => {
    await db?.close();
    await fixture?.drop();
  });

  it.each(actions)("POST %s is gone without changing legacy specs", async (action) => {
    await harness.assertRetired({ method: "POST", path: `${specPath}/${action}` }, {
      headers: { "X-WiseEff-User": "user-t1063" },
      body: JSON.stringify({
        reason: "retirement regression", documentation: "must not change",
        valueShape: { kind: "u32" }, constraints: {}, propertyKey: "renamed",
      }),
    });
  });

  it("PATCH is gone without changing legacy specs", async () => {
    await harness.assertRetired({ method: "PATCH", path: specPath }, {
      headers: { "X-WiseEff-User": "user-t1063" },
      body: JSON.stringify({ reason: "retirement regression", documentation: "must not change", constraints: {} }),
    });
  });

  it.each(["cutover", "property-key-cutover"])("GET %s cannot revive retired cutover workflows", async (action) => {
    await harness.assertRetired({ method: "GET", path: `${specPath}/${action}` }, {
      headers: { "X-WiseEff-User": "user-t1063" },
    });
  });

  it("is gone before payload validation or missing-object authentication", async () => {
    await harness.assertRetired({ method: "POST", path: "/api/v2/parameter-specs/missing-spec/activate" }, {
      headers: { "X-WiseEff-User": "missing-user" },
      body: JSON.stringify({ invalid: true }),
    });
  });

  it("keeps a trusted refusal audit without trusting payload actor or tenant", async () => {
    await harness.assertRetired({ method: "POST", path: `${specPath}/property-key-cutover/prepare` }, {
      headers: { "X-WiseEff-User": "user-t1063", "X-Request-Id": "t1063-trusted-refusal" },
      body: JSON.stringify({ actorUserId: "spoofed", organizationId: "other-tenant", reason: "spoofed" }),
    });
    const events = await db.query(`select organization_id, actor_user_id, actor_type, action, metadata
      from audit_events where trace_id = 't1063-trusted-refusal'`);
    expect(events.rows).toEqual([expect.objectContaining({
      organization_id: "org-t1063", actor_user_id: "user-t1063", actor_type: "user", action: "deny",
      metadata: expect.objectContaining({ reason: "legacy-surface-retired", routeId: "parameterSpecs.preparePropertyKeyCutover" }),
    })]);
  });

  it("uses the verified production principal, not spoofed headers or payload attribution", async () => {
    const issuer = "t1063-retirement-test";
    const secret = "t1063-test-only-signing-key";
    const payload = Buffer.from(JSON.stringify({
      iss: issuer, sub: "user-t1063", org: "org-t1063", exp: Math.floor(Date.now() / 1000) + 300,
    })).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    const production = createRetirementTestHarness({
      db, legacyTables, auth: { mode: "production", verifier: createTokenVerifier({ issuer, secret }) },
    });
    await production.assertRetired({ method: "PATCH", path: specPath }, {
      headers: {
        Authorization: `Bearer ${payload}.${signature}`,
        "X-WiseEff-User": "spoofed-user", "X-Request-Id": "t1063-production-refusal",
      },
      body: JSON.stringify({ actorUserId: "spoofed-user", organizationId: "other-tenant" }),
    });
    const events = await db.query(`select organization_id, actor_user_id from audit_events
      where trace_id = 't1063-production-refusal'`);
    expect(events.rows).toEqual([{ organization_id: "org-t1063", actor_user_id: "user-t1063" }]);
  });

  it("fails closed if trusted refusal audit storage fails", async () => {
    await db.query(`create function t1063_reject_audit() returns trigger language plpgsql as $$
      begin
        if NEW.trace_id = 't1063-audit-storage-failure' then raise exception 'Controlled audit failure'; end if;
        return NEW;
      end $$`);
    await db.query(`create trigger t1063_reject_audit before insert on audit_events
      for each row execute function t1063_reject_audit()`);
    const before = await db.query("select * from parameter_spec_versions where parameter_spec_id = 'spec-t1063'");
    try {
      const response = await requestJson<{ error: { code: string } }>(harness.server, specPath, {
        method: "PATCH",
        headers: { "X-WiseEff-User": "user-t1063", "X-Request-Id": "t1063-audit-storage-failure" },
        body: JSON.stringify({ documentation: "must not change", constraints: {}, reason: "retirement" }),
      });
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe("INTERNAL_ERROR");
      expect((await db.query("select * from parameter_spec_versions where parameter_spec_id = 'spec-t1063'")).rows).toEqual(before.rows);
    } finally {
      await db.query("drop trigger t1063_reject_audit on audit_events");
      await db.query("drop function t1063_reject_audit()");
    }
  });

  it("preserves the effective spec list and exact detail read window", async () => {
    const init = { headers: { "X-WiseEff-User": "user-t1063" } };
    const list = await requestJson<{ items: Array<{ id: string }> }>(
      harness.server, "/api/v2/parameter-specs?view=effective", init,
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toContainEqual(expect.objectContaining({ id: "spec-t1063" }));
    const detail = await requestJson<{ item: { id: string } }>(harness.server, `${specPath}?view=effective`, init);
    expect(detail.status).toBe(200);
    expect(detail.body.item.id).toBe("spec-t1063");
  });
});
