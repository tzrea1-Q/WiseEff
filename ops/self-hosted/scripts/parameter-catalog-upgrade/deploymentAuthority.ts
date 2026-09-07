import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { createAuthContextResolver } from "../../../../server/modules/auth/contextFactory";
import { createLocalAuthService } from "../../../../server/modules/auth/localAuth";
import { createUserInvocation } from "../../../../server/modules/auth/trustedInvocation";
import { createPostgresDatabase, isRootDatabase, type RootDatabase } from "../../../../server/shared/database/client";
import { createVerificationReportService } from "../../../../server/modules/release-verification/report/index";
import type { ApprovalCommand } from "../../../../server/modules/release-verification/core";
import type { RecoveryTargetIdentity } from "../../storage/recoveryPoint";
import { canonicalJson, sha256Prefixed } from "./journal";

type AuthorityKind = "operator" | "platform-owner" | "incident-owner";
type Principal = { userId: string; organizationId: string };
type Endpoint = { serverAddress: string; serverPort: number };
type AuthDatabaseIdentity = Endpoint & { databaseName: string; databaseOid: string };
export type DeploymentAuthorityAssignment = {
  format: "wiseeff-deployment-authority-v1";
  runId: string; target: RecoveryTargetIdentity; expiresAt: string;
  authentication: AuthDatabaseIdentity;
  principals: (Principal & { kind: AuthorityKind })[];
  verifierPrincipals: Principal[];
  reports: { purpose: ApprovalCommand["purpose"]; reportDigest: string }[];
  restore: { attemptId: string; captureDigest: string; target: RecoveryTargetIdentity } | null;
};
export class DeploymentAuthorityError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DeploymentAuthorityError"; }
}
const refuse = (suffix: string): never => { throw new DeploymentAuthorityError(`PCAT-DEPLOYMENT-AUTHORITY-${suffix}`); };
const digest = (value: unknown) => sha256Prefixed(canonicalJson(value));
const validDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:@-]{1,180}$/.test(value);
const identityKey = (principal: Principal) => canonicalJson([principal.organizationId, principal.userId]);
const kinds = ["operator", "platform-owner", "incident-owner"] as const;
const purposes = ["pre-activation", "post-retirement-runtime", "public-release", "legacy-read-sunset", "p16-cleanup"];
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

export type DeploymentAuthorityOptions = {
  custodyRoot: string; custodianUid: number; assignmentPath: string;
  expectedAssignmentDigest: string; runId: string; target: RecoveryTargetIdentity;
  /** Independently observed source backend, supplied by the fixed handoff root. */
  sourceDatabase: AuthDatabaseIdentity;
  /** Explicit private control-plane credential. There is no ambient URL fallback. */
  authConnectionString: string;
};

const statIdentity = (stat: Awaited<ReturnType<typeof lstat>>) => `${stat.dev}:${stat.ino}:${stat.uid}:${stat.mode}:${stat.nlink}`;
async function readAssignment(options: DeploymentAuthorityOptions) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const root = options.custodyRoot, filename = options.assignmentPath;
    if (!Number.isSafeInteger(options.custodianUid) || options.custodianUid < 0
      || !path.isAbsolute(root) || path.dirname(filename) !== root || await realpath(root) !== root) refuse("ASSIGNMENT-REJECTED");
    const directory = await lstat(root);
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== options.custodianUid || (directory.mode & 0o777) !== 0o700) refuse("ASSIGNMENT-REJECTED");
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== options.custodianUid || before.nlink !== 1 || (before.mode & 0o777) !== 0o600 || before.size > 65536) refuse("ASSIGNMENT-REJECTED");
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) { const read = await handle.read(bytes, size, bytes.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
    const after = await handle.stat(), named = await lstat(filename), parent = await lstat(root);
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || statIdentity(before) !== statIdentity(after) || statIdentity(before) !== statIdentity(named)
      || statIdentity(directory) !== statIdentity(parent) || await realpath(root) !== root) refuse("ASSIGNMENT-REJECTED");
    const value = JSON.parse(bytes.subarray(0, size).toString()) as DeploymentAuthorityAssignment;
    if (!validDigest(options.expectedAssignmentDigest) || digest(value) !== options.expectedAssignmentDigest
      || value.format !== "wiseeff-deployment-authority-v1" || value.runId !== options.runId || !id(value.runId)
      || !same(value.target, options.target) || Date.parse(value.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(value.expiresAt))
      || !Array.isArray(value.principals) || value.principals.length !== 3
      || kinds.some(kind => value.principals.filter(principal => principal.kind === kind).length !== 1)
      || value.principals.some(principal => !id(principal.userId) || !id(principal.organizationId))
      || new Set(value.principals.map(identityKey)).size !== 3 || !Array.isArray(value.verifierPrincipals)
      || value.verifierPrincipals.some(principal => !id(principal.userId) || !id(principal.organizationId) || value.principals.some(assigned => identityKey(assigned) === identityKey(principal)))
      || !Array.isArray(value.reports) || value.reports.some(report => !purposes.includes(report.purpose) || !validDigest(report.reportDigest))
      || !value.authentication || !id(value.authentication.databaseName) || !/^\d+$/.test(value.authentication.databaseOid)
      || typeof value.authentication.serverAddress !== "string" || !Number.isSafeInteger(value.authentication.serverPort)
      || (value.restore !== null && (!id(value.restore.attemptId) || !validDigest(value.restore.captureDigest)))) refuse("ASSIGNMENT-REJECTED");
    return { assignment: value, binding: `${statIdentity(directory)}:${statIdentity(before)}` };
  } catch { return refuse("ASSIGNMENT-REJECTED"); }
  finally { await handle?.close(); }
}

