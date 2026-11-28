import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

type Stage =
  | "preview" | "enqueue-publication" | "module-driver-publication" | "activation" | "artifact-read" | "artifact-write" | "lineage-verify-decode"
  | "activation-checkpoint-read" | "snapshot-read" | "snapshot-verify-decode" | "predecessor-decode"
  | "import-rules-read" | "markdown-plan" | "candidate-build" | "candidate-persist"
  | "compile" | "compile-append" | "pointer-lock" | "publication-lock" | "materialize" | "verify-projection" | "restore-heads" | "verify-constraints" | "commit";

type Log = (fields: Record<string, string | number>) => void;
type Correlation = { requestId: string } | { jobId: string; attempt: number; fence: number };
type Trace = { correlation: Correlation; log: Log; publication?: { candidateId: string; jobId?: string } };
const traces = new AsyncLocalStorage<Trace>();
const writeJson: Log = fields => { process.stdout.write(JSON.stringify(fields) + "\n"); };

export function withCatalogStageLogging<T>(context: Correlation, work: () => T, log: Log = writeJson): T {
  // Request IDs may come directly from an HTTP header. Preserve normal UUIDs
  // and correlate other IDs by hash without writing client-supplied text.
  const correlation = "requestId" in context && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(context.requestId)
    ? { requestId: createHash("sha256").update(context.requestId).digest("hex") }
    : context;
  return traces.run({ correlation, log }, work);
}

/** Link a persisted candidate or job to its API request once the command succeeds. */
export function linkCatalogStageToPublication(candidateId?: string, jobId?: string): void {
  const trace = traces.getStore();
  if (!trace || !("requestId" in trace.correlation) || !candidateId || !/^ccand_[a-f0-9]{16}$/.test(candidateId)) return;
  trace.publication = { candidateId };
  if (jobId && /^cjob_[a-f0-9]{16}$/.test(jobId)) trace.publication.jobId = jobId;
}

type StageCounts = { artifactCount?: number; byteCount?: number };

/** Storage errors can carry SQL and parameter values. Only emit standard error codes. */
export function logCatalogPersistenceFailure(operation: "artifact" | "candidate" | "transaction", error: unknown): void {
  const trace = traces.getStore();
  if (!trace) return;
  try {
    const fields: Record<string, string> = {};
    let cause = error;
    const seen = new Set<object>();
    while (cause && typeof cause === "object" && !seen.has(cause)) {
      seen.add(cause);
      const code = "sqlstate" in cause ? cause.sqlstate : "code" in cause ? cause.code : undefined;
      if (typeof code === "string" && ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"].includes(code)) fields.transportCode = code;
      else if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) fields.sqlstate = code;
      if ("reason" in cause && cause.reason === "artifact-too-large") fields.reason = cause.reason;
      cause = "cause" in cause ? cause.cause : undefined;
    }
    trace.log({ event: "catalog-stage", stage: "candidate-persist", state: "failed", operation, ...trace.correlation, ...fields });
  } catch {
    // The original failure belongs to the caller even if the log sink fails.
  }
}

export async function timeCatalogStage<T>(
  stage: Stage, work: () => Promise<T> | T, counts?: StageCounts | ((result: T) => StageCounts),
): Promise<T> {
  const trace = traces.getStore();
  if (!trace) return work();

  const started = performance.now();
  const emit = (state: "started" | "finished" | "threw", countFields?: () => StageCounts) => {
    try {
      trace.log({
        event: "catalog-stage", stage, state, ...trace.correlation,
        ...(state === "finished" ? trace.publication : undefined),
        ...(state === "started" ? {} : { elapsedMs: Math.round(performance.now() - started) }),
        ...countFields?.(),
      });
    } catch {
      // Diagnostics must not affect execution or transaction outcomes.
    }
  };
  const knownCounts = typeof counts === "object" ? () => counts : undefined;
  emit("started", knownCounts);
  try {
    const result = await work();
    emit("finished", typeof counts === "function" ? () => counts(result) : knownCounts);
    return result;
  } catch (error) {
    emit("threw", knownCounts);
    throw error;
  }
}
