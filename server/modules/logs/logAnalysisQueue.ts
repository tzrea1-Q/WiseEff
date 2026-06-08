import type { DurableQueue } from "../jobs/queuePort";

export type LogAnalysisQueuePayload = {
  organizationId: string;
  projectId: string;
  logId: string;
  runId: string;
  jobId: string;
};

export type LogAnalysisQueue = Pick<DurableQueue<LogAnalysisQueuePayload>, "enqueue">;

export async function enqueueLogAnalysisJob(
  queue: LogAnalysisQueue | undefined,
  payload: LogAnalysisQueuePayload
) {
  if (!queue) return null;

  return queue.enqueue({
    name: "analyze-log",
    payload,
    idempotencyKey: `log-analysis:${payload.jobId}`
  });
}
