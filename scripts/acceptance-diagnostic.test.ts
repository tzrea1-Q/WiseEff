import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const steps = workflow.jobs["acceptance-local-non-hdc"].steps as Array<Record<string, any>>;
const roots: string[] = [];
const sha = "1".repeat(40);
const env = {
  EFF_RUN_ID: "1234", EFF_ATTEMPT: "2", EFF_WORKFLOW_SHA: sha,
  EFF_BASE: "2".repeat(40), EFF_PR_HEAD: "3".repeat(40),
  EFF_EXECUTED_SHA: "4".repeat(40), EFF_TREE: "5".repeat(40),
  EFF_EXECUTION: "failure", EFF_ARCHIVE: "failure", EFF_UPLOAD: "skipped",
};

function runStep(id: string, overrides: Record<string, string> = {}) {
  const step = steps.find((item) => item.id === id);
  expect(step, `workflow step ${id} must exist`).toBeDefined();
  const root = mkdtempSync(path.join(tmpdir(), "eff-diagnostic-"));
  roots.push(root);
  const output = path.join(root, "output");
  const summary = path.join(root, "summary");
  writeFileSync(output, "");
  writeFileSync(summary, "");
  // The same isolated system interpreter used by Hosted ignores candidate modules.
  writeFileSync(path.join(root, "json.py"), 'raise RuntimeError("SYNTHETIC_SECRET")');
  let exitCode = 0;
  let stderr = "";
  try {
    execFileSync("/usr/bin/python3", ["-I", "-c", step!.run], {
      cwd: root,
      env: { PATH: process.env.PATH, PYTHONPATH: root, RUNNER_TEMP: root, GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary, ...env, ...overrides },
      timeout: 10_000, stdio: "pipe",
    });
  } catch (error) {
    const failure = error as { status: number; stderr: Buffer };
    exitCode = failure.status;
    stderr = failure.stderr.toString();
  }
  const outputs = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  const text = outputs.path ? readFileSync(outputs.path, "utf8") : "null";
  return { record: JSON.parse(text), text, summary: readFileSync(summary, "utf8"), root, outputs, exitCode, stderr };
}

afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("workflow-owned minimal acceptance diagnostics (EFF-T01–09)", () => {
  it("records dual failure independently without claiming cleanup or upload completion", () => {
    const { record } = runStep("acceptance_diagnostic");
    expect(record.schemaVersion).toBe(1);
    expect(record.scope).toBe("workflow-context-only");
    expect(record.identity).toMatchObject({ runId: "1234", attempt: "2", job: "acceptance-local-non-hdc",
      workflowSha: sha, acceptedBase: env.EFF_BASE, prHead: env.EFF_PR_HEAD,
      executedSha: env.EFF_EXECUTED_SHA, tree: env.EFF_TREE });
    expect(record.states).toEqual({ execution: "failure", cleanup: "unknown", diagnostic: "generated",
      archive: "failure", upload: "skipped", diagnosticUpload: "pending" });
    expect(record.firstFailedStage).toBe("execution");
    expect(record.code).toBe("EXECUTION_FAILED");
    expect(record.detailsSuppressed).toBe(true);
  });

  it("does not let successful archive/upload hide primary failure", () => {
    const { record } = runStep("acceptance_diagnostic", { EFF_ARCHIVE: "success", EFF_UPLOAD: "success" });
    expect(record.states.execution).toBe("failure");
    expect(record.states.cleanup).toBe("unknown");
    expect(record.code).toBe("EXECUTION_FAILED");
  });

  it.each(["success", "failure", "cancelled", "skipped", ""])("keeps upload outcome %s distinct", (status) => {
    const { record } = runStep("acceptance_diagnostic", { EFF_EXECUTION: "success", EFF_ARCHIVE: "success", EFF_UPLOAD: status });
    expect(record.states.upload).toBe(status || "unknown");
    expect(record.states.cleanup).toBe("unknown");
    expect(record).not.toHaveProperty("passed");
  });

  it("never reads candidate reports, logs, titles, paths, or unrelated secret environment", () => {
    const { text, summary, root } = runStep("acceptance_diagnostic", {
      TEST_TITLE: "\u001b[31m${touch /tmp/eff-pwn}; Cookie: session=SYNTHETIC_SECRET",
      DATABASE_URL: "postgres://user:SYNTHETIC_SECRET@localhost/private",
      AUTHORIZATION: "Bearer SYNTHETIC_SECRET", REPORT_PATH: "../../secret",
    });
    expect(text + summary).not.toContain("SYNTHETIC_SECRET");
    expect(text + summary).not.toContain("/private/");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65_536);
    expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(4_096);
    expect(readdirSync(root).length).toBe(4);
  });

  it.each(["failure\nCookie: SYNTHETIC_SECRET", "\u001b[31msuccess", "S".repeat(70_000)])("rejects malformed or oversized status without reflecting it", (value) => {
    const { record, text, summary, exitCode, stderr } = runStep("acceptance_diagnostic", { EFF_EXECUTION: value });
    expect(record).toBeNull();
    expect(exitCode).toBe(1);
    expect(stderr.trim()).toBe("DIAGNOSTIC_REJECTED");
    expect(text + summary + stderr).not.toContain("SYNTHETIC_SECRET");
  });

  it("leaves missing execution identity unknown, never substitutes workflow/head SHA", () => {
    const { record } = runStep("acceptance_diagnostic", { EFF_EXECUTED_SHA: "", EFF_TREE: "", EFF_EXECUTION: "skipped" });
    expect(record.identity.executedSha).toBeNull();
    expect(record.identity.tree).toBeNull();
    expect(record.code).toBe("EXECUTION_INCOMPLETE");
  });

  it("provides fixed rejection when the generator failed and omits candidate inputs", () => {
    const { record, text } = runStep("acceptance_diagnostic_fallback", { EFF_EXECUTION: "SYNTHETIC_SECRET", EFF_TREE: "SYNTHETIC_SECRET" });
    expect(record.code).toBe("DIAGNOSTIC_REJECTED");
    expect(record.identity).toEqual({ runId: "1234", attempt: "2", job: "acceptance-local-non-hdc" });
    expect(text).not.toContain("SYNTHETIC_SECRET");
  });

  it("records cancelled/incomplete execution honestly", () => {
    for (const status of ["cancelled", "skipped", ""]) {
      const { record } = runStep("acceptance_diagnostic", { EFF_EXECUTION: status });
      expect(record.code).toBe("EXECUTION_INCOMPLETE");
    }
  });

  it("observes the real checkout and fails closed outside a Git checkout", () => {
    const missing = runStep("acceptance_execution_identity");
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr.trim()).toBe("EXECUTION_IDENTITY_UNAVAILABLE");
    expect(missing.outputs.sha).toBeUndefined();
    const step = steps.find((s) => s.id === "acceptance_execution_identity")!;
    const root = mkdtempSync(path.join(tmpdir(), "eff-identity-"));
    roots.push(root);
    const output = path.join(root, "output");
    execFileSync("/usr/bin/python3", ["-I", "-c", step.run], {
      env: { GITHUB_OUTPUT: output }, timeout: 10_000, stdio: "pipe",
    });
    const expected = execFileSync("git", ["rev-parse", "HEAD", "HEAD^{tree}"], { encoding: "utf8" }).trim().split("\n");
    expect(readFileSync(output, "utf8")).toBe(`sha=${expected[0]}\ntree=${expected[1]}\n`);
  });

  it("settles a failed/skipped diagnostic upload as failure even when fallback exists", () => {
    const settle = steps.find((s) => s.name === "Settle diagnostic upload outcome")!;
    expect(settle.if).toBe("always()");
    const root = mkdtempSync(path.join(tmpdir(), "eff-settle-"));
    roots.push(root);
    for (const status of ["failure", "skipped", "cancelled", ""]) {
      expect(() => execFileSync("/usr/bin/python3", ["-I", "-c", settle.run], {
        env: { EFF_UPLOAD: status, GITHUB_STEP_SUMMARY: path.join(root, "summary") },
        timeout: 10_000, stdio: "pipe",
      })).toThrow();
    }
  });

  it("publishes exact fresh files and preserves failure/timeout bounds in wiring", () => {
    const generate = steps.find((s) => s.id === "acceptance_diagnostic");
    const fallback = steps.find((s) => s.id === "acceptance_diagnostic_fallback");
    const upload = steps.find((s) => s.id === "acceptance_diagnostic_upload");
    expect(generate?.if).toBe("always()");
    expect(fallback?.if).toBe("always() && steps.acceptance_diagnostic.outcome != 'success'");
    expect(upload?.with.path).toBe("${{ steps.acceptance_diagnostic.outcome == 'success' && steps.acceptance_diagnostic.outputs.path || steps.acceptance_diagnostic_fallback.outputs.path }}");
    expect(upload?.with["if-no-files-found"]).toBe("error");
    for (const step of [generate, fallback, upload]) {
      expect(step?.["timeout-minutes"]).toBe(1);
      expect(step?.["continue-on-error"]).not.toBe(true);
    }
    const identityIndex = steps.findIndex((s) => s.id === "acceptance_execution_identity");
    expect(identityIndex).toBe(1);
    expect(steps.findIndex((s) => s.id === "acceptance_gate0")).toBeGreaterThan(identityIndex);
    const { outputs: first } = runStep("acceptance_diagnostic");
    const { outputs: second } = runStep("acceptance_diagnostic");
    expect(first.path).not.toBe(second.path);
  });
});
