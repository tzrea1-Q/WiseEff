export type CiCohort = {
  kind: "ordinary-pr" | "full-acceptance-pr" | "main" | "nightly";
  coverage: string;
  runner: string;
  topology: string;
  cache: "warm" | "cold" | "unknown";
};

export type CiObservation = {
  cohort: CiCohort;
  conclusion: "success" | "failure" | "cancelled";
  createdAt: string | null;
  requiredCompletedAt: string | null;
  // Include every job attempt, including failed/replaced attempts; do not deduplicate by job name.
  jobs: readonly {
    startedAt: string | null;
    completedAt: string | null;
    conclusion: "success" | "failure" | "cancelled" | "skipped" | null;
    required: boolean;
    /** Explicit provenance when a later attempt replaced this job; never infer from its name. */
    replaced?: boolean;
  }[];
};

type MetricDelta = { beforeSeconds: number; afterSeconds: number; deltaSeconds: number; percentChange: number | null };

function timestamp(value: string | null) {
  return value === null || !Number.isFinite(Date.parse(value)) ? null : Date.parse(value);
}

function seconds(start: string | null, end: string | null) {
  const from = timestamp(start), to = timestamp(end);
  return from === null || to === null || to < from ? null : (to - from) / 1000;
}

function summarize(runs: readonly CiObservation[]) {
  const greenSeconds: number[] = [], executionSeconds: number[] = [], runnerSamples: number[] = [];
  let knownJobSeconds = 0, cancelledKnownJobSeconds = 0, unknownCostRuns = 0, unknownCancelledJobs = 0;
  for (const run of runs) {
    const jobs = run.jobs.filter((job) => job.conclusion !== "skipped");
    const durations = jobs.map((job) => seconds(job.startedAt, job.completedAt));
    const known = durations.reduce<number>((sum, duration) => sum + (duration ?? 0), 0);
    knownJobSeconds += known;
    jobs.forEach((job, index) => {
      if (run.conclusion !== "cancelled" && job.conclusion !== "cancelled" && !job.replaced) return;
      const duration = durations[index];
      if (duration === null || duration === undefined) unknownCancelledJobs++;
      else cancelledKnownJobSeconds += duration;
    });
    if (jobs.length === 0 || durations.includes(null)) unknownCostRuns++;
    else runnerSamples.push(known);
    if (run.conclusion !== "success") continue;
    const gate = seconds(run.createdAt, run.requiredCompletedAt);
    const starts = jobs.filter((job) => job.required).map((job) => timestamp(job.startedAt));
    if (gate === null || starts.length === 0 || starts.includes(null)) continue;
    const completed = timestamp(run.requiredCompletedAt)!;
    const first = Math.min(...starts as number[]);
    if (completed < first || first < timestamp(run.createdAt)!) continue;
    greenSeconds.push(gate);
    executionSeconds.push((completed - first) / 1000);
  }
  return { runs: runs.length, successfulTimedRuns: greenSeconds.length, greenSeconds, executionSeconds,
    runnerSamples, knownJobSeconds, cancelledKnownJobSeconds, unknownCostRuns,
    cancelledJobSeconds: unknownCancelledJobs ? null : cancelledKnownJobSeconds,
    runnerSeconds: unknownCostRuns ? null : knownJobSeconds };
}

function compare(before: number[], after: number[], minimum: number, p95 = false): MetricDelta | null {
  if (before.length < minimum || after.length < minimum) return null;
  const measure = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    if (p95) return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const from = measure(before), to = measure(after), delta = to - from;
  return { beforeSeconds: from, afterSeconds: to, deltaSeconds: delta, percentChange: from === 0 ? null : delta / from * 100 };
}

/** Pure arithmetic over supplied observations; this neither collects evidence nor establishes acceptance. */
export function compareCiOutcomes(cohort: CiCohort, beforeRuns: readonly CiObservation[], afterRuns: readonly CiObservation[]) {
  const keys = ["kind", "coverage", "runner", "topology", "cache"] as const;
  const comparable = keys.every((key) => cohort[key].trim() !== "" && cohort[key] !== "unknown");
  const select = (runs: readonly CiObservation[]) => {
    const matches = runs.filter((run) => keys.every((key) => run.cohort[key] === cohort[key]));
    return { ...summarize(matches), excludedRuns: runs.length - matches.length };
  };
  const before = select(beforeRuns), after = select(afterRuns);
  return { comparable, before, after,
    greenMedian: comparable ? compare(before.greenSeconds, after.greenSeconds, 5) : null,
    greenP95: comparable ? compare(before.greenSeconds, after.greenSeconds, 20, true) : null,
    runnerMedian: !comparable || before.unknownCostRuns || after.unknownCostRuns || before.successfulTimedRuns < 5 || after.successfulTimedRuns < 5
      ? null : compare(before.runnerSamples, after.runnerSamples, 5) };
}
