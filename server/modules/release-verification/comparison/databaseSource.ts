import { randomInt } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import { createPostgresDatabase, getRootPostgresPool, type Database, type Queryable, type RootDatabase } from "../../../shared/database/client";
import { readBindingDatabaseIdentity } from "../../catalog-cutover/bindingImportProducer";
import { readComparisonMappingFactsOnHeldSession } from "../../catalog-cutover/activation";
import { corpusRefusal } from "./errors";

type Source = {
  readonly managementClient: pg.PoolClient;
  readonly target: { readonly systemIdentifier: string; readonly databaseOid: string };
  readonly cutoverRunId: string;
  readonly planPin: string;
  readonly verifyBoundary: () => Promise<void>;
};
const issued = new WeakMap<Database, Source & { readonly pool: pg.Pool; readonly alive: () => boolean }>();
const refuse = (): never => { throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "comparison database source unavailable"); };

/** Assert only this owner's actual roots. There is no registration operation
 * for a caller's existing root, pool, socket or JSON identity. */
export function assertComparisonDatabaseSource(input: Source & { readonly database: Database; readonly pool: pg.Pool }): void {
  const source = issued.get(input.database);
  if (!source || !source.alive() || source.pool !== input.pool || getRootPostgresPool(input.database) !== input.pool ||
    source.managementClient !== input.managementClient || source.verifyBoundary !== input.verifyBoundary ||
    source.cutoverRunId !== input.cutoverRunId || source.planPin !== input.planPin ||
    !isDeepStrictEqual(source.target, input.target)) refuse();
}

/** Management-period source for the existing comparison collector. The ops
 * owner retains its original configuration FDs and host/source boundary.
 * This creates its own root; it cannot approve runtime, P12 or a report. */
