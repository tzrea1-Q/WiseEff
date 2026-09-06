import pg from "pg";

import type { Result } from "./result";
import { createProposalCatalogReadPorts, ProposalReadTargetError, readDatabaseIdentity } from "./catalogReadPorts";
import type { ProposalWriterClient } from "./repositories";

export type ProposalUnitOfWorkClient = ProposalWriterClient;

export const withProposalUnitOfWork = async <T, E>(
  pool: pg.Pool,
  work: (client: ProposalUnitOfWorkClient) => Promise<Result<T, E>>,
  readerPool?: pg.Pool,
): Promise<Result<T, E>> => {
  const client = await pool.connect();
  let reader: pg.PoolClient | undefined;
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    try {
      if (readerPool) {
        reader = await readerPool.connect();
        // READ COMMITTED deliberately observes an audit committed while the
        // writer waited for an idempotency lock. All reads stay on this session.
        await reader.query("begin isolation level read committed read only");
        if (await readDatabaseIdentity(client) !== await readDatabaseIdentity(reader)) throw new ProposalReadTargetError("read-target-mismatch");
      }
      const result = await work(reader ? { query: client.query.bind(client), reads: createProposalCatalogReadPorts(reader) } : client);
      if (!result.ok) {
        await client.query("rollback");
        return result;
      }
      await client.query("set constraints all immediate");
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    if (reader) { await reader.query("rollback").catch(() => undefined); reader.release(); }
    client.release();
  }
};
