import { randomInt } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import pg from "pg";
import { createIsolatedUpgradeDocker } from "../../../../scripts/isolated-upgrade-docker";
import { assertBindingManagementLogin, readBindingDatabaseIdentity } from "../../../../server/modules/catalog-cutover/bindingImportProducer";
import { assertRuntimeLoginIdentity, RuntimeConnectionError } from "../../../../server/shared/database/runtimeConnection";
import { canonicalJson } from "./journal";
import { assertHostOperationLockForJournal, openHandoffRuntimeConfigurationLease, type HandoffPlan, type HostOperationLock } from "./handoff";
import { observeLegacySourceEndpoint } from "./legacyWriterSource";

export class RuntimeRoleSourceError extends Error {
  constructor(readonly code: string, readonly cleanupCode?: string) {
    super(`PCAT-RUNTIME-ROLE-SOURCE-${code}`);
  }
}
function requireFact(value: unknown, code: string): asserts value {
  if (!value) throw new RuntimeRoleSourceError(code);
}
type Purpose = "application" | "catalog-governance-command";
type Role = { service: "api" | "worker"; purpose: Purpose; oid: string; name: string };
export type RuntimeRoleObservation = {
  scope: "management-time-configured-logins-only";
  runId: string; handoffDigest: string;
  target: { systemIdentifier: string; databaseOid: string };
  roles: readonly Role[];
};
declare const sourceBrand: unique symbol;
export type RuntimeRoleSource = { readonly [sourceBrand]: true; close(): Promise<void> };
type IssuedRuntimeRoleSource = {
  observe: () => Promise<RuntimeRoleObservation>;
  assertManagementSession: (client: pg.PoolClient) => Promise<void>;
};
const issued = new WeakMap<RuntimeRoleSource, IssuedRuntimeRoleSource>();

/** Observations cannot be supplied as JSON to this consumer. Every call repeats
 * config, endpoint, same-session identity/challenge and actual lock checks. */
export async function observeRuntimeRoles(source: RuntimeRoleSource): Promise<RuntimeRoleObservation> {
  const current = issued.get(source);
  requireFact(current, "NOT-ISSUED");
  return current.observe();
}

/** Proves that a retirement manager session is on the same pinned source
 * endpoint as the private management configuration. The caller receives only
 * an opaque source handle and its own checked-out client; no URL, credential,
 * callback, or caller-provided endpoint participates in this proof. */
export async function assertRuntimeRoleSourceManagementSession(
  source: RuntimeRoleSource,
  client: pg.PoolClient,
): Promise<void> {
  const current = issued.get(source);
  requireFact(current, "NOT-ISSUED");
  await current.assertManagementSession(client);
}

const parseConnection = (value: string | undefined) => {
  try {
    requireFact(value, "CONFIG-UNAVAILABLE");
    const url = new URL(value);
    requireFact(["postgres:", "postgresql:"].includes(url.protocol) && !url.search && !url.hash &&
      url.username && url.password && /^\/[a-zA-Z0-9_-]+$/.test(url.pathname), "TRANSPORT-UNSUPPORTED");
    decodeURIComponent(url.username); decodeURIComponent(url.password);
    return url;
  } catch { throw new RuntimeRoleSourceError("TRANSPORT-UNSUPPORTED"); }
};

/** This opens only short management-period READ ONLY LOGIN leases. It never
 * issues an admitted runtime database, starts the candidate, or runs an effect.
 * The root owns expectedHandoffDigest; it is not a request-provided role list. */
