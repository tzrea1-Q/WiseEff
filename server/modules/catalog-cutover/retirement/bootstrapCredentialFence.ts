import { randomBytes } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isIP, Socket } from "node:net";
import { TLSSocket } from "node:tls";
import pg from "pg";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { digestOf } from "../../release-verification/core/digest";
import { createApplicationReadActivation, createActivationIntent, type ActivationIntent, type ActivationOptions } from "../activation/index";
import { assertBindingManagementLogin } from "../bindingImportProducer";
import { acquireObservedManagementClient } from "./managementCheckout";
import { beginLegacySqlPrivilegeInspection, inspectLegacySqlPrivilegeFenceOnHeldSession } from "./legacySqlPrivilegeFence";
import { assertHostOperationLockForJournal, type HostOperationLock } from "../../../../ops/self-hosted/scripts/parameter-catalog-upgrade/handoff";
import { loadUpgradeJournal } from "../../../../ops/self-hosted/scripts/parameter-catalog-upgrade/journal";

/** Exact non-secret portion of the root's persisted authentication intent.
 * This selects evidence; it is not authorization to rotate credentials. */
export type BootstrapRootBinding = Readonly<{
  contract: "pcat-bootstrap-application-authentication-v1";
  runId: string; attemptId: string; activationIntent: ActivationIntent;
  activationBindingDigest: string; handoffDigest: string;
  recoveryPackageDigest: string; recoveryPointDigest: string;
  target: BindingDatabaseIdentity; roleName: string; custodyDirectory: string;
}>;

