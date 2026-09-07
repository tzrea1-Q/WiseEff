import { randomUUID, randomInt } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import pg from "pg";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { createP12Activation, type ActivationOptions } from "../../../../server/modules/catalog-cutover/activation";
import { legacyRolesAreRecoverable, type RetiringRole as Role } from "../../../../server/modules/catalog-cutover/retirement/roleRecovery";
import { applyLegacyLoginFence, assertNoSharedLegacyRoleUse, retiringRolesSql as rolesSql } from "../../../../server/modules/catalog-cutover/retirement/loginFence";
import { readBindingDatabaseIdentity } from "../../../../server/modules/parameter-bindings/cutoverImport/sourceBoundary";
import { digestOf } from "../../../../server/modules/release-verification/core/digest";
import { verifyRecoveryPackage } from "../../storage/recoveryPackage";
import { assertHostOperationLock, type HandoffPlan, type HostOperationLock } from "./handoff";
import { canonicalJson, loadUpgradeJournal, sha256Prefixed } from "./journal";

export class LegacyLoginRetirementError extends Error {
  constructor(readonly reason: string) { super(`PCAT-UPG-LEGACY-LOGIN-${reason}`); }
}
const refuse = (reason: string): never => { throw new LegacyLoginRetirementError(reason); };
const need = (value: unknown, reason: string): void => { if (!value) refuse(reason); };

export type LegacyLoginRetirementInput = {
  handoff: HandoffPlan;
  expectedHandoffDigest: string;
  lock: HostOperationLock;
  activation: ActivationOptions;
  activationAttemptId: string;
  attemptId: string;
  /** Explicit private management transport. Never inherited from DATABASE_URL. */
  administrativeConnectionString: string;
  recoveryDirectory: string;
};


/** Actual former LOGINs are derived from the stopped source containers, not a
 * caller role list. The only mutation is a bounded database substep of P13.
 * A result here is deliberately NOT the P13 checkpoint or runtime approval.
 */
