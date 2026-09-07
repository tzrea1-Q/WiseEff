import { randomUUID } from "node:crypto";

/** Cleanup state shared by disposable database fixtures. Failed or unfinished
 * effects never become successful no-ops, and no retry runs automatically. */
export function createDatabaseCleanup(effect: () => Promise<void>) {
  let closed = false;
  let inFlight: Promise<void> | undefined;
  return {
    get closed() { return closed; },
    get pending() { return inFlight !== undefined; },
    close(): Promise<void> {
      if (closed) return Promise.resolve();
      if (!inFlight) {
        inFlight = Promise.resolve().then(effect).then(() => { closed = true; })
          .finally(() => { inFlight = undefined; });
      }
      return inFlight;
    },
  };
}

/** Diagnose only the fixture's existing I/O; never opens another connection. */
export function createDatabaseCleanupTrace() {
  const cleanupId = randomUUID();
  return async <T>(phase: "connect" | "drop" | "end", effect: () => Promise<T>): Promise<T> => {
    const started = performance.now();
    let reported = false;
    const report = (outcome: "pending" | "completed" | "failed") => {
      // No URL, database name, SQL, backend PID, error or cause is accepted.
      // Diagnostic output failure must not replace the actual cleanup result.
      try { console.error(JSON.stringify({ kind: "test-database-cleanup", cleanupId, phase, outcome,
        elapsedMs: Math.max(0, Math.round(performance.now() - started)) })); } catch { /* best-effort diagnostic */ }
    };
    const timer = setTimeout(() => { reported = true; report("pending"); }, 1000);
    timer.unref();
    try {
      const result = await effect();
      if (reported) report("completed");
      return result;
    } catch (error) { report("failed"); throw error; }
    finally { clearTimeout(timer); }
  };
}
