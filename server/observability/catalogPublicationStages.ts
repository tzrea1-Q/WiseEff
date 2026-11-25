import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

type Stage =
  | "preview" | "enqueue-publication" | "activation" | "artifact-read" | "lineage-verify-decode"
  | "snapshot-read" | "snapshot-verify-decode" | "predecessor-decode"
  | "import-rules-read" | "markdown-plan" | "candidate-build" | "candidate-persist"
  | "compile" | "pointer-lock" | "publication-lock" | "materialize" | "verify-projection" | "restore-heads" | "verify-constraints" | "commit";

type Log = (fields: Record<string, string | number>) => void;
type Correlation = { requestId: string } | { jobId: string; attempt: number; fence: number };
type Trace = { correlation: Correlation; log: Log };
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

type StageCounts = { artifactCount?: number; byteCount?: number };

export async function timeCatalogStage<T>(
  stage: Stage, work: () => Promise<T> | T, counts?: (result: T) => StageCounts,
): Promise<T> {
  const trace = traces.getStore();
  if (!trace) return work();

  const started = performance.now();
  const emit = (state: "started" | "finished" | "threw", countFields?: () => StageCounts) => {
    try {
      trace.log({
        event: "catalog-stage", stage, state, ...trace.correlation,
        ...(state === "started" ? {} : { elapsedMs: Math.round(performance.now() - started) }),
        ...countFields?.(),
      });
    } catch {
      // Diagnostics must not affect execution or transaction outcomes.
    }
  };
  emit("started");
  try {
    const result = await work();
    emit("finished", counts ? () => counts(result) : undefined);
    return result;
  } catch (error) {
    emit("threw");
    throw error;
  }
}
