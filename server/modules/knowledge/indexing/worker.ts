import type { Database } from "../../../shared/database/client";
import type { KnowledgeEmbeddingClient } from "./embeddingClient";
import { claimNextIndexJob, markIndexOutcome } from "./repository";
import { indexKnowledgeEntry } from "./service";

export type KnowledgeIndexWorkerOptions = {
  db: Database;
  embeddingClient?: KnowledgeEmbeddingClient;
};

/**
 * Claims and processes one queued index refresh. Mirrors the log-analysis
 * polling worker seam: in-process by default, queue-ready by construction
 * (the claim uses FOR UPDATE SKIP LOCKED, so multiple workers are safe).
 */
export async function processNextKnowledgeIndexJob(
  options: KnowledgeIndexWorkerOptions
): Promise<"processed" | "idle"> {
  const claimed = await claimNextIndexJob(options.db);
  if (!claimed) {
    return "idle";
  }

  try {
    await indexKnowledgeEntry(options.db, {
      entryId: claimed.entryId,
      organizationId: claimed.organizationId,
      embeddingClient: options.embeddingClient
    });
  } catch (error) {
    // indexKnowledgeEntry records expected failures itself; this catch keeps
    // unexpected errors (connection loss mid-write, etc.) honest in the queue.
    await markIndexOutcome(options.db, {
      entryId: claimed.entryId,
      organizationId: claimed.organizationId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
  }
  return "processed";
}

export function startKnowledgeIndexWorkerLoop(
  options: KnowledgeIndexWorkerOptions,
  intervalMs = 1000
): () => void {
  let stopped = false;
  let running = false;

  const tick = () => {
    if (stopped || running) return;
    running = true;
    void processNextKnowledgeIndexJob(options)
      .catch(() => {
        // Loop-level failures (e.g. transient connection errors) must not kill the interval.
      })
      .finally(() => {
        running = false;
      });
  };

  const interval = setInterval(tick, intervalMs);
  tick();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
