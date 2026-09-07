import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, writeFile, rm, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSelfHostedPg16Database } from "../../../../server/testing/selfHostedUpgrade/database";
import { createPostgresDatabase, type RootDatabase } from "../../../../server/shared/database/client";
import { applyMigrations } from "../../../../server/shared/database/migrations";
import { createLocalAuthService } from "../../../../server/modules/auth/localAuth";
import { hashLocalAccountPassword } from "../../../../server/modules/auth/localAccountCredentials";
import { openDeploymentAuthority, isIncidentRestoreConfirmation, type DeploymentAuthorityAssignment, type DeploymentAuthorityOptions } from "./deploymentAuthority";
import { canonicalJson, sha256Prefixed } from "./journal";

// Receipt validation precedes every connection. No ambient database, auth mock,
// passed gate adapter, report insertion, or missing-environment skip is used.
let control: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let source: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let admin: RootDatabase, sourceAdmin: RootDatabase, writer: RootDatabase;
let options: DeploymentAuthorityOptions, assignment: DeploymentAuthorityAssignment;
let authority: Awaited<ReturnType<typeof openDeploymentAuthority>>;
let custodyRoot: string;
const loginName = `authority_${randomBytes(8).toString("hex")}`;
const loginRole = pg.escapeIdentifier(loginName);
const password = randomBytes(24).toString("hex");
const tokens = new Map<string, string>();
const target = { deploymentId: "isolated-authority", hostFingerprint: "synthetic-host", postgresIdentity: "synthetic-source", objectStoreIdentity: "synthetic-objects", redisIdentity: "synthetic-redis" };
const restoreTarget = { ...target, postgresIdentity: "synthetic-empty-destination" };
const missingReport = `sha256:${"a".repeat(64)}`;
const identity = async (db: RootDatabase) => (await db.query<DeploymentAuthorityAssignment["authentication"]>(`select current_database() as "databaseName",
  (select oid::text from pg_catalog.pg_database where datname=current_database()) as "databaseOid",
  inet_server_addr()::text as "serverAddress", inet_server_port() as "serverPort"`)).rows[0];