export async function openComparisonDatabaseV2(input: Source & { readonly connectionString: string }) {
  const { managementClient: manager, cutoverRunId, planPin, verifyBoundary } = input;
  const target = structuredClone(input.target);
  let url: URL;
  try {
    url = new URL(input.connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1" || !url.port ||
      url.search || url.hash || !url.username || !url.password || !/^\/[a-zA-Z0-9_-]+$/u.test(url.pathname)) refuse();
    decodeURIComponent(url.username); decodeURIComponent(url.password);
  } catch { return refuse(); }
  let closed = false, lost = false, closing: Promise<void> | undefined;
  let database: RootDatabase | undefined, pool: pg.Pool | undefined;
  const clients = new Set<pg.PoolClient & pg.Client>();
  const ended = new WeakSet<pg.Client>();
  const ending = new Map<pg.Client, Promise<void>>();
  const verifications = new Set<Promise<void>>();
  let cancel!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "comparison database source closed"));
  });
  void cancelled.catch(() => undefined);
  const onLoss = () => { lost = true; cancel(); };
  const end = (client: pg.Client) => {
    if (!ending.has(client)) ending.set(client, ended.has(client) ? Promise.resolve() : Promise.resolve().then(() => client.end()));
    return ending.get(client)!;
  };
  if (!(manager instanceof pg.Client)) return refuse();
  const stream = manager.connection.stream;
  const peer = (client: pg.Client, expectedStream: unknown = client.connection.stream) => {
    const actual = client.connection.stream;
    if (actual !== expectedStream || !(actual instanceof Socket) || actual instanceof TLSSocket || actual.destroyed ||
      actual.remoteAddress !== "127.0.0.1" || String(actual.remotePort) !== url.port) refuse();
  };
  const live = () => {
    if (closed || lost || !(manager instanceof pg.Client)) refuse();
    peer(manager, stream);
  };
  const observe = (client: pg.PoolClient) => {
    if (!(client instanceof pg.Client)) { onLoss(); return; }
    clients.add(client);
    client.on("error", onLoss);
    client.once("end", () => { ended.add(client); if (!closed) onLoss(); });
    if (closed) void end(client).catch(onLoss);
  };
  manager.on("error", onLoss); manager.on("end", onLoss);
  const close = () => closing ??= (async () => {
    closed = true;
    cancel();
    if (database) issued.delete(database);
    // Begin pool shutdown now, so it cannot acquire another caller lease.
    // Its promise alone is insufficient: pg can remove a client before that
    // client's native end completes, so we await all native ends separately.
    const rootClosing = database?.close() ?? Promise.resolve();
    for (const client of clients) void end(client).catch(onLoss);
    const results = await Promise.allSettled([rootClosing, ...verifications]);
    const nativeResults = await Promise.allSettled([...ending.values()]);
    for (const client of clients) client.off("error", onLoss);
    pool?.off("connect", observe); pool?.off("error", onLoss);
    manager.off("error", onLoss); manager.off("end", onLoss);
    // Checkout cancellation is delivered to its original caller. Only failed
    // resource shutdown makes close itself fail.
    if (results[0]?.status === "rejected" || nativeResults.some(result => result.status === "rejected")) refuse();
  })();
  try {
    live();
    await readComparisonMappingFactsOnHeldSession({ client: manager, target, runId: cutoverRunId, planDigest: planPin, verifyBoundary });
    const challenge = randomInt(1, 2147483647);
    const owner = (await manager.query<{ pid: number; username: string; database: string }>(`select pg_catalog.pg_backend_pid() as pid,
      session_user as username,pg_catalog.current_database() as database,pg_catalog.pg_advisory_xact_lock(824014,$1)`, [challenge])).rows[0];
    if (!owner || !Number.isSafeInteger(owner.pid) || owner.username !== decodeURIComponent(url.username) || owner.database !== url.pathname.slice(1)) refuse();
    await verifyBoundary(); live();
    const verify = async (session: Queryable) => {
      live(); await verifyBoundary(); live();
      const current = (await session.query<{ pid: number; username: string; same_identity: boolean; schemas: string[]; held: boolean }>(`select
        pg_catalog.pg_backend_pid() as pid,session_user as username,session_user=current_user as same_identity,
        pg_catalog.current_schemas(true)::text[] as schemas,
        exists(select 1 from pg_catalog.pg_locks where pid=$1 and database=$2::oid and locktype='advisory'
          and mode='ExclusiveLock' and granted and classid=824014::oid and objid=$3::oid and objsubid=2) as held`,
      [owner.pid, target.databaseOid, challenge])).rows[0];
      const native = [...clients].filter(client => !ended.has(client) && Reflect.get(client, "processID") === current?.pid);
      if (!current || native.length !== 1 || !current.same_identity || current.username !== owner.username ||
        current.schemas[0] !== "pg_catalog" || !current.held) refuse();
      peer(native[0]!);
      if (!isDeepStrictEqual(await readBindingDatabaseIdentity(native[0]!), target)) refuse();
      await verifyBoundary(); live(); peer(native[0]!);
    };
    database = createPostgresDatabase(url.href, { verifyCheckout: session => {
      const verification = Promise.race([verify(session), cancelled]).catch(() => { lost = true; return refuse(); });
      verifications.add(verification);
      void verification.then(() => verifications.delete(verification), () => verifications.delete(verification));
      return verification;
    } });
    const actualPool = getRootPostgresPool(database);
    if (!actualPool) return refuse();
    pool = actualPool;
    // Both root.query and Kernel-owned transactions go through this actual
    // pool. Observe native clients before its first connection can start.
    actualPool.on("connect", observe); actualPool.on("error", onLoss);
    await database.query("select 1");
    live();
    issued.set(database, { managementClient: manager, target, cutoverRunId, planPin, verifyBoundary, pool: actualPool,
      alive: () => !closed && !lost });
    return { database, pool: actualPool, close };
  } catch {
    try { await close(); } catch { /* retain the static original refusal */ }
    return refuse();
  }
}
