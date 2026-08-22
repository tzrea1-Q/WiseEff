import pg from "pg";

export type OwnerAwarePostgresDeadline = {
  signal: AbortSignal;
  remainingMs(stage: string): number;
};

export type OwnerAwarePostgresClientConfig = {
  connectionString: string;
  connectionTimeoutMillis: number;
  query_timeout: number;
  statement_timeout: number;
};

export type OwnerAwarePostgresQuery = {
  text: string;
  values?: readonly unknown[];
  query_timeout?: number;
};

export type OwnerAwarePostgresQueryResult<Row = Record<string, unknown>> = {
  rows: Row[];
  rowCount?: number | null;
};

export type OwnerAwarePostgresClient = {
  connect(): Promise<void>;
  query<Row = Record<string, unknown>>(
    query: OwnerAwarePostgresQuery,
  ): Promise<OwnerAwarePostgresQueryResult<Row>>;
  end(): Promise<void>;
  destroy(error: Error): void;
};

export type OwnerAwarePostgresSession = {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
    stage?: string,
  ): Promise<OwnerAwarePostgresQueryResult<Row>>;
};

export type WithOwnerAwarePostgresOptions = {
  connectionString: string;
  owner?: OwnerAwarePostgresDeadline;
  stage: string;
  createClient?: (config: OwnerAwarePostgresClientConfig) => OwnerAwarePostgresClient;
};

const standaloneTimeoutMs = 30_000;

/**
 * Owns one bounded PostgreSQL client from connect through close. The supplied
 * Gate0 deadline is the authority for connection, statement, and per-query
 * timeouts; abort destroys the socket and settles close before propagation.
 */
export async function withOwnerAwarePostgres<T>(
  options: WithOwnerAwarePostgresOptions,
  operation: (session: OwnerAwarePostgresSession) => Promise<T>,
): Promise<T> {
  const local = options.owner ? undefined : createStandaloneDeadline(standaloneTimeoutMs);
  const owner = options.owner ?? local!.owner;
  const initialBudget = boundedTimeout(owner.remainingMs(`${options.stage}: connect`));
  const client = (options.createClient ?? createNodePostgresClient)({
    connectionString: options.connectionString,
    connectionTimeoutMillis: initialBudget,
    query_timeout: initialBudget,
    statement_timeout: initialBudget,
  });
  let closePromise: Promise<void> | undefined;
  let destroyed = false;
  const close = (reason?: Error) => {
    let destroyError: Error | undefined;
    if (reason && !destroyed) {
      destroyed = true;
      try {
        client.destroy(reason);
      } catch (error) {
        destroyError = asError(error);
      }
    }
    closePromise ??= Promise.resolve().then(() => client.end());
    if (destroyError) {
      closePromise = closePromise.then(
        () => { throw destroyError; },
        (endError) => { throw new AggregateError([destroyError, asError(endError)], "PostgreSQL destroy and close failed."); },
      );
    }
    return closePromise;
  };
  let removeAbortListener: () => void = () => undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const abort = () => {
      const reason = owner.signal.reason instanceof Error
        ? owner.signal.reason
        : new Error(`Gate0 owner aborted PostgreSQL stage ${options.stage}.`);
      void close(reason).then(
        () => reject(reason),
        (closeError) => reject(new AggregateError(
          [reason, asError(closeError)],
          `${reason.message} PostgreSQL abort cleanup failed.`,
        )),
      );
    };
    owner.signal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => owner.signal.removeEventListener("abort", abort);
    if (owner.signal.aborted) abort();
  });
  const raceOwner = async <Result>(promise: Promise<Result>) => {
    try {
      return await Promise.race([promise, abortPromise]);
    } catch (error) {
      if (owner.signal.aborted) return abortPromise;
      throw error;
    }
  };

  let value: T | undefined;
  let primaryError: Error | undefined;
  try {
    await raceOwner(client.connect());
    value = await operation({
      query: async <Row = Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
        stage = "query",
      ) => {
        const queryBudget = boundedTimeout(owner.remainingMs(`${options.stage}: ${stage}`));
        return raceOwner(client.query<Row>({ text, values, query_timeout: queryBudget }));
      },
    });
  } catch (error) {
    primaryError = asError(error);
  }

  let closeError: Error | undefined;
  try {
    await Promise.race([close(), abortPromise]);
  } catch (error) {
    closeError = asError(error);
  } finally {
    removeAbortListener();
    local?.dispose();
  }

  if (primaryError && closeError && primaryError !== closeError) {
    throw new AggregateError([primaryError, closeError], `PostgreSQL stage ${options.stage} and client close both failed.`);
  }
  if (primaryError) throw primaryError;
  if (closeError) throw closeError;
  return value as T;
}

function createNodePostgresClient(config: OwnerAwarePostgresClientConfig): OwnerAwarePostgresClient {
  const client = new pg.Client(config);
  return {
    connect: () => client.connect().then(() => undefined),
    query: async <Row = Record<string, unknown>>(query: OwnerAwarePostgresQuery) =>
      client.query(query as pg.QueryConfig) as unknown as OwnerAwarePostgresQueryResult<Row>,
    end: () => client.end(),
    destroy: (error) => {
      const stream = (client as unknown as { connection?: { stream?: { destroy(error?: Error): void } } })
        .connection?.stream;
      stream?.destroy(error);
    },
  };
}

function createStandaloneDeadline(timeoutMs: number) {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timer = setTimeout(
    () => controller.abort(new Error("Standalone owned PostgreSQL deadline elapsed.")),
    timeoutMs,
  );
  timer.unref();
  return {
    owner: {
      signal: controller.signal,
      remainingMs(stage: string) {
        const remaining = deadlineAt - Date.now();
        if (controller.signal.aborted || remaining <= 0) {
          throw new Error(`Standalone owned PostgreSQL deadline elapsed before ${stage}.`);
        }
        return remaining;
      },
    },
    dispose: () => clearTimeout(timer),
  };
}

function boundedTimeout(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error("PostgreSQL owner budget must be positive.");
  return Math.max(1, Math.min(Math.floor(value), 2_147_483_647));
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}