/** Inspection-only custody transport. Never returns credentials or a client. */
export async function inspectBootstrapCredentialFenceFromCustodyTransport(input: {
  managementClient: pg.PoolClient; expectedRootBinding: BootstrapRootBinding;
  activation: ActivationOptions;
  /** Original root-owned journal/issued lock, never caller-supplied effect digests. */
  sqlSuccessor?: { journalPath: string; hostRunId: string; lock: HostOperationLock };
}): Promise<{ outcome: "not-applied" | "authentication-fenced-not-P13" | "unknown"; intentDigest?: string }> {
  const reader = input.managementClient;
  let root: BootstrapRootBinding, activation: ReturnType<typeof createApplicationReadActivation>;
  let stream: Socket, host: string, port: number;
  let sqlHost: typeof input.sqlSuccessor;
  // Client.host/port and caller objects are mutable. Use the actual connected
  // socket, then independently verify its database before reading any secret.
  try {
    root = structuredClone(input.expectedRootBinding);
    sqlHost = input.sqlSuccessor ? { ...input.sqlSuccessor } : undefined;
    if (!(reader instanceof pg.Client)) return { outcome: "unknown" };
    const connected = reader.connection.stream;
    if (!(connected instanceof Socket) || connected instanceof TLSSocket ||
        connected.destroyed || connected.remoteAddress !== "127.0.0.1" || !connected.remotePort) return { outcome: "unknown" };
    stream = connected;
    host = connected.remoteAddress; port = connected.remotePort;
    if (root.contract !== "pcat-bootstrap-application-authentication-v1" || root.runId !== root.activationIntent.runId ||
        !root.attemptId || root.attemptId.length > 160 || !root.roleName || !path.isAbsolute(root.custodyDirectory) ||
        !isDeepStrictEqual(root.target, root.activationIntent.target) || !isDeepStrictEqual(root.target, input.activation.target) ||
        !/^[a-f0-9]{64}$/.test(root.recoveryPackageDigest) ||
        [root.activationBindingDigest, root.handoffDigest, root.recoveryPointDigest]
          .some(value => !/^sha256:[a-f0-9]{64}$/.test(value))) return { outcome: "unknown" };
    const { inputDigest: _digest, ...intent } = root.activationIntent;
    if (!isDeepStrictEqual(createActivationIntent(intent), root.activationIntent)) return { outcome: "unknown" };
    activation = createApplicationReadActivation({ ...input.activation, target: root.target,
      boundary: { ...input.activation.boundary }, journal: { ...input.activation.journal } });
  } catch { return { outcome: "unknown" }; }
  let lost = false, readerTransaction = false, managerTransaction = false;
  let custody: BootstrapCredentialCustody | undefined, pool: pg.Pool | undefined, manager: pg.PoolClient | undefined;
  let managerReleased = false;
  let result: Awaited<ReturnType<typeof inspectBootstrapCredentialFence>> = { outcome: "unknown" };
  const releaseManager = () => { if (manager && !managerReleased) { managerReleased = true; manager.release(true); } };
  const onLoss = () => { lost = true; try { releaseManager(); } catch { /* Result remains unknown. */ } };
  const live = () => {
    if (lost || stream.destroyed || reader.connection.stream !== stream || stream.remoteAddress !== host || stream.remotePort !== port)
      failFence("custody-transport-lost");
  };
  reader.on("error", onLoss);
  reader.on("end", onLoss);
  try {
    live();
    // A SAVEPOINT is a transaction-existence probe. Never roll back or commit
    // an external transaction, even when rejecting it.
    const probe = pg.escapeIdentifier(`transport_${randomBytes(8).toString("hex")}`);
    try { await reader.query(`savepoint ${probe}`); await reader.query(`release savepoint ${probe}`); failFence("external-transaction"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "25P01")) throw error; }
    await assertBuiltinResolution(reader);
    await assertBindingManagementLogin(reader);
    if (!isDeepStrictEqual(await readBindingDatabaseIdentity(reader), root.target)) failFence("target-unproven");
    const connection = (await reader.query<{ database: string; pid: number; same: boolean; role: string }>(`select
      pg_catalog.current_database() as database,pg_catalog.pg_backend_pid() as pid,session_user=current_user as same,
      (select rolname from pg_catalog.pg_roles where oid=10) as role`)).rows[0];
    if (!connection?.same || connection.role !== root.roleName) failFence("management-client-unavailable");
    live();
    // SHARE needs a management transaction. Make it READ ONLY immediately
    // after acquiring the inventory locks and before the first snapshot query.
    // Only this transaction belongs to the facade; SET LOCAL restores the
    // borrowed login after rollback, and its pool/client are never closed here.
    await reader.query("begin isolation level serializable"); readerTransaction = true;
    await reader.query("set local role catalog_migration_owner");
    await reader.query("set local search_path=pg_catalog,parameter_catalog,pg_temp");
    await reader.query(`lock table parameter_catalog.catalog_state,
      parameter_catalog.catalog_releases, parameter_catalog.catalog_materializations,
      parameter_catalog.legacy_identities, parameter_catalog.legacy_mapping_heads,
      parameter_catalog.legacy_mapping_versions in share mode nowait`);
    await reader.query("set transaction read only");
    const readRoot = async (client: pg.PoolClient) => {
      const rows = (await client.query<{ payload: { request?: BootstrapRootBinding & { credentials: BootstrapCredentialReceipt }; requestDigest?: string } }>(
        `select payload from parameter_catalog.parameter_catalog_cutover_events
         where cutover_run_id=$1 and event_kind='bootstrap-application-authentication-intent' order by sequence_number`, [root.runId])).rows;
      const retained = rows[0]?.payload;
      if (rows.length !== 1 || !retained?.request || retained.requestDigest !== digestOf(retained.request)) failFence("root-intent-unavailable");
      const { credentials, ...binding } = retained.request;
      if (!isDeepStrictEqual(binding, root)) failFence("root-intent-mismatch");
      return structuredClone(retained.request);
    };
    const request = await readRoot(reader);
    const challenge = randomBytes(8), key1 = challenge.readInt32BE(0), key2 = challenge.readInt32BE(4);
    if ((await reader.query("select pg_catalog.pg_try_advisory_xact_lock($1,$2) as held", [key1, key2])).rows[0]?.held !== true)
      failFence("management-challenge-unavailable");
    const verifyReader = async () => {
      live();
      await assertBindingManagementLogin(reader);
      if (!isDeepStrictEqual(await readBindingDatabaseIdentity(reader), root.target)) failFence("target-unproven");
      const state = (await reader.query(`select pg_catalog.pg_backend_pid()=$1 as same_pid,
        current_user='catalog_migration_owner' as owner,pg_catalog.current_setting('transaction_read_only')='on' as readonly,
        (select count(*)=6 from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid() and granted and mode='ShareLock'
          and relation=any(array['parameter_catalog.catalog_state'::regclass,'parameter_catalog.catalog_releases'::regclass,
            'parameter_catalog.catalog_materializations'::regclass,'parameter_catalog.legacy_identities'::regclass,
            'parameter_catalog.legacy_mapping_heads'::regclass,'parameter_catalog.legacy_mapping_versions'::regclass])) as inventory`, [connection.pid])).rows[0];
      if (!state?.same_pid || !state.owner || !state.readonly || !state.inventory) failFence("management-guard-unavailable");
      live();
    };
    await verifyReader();
    custody = await reopenBootstrapCredentialCustody({ directory: root.custodyDirectory, custodianUid: process.getuid!(), receipt: request.credentials });
    const held = heldCustodies.get(custody)!;
    await checkCustody(held); await verifyReader();
    // No URL or ambient host/options fallback, and no old-password retry. A
    // pre-ALTER unknown attempt cannot use this new-only transport.
    pool = new pg.Pool({ host, port, database: connection.database, user: root.roleName,
      password: held.newSecret.toString("utf8"), ssl: false,
      options: "-c search_path=pg_catalog,parameter_catalog,pg_temp", application_name: "bootstrap-custody-inspection",
      max: 1, connectionTimeoutMillis: 2000, query_timeout: 5000 });
    pool.on("error", onLoss);
    manager = await acquireObservedManagementClient(pool, onLoss);
    const sameEndpoint = (await manager.query(`select session_user=current_user and
      (select oid=10 from pg_catalog.pg_roles where rolname=session_user) as bootstrap,
      exists(select 1 from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity a on a.pid=l.pid
        where l.pid=$1 and l.locktype='advisory' and l.granted and l.mode='ExclusiveLock'
          and l.objsubid=2 and l.classid=$2::oid and l.objid=$3::oid and a.datid=$4::oid) as same_reader`,
    [connection.pid, key1 >>> 0, key2 >>> 0, root.target.databaseOid])).rows[0];
    if (!sameEndpoint?.bootstrap || !sameEndpoint.same_reader ||
        !isDeepStrictEqual(await readBindingDatabaseIdentity(manager), root.target)) failFence("target-unproven");
    if ((await manager.query("select pg_catalog.pg_try_advisory_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as held")).rows[0]?.held !== true)
      failFence("management-lock-unavailable");
    const inspectHeldBinding = async () => {
      await verifyReader();
      const selected = await activation.inspectOnHeldManagementSession(root.activationIntent, manager!);
      if (selected.kind !== "applied" || selected.currentHeadDigest !== root.activationBindingDigest ||
          selected.binding.bindingDigest !== root.activationBindingDigest) failFence("activation-binding-mismatch");
    };
    const currentBinding = async () => {
      await manager!.query("begin isolation level repeatable read read only"); managerTransaction = true;
      await manager!.query("set local timezone='UTC'");
      await inspectHeldBinding();
      await manager!.query("rollback"); managerTransaction = false;
    };
    await currentBinding();
    if (!isDeepStrictEqual(await readRoot(manager), request)) failFence("root-intent-drift");
    const command = { client: manager, target: root.target, runId: root.runId, attemptId: root.attemptId, custody };
    const sqlKinds = ["legacy-sql-privileges-intent", "legacy-sql-privileges-applied"];
    const sqlRows = async () => (await manager!.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and event_kind=any($2::text[]) order by sequence_number`, [root.runId, sqlKinds])).rows;
    const initialSql = await sqlRows();
    let hostDigest: string | undefined, credentialDigest: string | undefined;
    const inspectHost = async (intentDigest?: string) => {
      if (!sqlHost) { if (intentDigest) failFence("sql-successor-host-required"); return; }
      await assertHostOperationLockForJournal(sqlHost.lock, sqlHost.journalPath);
      const loaded = loadUpgradeJournal({ journalPath: sqlHost.journalPath, runId: sqlHost.hostRunId, requireSettled: true });
      if (!loaded.ok) failFence("sql-successor-host-unavailable");
      if (hostDigest && loaded.value.record.journalDigest !== hostDigest) failFence("sql-successor-host-drift");
      hostDigest = loaded.value.record.journalDigest;
      const steps = loaded.value.record.entries.filter(entry => entry.action.startsWith("legacy-sql-privileges-"));
      if (!intentDigest) { if (steps.length) failFence("sql-successor-host-drift"); }
      else {
        const record = loaded.value.record;
        const authentication = record.entries.filter(entry => entry.bootstrapRetirement);
        const step = authentication[1]?.bootstrapRetirement;
        // The journal parser already checks the typed capture predecessor and
        // immutable pending -> credential-step chain. Match that exact chain
        // to the database-selected root/version, not copied generic SQL rows.
        if (record.cutoverRunId !== root.runId || record.planDigest !== root.activationIntent.planDigest ||
            authentication.length !== 2 || authentication[0].bootstrapRetirement?.outcome !== "pending" ||
            step?.outcome !== "credential-step" || !isDeepStrictEqual(step.intent.rootBinding, root) ||
            step.intent.rootRequestDigest !== digestOf(request) || step.intent.credentialVersion !== request.credentials.version ||
            credentialDigest !== undefined && step.credentialIntentDigest !== credentialDigest ||
            steps.length !== 2 || steps[0].seq <= authentication[1].seq ||
            steps[0].action !== "legacy-sql-privileges-pending" || steps[0].outcome !== "crashed" ||
            steps[1].action !== "legacy-sql-privileges-applied" || steps[1].outcome !== "committed" ||
            steps.some(entry => entry.inputDigest !== intentDigest)) failFence("sql-successor-host-drift");
      }
      await assertHostOperationLockForJournal(sqlHost.lock, sqlHost.journalPath);
    };
    if (initialSql.length) {
      const intentDigest = initialSql[0]?.payload?.intentDigest;
      if (initialSql.length !== 2 || typeof intentDigest !== "string") failFence("sql-successor-unavailable");
      await inspectHost(intentDigest);
      managerTransaction = true;
      await beginLegacySqlPrivilegeInspection(manager, root.target);
      await manager.query("set local timezone='UTC'");
      const ordered = (await manager.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
        where cutover_run_id=$1 and phase='P13' and event_kind=any($2::text[]) order by sequence_number`,
      [root.runId, ["bootstrap-application-authentication-intent", INTENT_EVENT, APPLIED_EVENT, ...sqlKinds]])).rows;
      if (!isDeepStrictEqual(ordered.map(row => row.event_kind), ["bootstrap-application-authentication-intent", INTENT_EVENT, APPLIED_EVENT, ...sqlKinds]) ||
          !isDeepStrictEqual(ordered[0].payload, { request, requestDigest: digestOf(request) }) ||
          !isDeepStrictEqual(ordered.slice(3), initialSql)) failFence("sql-successor-order-drift");
      credentialDigest = ordered[2].payload?.digest;
      if (typeof credentialDigest !== "string") failFence("sql-successor-order-drift");
      const selected = { client: manager, intentDigest, selection: { runId: root.runId, attemptId: root.attemptId,
        target: root.target, activationBindingDigest: root.activationBindingDigest, rootRequestDigest: digestOf(request),
        recoveryPackageDigest: root.recoveryPackageDigest } };
      const successor = await inspectLegacySqlPrivilegeFenceOnHeldSession(selected);
      if (successor.outcome !== "legacy-sql-privileges-fenced-not-P13" || !successor.intent || !successor.after) failFence("sql-successor-unavailable");
      result = await inspectAuthentication(command, successor);
      await inspectHeldBinding();
      if (!isDeepStrictEqual(await readRoot(manager), request) ||
          !isDeepStrictEqual(await inspectLegacySqlPrivilegeFenceOnHeldSession(selected), successor)) failFence("sql-successor-drift");
      // The final real P12/report boundary may await external work. Keep all
      // SQL-owner locks until it completes, then recheck the SQL effect and original
      // authentication baseline. No boundary callback runs after rollback.
      await inspectHeldBinding();
      if (!isDeepStrictEqual(await inspectLegacySqlPrivilegeFenceOnHeldSession(selected), successor) ||
          !isDeepStrictEqual(await inspectAuthentication(command, successor), result) ||
          !isDeepStrictEqual(await readRoot(manager), request)) failFence("sql-successor-drift");
      await inspectHost(intentDigest); await checkCustody(held); await verifyReader();
      await manager.query("rollback"); managerTransaction = false;
      live();
    } else {
      await inspectHost();
      result = await inspectBootstrapCredentialFence(command);
      if ((await sqlRows()).length) failFence("sql-successor-drift");
      await inspectHost();
      await currentBinding();
      if (!isDeepStrictEqual(await readRoot(manager), request)) failFence("root-intent-drift");
      await checkCustody(held); await verifyReader();
    }
  } catch { result = { outcome: "unknown" }; }
  finally {
    const rollbacks = await Promise.allSettled([
      Promise.resolve().then(async () => { if (managerTransaction && manager && !managerReleased) await manager.query("rollback"); }),
      Promise.resolve().then(async () => { if (readerTransaction) await reader.query("rollback"); }),
    ]);
    const released = await Promise.allSettled([Promise.resolve().then(releaseManager)]);
    const closed = await Promise.allSettled([Promise.resolve().then(() => pool?.end()), Promise.resolve().then(() => custody?.close())]);
    if (lost || [...rollbacks, ...released, ...closed].some(item => item.status === "rejected")) result = { outcome: "unknown" };
    reader.removeListener("error", onLoss);
    reader.removeListener("end", onLoss);
  }
  return result;
}