const request = (user = "incident") => ({ authorization: `Bearer ${tokens.get(user)}`, attemptId: "restore-attempt", captureDigest: `sha256:${"b".repeat(64)}`, target: restoreTarget, traceId: "authority-integration" });
beforeAll(async () => {
  control = await createSelfHostedPg16Database("authority_control");
  source = await createSelfHostedPg16Database("authority_source");
  admin = createPostgresDatabase(control.url); sourceAdmin = createPostgresDatabase(source.url);
  await applyMigrations(admin, path.resolve("server/migrations"));
  await sourceAdmin.query("create table authority_source_guard(value text); insert into authority_source_guard values ('frozen-source')");
  await admin.query("insert into organizations(id,name) values ('authority-org','Synthetic authority')");
  for (const role of ["guest", "admin", "platform-admin"]) await admin.query("insert into roles(id,name,level,permissions) values ($1,$1,'organization','{}') on conflict (id) do nothing", [role]);
  const userPassword = `Authority-${randomBytes(12).toString("hex")}!`;
  const hash = await hashLocalAccountPassword(userPassword);
  const auth = createLocalAuthService(admin, { selfRegisterEnabled: false });
  for (const user of ["operator", "owner", "incident", "ordinary-admin", "verifier"]) {
    await admin.query("insert into users(id,organization_id,name,email,title) values ($1,'authority-org',$1,$2,'Synthetic')", [user, `${user}@invalid.example`]);
    await admin.query("insert into user_password_credentials(user_id,username,password_hash) values ($1,$1,$2)", [user, hash]);
    await admin.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$1,'authority-org',$2)", [user, user === "ordinary-admin" ? "platform-admin" : "guest"]);
    const authenticated = await auth.login({ username: user, password: userPassword }, { requestId: `login-${user}` });
    tokens.set(user, authenticated.session.token);
  }
  await admin.query(`create role ${loginRole} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password '${password}'`);
  await admin.query(`grant select on public.auth_sessions,public.users,public.organizations,public.user_role_bindings,public.user_password_credentials to ${loginRole};
    grant update(last_used_at) on public.auth_sessions to ${loginRole}`);
  const url = new URL(control.url); url.username = loginName; url.password = password;
  custodyRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "authority-private-")));
  assignment = { format: "wiseeff-deployment-authority-v1", runId: "authority-run", target, expiresAt: new Date(Date.now() + 600000).toISOString(), authentication: await identity(admin),
    principals: [{ kind: "operator", userId: "operator", organizationId: "authority-org" }, { kind: "platform-owner", userId: "owner", organizationId: "authority-org" }, { kind: "incident-owner", userId: "incident", organizationId: "authority-org" }],
    verifierPrincipals: [{ userId: "verifier", organizationId: "authority-org" }], reports: [{ purpose: "pre-activation", reportDigest: missingReport }],
    restore: { attemptId: "restore-attempt", captureDigest: `sha256:${"b".repeat(64)}`, target: restoreTarget } };
  const assignmentPath = path.join(custodyRoot, "assignment.json");
  await writeFile(assignmentPath, JSON.stringify(assignment), { mode: 0o600 });
  options = { custodyRoot, custodianUid: process.getuid!(), assignmentPath, expectedAssignmentDigest: sha256Prefixed(canonicalJson(assignment)), runId: assignment.runId,
    target, sourceDatabase: await identity(sourceAdmin), authConnectionString: url.href };
  // Separate management report pool. Its own six-table writer manifest is 0139.
  const writerName = pg.escapeIdentifier(`authority_report_${randomBytes(8).toString("hex")}`);
  await admin.query(`create role ${writerName} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password '${password}';
    grant catalog_verification_writer_role to ${writerName} with inherit true, set false, admin false`);
  const writerUrl = new URL(control.url); writerUrl.username = writerName.slice(1, -1); writerUrl.password = password;
  writer = createPostgresDatabase(writerUrl.href);
  authority = await openDeploymentAuthority(options);
}, 60_000);
afterAll(async () => {
  await authority?.close(); await writer?.close(); await admin?.close(); await sourceAdmin?.close();
  await control?.close(); await source?.close();
  if (custodyRoot) await rm(custodyRoot, { recursive: true, force: true });
});

it("authenticates an actual restricted LOGIN and incident session without approving execution", async () => {
  const confirmation = await authority.confirmRestore(request());
  expect(confirmation.status).toBe("authenticated-confirmation-not-persisted");
  expect(confirmation.principal).toEqual({ userId: "incident", organizationId: "authority-org" });
  expect(isIncidentRestoreConfirmation(confirmation)).toBe(true);
  expect(isIncidentRestoreConfirmation({ ...confirmation })).toBe(false);
  await authority.assertConfirmationCurrent(confirmation);
  expect(Object.isFrozen(confirmation.target)).toBe(true);
  expect((await admin.query("select last_used_at is not null as used from auth_sessions where user_id='incident'")).rows).toEqual([{ used: true }]);
  expect((await sourceAdmin.query("table authority_source_guard")).rows).toEqual([{ value: "frozen-source" }]);
  const restricted = createPostgresDatabase(options.authConnectionString);
  try {
    expect((await restricted.query("select session_user as name,current_user=session_user as same")).rows).toEqual([{ name: loginName, same: true }]);
    for (const sql of ["select * from parameter_catalog.catalog_state", "delete from auth_sessions", "update users set is_active=false", "set role catalog_migration_owner"])
      await expect(restricted.query(sql)).rejects.toMatchObject({ code: "42501" });
  } finally { await restricted.close(); }
});

it.each(["ordinary-admin", "operator", "owner", "verifier"])("does not turn %s into incident-owner", async user => {
  await expect(authority.confirmRestore(request(user))).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-PRINCIPAL-REJECTED" });
});

it.each(["operator", "owner"])("authenticates %s and consumes formal report refusal without manufacturing passed evidence", async user => {
  expect(await authority.approveReport({ authorization: `Bearer ${tokens.get(user)}`, kind: user === "operator" ? "operator" : "platform-owner", purpose: "pre-activation", reportDigest: missingReport }, writer))
    .toMatchObject({ ok: false, error: { kind: "plan-not-found" } });
  expect((await admin.query("select count(*)::int as count from parameter_catalog.verification_approvals")).rows).toEqual([{ count: 0 }]);
});

