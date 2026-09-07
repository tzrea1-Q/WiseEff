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
