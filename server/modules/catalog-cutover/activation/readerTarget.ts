import { randomInt } from "node:crypto";
import type pg from "pg";
import type { Queryable } from "../../../shared/database/client";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { digestOf } from "../../release-verification/core/digest";
import { ActivationRefusal } from "./interface";
import { assertDedicatedCatalogReader } from "./readerAuthorization";

/** A live connection challenge, not a maintenance/approval lock. The reader does
 * not gain pg_control_system or any new metadata grant. Its random session lock
 * must be independently visible at the already identified management database.
 * PUBLIC pg_locks reveals lock identity, without reading another session's SQL.
 */
export async function verifyCatalogReaderSession(management: pg.PoolClient, reader: Queryable, expected: BindingDatabaseIdentity): Promise<void> {
  if (digestOf(await readBindingDatabaseIdentity(management)) !== digestOf(expected)) throw new ActivationRefusal("target-mismatch");
  const key = randomInt(1, 2 ** 31 - 1);
  const namespace = 1346584914;
  let held = false; let closeUnknown = false; let primary: ActivationRefusal | undefined;
  try {
    await assertDedicatedCatalogReader(reader);
    const probe = (await reader.query<{ pid: number; held: boolean }>("select pg_backend_pid() as pid,pg_try_advisory_lock($1::int,$2::int) as held", [namespace, key])).rows[0];
    held = probe?.held === true;
    if (!held) throw new ActivationRefusal("reader-challenge-unavailable");
    const visible = (await management.query<{ count: number }>(`select count(*)::int as count from pg_catalog.pg_locks
      where locktype='advisory' and pid=$1 and database=$2::oid and classid=$3::oid and objid=$4::oid
        and objsubid=2 and granted and mode='ExclusiveLock'`, [probe.pid, expected.databaseOid, namespace, key])).rows[0];
    if (visible?.count !== 1) throw new ActivationRefusal("catalog-reader-target-mismatch");
  } catch (error) {
    primary = error instanceof ActivationRefusal ? error : new ActivationRefusal("reader-challenge-failed");
    throw primary;
  } finally {
    if (held) {
      try {
        const released = (await reader.query<{ released: boolean }>("select pg_advisory_unlock($1::int,$2::int) as released", [namespace, key])).rows[0]?.released;
        if (released !== true) closeUnknown = true;
      } catch { closeUnknown = true; }
    }
    // The foundation hook destroys this exact checkout on any rejection.
    // Preserve the original admission refusal if cleanup also fails.
    if (closeUnknown) throw primary ?? new ActivationRefusal("reader-challenge-close-unknown");
  }
}
