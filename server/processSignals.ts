export class ProcessInitializationStopped extends Error {
  constructor() { super("PCAT-RUNTIME-INITIALIZATION-STOPPED"); }
}
export function assertProcessInitializing(signal?: AbortSignal) {
  if (signal?.aborted) throw new ProcessInitializationStopped();
}

/** Own process signals while initialization and resource draining settle. */
export async function runProcessWithSignals(options: {
  initialize(signal: AbortSignal, stop: () => Promise<void>): Promise<void>;
  shutdown(): Promise<void>;
  failureCode: string;
}) {
  const abort = new AbortController();
  let initialized!: () => void;
  const settled = new Promise<void>(resolve => { initialized = resolve; });
  let closing: Promise<void> | undefined;
  const stop = () => closing ??= (async () => {
    abort.abort();
    // An allocation already in flight must publish its resource before drain.
    await settled;
    try { await options.shutdown(); }
    finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  })();
  const onSignal = () => { void stop().catch(() => {
    console.error(options.failureCode); process.exitCode = 1;
  }); };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try { await options.initialize(abort.signal, stop); }
  catch (error) {
    initialized();
    await stop().catch(() => undefined);
    if (error instanceof ProcessInitializationStopped && abort.signal.aborted) return { stop };
    throw error;
  }
  initialized();
  if (abort.signal.aborted) await stop();
  return { stop };
}
