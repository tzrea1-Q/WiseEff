import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import YAML from "yaml";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const sha = "1".repeat(40);
const source = "e2e/acceptance/example.spec.ts";
const policy = {
  acceptedBase: "2".repeat(40),
  identity: { runId: "123", attempt: "1", shard: "2", executedSha: sha, tree: "3".repeat(40) },
  sources: { [source]: [[10, 1]] },
};
const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const workflowSteps = workflow.jobs["acceptance-local-non-hdc-shards"].steps;

function workflowStep(id: string, root: string, overrides: Record<string, string>) {
  const output = path.join(root, `output-${id}`);
  const summary = path.join(root, "summary");
  writeFileSync(output, "");
  let exitCode = 0;
  try {
    execFileSync("/usr/bin/python3", ["-I", "-c", workflowSteps.find((step: { id: string }) => step.id === id).run], {
      cwd: root, env: { PATH: process.env.PATH, RUNNER_TEMP: root, GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary, ...overrides }, timeout: 10_000, stdio: "pipe",
    });
  } catch (error) {
    exitCode = (error as { status: number }).status;
  }
  const outputs = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  return { outputs, exitCode, record: JSON.parse(readFileSync(outputs.path, "utf8")) };
}

async function fixture(options: { file?: string; line?: number; status?: string; policy?: unknown } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "wiseeff-failure-index-"));
  roots.push(root);
  const archive = path.join(root, "evidence.zip");
  const policyFile = path.join(root, "policy.json");
  const output = path.join(root, "index.json");
  const zip = new JSZip();
  zip.file("gate0-upload-snapshot.json", JSON.stringify({ version: 1,
    kind: "wiseeff-gate0-immutable-upload-snapshot", runs: [{ runId: "full-fixture", sourceCommit: sha }] }));
  zip.file("full-fixture/artifacts/browser/test-results/results.json", JSON.stringify({
    suites: [{ specs: [{ file: options.file ?? "example.spec.ts", line: options.line ?? 10, column: 1,
      title: "Cookie: session=SYNTHETIC_SECRET", tests: [{ projectName: "Desktop Chrome", results: [{
        status: options.status ?? "failed", error: { message: "Bearer SYNTHETIC_SECRET" },
      }] }] }] }],
  }));
  writeFileSync(archive, await zip.generateAsync({ type: "nodebuffer" }));
  chmodSync(archive, 0o444);
  writeFileSync(policyFile, JSON.stringify(options.policy ?? policy));
  return { root, archive, policyFile, output, zip };
}