it("rejects a spoofed release actor and a report outside the exact assigned scope", async () => {
  await expect(authority.approveReport({ authorization: `Bearer ${tokens.get("operator")}`, kind: "platform-owner", purpose: "pre-activation", reportDigest: missingReport }, writer)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-PRINCIPAL-REJECTED" });
  await expect(authority.approveReport({ authorization: `Bearer ${tokens.get("operator")}`, kind: "operator", purpose: "public-release", reportDigest: missingReport }, writer)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-REPORT-SCOPE-REJECTED" });
});

it.each(["attempt", "capture", "target"])("rejects restore %s drift", async fault => {
  const changed = request();
  if (fault === "attempt") changed.attemptId = "other-attempt";
  if (fault === "capture") changed.captureDigest = `sha256:${"c".repeat(64)}`;
  if (fault === "target") changed.target = { ...restoreTarget, redisIdentity: "other-redis" };
  await expect(authority.confirmRestore(changed)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-RESTORE-SCOPE-REJECTED" });
});

it("refuses missing and revoked real sessions with redacted errors", async () => {
  const secret = "unrecognized-private-credential";
  await expect(authority.confirmRestore({ ...request(), authorization: `Bearer ${secret}` })).rejects.toMatchObject({ message: "PCAT-DEPLOYMENT-AUTHORITY-OPERATION-FAILED" });
  await admin.query("update auth_sessions set revoked_at=now() where user_id='incident'");
  try { await expect(authority.confirmRestore(request())).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-OPERATION-FAILED" }); }
  finally { await admin.query("update auth_sessions set revoked_at=null where user_id='incident'"); }
});

it("refuses the exact source database before source authentication writes", async () => {
  await expect(openDeploymentAuthority({ ...options, sourceDatabase: assignment.authentication })).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-AUTHENTICATION-DATABASE-REJECTED" });
});

it.each(["superuser", "bypassrls", "createdb", "createrole", "replication"])("refuses actual %s drift on the next lease", async flag => {
  await admin.query(`alter role ${loginRole} ${flag}`);
  try { await expect(authority.confirmRestore(request())).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-AUTHENTICATION-DATABASE-REJECTED" }); }
  finally { await admin.query(`alter role ${loginRole} no${flag}`); }
});

it("refuses newly reachable synchronizer authority", async () => {
  await admin.query(`grant catalog_synchronizer_role to ${loginRole} with inherit false, set true, admin false`);
  try { await expect(authority.confirmRestore(request())).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-AUTHENTICATION-DATABASE-REJECTED" }); }
  finally { await admin.query(`revoke catalog_synchronizer_role from ${loginRole}`); }
});

it("rechecks assignment replacement and revocation for an issued confirmation", async () => {
  const confirmation = await authority.confirmRestore(request());
  const saved = `${options.assignmentPath}.original`;
  await rename(options.assignmentPath, saved);
  await writeFile(options.assignmentPath, JSON.stringify(assignment), { mode: 0o600 });
  try { await expect(authority.assertConfirmationCurrent(confirmation)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-ASSIGNMENT-REJECTED" }); }
  finally { await rm(options.assignmentPath); await rename(saved, options.assignmentPath); }
  const revoked = { ...assignment, expiresAt: "2000-01-01T00:00:00Z" };
  await writeFile(options.assignmentPath, JSON.stringify(revoked), { mode: 0o600 });
  try { await expect(authority.assertConfirmationCurrent(confirmation)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-ASSIGNMENT-REJECTED" }); }
  finally { await writeFile(options.assignmentPath, JSON.stringify(assignment), { mode: 0o600 }); }
});

it("closes the authentication pool and refuses later use", async () => {
  const disposable = await openDeploymentAuthority(options);
  await disposable.close(); await disposable.close();
  await expect(disposable.confirmRestore(request())).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-CLOSED" });
});
