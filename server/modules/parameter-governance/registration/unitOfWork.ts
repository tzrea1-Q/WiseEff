import pg from "pg";

import type { Result } from "./result";

export type RegistrationUnitOfWorkClient = pg.PoolClient;

export const withRegistrationUnitOfWork = async <T, E>(
  pool: pg.Pool,
  work: (client: RegistrationUnitOfWorkClient) => Promise<Result<T, E>>,
): Promise<Result<T, E>> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    try {
      const result = await work(client);
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
    client.release();
  }
};
