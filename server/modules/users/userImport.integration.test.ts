import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type Database, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createLocalAuthService } from "../auth/localAuth";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { createAgentInvocation, createUserInvocation, type UserInvocationContext } from "../auth/trustedInvocation";
import { getAuthContext } from "../auth/repository";
import { resolveOperatingContext } from "../auth/operatingContext";
import { createUserImport, previewUserImport, readUserImport } from "./userImport";

describe("user import preflight through HTTP and PostgreSQL", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, token: string;
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("userimport"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization: { id: "import-home", name: "Home" }, users: [{ id: "import-admin" }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('import-role','import-admin','import-home','admin')");
    await db.query("insert into user_password_credentials(user_id,username,password_hash) values('import-admin','existing-user',$1)", [await hashLocalAccountPassword("test-password")]);
    token = (await createLocalAuthService(db).login({ username: "existing-user", password: "test-password" }, { requestId: "fixture" })).session.token;
  });
  afterEach(async () => { try { await db?.close(); } finally { await ephemeral?.drop(); } });
  it("rejects Agent provenance on import preview and receipt lookup", async () => {
    const agent = createAgentInvocation(await getAuthContext(db, "import-admin"), { sessionId: "session", toolCallId: "tool", approval: { required: false } });
    const rows = [{ row: 2, name: "Person", username: "agent-person", password: "initial-password", title: "", roles: "访客" }];
    await expect(previewUserImport(db, agent as unknown as UserInvocationContext, { rows })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createUserImport(db, agent as unknown as UserInvocationContext, { importId: "ea274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: "preview", rows }, "agent-import")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(readUserImport(db, agent as unknown as UserInvocationContext, "ea274db7-0344-4c3d-a19a-9be7e3bd88c0")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects an actor transferred after preflight even if platform authority survives", async () => {
    await seedCoreGraph(db, { organization: { id: "import-target", name: "Target" } });
    await seedCoreGraph(db, { organization: { id: "import-other", name: "Other" } });
    await db.query("update user_role_bindings set role_id='platform-admin' where id='import-role'");
    const invocation = await resolveOperatingContext(db, createUserInvocation(await getAuthContext(db, "import-admin")), "import-target");
    const rows = [{ row: 2, name: "Late transfer", username: "late-transfer", password: "initial-password", title: "", roles: "访客" }];
    const preview = await previewUserImport(db, invocation, { rows });
    const moved: Database = {
      query: (text, values) => db.query(text, values),
      transaction: async (fn, options) => {
        await db.transaction(async tx => {
          await tx.query("delete from auth_sessions where user_id='import-admin'");
          await tx.query("delete from user_role_bindings where user_id='import-admin'");
          await tx.query("delete from user_oidc_identities where user_id='import-admin'");
          await tx.query("update users set organization_id='import-other' where id='import-admin'");
          await tx.query("insert into user_oidc_identities(user_id,organization_id) values('import-admin','import-other')");
          await tx.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('moved-platform','import-admin','import-other','platform-admin')");
        });
        return db.transaction(fn, options);
      }
    };
    await expect(createUserImport(moved, invocation, { importId: "9a274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.token, rows }, "transfer-race")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.query("select count(*)::int n from users where name='Late transfer'")).rows).toEqual([{ n: 0 }]);
  });
  it.each(["lookup", "replay"])("rejects %s when an unscoped administrator transfers before the receipt lock", async operation => {
    await seedCoreGraph(db, { organization: { id: "import-other", name: "Other" } });
    const invocation = createUserInvocation(await getAuthContext(db, "import-admin"));
    const rows = [{ row: 2, name: "Receipt member", username: "receipt-member", password: "initial-password", title: "", roles: "访客" }];
    const preview = await previewUserImport(db, invocation, { rows });
    const body = { importId: "7a274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.token, rows };
    expect((await createUserImport(db, invocation, body, "original-import")).count).toBe(1);
    const moved: Database = {
      query: (text, values) => db.query(text, values),
      transaction: async (fn, options) => {
        await db.transaction(async tx => {
          await tx.query("delete from auth_sessions where user_id='import-admin'");
          await tx.query("delete from user_role_bindings where user_id='import-admin'");
          await tx.query("delete from user_oidc_identities where user_id='import-admin'");
          await tx.query("update users set organization_id='import-other' where id='import-admin'");
          await tx.query("insert into user_oidc_identities(user_id,organization_id) values('import-admin','import-other')");
          await tx.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('moved-admin','import-admin','import-other','admin')");
        });
        return db.transaction(fn, options);
      }
    };
    const result = operation === "lookup" ? readUserImport(moved, invocation, body.importId) : createUserImport(moved, invocation, body, "replay-import");
    await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.query("select count(*)::int n from user_import_receipts where id=$1", [body.importId])).rows).toEqual([{ n: 1 }]);
  });
  it("allows an explicitly scoped platform administrator to recover after signing in from the new Home", async () => {
    await seedCoreGraph(db, { organization: { id: "import-target", name: "Target" } });
    await seedCoreGraph(db, { organization: { id: "import-other", name: "Other" } });
    await db.query("update user_role_bindings set role_id='platform-admin' where id='import-role'");
    const original = await resolveOperatingContext(db, createUserInvocation(await getAuthContext(db, "import-admin")), "import-target");
    const rows = [{ row: 2, name: "Recoverable member", username: "recoverable-member", password: "initial-password", title: "", roles: "访客" }];
    const preview = await previewUserImport(db, original, { rows });
    const body = { importId: "6a274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.token, rows };
    const receipt = await createUserImport(db, original, body, "original-import");
    await db.transaction(async tx => {
      await tx.query("delete from auth_sessions where user_id='import-admin'");
      await tx.query("delete from user_role_bindings where user_id='import-admin'");
      await tx.query("delete from user_oidc_identities where user_id='import-admin'");
      await tx.query("update users set organization_id='import-other' where id='import-admin'");
      await tx.query("insert into user_oidc_identities(user_id,organization_id) values('import-admin','import-other')");
      await tx.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('moved-platform','import-admin','import-other','platform-admin')");
    });
    const current = await resolveOperatingContext(db, createUserInvocation(await getAuthContext(db, "import-admin")), "import-target");
    expect(await readUserImport(db, current, body.importId)).toEqual(receipt);
    expect(await createUserImport(db, current, body, "replay-import")).toEqual(receipt);
  });
  it("records the original user provenance for a platform-scoped import", async () => {
    await seedCoreGraph(db, { organization: { id: "import-target", name: "Target" } });
    await db.query("update user_role_bindings set role_id='platform-admin' where id='import-role'");
    const server = () => createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [{ row: 2, name: "Scoped user", username: "scoped-user", password: "initial-password", title: "", roles: "访客" }];
    const preview = await requestJson<{ item: { token: string } }>(server(), "/api/v1/users/imports/preview?organizationId=import-target", { method: "POST", headers, body: JSON.stringify({ rows }) });
    const created = await requestJson<{ item: { rows: Array<{ userId: string }> } }>(server(), "/api/v1/users/imports?organizationId=import-target", { method: "POST", headers, body: JSON.stringify({ importId: "8a274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows }) });
    expect(created.status).toBe(200);
    const audit = await db.query("select organization_id,actor_user_id,actor_type,metadata from audit_events where kind='user-create' and target_id=$1", [created.body.item.rows[0].userId]);
    expect(audit.rows).toEqual([expect.objectContaining({ organization_id: "import-target", actor_user_id: "import-admin", actor_type: "user", metadata: expect.objectContaining({ initiator: "user", actorHomeOrganizationId: "import-home", operatingOrganizationId: "import-target" }) })]);
  });
  it("creates a batch once and replays it without changing passwords", async () => {
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [{ row: 2, name: "Alice", username: "new-alice", password: "initial-password", title: "", roles: "硬件开发；软件开发" }];
    const preview = await requestJson<{ item: { token: string } }>(server, "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    expect(preview.status).toBe(200);
    const body = { importId: "ea274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows };
    const create = () => requestJson<{ item: { count: number; rows: Array<{ row: number; userId: string }> } }>(server, "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify(body) });
    const first = await create();
    expect(first.status).toBe(200);
    expect(first.body.item).toMatchObject({ count: 1, rows: [{ row: 2 }] });
    body.rows[0].password = "different-password";
    expect((await create()).body).toEqual(first.body);
    const login = await requestJson(server, "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: "new-alice", password: "initial-password" }) });
    expect(login.status).toBe(200);
  });
  it("does not disclose a receipt to another administrator or after revocation", async () => {
    const server = () => createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [{ row: 2, name: "Private receipt", username: "private-receipt", password: "initial-password", title: "", roles: "访客" }];
    const preview = await requestJson<{ item: { token: string } }>(server(), "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    const importId = "ab274db7-0344-4c3d-a19a-9be7e3bd88c0";
    expect((await requestJson(server(), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify({ importId, previewToken: preview.body.item.token, rows }) })).status).toBe(200);
    await db.query("insert into users(id,organization_id,name,title) values('other-admin','import-home','Other administrator','Admin')");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('other-admin-role','other-admin','import-home','admin')");
    await db.query("insert into user_password_credentials(user_id,username,password_hash) values('other-admin','other-admin',$1)", [await hashLocalAccountPassword("other-password")]);
    const otherToken = (await createLocalAuthService(db).login({ username: "other-admin", password: "other-password" }, { requestId: "fixture-other" })).session.token;
    expect((await requestJson(server(), `/api/v1/users/imports/${importId}`, { headers: { Authorization: `Bearer ${otherToken}` } })).status).toBe(404);
    await db.query("update user_role_bindings set role_id='guest' where id='import-role'");
    expect((await requestJson(server(), `/api/v1/users/imports/${importId}`, { headers })).status).toBe(403);
  });
  it("preserves historical IDs after a created user is deleted and never recreates them on replay", async () => {
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [{ row: 2, name: "Deleted member", username: "deleted-member", password: "initial-password", title: "", roles: "访客" }];
    const preview = await requestJson<{ item: { token: string } }>(server, "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    const body = { importId: "bb274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows };
    const created = await requestJson<{ item: { rows: Array<{ userId: string }> } }>(server, "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify(body) });
    const userId = created.body.item.rows[0].userId;
    expect((await requestJson(server, `/api/v1/users/${userId}`, { method: "DELETE", headers })).status).toBe(204);
    const recovered = await requestJson<{ item: { count: number; rows: Array<{ row: number; userId: string }> } }>(server, `/api/v1/users/imports/${body.importId}`, { headers });
    expect(recovered.body.item).toMatchObject({ count: 1, rows: [{ row: 2, userId }] });
    expect(recovered.body.item.rows[0]).not.toHaveProperty("name");
    const replay = await requestJson(server, "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify({ ...body, previewToken: "expired", rows: [{ ...rows[0], password: "" }] }) });
    expect(replay.body).toEqual(recovered.body);
    expect((await requestJson(server, `/api/v1/users/${userId}`, { headers })).status).toBe(404);
  });
  it("rolls back every account and audit if a later credential write fails", async () => {
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [2, 3].map(row => ({ row, name: `Person ${row}`, username: `batch-${row}`, password: "sensitive-password", title: "", roles: "访客" }));
    const preview = await requestJson<{ item: { token: string } }>(server, "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    await db.query("create function reject_import_credential() returns trigger language plpgsql as $$ begin if new.username='batch-3' then raise exception 'rejected'; end if; return new; end $$");
    await db.query("create trigger reject_import_credential before insert on user_password_credentials for each row execute function reject_import_credential()");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await requestJson<{ error: { details: { code: string } } }>(server, "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify({ importId: "a0274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows }) });
    expect(response.status).toBe(500);
    expect(response.body.error.details.code).toBe("import-rolled-back");
    expect(JSON.stringify(response.body)).not.toContain("sensitive-password");
    expect(JSON.stringify(log.mock.calls)).not.toContain("sensitive-password");
    log.mockRestore();
    expect((await db.query("select (select count(*) from users where name like 'Person %')::int users, (select count(*) from user_password_credentials where username like 'batch-%')::int credentials, (select count(*) from audit_events where kind='user-create')::int audit, (select count(*) from user_import_receipts)::int receipts")).rows[0]).toEqual({ users: 0, credentials: 0, audit: 0, receipts: 0 });
  });
  it.each([
    ["users", "new.name='Failure 3'"],
    ["user_role_bindings", "new.user_id in (select id from users where name='Failure 3')"],
    ["audit_events", "new.kind='user-create' and new.target_id in (select id from users where name='Failure 3')"],
    ["user_import_receipts", "true"]
  ])("rolls back the entire batch when %s fails", async (table, condition) => {
    const server = () => createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [2, 3].map(row => ({ row, name: `Failure ${row}`, username: `failure-${row}`, password: "never-log-this-password", title: "", roles: "访客" }));
    const preview = await requestJson<{ item: { token: string } }>(server(), "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    await db.query(`create function reject_import_write() returns trigger language plpgsql as $$ begin if ${condition} then raise exception 'injected failure'; end if; return new; end $$`);
    await db.query(`create trigger reject_import_write before insert on ${table} for each row execute function reject_import_write()`);
    const result = await requestJson<{ error: { details: { code: string } } }>(server(), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify({ importId: "fa274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows }) });
    expect(result.status).toBe(500);
    expect(result.body.error.details.code).toBe("import-rolled-back");
    expect(JSON.stringify(result.body)).not.toContain("never-log-this-password");
    const counts = await db.query("select (select count(*) from users where name like 'Failure %')::int users, (select count(*) from user_password_credentials where username like 'failure-%')::int credentials, (select count(*) from user_role_bindings where user_id in (select id from users where name like 'Failure %'))::int roles, (select count(*) from audit_events where kind='user-create')::int audit, (select count(*) from user_import_receipts)::int receipts");
    expect(counts.rows[0]).toEqual({ users: 0, credentials: 0, roles: 0, audit: 0, receipts: 0 });
  });
  it("serializes simultaneous confirmations and permits recovery after suspension but rejects changed intent", async () => {
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [{ row: 2, name: "One", username: "concurrent-user", password: "initial-password", title: "", roles: "访客" }];
    const preview = await requestJson<{ item: { token: string } }>(server, "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    const body = { importId: "ba274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows };
    const call = (payload: unknown) => requestJson(createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) }), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify(payload) });
    const [first, second] = await Promise.all([call(body), call(body)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body).toEqual(second.body);
    expect((await db.query<{ count: number }>("select count(*)::int count from user_import_receipts")).rows[0].count).toBe(1);
    expect((await call({ ...body, rows: [{ ...rows[0], name: "Changed" }] })).status).toBe(409);
    await db.query("update organizations set status='suspended',lifecycle_version=lifecycle_version+1 where id='import-home'");
    expect((await call({ ...body, previewToken: "stale", rows: [{ ...rows[0], password: "" }] })).body).toEqual(first.body);
    const lookup = await requestJson(server, `/api/v1/users/imports/${body.importId}`, { headers });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual(first.body);
  });
  it.each(["revoked", "suspended", "username-taken"])("rechecks %s after preview and creates no users", async condition => {
    const server = () => createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [{ row: 2, name: "Late person", username: "late-person", password: "initial-password", title: "", roles: "访客" }];
    const preview = await requestJson<{ item: { token: string } }>(server(), "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    if (condition === "revoked") await db.query("update user_role_bindings set role_id='guest' where id='import-role'");
    if (condition === "suspended") await db.query("update organizations set status='suspended',lifecycle_version=lifecycle_version+1 where id='import-home'");
    if (condition === "username-taken") {
      await db.query("insert into users(id,organization_id,name,title) values('other-racer','import-home','Other racer','User')");
      await db.query("insert into user_password_credentials(user_id,username,password_hash) values('other-racer','late-person',$1)", [await hashLocalAccountPassword("existing-password")]);
    }
    const result = await requestJson(server(), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify({ importId: "e0274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows }) });
    expect(result.status).toBe(condition === "username-taken" ? 409 : 403);
    expect((await db.query("select count(*)::int n from users where name='Late person'")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select count(*)::int n from user_import_receipts")).rows).toEqual([{ n: 0 }]);
  });
  it("recovers after a lost commit acknowledgement without replaying credentials", async () => {
    let inject = true;
    const boundary: Database = {
      query: (text, values) => db.query(text, values),
      transaction: async (fn, options) => {
        let importTransaction = false;
        const result = await db.transaction(tx => fn({ ...tx, query: async <Row,>(text: string, values?: unknown[]) => {
          if (text.includes("administrator-continuity")) importTransaction = true;
          return tx.query<Row>(text, values);
        } }), options);
        if (importTransaction && inject) { inject = false; throw new Error("simulated lost commit acknowledgement"); }
        return result;
      }
    };
    const server = () => createWiseEffServer({ db: boundary, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [{ row: 2, name: "Uncertain", username: "uncertain-user", password: "original-password", title: "", roles: "访客" }];
    const preview = await requestJson<{ item: { token: string } }>(server(), "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    const body = { importId: "f1274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows };
    const lost = await requestJson<{ error: { details: { code: string } } }>(server(), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify(body) });
    expect(lost.status).toBe(500);
    expect(lost.body.error.details.code).toBe("import-not-confirmed");
    const recovered = await requestJson<{ item: { count: number } }>(server(), `/api/v1/users/imports/${body.importId}`, { headers });
    expect(recovered.status).toBe(200);
    expect(recovered.body.item.count).toBe(1);
    const retry = await requestJson(server(), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify({ ...body, previewToken: "expired", rows: [{ ...rows[0], password: "changed-password" }] }) });
    expect(retry.body).toEqual(recovered.body);
    expect((await requestJson(server(), "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: "uncertain-user", password: "original-password" }) })).status).toBe(200);
  });
  it("rolls back if a competing account wins the username after the final lookup", async () => {
    const server = () => createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const headers = { Authorization: `Bearer ${token}` };
    const rows = [{ row: 2, name: "Losing batch", username: "raced-user", password: "initial-password", title: "", roles: "访客" }];
    const preview = await requestJson<{ item: { token: string } }>(server(), "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    await db.query("insert into users(id,organization_id,name,title) values('race-winner','import-home','Race winner','User')");
    await db.query("create function pause_import_credential() returns trigger language plpgsql as $$ begin if new.username='raced-user' and new.user_id like 'u-%' then perform pg_advisory_xact_lock(1532001); end if; return new; end $$");
    await db.query("create trigger pause_import_credential before insert on user_password_credentials for each row execute function pause_import_credential()");
    const control = await getRootPostgresPool(db)!.connect();
    await control.query("select pg_advisory_lock(1532001)");
    const pending = requestJson(server(), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify({ importId: "f2274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows }) });
    try {
      const deadline = Date.now() + 5000;
      while (!(await db.query<{ waiting: boolean }>("select exists(select 1 from pg_locks where locktype='advisory' and not granted and objid=1532001) waiting")).rows[0].waiting) {
        if (Date.now() > deadline) throw new Error("Import did not reach username race barrier");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await db.query("insert into user_password_credentials(user_id,username,password_hash) values('race-winner','raced-user',$1)", [await hashLocalAccountPassword("winner-password")]);
    } finally { await control.query("select pg_advisory_unlock(1532001)"); control.release(); }
    expect((await pending).status).toBe(409);
    expect((await db.query("select name from users where name in ('Losing batch','Race winner') order by name")).rows).toEqual([{ name: "Race winner" }]);
    expect((await db.query("select count(*)::int n from user_import_receipts")).rows).toEqual([{ n: 0 }]);
  });
  it("creates 500 accounts through HTTP while measuring the administrator lock", async () => {
    let lockStarted = 0, lockMs = 0, otherStarted = 0, otherMs = 0;
    let other: Promise<{ status: number }> | undefined;
    const headers = { Authorization: `Bearer ${token}` };
    const measured: Database = {
      query: (text, values) => db.query(text, values),
      transaction: (fn, options) => db.transaction(async tx => {
        let measuredLock = false;
        const wrapped: Database = { ...tx, query: async <Row,>(text: string, values?: unknown[]) => {
          const result = await tx.query<Row>(text, values);
          if (text.includes("administrator-continuity") && !lockStarted) {
            measuredLock = true; lockStarted = performance.now(); otherStarted = performance.now();
            const otherServer = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
            other = requestJson(otherServer, "/api/v1/users/import-admin/organization-roles", { method: "PUT", headers, body: JSON.stringify({ roles: ["admin"], expectedRoles: ["admin"] }) }).then(result => { otherMs = performance.now() - otherStarted; return result; });
          }
          return result;
        } };
        try { return await fn(wrapped); } finally { if (measuredLock) lockMs = performance.now() - lockStarted; }
      }, options)
    };
    const server = () => createWiseEffServer({ db: measured, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: createLocalAuthService(db) });
    const rows = Array.from({ length: 500 }, (_, index) => ({ row: index + 2, name: `Capacity ${index}`, username: `capacity-${index}`, password: "capacity-password", title: "", roles: "访客" }));
    const preview = await requestJson<{ item: { token: string } }>(server(), "/api/v1/users/imports/preview", { method: "POST", headers, body: JSON.stringify({ rows }) });
    expect(preview.status).toBe(200);
    const body = { importId: "ca274db7-0344-4c3d-a19a-9be7e3bd88c0", previewToken: preview.body.item.token, rows };
    const start = performance.now();
    const result = await requestJson<{ item: { count: number } }>(server(), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify(body) });
    const fullMs = performance.now() - start;
    expect(result.status).toBe(200);
    expect(result.body.item.count).toBe(500);
    expect((await other!)?.status).toBe(200);
    expect((await db.query<{ count: number }>("select count(*)::int count from user_password_credentials where username like 'capacity-%'")).rows[0].count).toBe(500);
    const login = await requestJson(server(), "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: "capacity-499", password: "capacity-password" }) });
    expect(login.status).toBe(200);
    const extra = await requestJson(server(), "/api/v1/users/imports", { method: "POST", headers, body: JSON.stringify({ ...body, importId: "da274db7-0344-4c3d-a19a-9be7e3bd88c0", rows: [...rows, { ...rows[0], row: 502, username: "capacity-extra" }] }) });
    expect(extra.status).toBe(400);
    expect((await db.query<{ count: number }>("select count(*)::int count from user_password_credentials where username='capacity-extra'")).rows[0].count).toBe(0);
    process.stdout.write(`user-import capacity: full=${Math.round(fullMs)}ms global-lock-callback=${Math.round(lockMs)}ms other-admin=${Math.round(otherMs)}ms\n`);
  }, 120_000);
  it("reports normalized duplicates and global conflicts without credentials or writes", async () => {
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production", verifier: { verify: async () => ({ user: { id: "import-admin", organizationId: "import-home", name: "Admin", title: "", isActive: true }, organization: { id: "import-home", name: "Home" }, roles: [{ projectId: null, roleId: "admin" }], permissions: ["users:manage"] }) } }, localAuthService: createLocalAuthService(db) });
    const row = { row: 2, name: " Alice ", username: " Existing-User ", password: "synthetic-secret", title: "", roles: "硬件开发" };
    const before = await db.query("select (select count(*) from users)::int users, (select count(*) from user_password_credentials)::int credentials, (select count(*) from user_role_bindings)::int roles, (select count(*) from audit_events)::int audit");
    const response = await requestJson<{ item: { rows: Array<{ username: string }>; errors: Array<{ row: number; field: string }>; token?: string } }>(server, "/api/v1/users/imports/preview", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ rows: [row, { ...row, row: 4 }] }) });
    expect(response.status).toBe(200);
    expect(response.body.item.rows.map((r) => r.username)).toEqual(["existing-user", "existing-user"]);
    expect(response.body.item.errors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 2, field: "username" }), expect.objectContaining({ row: 4, field: "username" })]));
    expect(JSON.stringify(response.body)).not.toContain("synthetic-secret");
    expect((await db.query<{ count: number }>("select count(*)::int as count from users")).rows[0].count).toBe(1);
    const invalid = await requestJson(server, "/api/v1/users/imports/preview", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ rows: [{ ...row, "synthetic-secret-key": "synthetic-secret-value" }] }) });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(invalid.body)).not.toContain("synthetic-secret");
    const grant = await requestJson<{ item: { errors: Array<{ field: string }>; token: string | null } }>(server, "/api/v1/users/imports/preview", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ rows: [{ ...row, username: "new-user", roles: "平台超级管理员" }] }) });
    expect(grant.body.item.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "roles" })]));
    expect(grant.body.item.token).toBeNull();
    const clean = await requestJson<{ item: { rows: Array<{ username: string; roles: string[] }>; token: string; privilegedCount: number } }>(server, "/api/v1/users/imports/preview", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ rows: [{ ...row, username: " New-User ", roles: "管理员；硬件开发；管理员" }] }) });
    expect(clean.body.item).toMatchObject({ rows: [{ username: "new-user", roles: ["admin", "hardware-user"] }], privilegedCount: 1 });
    expect(clean.body.item.token).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(clean.body)).not.toContain("synthetic-secret");
    expect((await db.query("select (select count(*) from users)::int users, (select count(*) from user_password_credentials)::int credentials, (select count(*) from user_role_bindings)::int roles, (select count(*) from audit_events)::int audit")).rows).toEqual(before.rows);
    await db.query("update user_role_bindings set role_id='guest' where id='import-role'");
    expect((await requestJson(server, "/api/v1/users/imports/preview", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ rows: [row] }) })).status).toBe(403);
    await db.query("update user_role_bindings set role_id='admin' where id='import-role'");
    await db.query("update organizations set status='suspended' where id='import-home'");
    expect((await requestJson(server, "/api/v1/users/imports/preview", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ rows: [row] }) })).status).toBe(403);
  });
  it("requires explicit platform scope and reports foreign username conflicts without organization details", async () => {
    await seedCoreGraph(db, { organization: { id: "import-target", name: "Target" } });
    await db.query("update user_role_bindings set role_id='platform-admin' where id='import-role'");
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production", verifier: { verify: async () => ({ user: { id: "import-admin", organizationId: "import-home", name: "Admin", title: "", isActive: true }, organization: { id: "import-home", name: "Home" }, roles: [{ projectId: null, roleId: "platform-admin" }], permissions: ["users:manage"] }) } }, localAuthService: createLocalAuthService(db) });
    const body = JSON.stringify({ rows: [{ row: 2, name: "A", username: "EXISTING-USER", password: "synthetic-secret", title: "", roles: "访客" }] });
    const request = (path: string) => requestJson<{ item: { errors: Array<{ field: string }> } }>(server, path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
    expect((await request("/api/v1/users/imports/preview")).status).toBe(400);
    const response = await request("/api/v1/users/imports/preview?organizationId=import-target");
    expect(response.status).toBe(200);
    expect(response.body.item.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "username" })]));
    expect(JSON.stringify(response.body)).not.toContain("import-home");
  });
});
