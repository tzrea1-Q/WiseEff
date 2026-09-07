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
import { openDeploymentAuthority, isIncidentRestoreConfirmation, isDeploymentReportApproval, type DeploymentAuthorityAssignment, type DeploymentAuthorityOptions } from "./deploymentAuthority";
import { canonicalJson, sha256Prefixed } from "./journal";
import { approveDeploymentReport, openReportApprovalTarget, type ReportApprovalTarget } from "./reportApprovalTarget";

// Receipt validation precedes every connection. No ambient database, auth mock,
// passed gate adapter, report insertion, or missing-environment skip is used.
let control: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let source: Awaited<ReturnType<typeof createSelfHostedPg16Database>>;
let admin: RootDatabase, sourceAdmin: RootDatabase, writer: RootDatabase;
let options: DeploymentAuthorityOptions, assignment: DeploymentAuthorityAssignment;
let authority: Awaited<ReturnType<typeof openDeploymentAuthority>>;
let custodyRoot: string;
let reportTarget: ReportApprovalTarget;
let reportTargetOptions: Parameters<typeof openReportApprovalTarget>[0];
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
  assignment.reportDatabase = (await admin.query<{ systemIdentifier: string; databaseOid: string }>(`select c.system_identifier::text as "systemIdentifier",
    d.oid::text as "databaseOid" from pg_control_system() c cross join pg_database d where d.datname=current_database()`)).rows[0];
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
  reportTargetOptions = { physicalTarget: assignment.reportDatabase, managementConnectionString: control.url, writerConnectionString: writerUrl.href };
  reportTarget = await openReportApprovalTarget(reportTargetOptions);
  authority = await openDeploymentAuthority(options);
}, 60_000);
afterAll(async () => {
  await authority?.close(); await reportTarget?.close(); await writer?.close(); await admin?.close(); await sourceAdmin?.close();
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

it.each(["operator", "owner"])("authenticates %s into a formal command without manufacturing report or target approval", async user => {
  const reportRequest = { authorization: `Bearer ${tokens.get(user)}`, kind: user === "operator" ? "operator" as const : "platform-owner" as const, purpose: "pre-activation" as const, reportDigest: missingReport };
  const approval = await authority.prepareReportApproval(reportRequest);
  expect(isDeploymentReportApproval(approval)).toBe(true);
  expect(isDeploymentReportApproval({ ...approval })).toBe(false);
  expect(approval.command).toEqual({ principalId: user, principalKind: reportRequest.kind, purpose: "pre-activation" });
  const missing = await authority.approveReport(reportRequest, reportTarget);
  expect(missing).toMatchObject({ ok: false, error: { kind: "plan-not-found" } });
  await expect(authority.approveReport(reportRequest, writer)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-REPORT-TARGET-ADAPTER-UNAVAILABLE" });
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

it("does not accept another network address for the same source database", async () => {
  await expect(openDeploymentAuthority({ ...options, sourceDatabase: { ...assignment.authentication, serverAddress: "192.0.2.89" } }))
    .rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-AUTHENTICATION-DATABASE-REJECTED" });
});

it("snapshots the incident request before asynchronous authentication", async () => {
  const input = request();
  const pending = authority.confirmRestore(input);
  input.attemptId = "changed-after-dispatch";
  expect((await pending).attemptId).toBe("restore-attempt");
});

it("snapshots the report actor and digest before asynchronous authentication", async () => {
  const input = { authorization: `Bearer ${tokens.get("operator")}`, kind: "operator" as "operator" | "platform-owner", purpose: "pre-activation" as const, reportDigest: missingReport };
  const pending = authority.prepareReportApproval(input);
  input.kind = "platform-owner"; input.reportDigest = `sha256:${"0".repeat(64)}`;
  const approval = await pending;
  expect(approval.command.principalKind).toBe("operator"); expect(approval.reportDigest).toBe(missingReport);
});

it.each(["physical-target", "management-database", "superuser-writer"])("rejects report target factory %s", async fault => {
  const changed = structuredClone(reportTargetOptions);
  if (fault === "physical-target") changed.physicalTarget.systemIdentifier = "999";
  if (fault === "management-database") changed.managementConnectionString = source.url;
  if (fault === "superuser-writer") changed.writerConnectionString = control.url;
  await expect(openReportApprovalTarget(changed)).rejects.toMatchObject({ code: fault === "superuser-writer"
    ? "PCAT-REPORT-APPROVAL-WRITER-CAPABILITY-REJECTED" : "PCAT-REPORT-APPROVAL-PHYSICAL-TARGET-MISMATCH" });
});

it("refuses a copied report command and an already closed target", async () => {
  const command = await authority.prepareReportApproval({ authorization: `Bearer ${tokens.get("operator")}`, kind: "operator", purpose: "pre-activation", reportDigest: missingReport });
  await expect(approveDeploymentReport(reportTarget, { ...command })).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-REPORT-COMMAND-REJECTED" });
  const closed = await openReportApprovalTarget(reportTargetOptions); await closed.close(); await closed.close();
  await expect(approveDeploymentReport(closed, command)).rejects.toMatchObject({ code: "PCAT-REPORT-APPROVAL-TARGET-CLOSED" });
});

it("binds the actual restricted writer session to the management database and releases its challenge", async () => {
  const other = await createSelfHostedPg16Database("authority_other_report");
  const otherAdmin = createPostgresDatabase(other.url);
  try {
    await applyMigrations(otherAdmin, path.resolve("server/migrations"));
    const wrong = new URL(other.url), current = new URL(reportTargetOptions.writerConnectionString);
    wrong.username = current.username; wrong.password = current.password;
    await expect(openReportApprovalTarget({ ...reportTargetOptions, writerConnectionString: wrong.href }))
      .rejects.toMatchObject({ code: "PCAT-REPORT-APPROVAL-WRITER-TARGET-MISMATCH" });
    expect((await admin.query("select count(*)::int as count from pg_locks where locktype='advisory' and classid=1346584915 and objsubid=2")).rows).toEqual([{ count: 0 }]);
  } finally { await otherAdmin.close(); await other.close(); }
}, 60_000);

it("rechecks the assignment after a report command has been issued", async () => {
  const command = await authority.prepareReportApproval({ authorization: `Bearer ${tokens.get("operator")}`, kind: "operator", purpose: "pre-activation", reportDigest: missingReport });
  await writeFile(options.assignmentPath, JSON.stringify({ ...assignment, expiresAt: "2000-01-01T00:00:00Z" }), { mode: 0o600 });
  try { await expect(approveDeploymentReport(reportTarget, command)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-ASSIGNMENT-REJECTED" }); }
  finally { await writeFile(options.assignmentPath, JSON.stringify(assignment), { mode: 0o600 }); }
});

it.each(["missing", "other-physical-target"])("refuses a report command whose private physical mapping is %s", async fault => {
  const current = { ...assignment, reportDatabase: fault === "missing" ? undefined : { ...assignment.reportDatabase!, systemIdentifier: "999" } };
  const filename = path.join(custodyRoot, `assignment-${fault}.json`);
  await writeFile(filename, JSON.stringify(current), { mode: 0o600 });
  const scoped = await openDeploymentAuthority({ ...options, assignmentPath: filename, expectedAssignmentDigest: sha256Prefixed(canonicalJson(JSON.parse(JSON.stringify(current)))) });
  try {
    const command = await scoped.prepareReportApproval({ authorization: `Bearer ${tokens.get("operator")}`, kind: "operator", purpose: "pre-activation", reportDigest: missingReport });
    await expect(approveDeploymentReport(reportTarget, command)).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-REPORT-SCOPE-REJECTED" });
  } finally { await scoped.close(); await rm(filename); }
});

it.each(["catalog-read", "report-update", "registry-insert", "public-builtin", "public-parameter", "set-role", "admin-role", "no-inherit"])("refuses effective report writer drift through %s", async fault => {
  const writerName = pg.escapeIdentifier(new URL(reportTargetOptions.writerConnectionString).username);
  const grants: Record<string, [string, string]> = {
    "catalog-read": [`grant select on parameter_catalog.catalog_state to ${writerName}`, `revoke select on parameter_catalog.catalog_state from ${writerName}`],
    "report-update": [`grant update on parameter_catalog.verification_reports to ${writerName}`, `revoke update on parameter_catalog.verification_reports from ${writerName}`],
    "registry-insert": [`grant insert on parameter_catalog.verification_gate_registry to ${writerName}`, `revoke insert on parameter_catalog.verification_gate_registry from ${writerName}`],
    "public-builtin": ["grant execute on function pg_read_file(text) to public", "revoke execute on function pg_read_file(text) from public"],
    "public-parameter": ["grant alter system on parameter log_statement to public", "revoke alter system on parameter log_statement from public"],
    "set-role": [`grant catalog_verification_writer_role to ${writerName} with set true`, `grant catalog_verification_writer_role to ${writerName} with set false`],
    "admin-role": [`grant catalog_verification_writer_role to ${writerName} with admin true`, `grant catalog_verification_writer_role to ${writerName} with admin false`],
    "no-inherit": [`grant catalog_verification_writer_role to ${writerName} with inherit false`, `grant catalog_verification_writer_role to ${writerName} with inherit true`],
  };
  const [grant, revoke] = grants[fault];
  await admin.query(grant);
  try { await expect(openReportApprovalTarget(reportTargetOptions)).rejects.toMatchObject({ code: "PCAT-REPORT-APPROVAL-WRITER-CAPABILITY-REJECTED" }); }
  finally { await admin.query(revoke); }
});

it.each(["authentication", "report-writer"])("refuses a new PUBLIC system definer on the actual %s LOGIN", async pool => {
  await admin.query(`create table public.authority_definer_canary(value text);
    create function pg_catalog.authority_untrusted_definer() returns bigint language sql security definer
    set search_path=pg_catalog as 'with inserted as (insert into public.authority_definer_canary values (current_user) returning *) select count(*) from inserted'`);
  const restricted = createPostgresDatabase(pool === "authentication" ? options.authConnectionString : reportTargetOptions.writerConnectionString);
  try {
    await expect(restricted.query("insert into public.authority_definer_canary values ('forbidden')")).rejects.toMatchObject({ code: "42501" });
    expect((await restricted.query("select pg_catalog.authority_untrusted_definer()::int as count")).rows).toEqual([{ count: 1 }]);
    expect((await admin.query("select count(*)::int as count from pg_init_privs where classoid='pg_proc'::regclass and objoid='pg_catalog.authority_untrusted_definer()'::regprocedure")).rows).toEqual([{ count: 0 }]);
    if (pool === "authentication") await expect(authority.confirmRestore(request())).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-AUTHENTICATION-DATABASE-REJECTED" });
    else await expect(openReportApprovalTarget(reportTargetOptions).then(async accepted => { await accepted.close(); return accepted; }))
      .rejects.toMatchObject({ code: "PCAT-REPORT-APPROVAL-WRITER-CAPABILITY-REJECTED" });
  } finally { await restricted.close(); await admin.query("drop function pg_catalog.authority_untrusted_definer(); drop table public.authority_definer_canary"); }
});

it.each(["session-insert", "session-column-insert", "password-column-update", "public-password-update", "public-select", "definer", "function-grant", "grant-option", "sequence", "default-grant"])("refuses effective authority forgery through %s", async fault => {
  const grants: Record<string, [string, string]> = {
    "session-insert": [`grant insert on public.auth_sessions to ${loginRole}`, `revoke insert on public.auth_sessions from ${loginRole}`],
    "session-column-insert": [`grant insert(user_id) on public.auth_sessions to ${loginRole}`, `revoke insert(user_id) on public.auth_sessions from ${loginRole}`],
    "password-column-update": [`grant update(password_hash) on public.user_password_credentials to ${loginRole}`, `revoke update(password_hash) on public.user_password_credentials from ${loginRole}`],
    "public-password-update": ["grant update(password_hash) on public.user_password_credentials to public", "revoke update(password_hash) on public.user_password_credentials from public"],
    "public-select": ["create table public.authority_extra_secret(value text); grant select on public.authority_extra_secret to public", "drop table public.authority_extra_secret"],
    "definer": ["create function public.authority_forge() returns void language sql security definer set search_path=pg_catalog as 'update public.auth_sessions set revoked_at=null'; grant execute on function public.authority_forge() to public", "drop function public.authority_forge()"],
    "function-grant": [`create function public.authority_extra() returns int language sql as 'select 1'; grant execute on function public.authority_extra() to ${loginRole}`, "drop function public.authority_extra()"],
    "grant-option": [`grant select on public.auth_sessions to ${loginRole} with grant option`, `revoke grant option for select on public.auth_sessions from ${loginRole}`],
    "sequence": [`create sequence public.authority_extra_sequence; grant usage on sequence public.authority_extra_sequence to ${loginRole}`, "drop sequence public.authority_extra_sequence"],
    "default-grant": [`alter default privileges in schema public grant select on tables to ${loginRole}`, `alter default privileges in schema public revoke select on tables from ${loginRole}`],
  };
  const [grant, revoke] = grants[fault];
  await admin.query(grant);
  try { await expect(authority.confirmRestore(request())).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-AUTHENTICATION-DATABASE-REJECTED" }); }
  finally { await admin.query(revoke); }
});

it.each(["builtin-execute", "alter-system", "superuser-set", "unknown-set"])("refuses PUBLIC system authority through %s", async fault => {
  const permissions: Record<string, [string, string, string]> = {
    "builtin-execute": ["grant execute on function pg_catalog.pg_read_file(text) to public", "revoke execute on function pg_catalog.pg_read_file(text) from public", "select pg_catalog.pg_read_file('PG_VERSION') as value"],
    "alter-system": ["grant alter system on parameter log_statement to public", "revoke alter system on parameter log_statement from public", "select pg_catalog.has_parameter_privilege(current_user,'log_statement','ALTER SYSTEM') as value"],
    "superuser-set": ["grant set on parameter log_statement to public", "revoke set on parameter log_statement from public", "select pg_catalog.set_config('log_statement','all',false) as value"],
    "unknown-set": ["grant set on parameter authority.unavailable to public", "revoke set on parameter authority.unavailable from public", "select pg_catalog.has_parameter_privilege(current_user,'authority.unavailable','SET') as value"],
  };
  const [grant, revoke, observe] = permissions[fault];
  await admin.query(grant);
  const restricted = createPostgresDatabase(options.authConnectionString);
  try {
    const result = (await restricted.query(observe)).rows[0].value;
    if (fault === "builtin-execute") expect(String(result).trim()).toBe("16");
    else expect(result).toBe(fault === "superuser-set" ? "all" : true);
    await expect(authority.confirmRestore(request())).rejects.toMatchObject({ code: "PCAT-DEPLOYMENT-AUTHORITY-AUTHENTICATION-DATABASE-REJECTED" });
  } finally { await restricted.close(); await admin.query(revoke); }
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
