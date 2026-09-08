import { randomUUID, randomInt } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { constants } from "node:fs";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
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
  inspectBootstrapCredentialFenceFromCustodyTransport, type BootstrapCredentialCustody,
  type BootstrapRootBinding } from "../../../../server/modules/catalog-cutover/retirement/bootstrapCredentialFence";
import { readBindingDatabaseIdentity } from "../../../../server/modules/parameter-bindings/cutoverImport/sourceBoundary";
import { digestOf } from "../../../../server/modules/release-verification/core/digest";
import { verifyRecoveryPackage } from "../../storage/recoveryPackage";
import { assertHostOperationLockForJournal, type HandoffPlan, type HostOperationLock } from "./handoff";
import { canonicalJson, commitJournalTransition, loadUpgradeJournal, sha256Prefixed,
  type BootstrapRetirementEvent, type BootstrapRetirementIntent } from "./journal";
import { observeLegacySourceEndpoint } from "./legacyWriterSource";
import { assertRuntimeRoleSourceManagementSession, openRuntimeRoleSource, observeRuntimeRoles, type RuntimeRoleSource } from "./runtimeRoleSource";
import { applyLegacySqlPrivilegeFence, beginLegacySqlPrivilegeInspection,
  inspectLegacySqlPrivilegeFenceOnHeldSession } from "../../../../server/modules/catalog-cutover/retirement/legacySqlPrivilegeFence";

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
  let inspectionReader: pg.PoolClient | undefined;
  let packageDirectory: Awaited<ReturnType<typeof open>> | undefined;
  let journalDirectory: Awaited<ReturnType<typeof open>> | undefined;
  let recordRetirementUnknown: (() => Promise<void>) | undefined;
  let runtimeRoleSource: RuntimeRoleSource | undefined;
  let transaction = false, ending = false, unknown = false;
  let connectionFailed = false;
  let adminReleased = false, bootstrapStarted = false, ordinarySqlStarted = false, failed = false;
  let inspectionReaderReleased = false;
  let guard: Awaited<ReturnType<typeof acquireBootstrapInventoryGuard>> | undefined, custody: BootstrapCredentialCustody | undefined;
  const destroyAdmin = () => { if (admin && !adminReleased) { adminReleased = true; admin.release(true); } };
  const onConnectionError = () => { connectionFailed = true; };
  const onInspectionConnectionError = () => { if (!inspectionReaderReleased) onConnectionError(); };
  const releaseInspectionReader = () => {
    if (inspectionReader && !inspectionReaderReleased) {
      inspectionReaderReleased = true;
      try { inspectionReader.release(true); } catch { refuse("RESOURCE-CLOSE-FAILED"); }
    }
  };
  try {
    const loaded = loadUpgradeJournal({ journalPath: plan.inputs.journalPath, runId: plan.inputs.runId, requireSettled: true });
    need(loaded.ok, "JOURNAL-UNAVAILABLE");
    if (!loaded.ok) return refuse("JOURNAL-UNAVAILABLE");
    let expectedJournal = structuredClone(loaded.value.record);
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
      need(current.ok && isDeepStrictEqual(current.value.record, expectedJournal), "JOURNAL-DRIFT");
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
    if (bootstrapInspection) {
      // The source and management URL still contain the retired secret. Only
      // their already-observed routing is used here; never open an OID10 pool
      // before the formal facade reopens the exact retained private custody.
      const roleName = backup.bootstrap?.roleName, custodyDirectory = fixed.bootstrapCredentialDirectory;
      if (typeof roleName !== "string" || !roleName || typeof custodyDirectory !== "string") return refuse("BOOTSTRAP-CUSTODY-REQUIRED");
      need(path.isAbsolute(custodyDirectory) && await realpath(custodyDirectory) === custodyDirectory &&
        path.dirname(custodyDirectory) === plan.inputs.lockRoot && custodyDirectory !== fixed.recoveryDirectory &&
        !custodyDirectory.startsWith(`${fixed.recoveryDirectory}${path.sep}`), "BOOTSTRAP-CUSTODY-DIRECTORY-INVALID");
      for (const text of sourceUrls) {
        const sourceUrl = new URL(text);
        need(!sourceUrl.search && !sourceUrl.hash && sourceUrl.pathname === adminUrl.pathname &&
          decodeURIComponent(sourceUrl.username) === roleName, "SOURCE-SESSION-MISMATCH");
      }
      const expectedRootBinding: BootstrapRootBinding = { contract: "pcat-bootstrap-application-authentication-v1",
        runId: fixed.activationIntent.runId, attemptId: fixed.attemptId, activationIntent: fixed.activationIntent,
        activationBindingDigest: binding.bindingDigest, handoffDigest: fixed.expectedHandoffDigest,
        recoveryPackageDigest: backup.digest, recoveryPointDigest: capture.recoveryPointDigest,
        target: input.activation.target, roleName, custodyDirectory };
      const managementPorts = [...sourceEndpoints.values()].map(endpoint => endpoint.managementPort);
      let inspectionStream: unknown;
      const verifyInspectionEndpoint = () => {
        if (inspectionReaderReleased) return;
        const stream = inspectionReader instanceof pg.Client ? inspectionReader.connection.stream : undefined;
        need(stream === inspectionStream && stream instanceof Socket && !(stream instanceof TLSSocket) &&
          !stream.destroyed && stream.remoteAddress === "127.0.0.1" && managementPorts.length === 2 &&
          managementPorts.every(port => port === String(stream.remotePort)), "SOURCE-ENDPOINT-UNPROVEN");
      };
      const verifyInspectionBoundary = async () => {
        verifyInspectionEndpoint();
        need(isDeepStrictEqual(await check(), sourceUrls), "SOURCE-CONFIGURATION-DRIFT");
        await verifyBoundReport();
        verifyInspectionEndpoint();
      };
      // Attach both observers synchronously at checkout. The root releases
      // this borrowed lease; the facade owns only its private OID10 pool/FDs.
      inspectionReader = await new Promise<pg.PoolClient>((resolve, reject) => {
        input.activation.managementPool.connect((error, client) => {
          if (client) {
            inspectionReader = client; client.on("error", onInspectionConnectionError); client.on("end", onInspectionConnectionError);
            inspectionStream = client instanceof pg.Client ? client.connection.stream : undefined;
          }
          if (error || !client) reject(new LegacyLoginRetirementError("CONNECTION-FAILED"));
          else resolve(client);
        });
      });
      await verifyInspectionBoundary();
      const observed = structuredClone(await inspectBootstrapCredentialFenceFromCustodyTransport({
        managementClient: inspectionReader, expectedRootBinding,
        sqlSuccessor: { journalPath: plan.inputs.journalPath, hostRunId: plan.inputs.runId, lock: input.lock },
        activation: { ...input.activation, boundary: { ...input.activation.boundary, verify: verifyInspectionBoundary } },
      }));
      await verifyInspectionBoundary();
      // The final P12 observation borrows this same pool. Return the facade's
      // lease first, including for max:1; this is an additional drift check,
      // not a claim to retain the facade's SQL locks after it returns.
      releaseInspectionReader();
      await checkCurrentP12();
      await verifyInspectionBoundary();
      return { status: "bootstrap-authentication-inspected-not-p13" as const,
        outcome: observed.outcome, attemptId: fixed.attemptId, intentDigest: observed.intentDigest };
    }
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
      runtimeRoleSource = await openRuntimeRoleSource({ handoff: plan, expectedHandoffDigest: fixed.expectedHandoffDigest, lock: input.lock });
      await assertRuntimeRoleSourceManagementSession(runtimeRoleSource, admin!);
      const configuredRoles = structuredClone(await observeRuntimeRoles(runtimeRoleSource));
      need(configuredRoles.runId === plan.inputs.runId && configuredRoles.handoffDigest === fixed.expectedHandoffDigest &&
        isDeepStrictEqual(configuredRoles.target, input.activation.target), "RUNTIME-ROLE-SOURCE-MISMATCH");
      const verifyRuntimeRoles = async () => {
        await assertRuntimeRoleSourceManagementSession(runtimeRoleSource!, admin!);
        need(isDeepStrictEqual(await observeRuntimeRoles(runtimeRoleSource!), configuredRoles), "RUNTIME-ROLE-SOURCE-DRIFT");
      };
      const rootKind = "bootstrap-application-authentication-intent";
      const rootEvents = (await admin.query(`select payload from parameter_catalog.parameter_catalog_cutover_events
        where cutover_run_id=$1 and event_kind=$2 order by sequence_number`, [fixed.activationIntent.runId, rootKind])).rows;
      const rootBinding = { contract: "pcat-bootstrap-application-authentication-v1", runId: fixed.activationIntent.runId,
        attemptId: fixed.attemptId, activationIntent: fixed.activationIntent, activationBindingDigest: binding.bindingDigest,
        handoffDigest: fixed.expectedHandoffDigest, recoveryPackageDigest: backup.digest, recoveryPointDigest: capture.recoveryPointDigest,
        target: input.activation.target, roleName: management.name, custodyDirectory } as const;
      // One authentication attempt is unresolved until actual inspection. A
      // stored pending/unknown event never authorizes another password change.
      need(!expectedJournal.entries.some(entry => entry.bootstrapRetirement), "ATTEMPT-REQUIRES-RECONCILE");
      journalDirectory = await open(plan.inputs.lockRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const originalDirectory = await journalDirectory.stat();
      const checkJournalDirectory = async () => {
        await assertHostOperationLockForJournal(input.lock, plan.inputs.journalPath);
        const [held, named] = await Promise.all([journalDirectory!.stat(), lstat(plan.inputs.lockRoot)]);
        need(held.isDirectory() && named.isDirectory() && !named.isSymbolicLink() && named.uid === process.getuid?.() &&
          (named.mode & 0o777) === 0o700 && held.dev === originalDirectory.dev && held.ino === originalDirectory.ino &&
          held.dev === named.dev && held.ino === named.ino && await realpath(plan.inputs.lockRoot) === plan.inputs.lockRoot, "JOURNAL-DIRECTORY-DRIFT");
      };
      const appendRetirement = async (event: BootstrapRetirementEvent) => {
        await check(); await checkJournalDirectory();
        if (event.outcome !== "unknown") { await verifyBoundReport(); await verifyRuntimeRoles(); }
        need(isDeepStrictEqual(loaded.value.record, expectedJournal), "JOURNAL-DRIFT");
        // This must be the final await before the synchronous host effect:
        // report projection reads above may outlive the lock holder.
        await assertHostOperationLockForJournal(input.lock, plan.inputs.journalPath);
        need(!connectionFailed, "CONNECTION-FAILED");
        const result = commitJournalTransition(loaded.value, { action: `bootstrap-retirement-${event.outcome}`,
          inputDigest: sha256Prefixed(canonicalJson(event)), toState: loaded.value.record.state,
          nextAction: loaded.value.record.nextAction, outcome: event.outcome === "credential-step" ? "committed" : "crashed",
          bootstrapRetirement: event });
        need(result.ok && !result.value.replayed, "RETIREMENT-JOURNAL-UNKNOWN");
        // Advance only by this invocation's own acknowledged CAS, never by
        // adopting a record observed after an unrelated asynchronous write.
        expectedJournal = structuredClone(loaded.value.record);
        if (event.outcome === "credential-step") recordRetirementUnknown = undefined;
        await checkJournalDirectory(); await check();
        if (event.outcome !== "unknown") { await verifyBoundReport(); await verifyRuntimeRoles(); }
        await assertHostOperationLockForJournal(input.lock, plan.inputs.journalPath);
        need(!connectionFailed, "CONNECTION-FAILED");
      };
      let hostIntent: BootstrapRetirementIntent;
      let rootRequest: { request: typeof rootBinding & { credentials: BootstrapCredentialCustody["receipt"] }; requestDigest: string };
      {
        need(rootEvents.length === 0, "ATTEMPT-REQUIRES-RECONCILE");
        const originalSecret = decodeURIComponent(new URL(sourceUrls[0]).password);
        need(originalSecret.length > 0 && sourceUrls.every(value => decodeURIComponent(new URL(value).password) === originalSecret), "SOURCE-CREDENTIAL-MISMATCH");
        custody = await prepareBootstrapCredentialCustody({ directory: custodyDirectory, custodianUid: process.getuid!(), oldSecret: originalSecret });
        const request = { ...rootBinding, credentials: custody.receipt };
        rootRequest = { request, requestDigest: digestOf(request) };
        hostIntent = { hostRunId: plan.inputs.runId, rootBinding: structuredClone(rootBinding),
          captureDigest: captureEntries[0].inputDigest, rootRequestDigest: rootRequest.requestDigest,
          credentialVersion: custody.receipt.version };
        await verifyGuard();
        await appendRetirement({ intent: hostIntent, outcome: "pending" });
        recordRetirementUnknown = async () => { await appendRetirement({ intent: hostIntent, outcome: "unknown" }); };
        await verifyGuard();
        transaction = true;
        await admin.query("begin"); await admin.query("set local synchronous_commit=on");
        await admin.query(`insert into parameter_catalog.parameter_catalog_cutover_events(id,cutover_run_id,sequence_number,phase,event_kind,payload)
          select $1,$2,coalesce(max(sequence_number),0)+1,'P13',$3,$4::jsonb
          from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`,
        [`cevt_${randomUUID()}`, fixed.activationIntent.runId, rootKind, JSON.stringify(rootRequest)]);
        ending = true; await admin.query("commit"); transaction = false; ending = false;
      }
      await verifyGuard();
      const command = { client: admin, target: input.activation.target, runId: fixed.activationIntent.runId,
        attemptId: fixed.attemptId, custody,
        // The root constructs this constraint from issued/live resources. It
        // is not caller-supplied authorization and never opens a nested RR
        // transaction while the low-level effect owns its own transaction.
        beforeEffect: async () => {
          await targetCheck(); await guard!.verify(); await verifyBoundReport();
          await verifyRuntimeRoles();
          await assertHostOperationLockForJournal(input.lock, plan.inputs.journalPath);
          need(!connectionFailed, "CONNECTION-FAILED");
        } };
      bootstrapStarted = true;
      const applied = await applyBootstrapCredentialFence(command);
      const observed = await inspectBootstrapCredentialFence(command);
      await verifyGuard();
      need(applied.outcome === "authentication-fenced-not-P13" && observed.outcome === "authentication-fenced-not-P13" &&
        observed.intentDigest && applied.intentDigest === observed.intentDigest, "BOOTSTRAP-OUTCOME-UNKNOWN");
      const currentRoot = (await admin.query(`select payload from parameter_catalog.parameter_catalog_cutover_events
        where cutover_run_id=$1 and event_kind=$2 order by sequence_number`, [fixed.activationIntent.runId, rootKind])).rows;
      need(currentRoot.length === 1 && isDeepStrictEqual(currentRoot[0].payload, rootRequest), "ROOT-INTENT-DRIFT");
      await verifyGuard();
      await appendRetirement({ intent: hostIntent, outcome: "credential-step", credentialIntentDigest: observed.intentDigest });
      recordRetirementUnknown = undefined;
      const appendSqlHost = async (outcome: "pending" | "applied", intentDigest: string) => {
        const loaded = loadUpgradeJournal({ journalPath: plan.inputs.journalPath, runId: plan.inputs.runId });
        need(loaded.ok, "JOURNAL-UNAVAILABLE"); if (!loaded.ok) return refuse("JOURNAL-UNAVAILABLE");
        need(!loaded.value.record.entries.some(entry => entry.action === `legacy-sql-privileges-${outcome}`), "ATTEMPT-REQUIRES-RECONCILE");
        await checkJournalDirectory(); await verifyRuntimeRoles(); await command.beforeEffect();
        need(isDeepStrictEqual(loaded.value.record, expectedJournal), "JOURNAL-DRIFT");
        await assertHostOperationLockForJournal(input.lock, plan.inputs.journalPath);
        need(!connectionFailed, "CONNECTION-FAILED");
        const saved = commitJournalTransition(loaded.value, { action: `legacy-sql-privileges-${outcome}`,
          inputDigest: intentDigest, toState: loaded.value.record.state, nextAction: loaded.value.record.nextAction,
          outcome: outcome === "applied" ? "committed" : "crashed" });
        need(saved.ok && !saved.value.replayed, "SQL-PRIVILEGE-JOURNAL-UNKNOWN");
        expectedJournal = structuredClone(loaded.value.record);
        await checkJournalDirectory(); await verifyRuntimeRoles(); await command.beforeEffect();
      };
      need(!expectedJournal.entries.some(entry => entry.action.startsWith("legacy-sql-privileges-")), "ATTEMPT-REQUIRES-RECONCILE");
      const sqlResult = await applyLegacySqlPrivilegeFence({ client: admin,
        selection: { runId: fixed.activationIntent.runId, attemptId: fixed.attemptId, target: input.activation.target,
          activationBindingDigest: binding.bindingDigest, rootRequestDigest: rootRequest.requestDigest, recoveryPackageDigest: backup.digest },
        runtimeRoles: [...new Map(configuredRoles.roles.map(role => [role.oid, { oid: role.oid, name: role.name }])).values()],
        recoveryRoles: backup.roles,
        beforeEffect: async () => { await verifyRuntimeRoles(); await command.beforeEffect(); },
        persistHostIntent: intent => appendSqlHost("pending", intent.intentDigest),
        persistHostStep: intentDigest => appendSqlHost("applied", intentDigest),
      });
      need(sqlResult.outcome === "legacy-sql-privileges-fenced-not-P13" && /^sha256:[a-f0-9]{64}$/.test(sqlResult.intentDigest), "SQL-PRIVILEGE-OUTCOME-UNKNOWN");
      await verifyGuard();
      await command.beforeEffect();
      return { status: "bootstrap-authentication-fenced-not-p13" as const, attemptId: fixed.attemptId,
        fingerprint: digestOf({ rootBinding, intentDigest: observed.intentDigest }) };
    }
    need(!fixed.bootstrapCredentialDirectory, "SOURCE-IDENTITY-UNSUPPORTED");
    need(!expectedJournal.entries.some(entry => entry.action.startsWith("legacy-sql-privileges-")), "ATTEMPT-REQUIRES-RECONCILE");
    guard = await acquireBootstrapInventoryGuard({ managementPool: input.activation.managementPool,
      mutator: admin, target: input.activation.target,
      onMutatorReleased: () => { adminReleased = true; connectionFailed = true; } });
    runtimeRoleSource = await openRuntimeRoleSource({ handoff: plan, expectedHandoffDigest: fixed.expectedHandoffDigest, lock: input.lock });
    await assertRuntimeRoleSourceManagementSession(runtimeRoleSource, admin!);
    const configuredRoles = structuredClone(await observeRuntimeRoles(runtimeRoleSource));
    need(configuredRoles.runId === plan.inputs.runId && configuredRoles.handoffDigest === fixed.expectedHandoffDigest &&
      isDeepStrictEqual(configuredRoles.target, input.activation.target), "RUNTIME-ROLE-SOURCE-MISMATCH");
    const verifyOrdinaryBoundary = async () => {
      await targetCheck(); await guard!.verify();
      await assertRuntimeRoleSourceManagementSession(runtimeRoleSource!, admin!);
      need(isDeepStrictEqual(await observeRuntimeRoles(runtimeRoleSource!), configuredRoles), "RUNTIME-ROLE-SOURCE-DRIFT");
      await verifyBoundReport();
      await assertHostOperationLockForJournal(input.lock, plan.inputs.journalPath);
      need(!connectionFailed, "CONNECTION-FAILED");
    };
    await verifyOrdinaryBoundary();
    const oldRoles = (await admin.query<Role>(rolesSql, [[...names]])).rows;
    need(oldRoles.length === names.size && names.size > 0, "SOURCE-ROLE-MISSING");
    need(!oldRoles.some(old => configuredRoles.roles.some(candidate => candidate.oid === old.oid)), "SOURCE-RUNTIME-ROLE-OVERLAP");
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
    const appendOrdinarySqlHost = async (outcome: "pending" | "applied", intentDigest: string) => {
      await verifyOrdinaryBoundary();
      need(isDeepStrictEqual(loaded.value.record, expectedJournal), "JOURNAL-DRIFT");
      const saved = commitJournalTransition(loaded.value, { action: `legacy-sql-privileges-${outcome}`,
        inputDigest: intentDigest, toState: loaded.value.record.state, nextAction: loaded.value.record.nextAction,
        outcome: outcome === "applied" ? "committed" : "crashed" });
      need(saved.ok && !saved.value.replayed, "SQL-PRIVILEGE-JOURNAL-UNKNOWN");
      expectedJournal = structuredClone(loaded.value.record);
      await verifyOrdinaryBoundary();
    };
    // From this point any interrupted SQL successor has an unknown outcome;
    // the already committed authentication effect must never authorize replay.
    ordinarySqlStarted = true;
    const sqlResult = await applyLegacySqlPrivilegeFence({ client: admin,
      selection: { runId: fixed.activationIntent.runId, attemptId: fixed.attemptId, target: input.activation.target,
        activationBindingDigest: binding.bindingDigest, rootRequestDigest: digestOf(request), recoveryPackageDigest: backup.digest },
      runtimeRoles: [...new Map(configuredRoles.roles.map(role => [role.oid, { oid: role.oid, name: role.name }])).values()],
      recoveryRoles: backup.roles, beforeEffect: verifyOrdinaryBoundary,
      persistHostIntent: intent => appendOrdinarySqlHost("pending", intent.intentDigest),
      persistHostStep: digest => appendOrdinarySqlHost("applied", digest),
    });
    need(sqlResult.outcome === "legacy-sql-privileges-fenced-not-P13" && /^sha256:[a-f0-9]{64}$/.test(sqlResult.intentDigest), "SQL-PRIVILEGE-OUTCOME-UNKNOWN");
    await verifyOrdinaryBoundary();
    return { status: "legacy-logins-fenced-not-p13" as const, attemptId: fixed.attemptId,
      fingerprint: digestOf({ requestDigest: digestOf(request), roles: after, sqlIntentDigest: sqlResult.intentDigest }) };
  } catch (error) {
    failed = true;
    unknown = ending || bootstrapStarted || ordinarySqlStarted;
    if (transaction && !ending) { try { await admin?.query("rollback"); } catch { unknown = true; } }
    // Losing the host lock, directory identity, CAS or fsync means even this
    // diagnostic append is unavailable. Preserve pending and the SQL/custody
    // evidence; never clear a persistence lock or retry a credential effect.
    if (recordRetirementUnknown) { try { await recordRetirementUnknown(); } catch { unknown = true; } }
    if (unknown) return refuse("TRANSACTION-OUTCOME-UNKNOWN");
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("OPERATION-FAILED");
  } finally {
    const releases = await Promise.allSettled([
      Promise.resolve().then(destroyAdmin), Promise.resolve().then(() => guard?.close()),
      Promise.resolve().then(releaseInspectionReader),
    ]);
    const closed = await Promise.allSettled([
      Promise.resolve().then(() => adminPool?.end()), Promise.resolve().then(() => custody?.close()),
      Promise.resolve().then(() => packageDirectory?.close()),
      Promise.resolve().then(() => journalDirectory?.close()),
      Promise.resolve().then(() => runtimeRoleSource?.close()),
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
  let runtimeRoleSource: RuntimeRoleSource | undefined;
  let connectionFailed = false, inspectionFailed = false;
  try {
    const { digest, ...body } = fixed.handoff;
    need(digest === fixed.expectedHandoffDigest && digest === sha256Prefixed(canonicalJson(body)), "HANDOFF-MISMATCH");
    await assertHostOperationLockForJournal(input.lock, fixed.handoff.inputs.journalPath);
    const url = new URL(input.administrativeConnectionString);
    need(["postgres:", "postgresql:"].includes(url.protocol) && !!url.hostname && !!url.username && !url.search && !url.hash, "MANAGEMENT-CONFIGURATION-INVALID");
    pool = new pg.Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    const onConnectionError = () => { connectionFailed = true; };
    pool.on("error", onConnectionError);
    client = await new Promise<pg.PoolClient>((resolve, reject) => {
      pool!.connect((error, acquired) => {
        if (acquired) { client = acquired; acquired.on("error", onConnectionError); acquired.on("end", onConnectionError); }
        if (error || !acquired) reject(new LegacyLoginRetirementError("CONNECTION-FAILED"));
        else resolve(acquired);
      });
    });
    need(!connectionFailed, "CONNECTION-FAILED");
    need(isDeepStrictEqual(await readBindingDatabaseIdentity(client), fixed.target), "TARGET-MISMATCH");
    const held = (await client.query("select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtext('s7-orc-cutover-target'),pg_catalog.hashtext(pg_catalog.current_database())) as held")).rows[0];
    need(held?.held === true, "CONTROLLER-LOCK-HELD");
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local timezone='UTC'");
    const activation = await createApplicationReadActivation(input.activation).inspectOnHeldManagementSession(fixed.activationIntent, client);
    need(activation.kind === "applied" && activation.currentHeadDigest === activation.binding.bindingDigest, "P12-BINDING-MISMATCH");
    const allEvents = (await client.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and phase='P13' order by sequence_number`, [fixed.runId])).rows;
    const events = allEvents.slice(0, 2), successors = allEvents.slice(2);
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
        // An authentication-only predecessor is incomplete. Do not retry it
        // or infer the SQL successor from NOLOGIN or a host boolean.
        outcome = "pending";
        if (successors.length === 2 && successors[0].event_kind === "legacy-sql-privileges-intent" &&
          successors[1].event_kind === "legacy-sql-privileges-applied") {
          const sqlIntentDigest = successors[0].payload?.intentDigest;
          const journal = loadUpgradeJournal({ journalPath: fixed.handoff.inputs.journalPath,
            runId: fixed.handoff.inputs.runId, requireSettled: true });
          need(journal.ok && journal.value.record.cutoverRunId === fixed.runId, "SQL-PRIVILEGE-JOURNAL-UNKNOWN");
          if (!journal.ok) return refuse("SQL-PRIVILEGE-JOURNAL-UNKNOWN");
          const hostSteps = journal.value.record.entries.filter(entry => entry.action.startsWith("legacy-sql-privileges-"));
          need(hostSteps.length === 2 && hostSteps[0].action === "legacy-sql-privileges-pending" &&
            hostSteps[1].action === "legacy-sql-privileges-applied" && hostSteps[0].inputDigest === sqlIntentDigest &&
            hostSteps[1].inputDigest === sqlIntentDigest && hostSteps[1].outcome === "committed", "SQL-PRIVILEGE-JOURNAL-UNKNOWN");
          const expectedJournal = structuredClone(journal.value.record);
          await client.query("rollback");
          runtimeRoleSource = await openRuntimeRoleSource({ handoff: fixed.handoff, expectedHandoffDigest: fixed.expectedHandoffDigest, lock: input.lock });
          await assertRuntimeRoleSourceManagementSession(runtimeRoleSource, client);
          const configured = await observeRuntimeRoles(runtimeRoleSource);
          need(configured.runId === fixed.handoff.inputs.runId && configured.handoffDigest === fixed.expectedHandoffDigest &&
            isDeepStrictEqual(configured.target, fixed.target), "RUNTIME-ROLE-SOURCE-MISMATCH");
          await beginLegacySqlPrivilegeInspection(client, fixed.target);
          const sql = await inspectLegacySqlPrivilegeFenceOnHeldSession({ client, intentDigest: sqlIntentDigest,
            selection: { runId: fixed.runId, attemptId: fixed.attemptId, target: fixed.target,
              activationBindingDigest: activation.binding.bindingDigest, rootRequestDigest: digestOf(request), recoveryPackageDigest: request.recoveryPackageDigest } });
          const observedRoles = [...new Map(configured.roles.map(role => [role.oid, { oid: role.oid, name: role.name }])).values()];
          need(sql.outcome === "legacy-sql-privileges-fenced-not-P13" &&
            isDeepStrictEqual(sql.intent?.runtimeRoles, observedRoles), "SQL-PRIVILEGE-OUTCOME-UNKNOWN");
          need(isDeepStrictEqual((await client.query<Role>(rolesSql, [original.map(role => role.name)])).rows, fenced), "FENCE-DRIFT");
          await assertNoSharedLegacyRoleUse(client, original, fixed.target);
          const current = await createApplicationReadActivation(input.activation).inspectOnHeldManagementSession(fixed.activationIntent, client);
          need(current.kind === "applied" && isDeepStrictEqual(current.binding, activation.binding), "P12-BINDING-MISMATCH");
          await assertRuntimeRoleSourceManagementSession(runtimeRoleSource, client);
          need(isDeepStrictEqual(await observeRuntimeRoles(runtimeRoleSource), configured), "RUNTIME-ROLE-SOURCE-DRIFT");
          const latest = loadUpgradeJournal({ journalPath: fixed.handoff.inputs.journalPath, runId: fixed.handoff.inputs.runId, requireSettled: true });
          need(latest.ok && isDeepStrictEqual(latest.value.record, expectedJournal), "JOURNAL-DRIFT");
          outcome = "applied";
        } else if (successors.length) outcome = "inconsistent";
      }
    }
    await assertHostOperationLockForJournal(input.lock, fixed.handoff.inputs.journalPath);
    need(!connectionFailed, "CONNECTION-FAILED");
    await client.query("rollback");
    await assertHostOperationLockForJournal(input.lock, fixed.handoff.inputs.journalPath);
    need(!connectionFailed, "CONNECTION-FAILED");
    return { outcome, attemptId: fixed.attemptId };
  } catch (error) {
    inspectionFailed = true;
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("INSPECTION-FAILED");
  } finally {
    const closed = await Promise.allSettled([
      Promise.resolve().then(() => runtimeRoleSource?.close()),
      (async () => {
        try {
          if (client) {
            try { if (!(client instanceof pg.Client)) return refuse("INSPECTION-CLOSE-FAILED"); await client.end(); }
            finally { client.release(true); }
          }
        } finally { await pool?.end(); }
      })(),
    ]);
    if (!inspectionFailed && closed.some(result => result.status === "rejected")) refuse("INSPECTION-CLOSE-FAILED");
    if (!inspectionFailed) await assertHostOperationLockForJournal(input.lock, fixed.handoff.inputs.journalPath);
  }
}

export async function inspectLegacyApplicationLoginFence(input: LegacyLoginRetirementInput) {
  try { return input.bootstrapCredentialDirectory ? await retire(input, true) : await inspect(input); }
  catch (error) {
    if (error instanceof LegacyLoginRetirementError) throw error;
    return refuse("INSPECTION-FAILED");
  }
}
