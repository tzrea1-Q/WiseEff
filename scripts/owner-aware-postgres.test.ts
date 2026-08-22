import { describe, expect, it } from "vitest";

import {
  withOwnerAwarePostgres,
  type OwnerAwarePostgresClient,
  type OwnerAwarePostgresClientConfig,
} from "./owner-aware-postgres";

function ownerFor(controller: AbortController, remaining = 75) {
  return {
    signal: controller.signal,
    remainingMs: () => remaining,
  };
}

describe("owner-aware PostgreSQL executor", () => {
  it("aborts a half-open connection, destroys and closes the client, then propagates the deadline", async () => {
    const controller = new AbortController();
    const configs: OwnerAwarePostgresClientConfig[] = [];
    let destroyed = 0;
    let ended = 0;
    let operationCalls = 0;
    let rejectConnect: ((error: Error) => void) | undefined;
    const client: OwnerAwarePostgresClient = {
      connect: () => new Promise<void>((_resolve, reject) => { rejectConnect = reject; }),
      query: async () => ({ rows: [] }),
      destroy: () => {
        destroyed += 1;
        rejectConnect?.(new Error("connect socket destroyed"));
      },
      end: async () => { ended += 1; },
    };
    const running = withOwnerAwarePostgres(
      {
        connectionString: "postgres://owner:secret@127.0.0.1:5432/postgres",
        owner: ownerFor(controller),
        stage: "checked-absent database connect",
        createClient: (config) => {
          configs.push(config);
          return client;
        },
      },
      async () => { operationCalls += 1; },
    );
    controller.abort(new Error("Gate0 owner deadline elapsed during PostgreSQL connect."));

    await expect(running).rejects.toThrow(/deadline.*postgresql connect/i);
    expect(configs).toEqual([
      expect.objectContaining({
        connectionTimeoutMillis: 75,
        query_timeout: 75,
        statement_timeout: 75,
      }),
    ]);
    expect(operationCalls).toBe(0);
    expect(destroyed).toBe(1);
    expect(ended).toBe(1);
  });

  it("bounds a blocking cleanup query with the current owner budget and leaves no unsettled client", async () => {
    const controller = new AbortController();
    let destroyed = 0;
    let ended = 0;
    let rejectQuery: ((error: Error) => void) | undefined;
    const queries: Array<{ text: string; values?: readonly unknown[]; query_timeout?: number }> = [];
    const client: OwnerAwarePostgresClient = {
      connect: async () => undefined,
      query: (query) => {
        queries.push(query);
        return new Promise((_resolve, reject) => { rejectQuery = reject; });
      },
      destroy: () => {
        destroyed += 1;
        rejectQuery?.(new Error("query socket destroyed"));
      },
      end: async () => { ended += 1; },
    };
    const running = withOwnerAwarePostgres(
      {
        connectionString: "postgres://owner:secret@127.0.0.1:5432/postgres",
        owner: ownerFor(controller, 42),
        stage: "exact database cleanup",
        createClient: () => client,
      },
      (session) => session.query("drop database wiseeff_acceptance_full_red with (force)", [], "cleanup query"),
    );
    await Promise.resolve();
    controller.abort(new Error("Gate0 owner deadline elapsed during PostgreSQL cleanup."));

    await expect(running).rejects.toThrow(/deadline.*postgresql cleanup/i);
    expect(queries).toEqual([
      expect.objectContaining({
        text: "drop database wiseeff_acceptance_full_red with (force)",
        query_timeout: 42,
      }),
    ]);
    expect(destroyed).toBe(1);
    expect(ended).toBe(1);
  });
});
