import { expect, it } from "vitest";
import { compareCiOutcomes, type CiCohort, type CiObservation } from "./ci-outcomes";

const cohort: CiCohort = { kind: "full-acceptance-pr", coverage: "full-v1", runner: "ubuntu", topology: "backend2-quality4-native4", cache: "warm" };
const stamp = (seconds: number) => new Date(Date.UTC(2026, 9, 15) + seconds * 1000).toISOString();
const run = (seconds: number, overrides: Partial<CiObservation> = {}): CiObservation => ({
  cohort, conclusion: "success", createdAt: stamp(0), requiredCompletedAt: stamp(seconds),
  jobs: [{ startedAt: stamp(2), completedAt: stamp(seconds), conclusion: "success", required: true }],
  ...overrides
});

it("keeps overlapping runner attempts, failures and cancellations separate from successful gate wall time", () => {
  const observed = compareCiOutcomes(cohort, [], [run(20, { jobs: [
    { startedAt: stamp(2), completedAt: stamp(12), conclusion: "failure", required: true },
    { startedAt: stamp(2), completedAt: stamp(20), conclusion: "success", required: true },
    { startedAt: stamp(12), completedAt: stamp(18), conclusion: "success", required: true },
    { startedAt: null, completedAt: null, conclusion: "skipped", required: false }
  ] }), run(5, { conclusion: "cancelled" }), run(7, { conclusion: "failure" })]);
  expect(observed.after).toMatchObject({ runs: 3, successfulTimedRuns: 1, runnerSeconds: 42, cancelledKnownJobSeconds: 3 });
  expect(observed.after.greenSeconds).toEqual([20]);
  expect(observed.after.executionSeconds).toEqual([18]);
  expect(observed.greenMedian).toBeNull();
  expect(observed.greenP95).toBeNull();
});

it("retains cancelled and explicitly replaced attempt cost inside a surviving run without double counting", () => {
  const jobs: CiObservation["jobs"] = [
    { startedAt: stamp(0), completedAt: stamp(30), conclusion: "cancelled", required: true },
    { startedAt: stamp(30), completedAt: stamp(100), conclusion: "success", required: true }
  ];
  expect(compareCiOutcomes(cohort, [], [run(100, { jobs })]).after)
    .toMatchObject({ runnerSeconds: 100, cancelledKnownJobSeconds: 30 });
  expect(compareCiOutcomes(cohort, [], [run(100, { conclusion: "cancelled", jobs })]).after)
    .toMatchObject({ runnerSeconds: 100, cancelledKnownJobSeconds: 100 });
  const replaced = [{ ...jobs[0]!, conclusion: "success" as const, replaced: true }, jobs[1]!];
  expect(compareCiOutcomes(cohort, [], [run(100, { jobs: replaced })]).after)
    .toMatchObject({ runnerSeconds: 100, cancelledKnownJobSeconds: 30, cancelledJobSeconds: 30 });
  expect(compareCiOutcomes(cohort, [], [run(100, { jobs: [{ ...replaced[0]!, completedAt: null }, replaced[1]!] })]).after)
    .toMatchObject({ runnerSeconds: null, cancelledKnownJobSeconds: 0, cancelledJobSeconds: null, knownJobSeconds: 70 });
});

