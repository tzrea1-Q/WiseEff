import type { createHttpServer } from "./shared/http/server";

/** Stop accepting HTTP before draining consumers. Pool ownership ends only
 * after every consumer and accepted request has settled, including failures. */
export function createApiShutdown(options: {
  server: ReturnType<typeof createHttpServer>;
  workers: readonly (() => void | Promise<void>)[];
  pools: readonly (() => Promise<void>)[];
}) {
  let closing: Promise<void> | undefined;
  return () => closing ??= (async () => {
    const listener = new Promise<void>((resolve, reject) => {
      options.server.close(error => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
    });
    const requestDrain = options.server.drainRequests().finally(() => options.server.closeIdleConnections());
    const drained = await Promise.allSettled([
      listener, requestDrain, ...options.workers.map(stop => Promise.resolve().then(stop)),
    ]);
    const requests = await Promise.allSettled([options.server.drainRequests()]);
    const pools = await Promise.allSettled(options.pools.map(close => Promise.resolve().then(close)));
    if ([...drained, ...requests, ...pools].some(result => result.status === "rejected")) {
      throw new Error("PCAT-RUNTIME-API-SHUTDOWN-FAILED");
    }
  })();
}
