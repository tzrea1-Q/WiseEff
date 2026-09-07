import type { createHttpServer } from "./shared/http/server";

/** Stop accepting HTTP before draining consumers. Pool ownership ends only
 * after every consumer and accepted request has settled, including failures. */
export function createApiShutdown(options: {
  server: ReturnType<typeof createHttpServer> | (() => ReturnType<typeof createHttpServer> | undefined);
  workers: readonly (() => void | Promise<void>)[];
  pools: readonly (() => Promise<void>)[];
}) {
  let closing: Promise<void> | undefined;
  return () => closing ??= (async () => {
    const server = typeof options.server === "function" ? options.server() : options.server;
    const listener = new Promise<void>((resolve, reject) => {
      if (!server) { resolve(); return; }
      server.close(error => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
    });
    const requestDrain = server?.drainRequests().finally(() => server.closeIdleConnections());
    const drained = await Promise.allSettled([
      listener, requestDrain, ...options.workers.map(stop => Promise.resolve().then(stop)),
    ]);
    const requests = await Promise.allSettled([server?.drainRequests()]);
    const pools = await Promise.allSettled(options.pools.map(close => Promise.resolve().then(close)));
    if ([...drained, ...requests, ...pools].some(result => result.status === "rejected")) {
      throw new Error("PCAT-RUNTIME-API-SHUTDOWN-FAILED");
    }
  })();
}