function project(value: Awaited<ReturnType<typeof fixture>>) {
  let exitCode = 0;
  let stderr = "";
  try {
    execFileSync("/usr/bin/python3", ["-I", "scripts/acceptance-failure-index.py", value.archive, value.policyFile, value.output],
      { env: { PATH: process.env.PATH }, timeout: 7_000, stdio: "pipe" });
  } catch (error) {
    const failure = error as { status: number; stderr: Buffer };
    exitCode = failure.status;
    stderr = failure.stderr.toString();
  }
  const text = readFileSync(value.output, "utf8");
  return { record: JSON.parse(text), text, exitCode, stderr };
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("accepted-base compact acceptance failure index", () => {
  it("projects a known failed case from sealed evidence without copying titles or exception text", async () => {
    const value = await fixture();
    const { record, text, exitCode } = project(value);
    expect(exitCode).toBe(0);
    expect(record.status).toBe("generated");
    expect(record.identity).toEqual(policy.identity);
    expect(record.failures).toHaveLength(1);
    expect(record.failures[0]).toMatchObject({ category: "TEST_FAILED", phase: "browser", count: 1,
      source: { file: source, line: 10, column: 1 }, report: { entry: expect.any(Number) } });
    expect(record.failures[0].caseId).toMatch(/^[a-f0-9]{64}$/);
    expect(record.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(text).not.toContain("SYNTHETIC_SECRET");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(262_144);
  });
  it("maps changed or unknown source locations to an explicit count without adopting candidate text", async () => {
    const { record, text } = project(await fixture({ file: "new-SYNTHETIC_SECRET.spec.ts" }));
    expect(record.status).toBe("generated");
    expect(record.unmappedFailures).toBe(1);
    expect(record.failures).toEqual([]);
    expect(text).not.toContain("SYNTHETIC_SECRET");
  });
  it.each(["timedOut", "interrupted"])("preserves the controlled %s category", async (status) => {
    const { record } = project(await fixture({ status }));
    expect(record.failures[0].category).toBe(status === "timedOut" ? "TEST_TIMEOUT" : "TEST_INTERRUPTED");
  });
  it.each(["../SYNTHETIC_SECRET", "/SYNTHETIC_SECRET", "example.spec.ts\nSYNTHETIC_SECRET", "x/../../example.spec.ts"])("rejects hostile source %s with fixed output", async (file) => {
    const { record, text, exitCode } = project(await fixture({ file }));
    expect(exitCode).toBe(1);
    expect(record).toMatchObject({ status: "rejected", code: "INDEX_REJECTED", failures: [] });
    expect(text).not.toContain("SYNTHETIC_SECRET");
  });
  it.each(["malformed", "oversize", "wrong-identity", "writable", "symlink", "missing-report"])("fails closed on %s evidence", async (mutation) => {
    const value = await fixture();
    chmodSync(value.archive, 0o600);
    const reportPath = "full-fixture/artifacts/browser/test-results/results.json";
    if (mutation === "malformed") value.zip.file(reportPath, "{SYNTHETIC_SECRET");
    if (mutation === "oversize") value.zip.file(reportPath, "S".repeat(8 * 1024 * 1024 + 1));
    if (mutation === "wrong-identity") value.zip.file("gate0-upload-snapshot.json", JSON.stringify({ version: 1,
      kind: "wiseeff-gate0-immutable-upload-snapshot", runs: [{ runId: "full-fixture", sourceCommit: "9".repeat(40) }] }));
    if (mutation === "missing-report") value.zip.remove(reportPath);
    writeFileSync(value.archive, await value.zip.generateAsync({ type: "nodebuffer" }));
    if (mutation !== "writable") chmodSync(value.archive, 0o444);
    if (mutation === "symlink") {
      const link = path.join(value.root, "link.zip");
      symlinkSync(value.archive, link);
      value.archive = link;
    }
    const { record, text, exitCode } = project(value);
    expect(record.status).toBe(mutation === "missing-report" ? "unavailable" : "rejected");
    expect(exitCode).toBe(mutation === "missing-report" ? 0 : 1);
    expect(text).not.toContain("SYNTHETIC_SECRET");
  });
  it("stages only accepted unchanged source declarations and rejects replaced policy after staging", async () => {
    const value = await fixture();
    const git = (...args: string[]) => execFileSync("/usr/bin/git", args, { cwd: value.root, encoding: "utf8", stdio: "pipe" }).trim();
    mkdirSync(path.join(value.root, "scripts"));
    mkdirSync(path.join(value.root, "e2e/acceptance"), { recursive: true });
    writeFileSync(path.join(value.root, "scripts/acceptance-failure-index.py"), readFileSync("scripts/acceptance-failure-index.py"));
    writeFileSync(path.join(value.root, source), 'test("accepted", () => {});\n');
    git("init", "-q");
    git("add", "scripts/acceptance-failure-index.py", source);
    git("-c", "user.name=fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "accepted fixture");
    const base = git("rev-parse", "HEAD");
    const env = { EFF_BASE_SHA: base, EFF_RUN_ID: "123", EFF_ATTEMPT: "1", EFF_SHARD: "2",
      EFF_EXECUTED_SHA: base, EFF_TREE: git("rev-parse", "HEAD^{tree}") };
    const stage = workflowStep("acceptance_index_stage", value.root, env);
    expect(stage.exitCode).toBe(0);
    expect(stage.record.code).toBe("PUBLICATION_NOT_RUN");
    const stagedPolicy = path.join(stage.outputs.directory, "policy.json");
    expect(JSON.parse(readFileSync(stagedPolicy, "utf8")).sources).toEqual({ [source]: [[1, 1]] });
    const publishEnv = { EFF_INDEX_DIRECTORY: stage.outputs.directory, EFF_INDEX_STAGE: "success",
      EFF_INDEX_STAGE_MS: stage.outputs.processing_ms,
      EFF_INDEX_PUBLISHER_DIGEST: stage.outputs.publisher_digest,
      EFF_INDEX_POLICY_DIGEST: stage.outputs.policy_digest, EFF_ARCHIVE: "success" };
    const sealedArchive = path.join(value.root, "test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip");
    mkdirSync(path.dirname(sealedArchive), { recursive: true });
    value.zip.file("gate0-upload-snapshot.json", JSON.stringify({ version: 1,
      kind: "wiseeff-gate0-immutable-upload-snapshot", runs: [{ runId: "full-fixture", sourceCommit: base }] }));
    const reportPath = "full-fixture/artifacts/browser/test-results/results.json";
    const report = JSON.parse(await value.zip.file(reportPath)!.async("string"));
    report.suites[0].specs[0].line = 1;
    value.zip.file(reportPath, JSON.stringify(report));
    writeFileSync(sealedArchive, await value.zip.generateAsync({ type: "nodebuffer" }));
    chmodSync(sealedArchive, 0o444);
    const published = workflowStep("acceptance_index", value.root, publishEnv);
    expect(published.exitCode).toBe(0);
    expect(published.record.status).toBe("generated");
    expect(published.record.failures[0].source).toEqual({ file: source, line: 1, column: 1 });
    const unsafeArchive = workflowStep("acceptance_index", value.root, { ...publishEnv, EFF_ARCHIVE: "failure" });
    expect(unsafeArchive.record.code).toBe("SAFE_ARCHIVE_UNAVAILABLE");
    chmodSync(stagedPolicy, 0o600);
    writeFileSync(stagedPolicy, '{"candidate":"SYNTHETIC_SECRET"}');
    const rejected = workflowStep("acceptance_index", value.root, publishEnv);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.record).toMatchObject({ status: "rejected", code: "INDEX_REJECTED" });
    expect(JSON.stringify(rejected.record)).not.toContain("SYNTHETIC_SECRET");
    writeFileSync(path.join(value.root, source), '// inserted declaration\ntest("candidate", () => {});\n');
    git("add", source);
    git("-c", "user.name=fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "candidate fixture");
    const changed = workflowStep("acceptance_index_stage", value.root, { ...env, EFF_EXECUTED_SHA: git("rev-parse", "HEAD") });
    expect(changed.record.code).toBe("PUBLICATION_NOT_RUN");
    expect(JSON.parse(readFileSync(path.join(changed.outputs.directory, "policy.json"), "utf8")).sources).toEqual({});
  });
});