async function retire(input: LegacyLoginRetirementInput) {
  input = { ...input, activation: { ...input.activation, target: input.activation?.target ? { ...input.activation.target } : undefined as never } };
  const fixed = { handoff: structuredClone(input.handoff), expectedHandoffDigest: input.expectedHandoffDigest,
    attemptId: input.attemptId, activationAttemptId: input.activationAttemptId, recoveryDirectory: input.recoveryDirectory };
  const plan = fixed.handoff, { digest, ...planBody } = plan;
  need(typeof fixed.attemptId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(fixed.attemptId), "ATTEMPT-INVALID");
  need(digest === fixed.expectedHandoffDigest && digest === sha256Prefixed(canonicalJson(planBody)), "HANDOFF-MISMATCH");
  // The genuine issued host lock is checked before opening Docker or any pool.
  await assertHostOperationLock(input.lock, plan.inputs.lockRoot).catch(() => refuse("LOCK-UNAVAILABLE"));
  const docker = createIsolatedUpgradeDocker();
  need(docker.daemonId === plan.inputs.expectedDaemonId, "DAEMON-MISMATCH");
  const activation = createP12Activation(input.activation);
  let admin: pg.PoolClient | undefined;
  let adminPool: pg.Pool | undefined;
  let packageDirectory: Awaited<ReturnType<typeof open>> | undefined;
  let transaction = false, ending = false, unknown = false;
  let connectionFailed = false;
  const onConnectionError = () => { connectionFailed = true; };
  try {
    const loaded = loadUpgradeJournal({ journalPath: plan.inputs.journalPath, runId: plan.inputs.runId, requireSettled: true });
    need(loaded.ok, "JOURNAL-UNAVAILABLE");
    if (!loaded.ok) return refuse("JOURNAL-UNAVAILABLE");
    need(loaded.value.record.cutoverRunId === input.activation.runId, "CUTOVER-RUN-MISMATCH");
    const captures = loaded.value.record.entries.flatMap(entry => entry.recoveryCapture?.outcome === "committed" && entry.recoveryCapture.capture ? [entry.recoveryCapture] : []);
    need(captures.length === 1 && captures[0].directory.path === fixed.recoveryDirectory, "RECOVERY-SOURCE-UNAVAILABLE");
    const capture = captures[0].capture!;
    packageDirectory = await open(fixed.recoveryDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const checkPackageDirectory = async () => {
      const [held, named] = await Promise.all([packageDirectory!.stat(), lstat(fixed.recoveryDirectory)]);
      need(held.isDirectory() && named.isDirectory() && !named.isSymbolicLink() && named.uid === process.getuid?.() &&
        (named.mode & 0o777) === 0o700 && String(held.dev) === captures[0].directory.device && String(held.ino) === captures[0].directory.inode &&
        held.dev === named.dev && held.ino === named.ino && await realpath(fixed.recoveryDirectory) === fixed.recoveryDirectory, "RECOVERY-DIRECTORY-DRIFT");
    };
    const packageNow = async () => {
      await checkPackageDirectory();
      const value = await verifyRecoveryPackage(fixed.recoveryDirectory, capture.packageDigest);
      need(value.manifest.recovery.runId === capture.runId && value.manifest.recovery.recoveryPointDigest === capture.recoveryPointDigest &&
        isDeepStrictEqual(value.manifest.recovery.target, capture.source), "RECOVERY-MISMATCH");
      await checkPackageDirectory();
      return value;
    };
    const backup = await packageNow();
    const check = async () => {
      need(!connectionFailed, "CONNECTION-FAILED");
      await assertHostOperationLock(input.lock, plan.inputs.lockRoot);
      await input.activation.owner.verify({ ...input.activation.target });
      const current = loadUpgradeJournal({ journalPath: plan.inputs.journalPath, runId: plan.inputs.runId, requireSettled: true });
      need(current.ok && current.value.record.journalDigest === loaded.value.record.journalDigest, "JOURNAL-DRIFT");
      await packageNow();
      need(docker.daemonId === plan.inputs.expectedDaemonId, "DAEMON-MISMATCH");
      const urls: string[] = [];
      need(plan.inputs.source.applications.map(app => app.service).sort().join(",") === "api,web,worker", "APPLICATION-INVENTORY-INCOMPLETE");
      for (const app of plan.inputs.source.applications) {
        const actual = JSON.parse(docker.command(["inspect", app.containerId]).toString())[0];
        need(actual?.Id === app.containerId && actual.Image === app.imageId && actual.Config?.Image === app.imageReference &&
          actual.Config?.Labels?.["com.docker.compose.project"] === plan.inputs.source.project &&
          actual.Config?.Labels?.["com.docker.compose.service"] === app.service &&
          actual.State?.Status === "exited" && !actual.State.Running && !actual.State.Restarting, "SOURCE-WRITER-NOT-STOPPED");
        if (app.service !== "web") {
          const values = (actual.Config.Env as string[]).filter(value => value.startsWith("DATABASE_URL="));
          need(values.length === 1, "SOURCE-LOGIN-UNAVAILABLE");
          urls.push(values[0].slice("DATABASE_URL=".length));
        }
      }
      return urls;
    };
    const sourceUrls = await check();
    const binding = await activation.inspectAppliedBinding(fixed.activationAttemptId);
    need(binding.contract === "pcat-p12-binding-v1" && binding.runId === input.activation.runId && capture.runId === plan.inputs.runId &&
      ((binding.pins as Record<string, unknown>)?.artifact as Record<string, unknown>)?.gitSha === plan.inputs.candidate.sha &&
      digestOf((binding.facts as Record<string, unknown>)?.target) === digestOf(input.activation.target) &&
      (binding.facts as Record<string, unknown>)?.recoveryManifestDigest === capture.recoveryPointDigest, "P12-BINDING-MISMATCH");
    const checkCurrentP12 = async () => {
      const current = await activation.inspect();
      need(current.mode === "canonical" && current.attemptId === fixed.activationAttemptId &&
        isDeepStrictEqual(current.binding, binding) && digestOf(current.facts) === digestOf(binding.facts), "P12-CURRENT-STATE-DRIFT");
    };
    await checkCurrentP12();
    const adminUrl = new URL(input.administrativeConnectionString);
    need(["postgres:", "postgresql:"].includes(adminUrl.protocol) && !!adminUrl.hostname && !!adminUrl.username && !adminUrl.search && !adminUrl.hash, "MANAGEMENT-CONFIGURATION-INVALID");
    adminPool = new pg.Pool({ connectionString: adminUrl.href, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    adminPool.on("error", onConnectionError);
    admin = await adminPool.connect();
    admin.on("error", onConnectionError);
    const targetCheck = async () => {
      need(isDeepStrictEqual(await readBindingDatabaseIdentity(admin!), input.activation.target), "TARGET-MISMATCH");
      await check();
    };
    await targetCheck();
    const management = (await admin.query(`select r.oid::text as oid,session_user as name,current_database() as database,
      session_user=current_user and r.rolsuper as admitted from pg_catalog.pg_roles r where rolname=session_user`)).rows[0];
    need(management?.admitted === true && management.oid === "10" && management.name === (backup.bootstrap?.roleName ?? "postgres"), "MANAGEMENT-IDENTITY-UNSUPPORTED");
    const names = new Set<string>();
    // The stopped container's credentials use the already identified management
    // transport. The backend challenge proves the actual session's database.
    for (const sourceUrlText of sourceUrls) {
      const sourceUrl = new URL(sourceUrlText);
      need(!sourceUrl.search && !sourceUrl.hash && sourceUrl.pathname === `/${management.database}` && !!sourceUrl.username, "SOURCE-CONFIGURATION-UNSUPPORTED");
      const transport = new URL(adminUrl); transport.username = sourceUrl.username; transport.password = sourceUrl.password;
      const client = new pg.Client({ connectionString: transport.href, connectionTimeoutMillis: 5000, query_timeout: 10000 });
      client.on("error", onConnectionError);
      const key = randomInt(1, 2147483647);
      try {
        await client.connect();
        const actual = (await client.query(`select pg_catalog.pg_backend_pid() as pid,session_user as name,
          session_user=current_user as same;`)).rows[0];
        await client.query("select pg_catalog.pg_advisory_lock(824013,$1)", [key]);
        const challenge = (await admin.query(`select count(*)::int as count from pg_catalog.pg_locks
          where pid=$1 and database=$2::oid and locktype='advisory' and granted and classid=824013 and objid=$3::oid and objsubid=2`, [actual.pid, input.activation.target.databaseOid, key])).rows[0];
        need(actual.same === true && challenge?.count === 1 && actual.name !== management.name, "SOURCE-SESSION-MISMATCH");
        names.add(actual.name);
      } finally { await client.end(); }
    }
    await targetCheck();
    const oldRoles = (await admin.query<Role>(rolesSql, [[...names]])).rows;
    need(oldRoles.length === names.size && names.size > 0, "SOURCE-ROLE-MISSING");
    need(legacyRolesAreRecoverable(oldRoles, backup.roles), "ROLE-RECOVERY-UNSUPPORTED");
    const checkShared = () => assertNoSharedLegacyRoleUse(admin!, oldRoles, input.activation.target);
    await checkShared();
    const lock = (await admin.query("select pg_catalog.pg_try_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as held")).rows[0];
    need(lock?.held === true, "CONTROLLER-LOCK-HELD");
    const request = { contract: "pcat-legacy-login-fence-v1", runId: input.activation.runId, attemptId: fixed.attemptId,
      activationAttemptId: fixed.activationAttemptId, activationBindingDigest: digestOf(binding), target: input.activation.target,
      recoveryPackageDigest: backup.digest, recoveryPointDigest: capture.recoveryPointDigest, roles: oldRoles };
    const append = async (kind: string) => {
      await admin!.query(`insert into parameter_catalog.parameter_catalog_cutover_events(id,cutover_run_id,sequence_number,phase,event_kind,payload)
        select $1,$2,coalesce(max(sequence_number),0)+1,'P13',$3,$4::jsonb
        from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`, [`cevt_${randomUUID()}`, input.activation.runId, kind, JSON.stringify({ request, requestDigest: digestOf(request) })]);
    };
    await admin.query("begin isolation level serializable"); transaction = true;
    await admin.query("set local synchronous_commit=on");
    await targetCheck();
    await admin.query("select id from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update", [input.activation.runId]);
    const prior = await admin.query("select id from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1 and phase='P13'", [input.activation.runId]);
    need(prior.rowCount === 0, "ATTEMPT-REQUIRES-RECONCILE");
    await append("legacy-login-fence-intent");
    ending = true; await admin.query("commit"); transaction = false; ending = false;
    await admin.query("begin isolation level serializable"); transaction = true;
    await admin.query("set local synchronous_commit=on");
    await targetCheck(); await checkShared();
    need(isDeepStrictEqual((await admin.query<Role>(rolesSql, [[...names]])).rows, oldRoles), "ROLE-DRIFT");
    need(isDeepStrictEqual(await activation.inspectAppliedBinding(fixed.activationAttemptId), binding), "P12-DRIFT");
    await checkCurrentP12();
    await applyLegacyLoginFence({ client: admin, target: input.activation.target, expectedRoles: oldRoles, recoveryRoles: backup.roles });
    await targetCheck();
    await append("legacy-login-fence-applied");
    ending = true; await admin.query("commit"); transaction = false; ending = false;
    // NOLOGIN does not terminate old sessions. A late connection is a refusal,
    // never a reason to kill arbitrary backends or declare P13 complete.
    await checkShared(); await targetCheck();
    const after = (await admin.query<Role>(rolesSql, [[...names]])).rows;
    need(after.length === oldRoles.length && after.every((role, index) => role.oid === oldRoles[index].oid && !role.login && role.members.length === 0), "FENCE-DRIFT");
    return { status: "legacy-logins-fenced-not-p13" as const, attemptId: fixed.attemptId, fingerprint: digestOf({ requestDigest: digestOf(request), roles: after }) };
  } catch (error) {
    unknown = ending;
    if (transaction && !ending) { try { await admin?.query("rollback"); } catch { unknown = true; } }
    if (unknown) return refuse("TRANSACTION-OUTCOME-UNKNOWN");
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("OPERATION-FAILED");
  } finally {
    await activation.close().catch(() => undefined);
    admin?.release(true);
    await adminPool?.end().catch(() => undefined);
    await packageDirectory?.close().catch(() => undefined);
  }
}

export async function retireLegacyApplicationLogins(input: LegacyLoginRetirementInput) {
  try { return await retire(input); }
  catch (error) {
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("OPERATION-FAILED");
  }
}

/** Reconciliation never retries a role change, clears an intent or claims P13.
 * It also works after NOLOGIN makes the original credentials unusable.
 */
async function inspect(input: LegacyLoginRetirementInput): Promise<{
  outcome: "missing" | "pending" | "applied" | "inconsistent";
  attemptId: string;
}> {
  const fixed = { handoff: structuredClone(input.handoff), attemptId: input.attemptId, activationAttemptId: input.activationAttemptId,
    expectedHandoffDigest: input.expectedHandoffDigest, target: { ...input.activation.target }, runId: input.activation.runId };
  let pool: pg.Pool | undefined, client: pg.PoolClient | undefined;
  let connectionFailed = false;
  try {
    const { digest, ...body } = fixed.handoff;
    need(digest === fixed.expectedHandoffDigest && digest === sha256Prefixed(canonicalJson(body)), "HANDOFF-MISMATCH");
    await assertHostOperationLock(input.lock, fixed.handoff.inputs.lockRoot);
    const url = new URL(input.administrativeConnectionString);
    need(["postgres:", "postgresql:"].includes(url.protocol) && !!url.hostname && !!url.username && !url.search && !url.hash, "MANAGEMENT-CONFIGURATION-INVALID");
    pool = new pg.Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    pool.on("error", () => { connectionFailed = true; });
    client = await pool.connect(); client.on("error", () => { connectionFailed = true; });
    need(isDeepStrictEqual(await readBindingDatabaseIdentity(client), fixed.target), "TARGET-MISMATCH");
    await client.query("begin isolation level repeatable read read only");
    const events = (await client.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and phase='P13' order by sequence_number`, [fixed.runId])).rows;
    let outcome: "missing" | "pending" | "applied" | "inconsistent" = events.length ? "inconsistent" : "missing";
    const request = events[0]?.payload?.request;
    if (request?.contract === "pcat-legacy-login-fence-v1" && request.runId === fixed.runId && request.attemptId === fixed.attemptId &&
      request.activationAttemptId === fixed.activationAttemptId && isDeepStrictEqual(request.target, fixed.target) &&
      Array.isArray(request.roles) && request.roles.length && events[0].event_kind === "legacy-login-fence-intent" &&
      events[0].payload.requestDigest === digestOf(request) &&
      (events.length === 1 || (events.length === 2 && events[1].event_kind === "legacy-login-fence-applied" && isDeepStrictEqual(events[1].payload, events[0].payload)))) {
      const actual = (await client.query<Role>(rolesSql, [request.roles.map((role: Role) => role.name)])).rows;
      const original = request.roles as Role[];
      const fenced = original.map(role => ({ ...role, login: false, members: [], callers: [{ oid: role.oid, name: role.name }] }));
      if (events.length === 1 && isDeepStrictEqual(actual, original)) outcome = "pending";
      if (events.length === 2 && isDeepStrictEqual(actual, fenced)) {
        // Preserve pre-revocation caller OIDs: an existing SET ROLE session
        // retains its effective identity after membership has been removed.
        await assertNoSharedLegacyRoleUse(client, original, fixed.target);
        outcome = "applied";
      }
    }
    await assertHostOperationLock(input.lock, fixed.handoff.inputs.lockRoot);
    need(!connectionFailed, "CONNECTION-FAILED");
    await client.query("rollback");
    return { outcome, attemptId: fixed.attemptId };
  } catch (error) {
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("INSPECTION-FAILED");
  } finally {
    client?.release(true); await pool?.end().catch(() => undefined);
  }
}

export async function inspectLegacyApplicationLoginFence(input: LegacyLoginRetirementInput) {
  try { return await inspect(input); }
  catch (error) {
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("INSPECTION-FAILED");
  }
}