const authIdentitySql = `with recursive reachable(oid) as (
  select oid from pg_catalog.pg_roles where rolname=session_user
  union select m.roleid from pg_catalog.pg_auth_members m join reachable r on r.oid=m.member
)
select current_database() as "databaseName", (select oid::text from pg_catalog.pg_database where datname=current_database()) as "databaseOid",
 inet_server_addr()::text as "serverAddress", inet_server_port() as "serverPort",
 session_user=current_user as same_identity,
 (select count(*)::int from pg_catalog.pg_roles r join reachable x on x.oid=r.oid
   where r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication) as elevated,
 (select count(*)::int from pg_catalog.pg_shdepend d join reachable x on x.oid=d.refobjid
   where d.refclassid='pg_catalog.pg_authid'::pg_catalog.regclass and d.deptype='o') as owners,
 (select count(*)::int from pg_catalog.pg_auth_members m join reachable x on x.oid=m.member) as memberships`;

/** This confirmation is not a restore token or an execution capability. The
 * parent must persist it through its journal admission before any restore. */
export type IncidentRestoreConfirmation = Readonly<{
  status: "authenticated-confirmation-not-persisted";
  assignmentDigest: string; runId: string; attemptId: string; captureDigest: string;
  target: RecoveryTargetIdentity; principal: Principal; traceId: string;
  approvalReference: string; expiresAt: string;
}>;
const confirmations = new WeakSet<object>();
export const isIncidentRestoreConfirmation = (value: unknown): value is IncidentRestoreConfirmation =>
  typeof value === "object" && value !== null && confirmations.has(value);

