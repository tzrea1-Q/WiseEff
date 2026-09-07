import { randomUUID, randomInt } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import pg from "pg";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { createApplicationReadActivation, type ActivationIntent, type ActivationOptions } from "../../../../server/modules/catalog-cutover/activation";
import { createVerificationReportService } from "../../../../server/modules/release-verification/report/index";
import { legacyRolesAreRecoverable, type RetiringRole as Role } from "../../../../server/modules/catalog-cutover/retirement/roleRecovery";
import { applyLegacyLoginFence, assertNoSharedLegacyRoleUse, retiringRolesSql as rolesSql } from "../../../../server/modules/catalog-cutover/retirement/loginFence";
import { acquireObservedManagementClient } from "../../../../server/modules/catalog-cutover/retirement/managementCheckout";
import { beginLegacyRetirementTransaction } from "../../../../server/modules/catalog-cutover/retirement/managementTransaction";
import { assertBindingManagementLogin } from "../../../../server/modules/catalog-cutover/bindingImportProducer";
import { applyBootstrapCredentialFence, inspectBootstrapCredentialFence, prepareBootstrapCredentialCustody,
  reopenBootstrapCredentialCustody, type BootstrapCredentialCustody } from "../../../../server/modules/catalog-cutover/retirement/bootstrapCredentialFence";
import { readBindingDatabaseIdentity } from "../../../../server/modules/parameter-bindings/cutoverImport/sourceBoundary";
import { digestOf } from "../../../../server/modules/release-verification/core/digest";
import { verifyRecoveryPackage } from "../../storage/recoveryPackage";
import { assertHostOperationLockForJournal, type HandoffPlan, type HostOperationLock } from "./handoff";
import { canonicalJson, loadUpgradeJournal, sha256Prefixed } from "./journal";
import { observeLegacySourceEndpoint } from "./legacyWriterSource";

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
  activationIntent: ActivationIntent;
  attemptId: string;
  /** Explicit private management transport. Never inherited from DATABASE_URL. */
  administrativeConnectionString: string;
  recoveryDirectory: string;
  /** Explicit private custody directory. Never a default or secret JSON input. */
  bootstrapCredentialDirectory?: string;
};

/** Root-owned resource lifetime, not stage authorization. This acquires no
 * credential/P12/report evidence and never invokes the authentication effect.
 * The mutator owns the single S7 lock; the separate restricted LOGIN holds the
 * six inventory locks across the mutator's own commits. */
