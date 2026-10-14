import type { Reporter, TestCase, TestResult, TestStep } from "playwright/reporter";

export default class QualityPhaseReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult) {
    const totalsMs = { navigation: 0, readiness: 0, axe: 0, capture: 0 };
    const phases: { phase: keyof typeof totalsMs; durationMs: number; failed: boolean }[] = [];
    const collect = (steps: TestStep[]) => {
      for (const step of steps) {
        const phase = step.title.replace(/^quality:/, "");
        if (step.title.startsWith("quality:") && Object.hasOwn(totalsMs, phase)) {
          const key = phase as keyof typeof totalsMs;
          totalsMs[key] += step.duration;
          phases.push({ phase: key, durationMs: step.duration, failed: Boolean(step.error) });
        } else {
          collect(step.steps);
        }
      }
    };
    collect(result.steps);
    result.attachments.push({
      name: "quality-phase-timings",
      contentType: "application/json",
      body: Buffer.from(JSON.stringify({
        retry: result.retry, status: result.status, durationMs: result.duration, totalsMs, phases
      }))
    });
  }
}