type FileIdentity = { dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string };
export type BootstrapCredentialReceipt = {
  version: string; directory: { dev: string; ino: string }; oldFile: FileIdentity; newFile: FileIdentity;
};
export type BootstrapCredentialCustody = { readonly receipt: BootstrapCredentialReceipt; close(): Promise<void> };
type HeldCustody = {
  root: FileHandle; oldFile: FileHandle; newFile: FileHandle; directory: string; custodianUid: number;
  receipt: BootstrapCredentialReceipt; oldSecret: Buffer; newSecret: Buffer; closed: boolean;
};
const heldCustodies = new WeakMap<BootstrapCredentialCustody, HeldCustody>();
const refuse = (): never => { throw new Error("bootstrap-credential-custody-unavailable"); };
const identity = (value: BigIntStats): FileIdentity => ({ dev: String(value.dev), ino: String(value.ino),
  size: String(value.size), mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) });
const rootIdentity = (value: BigIntStats) => ({ dev: String(value.dev), ino: String(value.ino) });
const privateRoot = (value: BigIntStats, uid: number) => value.isDirectory() && value.uid === BigInt(uid) && (value.mode & 0o777n) === 0o700n;
const privateFile = (value: BigIntStats, uid: number) => value.isFile() && value.uid === BigInt(uid) && value.nlink === 1n &&
  (value.mode & 0o777n) === 0o600n && value.size > 0n && value.size <= 1024n;