export async function openRuntimeRoleSource(input: { handoff: HandoffPlan; expectedHandoffDigest: string; lock: HostOperationLock }): Promise<RuntimeRoleSource> {
  const plan = structuredClone(input.handoff), expectedDigest = input.expectedHandoffDigest, lock = input.lock;
  const config = await openHandoffRuntimeConfigurationLease(plan, expectedDigest, lock);
  const connections: { pool: pg.Pool; client?: pg.PoolClient; released: boolean }[] = [];
  let closed = false, lost = false, closing: Promise<void> | undefined;
  const onLoss = () => { lost = true; };
  const close = () => closing ??= (async () => {
    closed = true;
    const results = await Promise.allSettled(connections.map(async connection => {
      try {
        if (connection.client && !connection.released) {
          // pg-pool removes a released client from its count before that
          // client's asynchronous end settles. Pool.end alone can return early.
          try {
            requireFact(connection.client instanceof pg.Client, "CLOSE-FAILED");
            await connection.client.end();
          }
          finally { connection.released = true; connection.client.release(true); }
        }
      } finally { await connection.pool.end(); }
    }).concat([config.close()]));
    if (results.some(result => result.status === "rejected")) throw new RuntimeRoleSourceError("CLOSE-FAILED");
  })();
  const connect = async (url: URL) => {
    const pool = new pg.Pool({ connectionString: url.href, max: 1, connectionTimeoutMillis: 5000,
      query_timeout: 5000, options: "-c default_transaction_read_only=on" });
    pool.on("error", onLoss);
    const owned = { pool, client: undefined as pg.PoolClient | undefined, released: false };
    connections.push(owned);
    const client = await new Promise<pg.PoolClient>((resolve, reject) => {
      pool.connect((error, checkedOut) => {
        // Checkout transfers ownership before the Promise continuation. Register
        // immediately, including an error+client result, so no event can escape
        // and the failure path still releases every actual checked-out client.
        if (checkedOut) {
          owned.client = checkedOut;
          checkedOut.on("error", onLoss); checkedOut.on("end", onLoss);
        }
        if (error || !checkedOut) reject(new RuntimeRoleSourceError("CONNECTION-UNAVAILABLE"));
        else resolve(checkedOut);
      });
    });
    requireFact(!closed && !lost, "CONNECTION-LOST");
    const schemas = (await client.query<{ schemas: string[] }>("select pg_catalog.current_schemas(true)::text[] as schemas")).rows[0]?.schemas;
    requireFact(Array.isArray(schemas) && schemas[0] === "pg_catalog", "RESOLUTION-UNSAFE");
    return client;
  };
  try {
    const environment = await config.read();
    const managementUrl = parseConnection(environment.management.DATABASE_URL);
    requireFact(managementUrl.hostname === "127.0.0.1" && managementUrl.port, "MANAGEMENT-ENDPOINT-UNPROVEN");
    const docker = createIsolatedUpgradeDocker();
    requireFact(docker.daemonId === plan.inputs.expectedDaemonId, "DAEMON-MISMATCH");
    const stores = plan.inputs.source.stores.filter(store => store.service === "postgres");
    requireFact(stores.length === 1 && /^[a-f0-9]{64}$/.test(stores[0].containerId), "TARGET-UNAVAILABLE");
    const postgres = stores[0];
    const pinned = plan.observation.stores.find(store => store.service === "postgres");
    requireFact(pinned && pinned.id === postgres.containerId, "TARGET-UNAVAILABLE");
    const inspect = () => {
      const actual = JSON.parse(docker.command(["inspect", postgres.containerId]).toString())[0];
      const ports = actual?.NetworkSettings?.Ports?.["5432/tcp"];
      requireFact(actual?.Id === pinned.id && actual.Image === pinned.imageId && actual.State?.Running === true &&
        actual.Mounts?.some((mount: { Name?: string; Destination?: string }) => mount.Name === postgres.volumeName && mount.Destination === postgres.destination) &&
        Array.isArray(ports) && ports.length === 1 && ports[0].HostIp === "127.0.0.1" && ports[0].HostPort === managementUrl.port,
      "TARGET-ENDPOINT-MISMATCH");
      return canonicalJson({ id: actual.Id, image: actual.Image, started: actual.State.StartedAt, ports, mounts: actual.Mounts });
    };
    const containerIdentity = inspect();
    const manager = await connect(managementUrl);
    const peer = (client: pg.PoolClient) => {
      const stream = client instanceof pg.Client ? client.connection.stream : undefined;
      requireFact(stream instanceof Socket && !(stream instanceof TLSSocket) && !stream.destroyed &&
        stream.remoteAddress === "127.0.0.1" && String(stream.remotePort) === managementUrl.port, "SESSION-ENDPOINT-MISMATCH");
    };
    peer(manager);
    await assertBindingManagementLogin(manager);
    const target = await readBindingDatabaseIdentity(manager);
    const managementIdentity = (await manager.query<{ oid: string }>("select oid::text from pg_catalog.pg_roles where rolname=session_user and session_user=current_user")).rows[0];
    requireFact(managementIdentity, "MANAGEMENT-IDENTITY-UNAVAILABLE");
    const selections: { service: "api" | "worker"; purpose: Purpose; url: URL }[] = [
      { service: "api", purpose: "application", url: parseConnection(environment.api.DATABASE_URL) },
      { service: "worker", purpose: "application", url: parseConnection(environment.worker.DATABASE_URL) },
    ];
    if (environment.api.CATALOG_GOVERNANCE_DATABASE_URL) selections.push({ service: "api", purpose: "catalog-governance-command",
      url: parseConnection(environment.api.CATALOG_GOVERNANCE_DATABASE_URL) });
    const registrations = [...plan.inputs.source.applications.map(app => app.containerId), ...plan.inputs.source.stores.map(store => store.containerId)];
    const resolve = (selection: typeof selections[number]) => {
      requireFact(selection.url.pathname === managementUrl.pathname, "DATABASE-MISMATCH");
      if (selection.url.hostname === "127.0.0.1") {
        requireFact(selection.url.port === managementUrl.port, "TARGET-ENDPOINT-MISMATCH");
        return;
      }
      const application = plan.inputs.source.applications.filter(app => app.service === selection.service);
      requireFact(application.length === 1, "SOURCE-ENDPOINT-UNPROVEN");
      // This is only the existing stopped source resolver's supported profile.
      // It proves no future container's DNS or candidate startup readiness.
      observeLegacySourceEndpoint({ docker, sourceUrl: selection.url.href, administrativeUrl: managementUrl.href,
        applicationId: application[0].containerId, postgresId: postgres.containerId, registeredIds: registrations, ownerRunId: plan.inputs.runId });
    };
    const sessions: { selection: typeof selections[number]; client: pg.PoolClient; key: number; identity: Role }[] = [];
    const role = async (client: pg.PoolClient, selection: typeof selections[number]): Promise<Role> => {
      await assertRuntimeLoginIdentity(client, selection.purpose);
      const row = (await client.query<{ oid: string; name: string }>("select oid::text,rolname as name from pg_catalog.pg_roles where rolname=session_user and session_user=current_user and rolcanlogin")).rows[0];
      requireFact(row && row.oid !== "10" && row.oid !== managementIdentity.oid, "RUNTIME-IDENTITY-MISMATCH");
      return { service: selection.service, purpose: selection.purpose, oid: row.oid, name: row.name };
    };
    for (const selection of selections) {
      resolve(selection);
      const transport = new URL(selection.url.href);
      transport.hostname = managementUrl.hostname; transport.port = managementUrl.port;
      const client = await connect(transport); peer(client);
      const identity = await role(client, selection), key = randomInt(1, 2147483647);
      await client.query("select pg_catalog.pg_advisory_lock(824017,$1::int)", [key]);
      sessions.push({ selection, client, key, identity });
    }
    const assertManagementSession = async (candidate: pg.PoolClient): Promise<void> => {
      try {
        requireFact(!closed && !lost, "CLOSED-OR-LOST");
        await config.read();
        requireFact(inspect() === containerIdentity, "TARGET-DRIFT");
        peer(manager);
        await assertBindingManagementLogin(manager);
        requireFact(canonicalJson(await readBindingDatabaseIdentity(manager)) === canonicalJson(target), "DATABASE-DRIFT");
        peer(candidate);
        const identity = (await candidate.query<{ pid: number; database: string }>(`select pg_catalog.pg_backend_pid() as pid,
          (select oid::text from pg_catalog.pg_database where datname=pg_catalog.current_database()) as database`)).rows[0];
        requireFact(identity?.pid && identity.database === target.databaseOid, "MANAGEMENT-SESSION-IDENTITY-MISMATCH");
        const key = randomInt(1, 2147483647);
        let lockAttempted = false;
        let primaryError: unknown;
        let cleanupError: unknown;
        try {
          lockAttempted = true;
          await candidate.query("select pg_catalog.pg_advisory_lock(824018,$1::int)", [key]);
          const proof = await manager.query<{ valid: boolean }>(`select count(*)=1 as valid from pg_catalog.pg_locks
            where locktype='advisory' and granted and mode='ExclusiveLock' and pid=$1 and database=$2::oid
              and classid=824018::oid and objid=$3::oid and objsubid=2`, [identity.pid, target.databaseOid, key]);
          requireFact(proof.rows[0]?.valid === true, "MANAGEMENT-SESSION-CHALLENGE-FAILED");
        } catch (error) {
          primaryError = error;
        } finally {
          if (lockAttempted) {
            try {
              const unlocked = await candidate.query<{ unlocked: boolean }>(
                "select pg_catalog.pg_advisory_unlock(824018,$1::int) as unlocked", [key]);
              if (unlocked.rows[0]?.unlocked !== true) throw new RuntimeRoleSourceError("MANAGEMENT-SESSION-UNLOCK-FAILED");
            } catch (error) {
              cleanupError = error;
              // A failed unlock leaves the caller-owned session lease uncertain.
              // Retire the source as well; the caller still owns and must close
              // the candidate client in its normal resource-finally path.
              lost = true;
            }
          }
        }
        if (primaryError) {
          const cleanupCode = cleanupError ? "MANAGEMENT-SESSION-CLEANUP-UNKNOWN" : undefined;
          // Keep the typed admission reason, but never export a driver error or
          // its cause. The owner must destroy the checked-out client when this
          // static cleanup code is present.
          if (primaryError instanceof RuntimeRoleSourceError) {
            throw cleanupCode ? new RuntimeRoleSourceError(primaryError.code, cleanupCode) : primaryError;
          }
          if (primaryError instanceof RuntimeConnectionError && !cleanupCode) throw primaryError;
          throw new RuntimeRoleSourceError(cleanupCode ?? "MANAGEMENT-SESSION-UNAVAILABLE", cleanupCode);
        }
        if (cleanupError) throw new RuntimeRoleSourceError("MANAGEMENT-SESSION-CLEANUP-UNKNOWN");
        await config.read(); requireFact(inspect() === containerIdentity, "TARGET-DRIFT");
        await assertHostOperationLockForJournal(lock, plan.inputs.journalPath);
        requireFact(!closed && !lost, "CLOSED-OR-LOST");
      } catch (error) {
        if (error instanceof RuntimeRoleSourceError || error instanceof RuntimeConnectionError) throw error;
        throw new RuntimeRoleSourceError("MANAGEMENT-SESSION-UNAVAILABLE");
      }
    };
    const current = async (): Promise<RuntimeRoleObservation> => {
      try {
        requireFact(!closed && !lost, "CLOSED-OR-LOST");
        await config.read();
        requireFact(inspect() === containerIdentity, "TARGET-DRIFT"); peer(manager);
        await assertBindingManagementLogin(manager);
        requireFact(canonicalJson(await readBindingDatabaseIdentity(manager)) === canonicalJson(target), "DATABASE-DRIFT");
        const roles: Role[] = [];
        for (const session of sessions) {
          resolve(session.selection); peer(session.client);
          const identity = await role(session.client, session.selection);
          requireFact(canonicalJson(identity) === canonicalJson(session.identity), "RUNTIME-IDENTITY-DRIFT");
          const pid = (await session.client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
          const proof = await manager.query<{ valid: boolean }>(`select count(*)=1 as valid from pg_catalog.pg_locks
            where locktype='advisory' and granted and mode='ExclusiveLock' and pid=$1 and database=$2::oid
              and classid=824017::oid and objid=$3::oid and objsubid=2`, [pid, target.databaseOid, session.key]);
          requireFact(proof.rows[0]?.valid === true, "SESSION-CHALLENGE-FAILED");
          roles.push(identity);
        }
        await config.read(); requireFact(inspect() === containerIdentity, "TARGET-DRIFT");
        await assertHostOperationLockForJournal(lock, plan.inputs.journalPath);
        requireFact(!closed && !lost, "CLOSED-OR-LOST");
        return { scope: "management-time-configured-logins-only", runId: plan.inputs.runId, handoffDigest: expectedDigest,
          target: { ...target }, roles };
      } catch (error) {
        if (error instanceof RuntimeRoleSourceError || error instanceof RuntimeConnectionError) throw error;
        throw new RuntimeRoleSourceError("OBSERVATION-UNAVAILABLE");
      }
    };
    await current();
    const source = Object.freeze({ close }) as RuntimeRoleSource;
    issued.set(source, { observe: current, assertManagementSession });
    return source;
  } catch (error) {
    await close().catch(() => undefined);
    if (error instanceof RuntimeRoleSourceError || error instanceof RuntimeConnectionError) throw error;
    throw new RuntimeRoleSourceError("OPEN-UNAVAILABLE");
  }
}