export async function openDeploymentAuthority(input: DeploymentAuthorityOptions) {
  const options = structuredClone(input);
  const pinned = await readAssignment(options);
  let db: RootDatabase | undefined;
  let closed = false;
  try {
    const connection = new URL(options.authConnectionString);
    if (!["postgres:", "postgresql:"].includes(connection.protocol) || !connection.hostname || !connection.username || connection.pathname.length < 2) refuse("AUTHENTICATION-UNAVAILABLE");
    const observe = async (session: Pick<RootDatabase, "query">) => {
      if (closed) refuse("CLOSED");
      const observed = await readAssignment(options);
      if (observed.binding !== pinned.binding) refuse("ASSIGNMENT-REJECTED");
      const assignment = observed.assignment;
      const result = await session.query<AuthDatabaseIdentity & { same_identity: boolean; elevated: number; owners: number; memberships: number }>(authIdentitySql);
      const row = result.rows[0];
      const identity = row && { databaseName: row.databaseName, databaseOid: row.databaseOid, serverAddress: row.serverAddress, serverPort: row.serverPort };
      if (result.rowCount !== 1 || !row || row.same_identity !== true || row.elevated !== 0 || row.owners !== 0 || row.memberships !== 0
        || !same(identity, assignment.authentication) || same(identity, options.sourceDatabase)) refuse("AUTHENTICATION-DATABASE-REJECTED");
      return assignment;
    };
    db = createPostgresDatabase(options.authConnectionString, { verifyCheckout: async session => {
      await observe(session);
      // The existing authentication repository uses unqualified public names.
      // Pin every actual lease before those queries, including reconnects.
      await session.query("select pg_catalog.set_config('search_path','pg_catalog,public,pg_temp',false)");
    } });
    const authDb = db;
    const verify = () => observe(authDb);
    await verify();
    const resolver = createAuthContextResolver({ mode: "production", localAuthResolver: createLocalAuthService(authDb, { selfRegisterEnabled: false }).resolveSession });
    const authenticate = async (authorization: string, kind: AuthorityKind) => {
      const assignment = await verify();
      const auth = await resolver({ headers: { authorization } });
      const invocation = createUserInvocation(auth);
      const principal = { userId: invocation.principal.user.id, organizationId: invocation.principal.organization.id };
      if (!assignment.principals.some(grant => grant.kind === kind && identityKey(grant) === identityKey(principal))) refuse("PRINCIPAL-REJECTED");
      await verify();
      return { assignment, principal };
    };
    const safe = async <T>(action: () => Promise<T>): Promise<T> => {
      try { return await action(); }
      catch (error) { if (error instanceof DeploymentAuthorityError) throw error; return refuse("OPERATION-FAILED"); }
    };
    return Object.freeze({
      async approveReport(request: { authorization: string; kind: "operator" | "platform-owner"; purpose: ApprovalCommand["purpose"]; reportDigest: string }, reportDb: RootDatabase) {
        return safe(async () => {
          if (!isRootDatabase(reportDb) || reportDb === authDb || !["operator", "platform-owner"].includes(request.kind)) refuse("REPORT-COMMAND-REJECTED");
          const { assignment, principal } = await authenticate(request.authorization, request.kind);
          if (!assignment.reports.some(report => report.purpose === request.purpose && report.reportDigest === request.reportDigest)) refuse("REPORT-SCOPE-REJECTED");
          // Report integrity, gates, purpose, distinct approvals and append-only
          // persistence remain owned by the existing domain service.
          return createVerificationReportService({ db: reportDb }).approveReport(request.reportDigest, {
            principalKind: request.kind, principalId: principal.userId, purpose: request.purpose,
          });
        });
      },
      async confirmRestore(request: { authorization: string; attemptId: string; captureDigest: string; target: RecoveryTargetIdentity; traceId: string }) {
        return safe(async () => {
          const { assignment, principal } = await authenticate(request.authorization, "incident-owner");
          if (!id(request.traceId) || !assignment.restore || !same(assignment.restore, { attemptId: request.attemptId, captureDigest: request.captureDigest, target: request.target })) refuse("RESTORE-SCOPE-REJECTED");
          const body = { assignmentDigest: options.expectedAssignmentDigest, runId: options.runId,
            ...structuredClone(assignment.restore), target: Object.freeze({ ...assignment.restore.target }),
            principal: Object.freeze(principal), traceId: request.traceId, expiresAt: assignment.expiresAt };
          const confirmation = Object.freeze({ status: "authenticated-confirmation-not-persisted" as const, ...body, approvalReference: digest(body) });
          confirmations.add(confirmation); return confirmation;
        });
      },
      async assertConfirmationCurrent(confirmation: IncidentRestoreConfirmation) {
        return safe(async () => {
          const assignment = await verify();
          if (!isIncidentRestoreConfirmation(confirmation) || confirmation.assignmentDigest !== options.expectedAssignmentDigest
            || confirmation.runId !== options.runId || Date.parse(confirmation.expiresAt) <= Date.now()
            || !assignment.principals.some(principal => principal.kind === "incident-owner" && identityKey(principal) === identityKey(confirmation.principal))
            || !same(assignment.restore, { attemptId: confirmation.attemptId, captureDigest: confirmation.captureDigest, target: confirmation.target })) refuse("RESTORE-SCOPE-REJECTED");
        });
      },
      async close() { if (!closed) { closed = true; await authDb.close(); } },
    });
  } catch (error) {
    await db?.close().catch(() => undefined);
    if (error instanceof DeploymentAuthorityError) throw error;
    return refuse("AUTHENTICATION-UNAVAILABLE");
  }
}