export async function reopenBootstrapCredentialCustody(input: {
  directory: string; custodianUid: number; receipt: BootstrapCredentialReceipt;
}): Promise<BootstrapCredentialCustody> {
  let root: FileHandle | undefined, oldFile: FileHandle | undefined, newFile: FileHandle | undefined;
  let oldSecret: Buffer = Buffer.alloc(0), newSecret: Buffer = Buffer.alloc(0);
  try {
    const receipt = structuredClone(input.receipt);
    if (!Number.isSafeInteger(input.custodianUid) || input.custodianUid < 0 || !path.isAbsolute(input.directory) ||
        await realpath(input.directory) !== input.directory || !/^[a-f0-9]{32}$/.test(receipt.version)) refuse();
    root = await open(input.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!privateRoot(await root.stat({ bigint: true }), input.custodianUid) ||
        !isDeepStrictEqual(rootIdentity(await root.stat({ bigint: true })), receipt.directory)) refuse();
    const read = async (suffix: string, expected: FileIdentity): Promise<{ handle: FileHandle; bytes: Buffer }> => {
      const handle = await open(path.join(input.directory, `${receipt.version}.${suffix}`), constants.O_RDONLY | constants.O_NOFOLLOW);
      if (suffix === "old") oldFile = handle; else newFile = handle;
      const actual = await handle.stat({ bigint: true });
      if (!privateFile(actual, input.custodianUid) || !isDeepStrictEqual(identity(actual), expected)) refuse();
      return { handle, bytes: await handle.readFile() };
    };
    oldSecret = (await read("old", receipt.oldFile)).bytes;
    newSecret = (await read("new", receipt.newFile)).bytes;
    if (!oldSecret.length || oldSecret.includes(0) || !/^[a-f0-9]{64}$/.test(newSecret.toString("utf8"))) refuse();
    const value: HeldCustody = { root, oldFile: oldFile!, newFile: newFile!, directory: input.directory,
      custodianUid: input.custodianUid, receipt, oldSecret, newSecret, closed: false };
    await checkCustody(value);
    return issue(value);
  } catch {
    oldSecret.fill(0); newSecret.fill(0);
    await Promise.allSettled([root?.close(), oldFile?.close(), newFile?.close()]);
    return refuse();
  }
}

async function checkCustody(value: HeldCustody): Promise<void> {
  if (value.closed || await realpath(value.directory) !== value.directory) refuse();
  const [root, namedRoot] = await Promise.all([value.root.stat({ bigint: true }), lstat(value.directory, { bigint: true })]);
  if (!privateRoot(root, value.custodianUid) || !privateRoot(namedRoot, value.custodianUid) ||
      !isDeepStrictEqual(rootIdentity(root), value.receipt.directory) || !isDeepStrictEqual(rootIdentity(namedRoot), value.receipt.directory)) refuse();
  for (const [handle, suffix, expected, bytes] of [[value.oldFile, "old", value.receipt.oldFile, value.oldSecret],
    [value.newFile, "new", value.receipt.newFile, value.newSecret]] as const) {
    const [held, named] = await Promise.all([handle.stat({ bigint: true }), lstat(path.join(value.directory, `${value.receipt.version}.${suffix}`), { bigint: true })]);
    if (!privateFile(held, value.custodianUid) || !privateFile(named, value.custodianUid) ||
        !isDeepStrictEqual(identity(held), expected) || !isDeepStrictEqual(identity(named), expected)) refuse();
    const current = Buffer.alloc(bytes.length);
    try {
      const read = await handle.read(current, 0, current.length, 0);
      if (read.bytesRead !== bytes.length || !current.equals(bytes)) refuse();
    } finally { current.fill(0); }
    if (!isDeepStrictEqual(identity(await handle.stat({ bigint: true })), expected)) refuse();
  }
}

function issue(value: HeldCustody): BootstrapCredentialCustody {
  const custody = Object.freeze({ get receipt() { return structuredClone(value.receipt); }, async close() {
    if (value.closed) return;
    value.closed = true;
    value.oldSecret.fill(0); value.newSecret.fill(0);
    const results = await Promise.allSettled([value.oldFile.close(), value.newFile.close(), value.root.close()]);
    if (results.some(result => result.status === "rejected")) refuse();
  } });
  heldCustodies.set(custody, value);
  return custody;
}

/** Explicit private preparation, not approval or a database mutation. Partial
 * files survive failure. No secret or password digest appears in the receipt. */
