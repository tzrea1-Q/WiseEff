import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

type Attachment = { name: string; contentType: string; path?: string };
type Result = { status: string; errors: { message?: string }[]; attachments: Attachment[] };
type Suite = {
  suites?: Suite[];
  specs?: { title: string; tests: { projectName: string; expectedStatus: string; results: Result[] }[] }[];
};
type Report = { errors: unknown[]; suites: Suite[] };

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");

export function generateBaselineReview(report: Report, root: string, output: string): boolean {
  root = realpathSync(root);
  const review = path.join(output, "baseline-review");
  rmSync(review, { recursive: true, force: true });
  const failures: { title: string; result: Result }[] = [];
  let eligible = Array.isArray(report.errors) && report.errors.length === 0 && Array.isArray(report.suites);
  const visit = (suite: Suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.results.length !== 1) eligible = false;
        for (const result of test.results) {
          if (result.status === "passed" || result.status === "skipped") continue;
          if (test.projectName !== "visual" || test.expectedStatus !== "passed" || result.status !== "failed") eligible = false;
          failures.push({ title: spec.title, result });
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  if (!eligible || failures.length === 0) return false;

  const images = new Map<string, { title: string; expected: Buffer; actual: Buffer; diff: Buffer }>();
  const readPng = (attachment: Attachment, directory: string) => {
    if (!attachment.path || attachment.contentType !== "image/png") throw new Error("Missing screenshot attachment");
    const resolved = realpathSync(path.resolve(root, attachment.path));
    const relative = path.relative(realpathSync(directory), resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Screenshot outside its authorized directory");
    const bytes = Buffer.from(readFileSync(resolved, "base64"), "base64");
    if (!bytes.subarray(0, 8).equals(pngSignature)) throw new Error("Screenshot is not PNG");
    return bytes;
  };
  for (const { title, result } of failures) {
    if (!result.errors?.length || !result.errors.every(({ message }) => {
      const text = stripVTControlCharacters(message ?? "");
      return /expect\((?:locator|page)\)\.toHaveScreenshot\(expected\) failed/.test(text)
        && /\d+ pixels \(ratio [\d.]+ of all image pixels\) are different\.|Expected an image \d+px by \d+px, received \d+px by \d+px\./.test(text);
    }) || result.attachments.some(({ name }) => name.endsWith("-previous.png"))) return false;
    const expectedAttachments = result.attachments.filter(({ name }) => name.endsWith("-expected.png"));
    if (expectedAttachments.length !== result.errors.length) return false;
    for (const expectedAttachment of expectedAttachments) {
      const stem = expectedAttachment.name.slice(0, -"-expected.png".length);
      const actualAttachments = result.attachments.filter(({ name }) => name === `${stem}-actual.png`);
      const diffAttachments = result.attachments.filter(({ name }) => name === `${stem}-diff.png`);
      const expectedPath = path.resolve(root, expectedAttachment.path ?? "");
      if (!existsSync(expectedPath)) return false;
      const baseline = path.relative(root, realpathSync(expectedPath)).split(path.sep).join("/");
      if (!/^e2e\/quality\/visual\.quality\.spec\.ts-snapshots\/linux\/[a-zA-Z0-9_-]+\.png$/.test(baseline)
        || actualAttachments.length !== 1 || diffAttachments.length !== 1) return false;
      if (realpathSync(path.join(root, baseline)) !== path.join(realpathSync(root), baseline)) return false;
      const expected = readPng(expectedAttachment, path.dirname(path.join(root, baseline)));
      const actual = readPng(actualAttachments[0], output);
      const diff = readPng(diffAttachments[0], output);
      if (expected.equals(actual)) return false;
      const prior = images.get(baseline);
      if (prior && (!prior.expected.equals(expected) || !prior.actual.equals(actual))) return false;
      images.set(baseline, { title, expected, actual, diff });
    }
  }

  const temporary = mkdtempSync(path.join(os.tmpdir(), "quality-baseline-patch-"));
  let patch = "";
  let gallery = "";
  try {
    for (const [baseline, image] of images) {
      const expectedPath = path.join(temporary, "expected.png");
      const actualPath = path.join(temporary, "actual.png");
      writeFileSync(expectedPath, image.expected);
      writeFileSync(actualPath, image.actual);
      const comparison = spawnSync("git", ["diff", "--no-index", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", expectedPath, actualPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (comparison.status !== 1 || !comparison.stdout.includes("GIT binary patch")) throw new Error("Cannot generate baseline patch");
      patch += comparison.stdout.replace(/^diff --git .*$/m, `diff --git a/${baseline} b/${baseline}`);
      gallery += `<section><h2>${escapeHtml(image.title)}</h2><p>${escapeHtml(baseline)}</p><div class="images">${(["expected", "actual", "diff"] as const).map((kind) => `<figure><figcaption>${kind[0].toUpperCase()}${kind.slice(1)}</figcaption><img alt="${kind}" src="data:image/png;base64,${image[kind].toString("base64")}"></figure>`).join("")}</div></section>`;
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  mkdirSync(review, { recursive: true });
  writeFileSync(path.join(review, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Candidate baseline review</title><style>body{font:16px system-ui;margin:2rem}.images{display:flex;gap:1rem}figure{margin:0;min-width:0;flex:1}img{max-width:100%}section{margin-bottom:3rem}</style><h1>Candidate baseline review</h1><p>Review each image at original resolution. Human approval is required before applying candidate.patch; rerun normal comparisons afterwards.</p>${gallery}</html>`);
  writeFileSync(path.join(review, "candidate.patch"), patch);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.resolve("test-results/quality");
  const reportPath = process.argv[2] ?? path.join(output, "results.json");
  if (!existsSync(reportPath)) rmSync(path.join(output, "baseline-review"), { recursive: true, force: true });
  const generated = existsSync(reportPath) && generateBaselineReview(JSON.parse(readFileSync(reportPath, "utf8")), process.cwd(), output);
  console.log(generated ? "Candidate baseline review generated; human approval required." : "No screenshot-only failure; no baseline candidate published.");
}
