import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { evaluateL1CiWorkflow } from "./check-acceptance-ci";

type Step = { id?: string; uses?: string; run?: string; if?: string; with?: Record<string, string> };
type Job = { name?: string; if?: string; steps: Step[] };
const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const jobs = workflow.jobs as Record<string, Job>;

function evaluate(expression: string, eventName: string, action = "", label = "") {
  return runInNewContext(expression.replace(/\$\{\{|\}\}/g, ""), {
    github: { event_name: eventName, event: { action, label: { name: label }, pull_request: { number: eventName === "pull_request" ? 42 : undefined } }, workflow: "CI", run_id: 123 },
    always: () => true,
  });
}

function render(template: string, eventName: string, action: string, label: string) {
  return template.replace(/\$\{\{(.*?)\}\}/g, (_, expression: string) => String(evaluate(expression, eventName, action, label)));
}

describe("CI hygiene", () => {
  it.each(["cache", "install", "detect", "concurrency", "gate-name", "gate-step", "aggregate"])("rejects hygiene/gate regressions: %s", (mutation) => {
    const candidate = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    if (mutation === "cache") candidate.jobs["acceptance-quality-lanes"].steps = candidate.jobs["acceptance-quality-lanes"].steps.filter((step: Step) => step.uses !== "actions/cache@v4");
    if (mutation === "install") candidate.jobs["acceptance-smoke"].steps.find((step: Step) => step.run?.includes("playwright install")).if = "steps.cache.outputs.cache-hit != 'true'";
    if (mutation === "detect") delete candidate.jobs.detect.if;
    if (mutation === "concurrency") candidate.concurrency.group = "${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}";
    if (mutation === "gate-name") candidate.jobs.required.name = "Merge bar";
    if (mutation === "gate-step") candidate.jobs.required.steps[2].if = "false";
    if (mutation === "aggregate") candidate.jobs["build-and-test"].if = "success()";
    expect(evaluateL1CiWorkflow(YAML.stringify(candidate)).status).toBe("failed");
  });
  it.each([
    ["pull_request", "labeled", "bug", false],
    ["pull_request", "unlabeled", "bug", false],
    ["pull_request", "labeled", "full-acceptance", true],
    ["pull_request", "unlabeled", "full-acceptance", true],
    ["pull_request", "opened", "", true],
    ["pull_request", "synchronize", "", true],
    ["pull_request", "reopened", "", true],
    ["push", "", "", true],
    ["schedule", "", "", true],
    ["workflow_dispatch", "", "", true],
  ])("selects CI for %s/%s/%s: %s", (eventName, action, label, selected) => {
    expect(workflow.on.pull_request.types).toContain("unlabeled");
    const group = render(workflow.concurrency.group, eventName, action, label);
    expect(group).toBe(selected && eventName === "pull_request" ? "CI-42" : "CI-123");
    expect(evaluate(workflow.concurrency["cancel-in-progress"], eventName, action, label)).toBe(selected && eventName === "pull_request");
    for (const id of ["detect", "l1-server", "build-and-test", "acceptance-quality", "acceptance-local-non-hdc"]) {
      expect(evaluate(jobs[id].if ?? "true", eventName, action, label), id).toBe(selected);
    }
    expect(jobs.required.if).toBe("always()");
    expect(render(jobs.required.name!, eventName, action, label)).toBe(selected ? "Merge bar" : "Merge bar (ignored label)");
    for (const step of jobs.required.steps) {
      expect(evaluate(step.if ?? "true", eventName, action, label)).toBe(selected);
    }
  });
  it("restores a version-keyed Chromium cache before every browser install without skipping system dependencies", () => {
    const browserJobs = Object.values(jobs).filter((job) => job.steps.some((step) => step.run?.includes("playwright install")));
    expect(browserJobs).toHaveLength(4);
    for (const job of browserJobs) {
      const installIndex = job.steps.findIndex((step) => step.run?.includes("playwright install"));
      const versionIndex = job.steps.findIndex((step) => step.id === "playwright_version");
      const cacheIndex = job.steps.findIndex((step) => step.uses === "actions/cache@v4" && step.with?.path === "~/.cache/ms-playwright");
      expect(versionIndex).toBeGreaterThan(job.steps.findIndex((step) => step.run === "npm ci"));
      expect(cacheIndex).toBeGreaterThan(versionIndex);
      expect(installIndex).toBeGreaterThan(cacheIndex);
      expect(job.steps[versionIndex].run).toContain("require('@playwright/test/package.json').version");
      expect(job.steps[cacheIndex].with?.key).toBe("playwright-chromium-${{ runner.os }}-${{ runner.arch }}-${{ steps.playwright_version.outputs.version }}");
      expect(job.steps[cacheIndex].with?.["restore-keys"]).toBeUndefined();
      expect(job.steps[installIndex]).toMatchObject({ run: "npx playwright install --with-deps chromium" });
      expect(job.steps[installIndex].if).toBeUndefined();
    }
  });
});