export async function prepareBootstrapCredentialCustody(input: {
  directory: string; custodianUid: number; oldSecret: string;
}): Promise<BootstrapCredentialCustody> {
  let root: FileHandle | undefined, oldFile: FileHandle | undefined, newFile: FileHandle | undefined;
  const oldSecret = Buffer.from(input.oldSecret), newSecret = Buffer.from(randomBytes(32).toString("hex"));
  try {
    if (!Number.isSafeInteger(input.custodianUid) || input.custodianUid < 0 || !path.isAbsolute(input.directory) ||
        await realpath(input.directory) !== input.directory || !oldSecret.length || oldSecret.length > 1024 || input.oldSecret.includes("\0")) refuse();
    root = await open(input.directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    const original = await root.stat({ bigint: true });
    if (!privateRoot(original, input.custodianUid)) refuse();
    const version = randomBytes(16).toString("hex");
    for (const [suffix, bytes] of [["old", oldSecret], ["new", newSecret]] as const) {
      if (!isDeepStrictEqual(rootIdentity(await lstat(input.directory, { bigint: true })), rootIdentity(original))) refuse();
      const filename = path.join(input.directory, `${version}.${suffix}`);
      const file = await open(filename, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      if (suffix === "old") oldFile = file; else newFile = file;
      if (!isDeepStrictEqual(rootIdentity(await lstat(input.directory, { bigint: true })), rootIdentity(original)) ||
          !isDeepStrictEqual(identity(await file.stat({ bigint: true })), identity(await lstat(filename, { bigint: true })))) refuse();
      await file.writeFile(bytes); await file.sync();
    }
    await root.sync();
    const value: HeldCustody = { root, oldFile: oldFile!, newFile: newFile!, directory: input.directory, custodianUid: input.custodianUid,
      oldSecret, newSecret, closed: false, receipt: { version, directory: rootIdentity(original),
        oldFile: identity(await oldFile!.stat({ bigint: true })), newFile: identity(await newFile!.stat({ bigint: true })) } };
    await checkCustody(value);
    return issue(value);
  } catch {
    oldSecret.fill(0); newSecret.fill(0);
    await Promise.allSettled([root?.close(), oldFile?.close(), newFile?.close()]);
    return refuse();
  }
}

type AuthenticationIntent = {
  contract: "pcat-bootstrap-authentication-v1"; runId: string; attemptId: string;
  target: BindingDatabaseIdentity; roleName: string; roleOid: "10";
  credentials: BootstrapCredentialReceipt; baselineDigest: string;
};
type AuthenticationCommand = {
  /** Existing management lease. Its root caller owns deployment admission and
   * the host lock. This module additionally checks the actual S7 session lock. */
  client: pg.PoolClient; target: BindingDatabaseIdentity; runId: string; attemptId: string;
  custody: BootstrapCredentialCustody;
  /** Optional management lifecycle constraint, not approval. Formal roots
   * install their own live boundary closure; callers cannot supply it to the
   * maintenance root. It must not open a nested transaction or borrow this pool. */
  beforeEffect?: () => Promise<void>;
};
class BootstrapAuthenticationFenceError extends Error {}
function failFence(reason: string): never { throw new BootstrapAuthenticationFenceError(`bootstrap-authentication-fence-${reason}`); }
const INTENT_EVENT = "bootstrap-authentication-fence-intent";
const APPLIED_EVENT = "bootstrap-authentication-fence-applied";
// PG16's built-in launcher has no database/authenticated client transaction.
// Every worker/client remains excluded; slots/subscriptions are checked below
// so this exception cannot substitute for a stopped replication writer.
const DORMANT_LAUNCHER = `(backend_type='logical replication launcher' and datid is null and client_addr is null
  and state is null and backend_xid is null and backend_xmin is null)`;

async function assertManagement(client: pg.PoolClient, target: BindingDatabaseIdentity, custody: HeldCustody): Promise<string> {
  if (!(client instanceof pg.Client) || isIP(client.host) !== 4 || !client.port) failFence("target-unproven");
  await assertBuiltinResolution(client);
  if (!isDeepStrictEqual(await readBindingDatabaseIdentity(client), target)) failFence("target-unproven");
  await client.query("select pg_catalog.pg_stat_clear_snapshot()");
  const result = (await client.query(`select r.rolname as name,
    r.oid=10 and session_user=current_user and r.rolsuper and r.rolbypassrls and r.rolcreatedb and r.rolcreaterole
      and r.rolreplication and r.rolinherit and r.rolcanlogin and r.rolconnlimit=-1 and r.rolvaliduntil is null and r.rolconfig is null
      and not (select datistemplate from pg_catalog.pg_database where datname=current_database())
      and current_setting('server_version_num')::integer between 160000 and 169999 as standard,
    exists(select 1 from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid() and locktype='advisory' and mode='ExclusiveLock'
      and granted and classid=hashtext('s7-orc-cutover-target')::oid and objid=hashtext(current_database())::oid and objsubid=2
      and database=(select oid from pg_catalog.pg_database where datname=current_database())) as locked,
    (select count(*)::int from pg_catalog.pg_auth_members where roleid=10 or member=10) as members,
    (select count(*)::int from pg_catalog.pg_roles where oid<>10 and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)) as managers,
    (select count(*)::int from pg_catalog.pg_stat_activity where usesysid=10 and pid<>pg_catalog.pg_backend_pid() and not ${DORMANT_LAUNCHER}) as sessions,
    (select count(*)::int from pg_catalog.pg_stat_activity where usesysid=10 and ${DORMANT_LAUNCHER}) as launchers,
    exists(select 1 from pg_catalog.pg_replication_slots) or exists(select 1 from pg_catalog.pg_subscription) as replication,
    (select count(*)::int from pg_catalog.pg_db_role_setting where setrole=10) as settings,
    (select rolpassword like 'SCRAM-SHA-256$%' from pg_catalog.pg_authid where oid=10) as scram
    from pg_catalog.pg_roles r where rolname=session_user`)).rows[0];
  if (!result || !result.standard) failFence("bootstrap-standard-role-required");
  if (!result.locked) failFence("exclusive-lock-required");
  if (result.members) failFence("bootstrap-memberships-present");
  if (result.managers) failFence("other-management-role-present");
  if (result.sessions) failFence("bootstrap-session-present");
  if (result.launchers > 1 || result.replication) failFence("replication-profile-unsupported");
  if (result.settings) failFence("bootstrap-settings-unsupported");
  if (!result.scram) failFence("bootstrap-scram-required");
  // Only the non-loopback TCP profile is supported. Local admin sockets are
  // outside this application's transport; they are never used for auth probes.
  const hba = (await client.query(`select type,address,netmask,auth_method,error from pg_catalog.pg_hba_file_rules order by rule_number`)).rows;
  if (!hba.length || hba.some(row => row.error || (row.type !== "local" && row.auth_method !== "scram-sha-256" &&
      !((row.address === "127.0.0.1" && row.netmask === "255.255.255.255") ||
        (row.address === "::1" && row.netmask === "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"))))) failFence("authentication-profile-unsupported");
  const logging = (await client.query(`select current_setting('shared_preload_libraries') as shared,
    current_setting('session_preload_libraries') as session,current_setting('local_preload_libraries') as local,
    current_setting('log_transaction_sample_rate')::numeric<>0 or current_setting('debug_print_parse')::boolean or
    current_setting('debug_print_rewritten')::boolean or current_setting('debug_print_plan')::boolean or
    current_setting('log_parser_stats')::boolean or current_setting('log_planner_stats')::boolean or
    current_setting('log_executor_stats')::boolean or current_setting('log_statement_stats')::boolean or
    exists(select 1 from pg_catalog.pg_settings where name like 'auto_explain.%' or name like 'pgaudit.%') as unsafe`)).rows[0];
  // Transaction sampling is selected at BEGIN, so disabling it only just
  // before ALTER cannot make an already sampled transaction private.
  if (!logging || logging.shared || logging.session || logging.local || logging.unsafe) failFence("logging-profile-unsupported");
  await assertNonTargetDatabases(client, target, result.name, custody);
  return result.name;
}

async function assertBuiltinResolution(client: pg.PoolClient): Promise<void> {
  if ((await client.query("select (pg_catalog.current_schemas(true))[1]='pg_catalog' as builtin_first")).rows[0]?.builtin_first !== true)
    failFence("search-path-unsupported");
}

/** A default maintenance database is not another application target. Observe
 * its actual catalogs through a separate read-only, password-authenticated
 * connection; its name alone cannot make it safe to share bootstrap auth. */
async function assertNonTargetDatabases(client: pg.PoolClient, target: BindingDatabaseIdentity, roleName: string, custody: HeldCustody): Promise<void> {
  const inventory = async () => (await client.query(`select oid::text,datname,datdba::text,datacl::text,datistemplate,datallowconn,datconnlimit,
    (select count(*)=4 and bool_and(grantor=10 and not is_grantable and
      ((grantee=0 and privilege_type='CONNECT') or (grantee=10 and privilege_type in ('CREATE','TEMPORARY','CONNECT'))))
      from pg_catalog.aclexplode(datacl)) as default_template_acl
    from pg_catalog.pg_database where oid<>$1::oid order by oid`, [target.databaseOid])).rows;
  const before = await inventory();
  if (target.databaseOid === "1" || target.databaseOid === "4" || before.filter(row => row.datistemplate).length !== 2 ||
      !before.some(row => row.oid === "1") || !before.some(row => row.oid === "4") || before.some(row => {
        if (row.datdba !== "10" || row.datconnlimit !== -1) return true;
        if (row.oid === "1" || row.oid === "4") return !row.datistemplate || row.datname !== (row.oid === "1" ? "template1" : "template0") ||
          row.datallowconn !== (row.oid === "1") || !row.default_template_acl;
        return row.oid !== "5" || row.datname !== "postgres" || row.datistemplate || row.datacl !== null || !row.datallowconn;
      })) failFence("maintenance-database-unsupported");
  const inspect = async (probe: pg.PoolClient) => {
    await probe.query("begin read only");
    try {
      const state = (await probe.query(`select
        exists(select 1 from pg_catalog.pg_stat_activity where datid=(select oid from pg_catalog.pg_database where datname=current_database())
          and pid<>pg_catalog.pg_backend_pid()) as sessions,
        exists(select 1 from pg_catalog.pg_class where oid>=16384) or
        exists(select 1 from pg_catalog.pg_proc where oid>=16384) or
        exists(select 1 from pg_catalog.pg_type where oid>=16384) or
        exists(select 1 from pg_catalog.pg_namespace where oid>=16384 or nspname not in ('pg_catalog','pg_toast','information_schema','public')) or
        exists(select 1 from pg_catalog.pg_operator where oid>=16384) or
        exists(select 1 from pg_catalog.pg_opclass where oid>=16384) or
        exists(select 1 from pg_catalog.pg_opfamily where oid>=16384) or
        exists(select 1 from pg_catalog.pg_collation where oid>=16384) or
        exists(select 1 from pg_catalog.pg_extension where extname<>'plpgsql' or extowner<>10 or extnamespace<>11 or extversion<>'1.0') or
        exists(select 1 from pg_catalog.pg_foreign_server) or exists(select 1 from pg_catalog.pg_user_mapping) or
        exists(select 1 from pg_catalog.pg_foreign_data_wrapper) or exists(select 1 from pg_catalog.pg_event_trigger) or
        exists(select 1 from pg_catalog.pg_publication) or exists(select 1 from pg_catalog.pg_subscription) or
        exists(select 1 from pg_catalog.pg_largeobject_metadata) as objects,
        exists(select 1 from pg_catalog.pg_default_acl) or
        exists(select 1 from pg_catalog.pg_db_role_setting where setdatabase=(select oid from pg_catalog.pg_database where datname=current_database())) or
        not exists(select 1 from pg_catalog.pg_namespace where oid=2200 and nspname='public' and nspowner=6171
          and nspacl @> array['pg_database_owner=UC/pg_database_owner','=U/pg_database_owner']::aclitem[]
          and cardinality(nspacl)=2) or
        exists(select 1 from (select relacl as acl from pg_catalog.pg_class union all select proacl from pg_catalog.pg_proc
          union all select typacl from pg_catalog.pg_type union all select nspacl from pg_catalog.pg_namespace) a,
          lateral pg_catalog.aclexplode(a.acl) x where x.grantee>=16384 or x.grantor>=16384) as acl`)).rows[0];
      if (!state || state.sessions || state.objects || state.acl) failFence("maintenance-database-not-empty-default");
      await probe.query("commit");
    } catch (error) { await probe.query("rollback").catch(() => undefined); throw error; }
  };
  for (const database of before.filter(row => row.datallowconn)) {
    const databaseTarget = { ...target, databaseOid: database.oid };
    // Unknown authentication never chooses another credential. Only an actual
    // password refusal permits checking the other retained version.
    if (await authenticate(client, custody.newSecret, databaseTarget, roleName, database.datname, inspect) === "password-rejected" &&
        await authenticate(client, custody.oldSecret, databaseTarget, roleName, database.datname, inspect) !== "accepted") failFence("maintenance-authentication-unavailable");
  }
  await client.query("select pg_catalog.pg_stat_clear_snapshot()");
  if (!isDeepStrictEqual(before, await inventory()) || (await client.query(`select 1 from pg_catalog.pg_stat_activity
    where datid=4 or (usesysid=10 and pid<>pg_catalog.pg_backend_pid() and not ${DORMANT_LAUNCHER}) limit 1`)).rowCount) failFence("maintenance-boundary-drift");
}

async function metadataValue(client: pg.PoolClient) {
  const result = await client.query(`select jsonb_build_object(
    'role',(select to_jsonb(r) from pg_catalog.pg_roles r where oid=10),
    'relations',(select jsonb_agg(jsonb_build_array(oid,relowner,relacl) order by oid) from pg_catalog.pg_class),
    'schemas',(select jsonb_agg(jsonb_build_array(oid,nspowner,nspacl) order by oid) from pg_catalog.pg_namespace),
    'functions',(select jsonb_agg(jsonb_build_array(oid,proowner,proacl) order by oid) from pg_catalog.pg_proc),
    'types',(select jsonb_agg(jsonb_build_array(oid,typowner,typacl) order by oid) from pg_catalog.pg_type),
    'databases',(select jsonb_agg(jsonb_build_array(oid,datdba,datacl) order by oid) from pg_catalog.pg_database),
    'defaults',(select jsonb_agg(to_jsonb(a) order by oid) from pg_catalog.pg_default_acl a),
    'members',(select jsonb_agg(to_jsonb(a) order by roleid,member) from pg_catalog.pg_auth_members a)) as value`);
  return result.rows[0]?.value ?? failFence("metadata-unavailable");
}
async function metadataDigest(client: pg.PoolClient): Promise<string> {
  return digestOf(await metadataValue(client));
}
type SqlSuccessorInspection = Awaited<ReturnType<typeof inspectLegacySqlPrivilegeFenceOnHeldSession>>;
/** Only the private facade can enter this path after the formal SQL owner has
 * verified the original successor and while its actual locks remain held.
 * Preserve the original metadata format: column ACLs belong to SQL readback. */
async function metadataBeforeSqlSuccessor(client: pg.PoolClient, successor: SqlSuccessorInspection): Promise<string> {
  if (!successor.intent || !successor.after || successor.outcome !== "legacy-sql-privileges-fenced-not-P13") failFence("sql-successor-unavailable");
  const value = await metadataValue(client);
  if (!Array.isArray(value.relations)) failFence("metadata-unavailable");
  for (const previous of successor.intent.inventory.relations) {
    const matches = value.relations.filter((tuple: unknown[]) => Array.isArray(tuple) && String(tuple[0]) === previous.oid);
    const after = successor.after.relations.filter(relation => relation.oid === previous.oid);
    if (matches.length !== 1 || after.length !== 1 || matches[0].length !== 3 || String(matches[0][1]) !== previous.owner ||
        after[0].owner !== previous.owner || !isDeepStrictEqual(matches[0][2], after[0].acl)) failFence("sql-successor-metadata-drift");
    matches[0][2] = structuredClone(previous.acl);
  }
  return digestOf(value);
}

async function authenticate(client: pg.PoolClient, password: Buffer, target: BindingDatabaseIdentity, roleName: string,
  database?: string, inspect?: (probe: pg.PoolClient) => Promise<void>): Promise<"accepted" | "password-rejected"> {
  if (!(client instanceof pg.Client)) failFence("management-client-unavailable");
  const pool = new pg.Pool({ host: client.host, port: client.port, database: database ?? client.database, max: 1,
    user: roleName, password: password.toString("utf8"), connectionTimeoutMillis: 2000, query_timeout: 5000 });
  let broken = false;
  let probe: pg.PoolClient | undefined;
  const observe = () => { broken = true; };
  pool.on("error", observe);
  try {
    probe = await new Promise<pg.PoolClient>((resolve, reject) => pool.connect((error, value) => {
      if (value) { probe = value; value.on("error", observe); }
      if (error || !value) reject(error ?? new Error("authentication-client-unavailable"));
      else resolve(value);
    }));
    await assertBuiltinResolution(probe);
    const identity = await readBindingDatabaseIdentity(probe);
    const role = (await probe.query("select oid::text as oid,rolname from pg_catalog.pg_roles where rolname=session_user and session_user=current_user")).rows[0];
    if (broken || !isDeepStrictEqual(identity, target) || role?.oid !== "10" || role.rolname !== roleName) failFence("authentication-target-mismatch");
    await inspect?.(probe);
    if (broken) failFence("authentication-connection-lost");
    return "accepted";
  } catch (error) {
    if (!broken && error instanceof Error && "code" in error && error.code === "28P01") return "password-rejected";
    return failFence("authentication-result-unknown");
  } finally {
    try { probe?.release(true); await pool.end(); }
    catch { failFence("authentication-close-unknown"); }
  }
}

async function appendAuthenticationEvent(client: pg.PoolClient, intent: AuthenticationIntent, event: string): Promise<void> {
  await client.query(`insert into parameter_catalog.parameter_catalog_cutover_events(id,cutover_run_id,sequence_number,phase,event_kind,payload)
    select $1,$2,coalesce(max(sequence_number),0)+1,'P13',$3,$4::jsonb from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`,
  [randomBytes(16).toString("hex"), intent.runId, event, JSON.stringify({ intent, digest: digestOf(intent) })]);
}

/** Low-level management authentication effect, never a release gate or CLI.
 * The root must first prove P12, its applicable approved report and same-boundary
 * recovery/host lock. These events are not a completed P13 checkpoint. */
export async function applyBootstrapCredentialFence(input: AuthenticationCommand): Promise<{
  outcome: "authentication-fenced-not-P13"; intentDigest: string;
}> {
  const { client, beforeEffect } = input;
  if (!(client instanceof pg.Client)) failFence("management-client-unavailable");
  const target = structuredClone(input.target), runId = input.runId, attemptId = input.attemptId;
  const custody = heldCustodies.get(input.custody);
  let transaction = false, commitDispatched = false, intentCommitted = false, broken = false;
  const observeError = () => { broken = true; };
  client.on("error", observeError);
  try {
    if (!custody || !runId || !attemptId || runId.length > 160 || attemptId.length > 160) failFence("command-invalid");
    await checkCustody(custody);
    const roleName = await assertManagement(client, target, custody);
    const savepoint = `bootstrap_${randomBytes(8).toString("hex")}`;
    try { await client.query(`savepoint ${pg.escapeIdentifier(savepoint)}`); await client.query(`release savepoint ${pg.escapeIdentifier(savepoint)}`); failFence("external-transaction"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "25P01")) throw error; }
    if (await authenticate(client, custody.oldSecret, target, roleName) !== "accepted" ||
        await authenticate(client, custody.newSecret, target, roleName) !== "password-rejected") failFence("credential-precondition");
    const wrong = Buffer.from(randomBytes(32).toString("hex"));
    try { if (await authenticate(client, wrong, target, roleName) !== "password-rejected") failFence("password-authentication-required"); }
    finally { wrong.fill(0); }
    await client.query("begin"); transaction = true;
    await client.query("set local synchronous_commit=on");
    const run = await client.query("select id from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update", [runId]);
    if (run.rowCount !== 1) failFence("run-unavailable");
    const existing = await client.query(`select id from parameter_catalog.parameter_catalog_cutover_events
      where event_kind=any($1::text[]) and (cutover_run_id=$2 or payload->'intent'->'credentials'->>'version'=$3)`,
    [[INTENT_EVENT, APPLIED_EVENT], runId, custody.receipt.version]);
    if (existing.rowCount) failFence("existing-attempt-requires-inspection");
    const intent: AuthenticationIntent = { contract: "pcat-bootstrap-authentication-v1", runId, attemptId, target,
      roleName, roleOid: "10", credentials: structuredClone(custody.receipt), baselineDigest: await metadataDigest(client) };
    await beforeEffect?.();
    await appendAuthenticationEvent(client, intent, INTENT_EVENT);
    await checkCustody(custody);
    await beforeEffect?.();
    commitDispatched = true; await client.query("commit"); transaction = false; commitDispatched = false; intentCommitted = true;
    await beforeEffect?.();
    await client.query("begin"); transaction = true;
    await client.query("set local synchronous_commit=on");
    await client.query("lock table pg_catalog.pg_authid in share row exclusive mode nowait");
    await client.query("lock table pg_catalog.pg_database in share mode nowait");
    if (await assertManagement(client, target, custody) !== roleName || await metadataDigest(client) !== intent.baselineDigest) failFence("source-drift");
    await checkCustody(custody);
    // The same narrowly controlled logging settings are used by the approved
    // recovery executor. No password/hash is returned or persisted as evidence.
    await client.query("set local log_statement='none'; set local log_min_error_statement='panic'; set local log_min_duration_statement=-1; set local log_min_duration_sample=-1; set local password_encryption='scram-sha-256'");
    // Logging controls do not hide pg_stat_activity from statistics readers.
    // Complete this separate, secret-free statement and verify the same lease
    // before dispatching any password literal. LOCAL restores the prior setting
    // on commit/rollback; no permanent runtime privilege or configuration changes.
    await client.query("set local track_activities=off");
    if ((await client.query("select not pg_catalog.current_setting('track_activities')::boolean as private")).rows[0]?.private !== true)
      failFence("activity-privacy-unavailable");
    await beforeEffect?.();
    await client.query(`alter role ${pg.escapeIdentifier(roleName)} password ${pg.escapeLiteral(custody.newSecret.toString("utf8"))}`);
    if (await metadataDigest(client) !== intent.baselineDigest) failFence("owner-acl-or-attribute-drift");
    await beforeEffect?.();
    await appendAuthenticationEvent(client, intent, APPLIED_EVENT);
    await checkCustody(custody);
    if (broken) failFence("connection-lost");
    await beforeEffect?.();
    commitDispatched = true; await client.query("commit"); transaction = false; commitDispatched = false;
    if (await authenticate(client, custody.newSecret, target, roleName) !== "accepted" ||
        await authenticate(client, custody.oldSecret, target, roleName) !== "password-rejected") failFence("postcondition-unknown");
    await assertManagement(client, target, custody); await checkCustody(custody);
    return { outcome: "authentication-fenced-not-P13", intentDigest: digestOf(intent) };
  } catch (error) {
    if (transaction && !commitDispatched) await client.query("rollback").catch(() => undefined);
    if (!commitDispatched && !intentCommitted && error instanceof BootstrapAuthenticationFenceError) throw error;
    return failFence(commitDispatched || intentCommitted ? "outcome-unknown-inspect-original-version" : "refused");
  } finally { client.removeListener("error", observeError); }
}

/** Inspection never rotates a password, retries an intent, or changes a phase.
 * A committed SQL event alone is insufficient: both actual authentications and
 * the original private version must agree before reconciliation is possible. */
export async function inspectBootstrapCredentialFence(input: AuthenticationCommand): Promise<{
  outcome: "not-applied" | "authentication-fenced-not-P13" | "unknown"; intentDigest?: string;
}> {
  return inspectAuthentication(input);
}

async function inspectAuthentication(input: AuthenticationCommand, successor?: SqlSuccessorInspection): Promise<{
  outcome: "not-applied" | "authentication-fenced-not-P13" | "unknown"; intentDigest?: string;
}> {
  // Select once before the first custody/SQL await. Inspection must reconcile
  // the caller's original intent, not a later mutation of the same object.
  const { client, custody: selectedCustody, runId, attemptId } = input;
  let target: BindingDatabaseIdentity;
  try { target = structuredClone(input.target); } catch { return { outcome: "unknown" }; }
  const custody = heldCustodies.get(selectedCustody);
  if (!(client instanceof pg.Client)) return { outcome: "unknown" };
  let broken = false;
  const observeError = () => { broken = true; };
  client.on("error", observeError);
  try {
    if (!custody) failFence("custody-required");
    await checkCustody(custody);
    const roleName = await assertManagement(client, target, custody);
    const events = (await client.query(`select event_kind,payload from parameter_catalog.parameter_catalog_cutover_events
      where cutover_run_id=$1 and event_kind=any($2::text[]) order by sequence_number`,
    [runId, [INTENT_EVENT, APPLIED_EVENT]])).rows;
    const intent = events[0]?.payload?.intent as AuthenticationIntent | undefined;
    if (!intent || events[0].event_kind !== INTENT_EVENT || intent.contract !== "pcat-bootstrap-authentication-v1" ||
        intent.runId !== runId || intent.attemptId !== attemptId || intent.roleName !== roleName || intent.roleOid !== "10" ||
        !isDeepStrictEqual(intent.target, target) || !isDeepStrictEqual(intent.credentials, custody.receipt) ||
        events[0].payload.digest !== digestOf(intent) ||
        (successor ? await metadataBeforeSqlSuccessor(client, successor) : await metadataDigest(client)) !== intent.baselineDigest ||
        (events.length !== 1 && !(events.length === 2 && events[1].event_kind === APPLIED_EVENT &&
          isDeepStrictEqual(events[1].payload, events[0].payload)))) return { outcome: "unknown" };
    const oldAuthentication = await authenticate(client, custody.oldSecret, target, roleName);
    const newAuthentication = await authenticate(client, custody.newSecret, target, roleName);
    await assertManagement(client, target, custody); await checkCustody(custody);
    if (successor && await metadataBeforeSqlSuccessor(client, successor) !== intent.baselineDigest) return { outcome: "unknown" };
    if (broken) return { outcome: "unknown" };
    if (events.length === 1 && oldAuthentication === "accepted" && newAuthentication === "password-rejected")
      return { outcome: "not-applied", intentDigest: digestOf(intent) };
    if (events.length === 2 && oldAuthentication === "password-rejected" && newAuthentication === "accepted")
      return { outcome: "authentication-fenced-not-P13", intentDigest: digestOf(intent) };
    return { outcome: "unknown" };
  } catch { return { outcome: "unknown" }; }
  finally { client.removeListener("error", observeError); }
}