export async function acquireBootstrapInventoryGuard(input: {
  managementPool: pg.Pool;
  mutator: pg.PoolClient;
  target: ActivationOptions["target"];
  /** Notification after this module has destroyed the actual mutating client. */
  onMutatorReleased?: () => void;
}) {
  const { managementPool, mutator, onMutatorReleased } = input, target = { ...input.target };
  let guard: pg.PoolClient | undefined, closed = false, lost = false, mutatorReleased = false;
  const onLost = () => {
    if (closed) return;
    lost = true;
    if (!mutatorReleased) {
      mutatorReleased = true;
      try { mutator.release(true); } catch { /* Verification retains a static refusal. */ }
      finally { onMutatorReleased?.(); }
    }
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    guard?.release(true);
  };
  try {
    need(isDeepStrictEqual(await readBindingDatabaseIdentity(mutator), target), "TARGET-MISMATCH");
    const manager = (await mutator.query(`select r.oid::text as oid,
      session_user=current_user and r.rolsuper as admitted from pg_catalog.pg_roles r where rolname=session_user`)).rows[0];
    need(manager?.admitted === true && manager.oid === "10", "MANAGEMENT-IDENTITY-UNSUPPORTED");
    guard = await new Promise<pg.PoolClient>((resolve, reject) => {
      managementPool.connect((error, client) => {
        if (client) { guard = client; client.on("error", onLost); client.on("end", onLost); }
        if (error || !client) { reject(new LegacyLoginRetirementError("GUARD-CHECKOUT-FAILED")); return; }
        resolve(client);
      });
    });
    need(!lost, "GUARD-CONNECTION-LOST");
    await assertBindingManagementLogin(guard);
    const identity = (await guard.query(`select pg_backend_pid() as pid,session_user=current_user as same,
      (select oid::text from pg_roles where rolname=session_user) as oid`)).rows[0];
    need(identity?.same === true && identity.oid !== "10", "GUARD-IDENTITY-UNSUPPORTED");
    // OID10 observes the same guard backend, rather than granting the restricted
    // manager system-identity functions or trusting its connection URL.
    const challengeKey = randomInt(1, 2147483647);
    await guard.query("select pg_catalog.pg_advisory_lock(824014,$1)", [challengeKey]);
    const challenge = (await mutator.query(`select count(*)::int as count from pg_catalog.pg_locks
      where pid=$1 and database=$2::oid and locktype='advisory' and granted and mode='ExclusiveLock'
      and classid=824014 and objid=$3::oid and objsubid=2`, [identity.pid, target.databaseOid, challengeKey])).rows[0];
    need(challenge?.count === 1 && !lost, "GUARD-TARGET-MISMATCH");
    await guard.query("set role catalog_migration_owner");
    await beginLegacyRetirementTransaction(guard);
    const held = (await mutator.query("select pg_catalog.pg_try_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as held")).rows[0];
    need(held?.held === true, "CONTROLLER-LOCK-HELD");
    const verify = async () => {
      need(!closed && !lost, "GUARD-CONNECTION-LOST");
      need(isDeepStrictEqual(await readBindingDatabaseIdentity(mutator), target), "TARGET-MISMATCH");
      const ownLock = (await mutator.query(`select exists(select 1 from pg_catalog.pg_locks
        where pid=pg_catalog.pg_backend_pid() and database=$1::oid and locktype='advisory' and granted and mode='ExclusiveLock'
        and classid=hashtext('s7-orc-cutover-target')::oid and objid=hashtext(current_database())::oid and objsubid=2) as held`, [target.databaseOid])).rows[0];
      const locks = (await mutator.query(`select count(distinct relation)::int as count from pg_catalog.pg_locks
        where pid=$1 and database=$2::oid and locktype='relation' and granted and mode='ShareLock'
        and relation=any(array['parameter_catalog.catalog_state'::regclass,'parameter_catalog.catalog_releases'::regclass,
          'parameter_catalog.catalog_materializations'::regclass,'parameter_catalog.legacy_identities'::regclass,
          'parameter_catalog.legacy_mapping_heads'::regclass,'parameter_catalog.legacy_mapping_versions'::regclass])`,
      [identity.pid, target.databaseOid])).rows[0];
      need(!lost && ownLock?.held === true && locks?.count === 6, "GUARD-LOCK-LOST");
    };
    await verify();
    return { verify, close };
  } catch (error) {
    await close().catch(() => undefined);
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("GUARD-UNAVAILABLE");
  }
}


/** Actual former LOGINs are derived from the stopped source containers, not a
 * caller role list. The only mutation is a bounded database substep of P13.
 * A result here is deliberately NOT the P13 checkpoint or runtime approval.
 */
