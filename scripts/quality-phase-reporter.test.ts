import { expect, it } from "vitest";
import type { TestCase, TestResult, TestStep } from "playwright/reporter";
import QualityPhaseReporter from "../e2e/quality/phase-reporter";

it("attaches per-attempt phase timings, including failed phases, without counting nested steps twice", () => {
  const step = (title: string, duration: number, steps: TestStep[] = [], failed = false) =>
    ({ title, duration, steps, error: failed ? { message: "not ready" } : undefined }) as TestStep;
  const result = {
    retry: 1, status: "failed", duration: 200, attachments: [],
    steps: [
      step("Before Hooks", 80, [step("quality:navigation", 30), step("quality:readiness", 50, [step("quality:readiness", 20)])]),
      step("quality:axe", 60), step("quality:capture", 40), step("quality:readiness", 20, [], true),
      step("unrelated action", 500)
    ]
  } as unknown as TestResult;
  const reporter = new QualityPhaseReporter();
  reporter.onTestEnd({} as TestCase, result);
  expect(result.attachments).toHaveLength(1);
  expect(result.attachments[0].name).toBe("quality-phase-timings");
  expect(JSON.parse(result.attachments[0].body!.toString())).toEqual({
    retry: 1, status: "failed", durationMs: 200,
    totalsMs: { navigation: 30, readiness: 70, axe: 60, capture: 40 },
    phases: [
      { phase: "navigation", durationMs: 30, failed: false },
      { phase: "readiness", durationMs: 50, failed: false },
      { phase: "axe", durationMs: 60, failed: false },
      { phase: "capture", durationMs: 40, failed: false },
      { phase: "readiness", durationMs: 20, failed: true }
    ]
  });
  const next = { retry: 0, status: "passed", duration: 5, steps: [], attachments: [] } as unknown as TestResult;
  reporter.onTestEnd({} as TestCase, next);
  expect(JSON.parse(next.attachments[0].body!.toString()).totalsMs).toEqual({ navigation: 0, readiness: 0, axe: 0, capture: 0 });
});
