import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";
import { generateBaselineReview } from "./quality-baseline-review";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "baseline-review-"));
  roots.push(root);
  const baseline = "e2e/quality/visual.quality.spec.ts-snapshots/linux/home-shell.png";
  mkdirSync(path.dirname(path.join(root, baseline)), { recursive: true });
  const output = path.join(root, "test-results/quality");
  mkdirSync(output, { recursive: true });
  const expected = readFileSync("e2e/quality/visual.quality.spec.ts-snapshots/linux/home-shell.png");
  const actual = readFileSync("e2e/quality/visual.quality.spec.ts-snapshots/linux/organization.png");
  writeFileSync(path.join(root, baseline), expected);
  writeFileSync(path.join(output, "actual.png"), actual);
  writeFileSync(path.join(output, "diff.png"), expected);
  const result = {
    status: "failed", errors: [{ message: "Error: expect(locator).toHaveScreenshot(expected) failed\n  12 pixels (ratio 0.03 of all image pixels) are different." }],
    attachments: [
      { name: "home-shell-expected.png", contentType: "image/png", path: path.join(root, baseline) },
      { name: "home-shell-actual.png", contentType: "image/png", path: path.join(output, "actual.png") },
      { name: "home-shell-diff.png", contentType: "image/png", path: path.join(output, "diff.png") }
    ]
  };
  const report = { errors: [], suites: [{ specs: [{ title: "Home <shell>", tests: [{ projectName: "visual", expectedStatus: "passed", results: [result] }] }] }] };
  return { root, baseline, output, expected, actual, result, report };
}

it("generates a reviewable screenshot triple and an applicable binary patch without changing the baseline", () => {
  const context = fixture();
  expect(generateBaselineReview(context.report, context.root, context.output)).toBe(true);
  const review = path.join(context.output, "baseline-review");
  const html = readFileSync(path.join(review, "index.html"), "utf8");
  expect(html).toContain("Home &lt;shell&gt;");
  for (const label of ["Expected", "Actual", "Diff"]) expect(html).toContain(label);
  expect(html).toContain(context.actual.toString("base64"));
  expect(readFileSync(path.join(context.root, context.baseline))).toEqual(context.expected);
  spawnSync("git", ["init", "-q", context.root]);
  const applied = spawnSync("git", ["apply", "--binary", path.join(review, "candidate.patch")], { cwd: context.root, encoding: "utf8" });
  expect(applied.stderr).toBe("");
  expect(applied.status).toBe(0);
  expect(readFileSync(path.join(context.root, context.baseline))).toEqual(context.actual);
});

it.each(["passed", "assertion", "compact", "global", "missing", "timeout", "retry", "unsafe"])("does not publish a candidate for %s failures", (kind) => {
  const context = fixture();
  const test = context.report.suites[0].specs[0].tests[0];
  if (kind === "passed") context.result.status = "passed";
  if (kind === "assertion") context.result.errors.push({ message: "expect(locator).toBeVisible() failed" });
  if (kind === "compact") test.projectName = "compact";
  if (kind === "global") (context.report.errors as unknown[]).push({ message: "webServer failed" });
  if (kind === "missing") context.result.attachments.pop();
  if (kind === "timeout") context.result.status = "timedOut";
  if (kind === "retry") test.results.push({ ...context.result, status: "passed" });
  if (kind === "unsafe") context.result.attachments[0].path = path.join(context.root, "../outside.png");
  mkdirSync(path.join(context.output, "baseline-review"));
  writeFileSync(path.join(context.output, "baseline-review/candidate.patch"), "stale");
  expect(generateBaselineReview(context.report, context.root, context.output)).toBe(false);
  expect(existsSync(path.join(context.output, "baseline-review"))).toBe(false);
});

it("generates review artifacts after a failed visual lane without altering its gate or accepting snapshots", () => {
  const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const steps = workflow.jobs["acceptance-quality-lanes"].steps;
  const generator = steps.find((step: { run?: string }) => step.run?.includes("scripts/quality-baseline-review.ts"));
  expect(generator).toBeDefined();
  expect(generator.if).toBe("failure() && matrix.lane == 'visual'");
  expect(generator.run).toContain('"$RUNNER_TEMP/wiseeff-ci-shard/results.json"');
  expect(steps.indexOf(generator)).toBeGreaterThan(steps.findIndex((step: { name: string }) => step.name === "Upload quality evidence"));
  const upload = steps.find((step: { with?: { name?: string } }) => step.with?.name === "wiseeff-visual-baseline-review");
  expect(upload.if).toContain("hashFiles('test-results/quality/baseline-review/candidate.patch') != ''");
  expect(upload.with.path).toBe("test-results/quality/baseline-review");
  expect(steps.indexOf(upload)).toBe(steps.indexOf(generator) + 1);
  expect(steps.some((step: { run?: string }) => /--update-snapshots|git apply/.test(step.run ?? ""))).toBe(false);
});

it("handles image dimension comparisons and reads the failed lane's original report from the CLI", () => {
  const context = fixture();
  context.result.errors[0].message = "Error: expect(page).toHaveScreenshot(expected) failed\n  Expected an image 1440px by 900px, received 1440px by 901px.";
  const reportPath = path.join(context.root, "lane-results.json");
  writeFileSync(reportPath, JSON.stringify(context.report));
  const generated = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/quality-baseline-review.ts"), reportPath], { cwd: context.root, encoding: "utf8" });
  expect(generated.status).toBe(0);
  expect(generated.stdout).toContain("Candidate baseline review generated");
  expect(existsSync(path.join(context.output, "baseline-review/candidate.patch"))).toBe(true);
});
