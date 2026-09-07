import type { Server } from "node:http";

/** Stop accepting HTTP before draining consumers. Pool ownership ends only
 * after every consumer and accepted request has settled, including failures. */
export function createApiShutdown(options: {
  server: Server;
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
    const drained = await Promise.allSettled([
      listener, ...options.workers.map(stop => Promise.resolve().then(stop)),
    ]);
    const pools = await Promise.allSettled(options.pools.map(close => Promise.resolve().then(close)));
    if ([...drained, ...pools].some(result => result.status === "rejected")) {
      throw new Error("PCAT-RUNTIME-API-SHUTDOWN-FAILED");
    }
  })();
}