async function retire(input: LegacyLoginRetirementInput, bootstrapInspection = false) {
  input = { ...input, activation: { ...input.activation, target: input.activation?.target ? { ...input.activation.target } : undefined as never } };
  const fixed = { handoff: structuredClone(input.handoff), expectedHandoffDigest: input.expectedHandoffDigest,
    attemptId: input.attemptId, activationIntent: structuredClone(input.activationIntent), recoveryDirectory: input.recoveryDirectory,
    bootstrapCredentialDirectory: input.bootstrapCredentialDirectory };
  const plan = fixed.handoff, { digest, ...planBody } = plan;
  need(typeof fixed.attemptId === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(fixed.attemptId), "ATTEMPT-INVALID");
  need(digest === fixed.expectedHandoffDigest && digest === sha256Prefixed(canonicalJson(planBody)), "HANDOFF-MISMATCH");
  // The genuine issued host lock is checked before opening Docker or any pool.
  await assertHostOperationLockForJournal(input.lock, plan.inputs.journalPath).catch(() => refuse("LOCK-UNAVAILABLE"));
  need(plan.inputs.lockRoot === path.dirname(plan.inputs.journalPath), "LOCK-UNAVAILABLE");
  const docker = createIsolatedUpgradeDocker();
  need(docker.daemonId === plan.inputs.expectedDaemonId, "DAEMON-MISMATCH");
  const activation = createApplicationReadActivation(input.activation);
  let admin: pg.PoolClient | undefined;
  let adminPool: pg.Pool | undefined;
  let packageDirectory: Awaited<ReturnType<typeof open>> | undefined;
  let transaction = false, ending = false, unknown = false;
  let connectionFailed = false;
  let adminReleased = false, bootstrapStarted = false, failed = false;
  let guard: Awaited<ReturnType<typeof acquireBootstrapInventoryGuard>> | undefined, custody: BootstrapCredentialCustody | undefined;
  const destroyAdmin = () => { if (admin && !adminReleased) { adminReleased = true; admin.release(true); } };
  const onConnectionError = () => { connectionFailed = true; };
  try {
    const loaded = loadUpgradeJournal({ journalPath: plan.inputs.journalPath, runId: plan.inputs.runId, requireSettled: true });
    need(loaded.ok, "JOURNAL-UNAVAILABLE");
    if (!loaded.ok) return refuse("JOURNAL-UNAVAILABLE");
    need(loaded.value.record.cutoverRunId === fixed.activationIntent.runId, "CUTOVER-RUN-MISMATCH");
    const captureEntries = loaded.value.record.entries.filter(entry => entry.recoveryCapture?.outcome === "committed" && entry.recoveryCapture.capture);
    const captures = captureEntries.map(entry => entry.recoveryCapture!);
    need(captures.length === 1 && captures[0].directory.path === fixed.recoveryDirectory, "RECOVERY-SOURCE-UNAVAILABLE");
    need(!loaded.value.record.entries.some(entry => entry.action.startsWith("recovery-execution-") ||
      entry.seq > captureEntries[0].seq && ["recovery-capture-pending", "recovery-capture-unknown"].includes(entry.action)), "RECOVERY-SOURCE-UNSETTLED");
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
    const postgresStores = plan.inputs.source.stores.filter(store => store.service === "postgres");
    need(postgresStores.length === 1, "SOURCE-ENDPOINT-UNPROVEN");
    const sourceEndpoints = new Map<string, ReturnType<typeof observeLegacySourceEndpoint>>();
    const check = async () => {
      need(!connectionFailed, "CONNECTION-FAILED");
      await assertHostOperationLockForJournal(input.lock, plan.inputs.journalPath);
      await input.activation.boundary.verify();
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
          const sourceUrl = values[0].slice("DATABASE_URL=".length);
          const endpoint = observeLegacySourceEndpoint({ docker, sourceUrl,
            administrativeUrl: input.administrativeConnectionString, applicationId: app.containerId,
            postgresId: postgresStores[0].containerId, ownerRunId: capture.runId,
            registeredIds: [...plan.inputs.source.applications.map(value => value.containerId), ...plan.inputs.source.stores.map(value => value.containerId)] });
          const previousEndpoint = sourceEndpoints.get(app.containerId);
          need(!previousEndpoint || isDeepStrictEqual(previousEndpoint, endpoint), "SOURCE-ENDPOINT-DRIFT");
          sourceEndpoints.set(app.containerId, endpoint);
          urls.push(sourceUrl);
        }
      }
      return urls;
    };
    const sourceUrls = await check();
    const inspected = await activation.inspect(fixed.activationIntent);
    if (inspected.kind !== "applied" || inspected.currentHeadDigest !== inspected.binding.bindingDigest) return refuse("P12-BINDING-MISMATCH");
    const binding = inspected.binding;
    need(binding.version === "pcat-activation-v1" && isDeepStrictEqual(binding.intent, fixed.activationIntent) &&
      isDeepStrictEqual(binding.intent.target, input.activation.target) && capture.runId === plan.inputs.runId, "P12-BINDING-MISMATCH");
    const verifyBoundReport = async () => {
      const selected = await createVerificationReportService({ db: input.activation.reports }).readReport(binding.intent.reportDigest);
      if (selected.kind !== "present") return refuse("P12-REPORT-UNAVAILABLE");
      const report = selected.report;
      need(report.digest === binding.intent.reportDigest && report.purpose === "pre-activation" && report.decision === "passed" &&
        report.pins.artifact.gitSha === plan.inputs.candidate.sha && report.pins.cutover.planDigest === binding.intent.planDigest &&
        report.pins.cutover.sourceSnapshotFingerprint === binding.sourceSnapshotFingerprint &&
        report.pins.catalog.releaseId === binding.catalog.releaseId && report.pins.catalog.releaseDigest === binding.catalog.releaseDigest &&
        report.pins.mappingArchive.mappingEpoch === binding.mapping.epoch && report.pins.mappingArchive.mappingHeadDigest === binding.mapping.headDigest &&
        report.pins.recovery.recoveryPointDigest === capture.recoveryPointDigest &&
        report.pins.target.deploymentId === capture.source.deploymentId && report.pins.target.hostFingerprint === capture.source.hostFingerprint &&
        report.pins.database.targetIdentity === capture.source.postgresIdentity, "P12-REPORT-MISMATCH");
    };
    const checkCurrentP12 = async () => {
      const current = transaction && admin
        ? await activation.inspectOnHeldManagementSession(fixed.activationIntent, admin)
        : await activation.inspect(fixed.activationIntent);
      need(current.kind === "applied" && current.currentHeadDigest === binding.bindingDigest &&
        isDeepStrictEqual(current.binding, binding), "P12-CURRENT-STATE-DRIFT");
      await verifyBoundReport();
    };
    await checkCurrentP12();
    const adminUrl = new URL(input.administrativeConnectionString);
    need(["postgres:", "postgresql:"].includes(adminUrl.protocol) && !!adminUrl.hostname && !!adminUrl.username && !adminUrl.search && !adminUrl.hash, "MANAGEMENT-CONFIGURATION-INVALID");
    adminPool = new pg.Pool({ connectionString: adminUrl.href, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    adminPool.on("error", onConnectionError);
    admin = await acquireObservedManagementClient(adminPool, onConnectionError);
    need(!connectionFailed, "CONNECTION-FAILED");
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
      if (bootstrapInspection) {
        // The retained source credential is intentionally unusable after rotation.
        // Actual root-intent/custody and both authentications are checked below.
        need(decodeURIComponent(sourceUrl.username) === management.name, "SOURCE-SESSION-MISMATCH");
        names.add(management.name);
        continue;
      }
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
        need(actual.same === true && challenge?.count === 1, "SOURCE-SESSION-MISMATCH");
        names.add(actual.name);
      } finally { await client.end(); }
    }
    await targetCheck();
    if (names.has(management.name)) {
      need(names.size === 1 && backup.bootstrap?.roleName === management.name &&
        typeof fixed.bootstrapCredentialDirectory === "string", "BOOTSTRAP-CUSTODY-REQUIRED");
      const custodyDirectory = fixed.bootstrapCredentialDirectory!;
      need(path.isAbsolute(custodyDirectory) && await realpath(custodyDirectory) === custodyDirectory &&
        path.dirname(custodyDirectory) === plan.inputs.lockRoot && custodyDirectory !== fixed.recoveryDirectory &&
        !custodyDirectory.startsWith(`${fixed.recoveryDirectory}${path.sep}`), "BOOTSTRAP-CUSTODY-DIRECTORY-INVALID");
      guard = await acquireBootstrapInventoryGuard({ managementPool: input.activation.managementPool,
        mutator: admin, target: input.activation.target,
        onMutatorReleased: () => { adminReleased = true; connectionFailed = true; } });
      const verifyGuard = async () => {
        await targetCheck();
        await guard!.verify();
        transaction = true;
        await admin!.query("begin isolation level repeatable read read only");
        await admin!.query("set local timezone='UTC'");
        await checkCurrentP12();
        await admin!.query("rollback"); transaction = false;
      };
      await verifyGuard();
      const rootKind = "bootstrap-application-authentication-intent";
      const rootEvents = (await admin.query(`select payload from parameter_catalog.parameter_catalog_cutover_events
        where cutover_run_id=$1 and event_kind=$2 order by sequence_number`, [fixed.activationIntent.runId, rootKind])).rows;
      const rootBinding = { contract: "pcat-bootstrap-application-authentication-v1", runId: fixed.activationIntent.runId,
        attemptId: fixed.attemptId, activationIntent: fixed.activationIntent, activationBindingDigest: binding.bindingDigest,
        handoffDigest: fixed.expectedHandoffDigest, recoveryPackageDigest: backup.digest, recoveryPointDigest: capture.recoveryPointDigest,
        target: input.activation.target, roleName: management.name, custodyDirectory };
      if (bootstrapInspection) {
        const retained = rootEvents[0]?.payload;
        need(rootEvents.length === 1 && retained?.request && retained.requestDigest === digestOf(retained.request), "BOOTSTRAP-ROOT-INTENT-UNAVAILABLE");
        const { credentials, ...bound } = retained.request;
        need(isDeepStrictEqual(bound, rootBinding), "BOOTSTRAP-ROOT-INTENT-MISMATCH");
        custody = await reopenBootstrapCredentialCustody({ directory: custodyDirectory, custodianUid: process.getuid!(), receipt: credentials });
      } else {
        need(rootEvents.length === 0, "ATTEMPT-REQUIRES-RECONCILE");
        const originalSecret = decodeURIComponent(new URL(sourceUrls[0]).password);
        need(originalSecret.length > 0 && sourceUrls.every(value => decodeURIComponent(new URL(value).password) === originalSecret), "SOURCE-CREDENTIAL-MISMATCH");
        custody = await prepareBootstrapCredentialCustody({ directory: custodyDirectory, custodianUid: process.getuid!(), oldSecret: originalSecret });
        const request = { ...rootBinding, credentials: custody.receipt };
        await verifyGuard();
        transaction = true;
        await admin.query("begin"); await admin.query("set local synchronous_commit=on");
        await admin.query(`insert into parameter_catalog.parameter_catalog_cutover_events(id,cutover_run_id,sequence_number,phase,event_kind,payload)
          select $1,$2,coalesce(max(sequence_number),0)+1,'P13',$3,$4::jsonb
          from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`,
        [`cevt_${randomUUID()}`, fixed.activationIntent.runId, rootKind, JSON.stringify({ request, requestDigest: digestOf(request) })]);
        ending = true; await admin.query("commit"); transaction = false; ending = false;
      }
      await verifyGuard();
      const command = { client: admin, target: input.activation.target, runId: fixed.activationIntent.runId,
        attemptId: fixed.attemptId, custody };
      bootstrapStarted = !bootstrapInspection;
      if (!bootstrapInspection) await applyBootstrapCredentialFence(command);
      const observed = await inspectBootstrapCredentialFence(command);
      await verifyGuard();
      if (bootstrapInspection) return { status: "bootstrap-authentication-inspected-not-p13" as const,
        outcome: observed.outcome, attemptId: fixed.attemptId, intentDigest: observed.intentDigest };
      need(observed.outcome === "authentication-fenced-not-P13" && observed.intentDigest, "BOOTSTRAP-OUTCOME-UNKNOWN");
      return { status: "bootstrap-authentication-fenced-not-p13" as const, attemptId: fixed.attemptId,
        fingerprint: digestOf({ rootBinding, intentDigest: observed.intentDigest }) };
    }
    need(!bootstrapInspection && !fixed.bootstrapCredentialDirectory, "SOURCE-IDENTITY-UNSUPPORTED");
    const oldRoles = (await admin.query<Role>(rolesSql, [[...names]])).rows;
    need(oldRoles.length === names.size && names.size > 0, "SOURCE-ROLE-MISSING");
    need(legacyRolesAreRecoverable(oldRoles, backup.roles), "ROLE-RECOVERY-UNSUPPORTED");
    const checkShared = () => assertNoSharedLegacyRoleUse(admin!, oldRoles, input.activation.target);
    await checkShared();
    const lock = (await admin.query("select pg_catalog.pg_try_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as held")).rows[0];
    need(lock?.held === true, "CONTROLLER-LOCK-HELD");
    const request = { contract: "pcat-legacy-login-fence-v1", runId: fixed.activationIntent.runId, attemptId: fixed.attemptId,
      activationIntent: fixed.activationIntent, activationBindingDigest: binding.bindingDigest, target: input.activation.target,
      recoveryPackageDigest: backup.digest, recoveryPointDigest: capture.recoveryPointDigest, roles: oldRoles };
    const append = async (kind: string) => {
      await admin!.query(`insert into parameter_catalog.parameter_catalog_cutover_events(id,cutover_run_id,sequence_number,phase,event_kind,payload)
        select $1,$2,coalesce(max(sequence_number),0)+1,'P13',$3,$4::jsonb
        from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`, [`cevt_${randomUUID()}`, fixed.activationIntent.runId, kind, JSON.stringify({ request, requestDigest: digestOf(request) })]);
    };
    transaction = true;
    await beginLegacyRetirementTransaction(admin);
    await targetCheck();
    await checkCurrentP12();
    await admin.query("select id from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update", [fixed.activationIntent.runId]);
    const prior = await admin.query("select id from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1 and phase='P13'", [fixed.activationIntent.runId]);
    need(prior.rowCount === 0, "ATTEMPT-REQUIRES-RECONCILE");
    await append("legacy-login-fence-intent");
    ending = true; await admin.query("commit"); transaction = false; ending = false;
    transaction = true;
    await beginLegacyRetirementTransaction(admin);
    await targetCheck(); await checkShared();
    need(isDeepStrictEqual((await admin.query<Role>(rolesSql, [[...names]])).rows, oldRoles), "ROLE-DRIFT");
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
    failed = true;
    unknown = ending || bootstrapStarted;
    if (transaction && !ending) { try { await admin?.query("rollback"); } catch { unknown = true; } }
    if (unknown) return refuse("TRANSACTION-OUTCOME-UNKNOWN");
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("OPERATION-FAILED");
  } finally {
    const releases = await Promise.allSettled([
      Promise.resolve().then(destroyAdmin), Promise.resolve().then(() => guard?.close()),
    ]);
    const closed = await Promise.allSettled([
      Promise.resolve().then(() => adminPool?.end()), Promise.resolve().then(() => custody?.close()),
      Promise.resolve().then(() => packageDirectory?.close()),
    ]);
    if (!failed && [...releases, ...closed].some(result => result.status === "rejected")) refuse("RESOURCE-CLOSE-FAILED");
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
  const fixed = { handoff: structuredClone(input.handoff), attemptId: input.attemptId, activationIntent: structuredClone(input.activationIntent),
    expectedHandoffDigest: input.expectedHandoffDigest, target: { ...input.activation.target }, runId: input.activationIntent.runId };
  let pool: pg.Pool | undefined, client: pg.PoolClient | undefined;
  let connectionFailed = false;
  try {
    const { digest, ...body } = fixed.handoff;
    need(digest === fixed.expectedHandoffDigest && digest === sha256Prefixed(canonicalJson(body)), "HANDOFF-MISMATCH");
    await assertHostOperationLockForJournal(input.lock, fixed.handoff.inputs.journalPath);
    const url = new URL(input.administrativeConnectionString);
    need(["postgres:", "postgresql:"].includes(url.protocol) && !!url.hostname && !!url.username && !url.search && !url.hash, "MANAGEMENT-CONFIGURATION-INVALID");
    pool = new pg.Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    const onConnectionError = () => { connectionFailed = true; };
    pool.on("error", onConnectionError);
    client = await acquireObservedManagementClient(pool, onConnectionError);
    need(!connectionFailed, "CONNECTION-FAILED");
    need(isDeepStrictEqual(await readBindingDatabaseIdentity(client), fixed.target), "TARGET-MISMATCH");
    const held = (await client.query("select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtext('s7-orc-cutover-target'),pg_catalog.hashtext(pg_catalog.current_database())) as held")).rows[0];
    need(held?.held === true, "CONTROLLER-LOCK-HELD");
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local timezone='UTC'");
    const activation = await createApplicationReadActivation(input.activation).inspectOnHeldManagementSession(fixed.activationIntent, client);
    need(activation.kind === "applied" && activation.currentHeadDigest === activation.binding.bindingDigest, "P12-BINDING-MISMATCH");
    const events = (await client.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and phase='P13' order by sequence_number`, [fixed.runId])).rows;
    let outcome: "missing" | "pending" | "applied" | "inconsistent" = events.length ? "inconsistent" : "missing";
    const request = events[0]?.payload?.request;
    if (request?.contract === "pcat-legacy-login-fence-v1" && request.runId === fixed.runId && request.attemptId === fixed.attemptId &&
      isDeepStrictEqual(request.activationIntent, fixed.activationIntent) && isDeepStrictEqual(request.target, fixed.target) &&
      activation.kind === "applied" && request.activationBindingDigest === activation.binding.bindingDigest &&
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
    await assertHostOperationLockForJournal(input.lock, fixed.handoff.inputs.journalPath);
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
  try { return input.bootstrapCredentialDirectory ? await retire(input, true) : await inspect(input); }
  catch (error) {
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("INSPECTION-FAILED");
  }
}