it("requires five matched observations on both sides for medians and twenty for nearest-rank P95", () => {
  const before = Array.from({ length: 20 }, (_, index) => run((index + 1) * 10));
  const after = Array.from({ length: 20 }, (_, index) => run((index + 1) * 11));
  expect(compareCiOutcomes(cohort, before.slice(0, 4), after).greenMedian).toBeNull();
  expect(compareCiOutcomes(cohort, before, after.slice(0, 4)).runnerMedian).toBeNull();
  expect(compareCiOutcomes(cohort, [...before.slice(0, 4), run(20, { conclusion: "failure" })], after).runnerMedian).toBeNull();
  expect(compareCiOutcomes(cohort, before.slice(0, 19), after).greenP95).toBeNull();
  expect(compareCiOutcomes(cohort, before, after.slice(0, 19)).greenP95).toBeNull();
  const observed = compareCiOutcomes(cohort, before, after);
  expect(observed.greenMedian).toEqual({ beforeSeconds: 105, afterSeconds: 115.5, deltaSeconds: 10.5, percentChange: 10 });
  expect(observed.greenP95).toEqual({ beforeSeconds: 190, afterSeconds: 209, deltaSeconds: 19, percentChange: 10 });
  expect(observed.runnerMedian).toMatchObject({ beforeSeconds: 103, afterSeconds: 113.5, deltaSeconds: 10.5 });
  const five = compareCiOutcomes(cohort, before.slice(0, 5), after.slice(0, 5));
  expect(five.greenMedian).toMatchObject({ beforeSeconds: 30, afterSeconds: 33 });
});

it("separates coverage, event, runner, topology and cache cohorts instead of pooling faster runs", () => {
  const baseline = Array.from({ length: 5 }, () => run(20));
  const others: CiObservation[] = [
    { kind: "ordinary-pr" as const }, { coverage: "docs-only" }, { runner: "macos" },
    { topology: "native1" }, { cache: "cold" as const }
  ].map((difference) => run(3, { cohort: { ...cohort, ...difference } }));
  const observed = compareCiOutcomes(cohort, [...baseline, ...others], [...baseline, ...others]);
  expect(observed.before).toMatchObject({ runs: 5, excludedRuns: 5, runnerSeconds: 90 });
  expect(observed.greenMedian).toMatchObject({ beforeSeconds: 20, afterSeconds: 20 });
  const unknown = { ...cohort, cache: "unknown" as const };
  const unclassified = Array.from({ length: 20 }, () => run(20, { cohort: unknown }));
  expect(compareCiOutcomes(unknown, unclassified, unclassified)).toMatchObject({ comparable: false, greenMedian: null, greenP95: null, runnerMedian: null });
});

it("keeps missing or invalid timestamps and absent jobs unknown, including epoch-zero timestamps", () => {
  const baseline = Array.from({ length: 5 }, () => run(10));
  const incomplete = run(10, { createdAt: null, jobs: [{ startedAt: stamp(2), completedAt: null, conclusion: "cancelled", required: true }] });
  const observed = compareCiOutcomes(cohort, baseline, [...baseline.slice(0, 4), incomplete]);
  expect(observed.after).toMatchObject({ successfulTimedRuns: 4, runnerSeconds: null, knownJobSeconds: 32, unknownCostRuns: 1 });
  expect(observed.greenMedian).toBeNull();
  expect(observed.runnerMedian).toBeNull();
  for (const invalid of [run(10, { jobs: [] }), run(10, { requiredCompletedAt: "unknown" }), run(1)]) {
    const result = compareCiOutcomes(cohort, [], [invalid]);
    expect(result.after.successfulTimedRuns).toBe(0);
  }
  const epoch = "1970-01-01T00:00:00.000Z";
  const zero = run(0, { createdAt: epoch, requiredCompletedAt: epoch,
    jobs: [{ startedAt: epoch, completedAt: epoch, conclusion: "success", required: true }] });
  expect(compareCiOutcomes(cohort, Array(5).fill(zero), Array(5).fill(zero)).greenMedian)
    .toEqual({ beforeSeconds: 0, afterSeconds: 0, deltaSeconds: 0, percentChange: null });
});

it.each(["success", "cancelled"] as const)("keeps cancelled cost unknown when a %s run has no job inventory", (conclusion) => {
  expect(compareCiOutcomes(cohort, [], [run(100, { conclusion, jobs: [] })]).after)
    .toMatchObject({ runnerSeconds: null, unknownCostRuns: 1, knownJobSeconds: 0, cancelledKnownJobSeconds: 0, cancelledJobSeconds: null });
});
