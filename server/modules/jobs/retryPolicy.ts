export type RetryDecision =
  | { action: "retry"; nextRunAt: string; reason: string }
  | { action: "dead-letter"; reason: string };

export function decideRetry(input: {
  attemptCount: number;
  maxAttempts: number;
  baseDelayMs: number;
  now: Date;
}): RetryDecision {
  if (input.attemptCount >= input.maxAttempts) {
    return { action: "dead-letter", reason: `Job exhausted ${input.maxAttempts} attempts.` };
  }

  const nextAttempt = input.attemptCount + 1;
  const delayMs = input.baseDelayMs * 2 ** input.attemptCount;

  return {
    action: "retry",
    nextRunAt: new Date(input.now.getTime() + delayMs).toISOString(),
    reason: `Retry ${nextAttempt} of ${input.maxAttempts} after ${delayMs}ms.`
  };
}
