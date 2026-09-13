import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { l1CommandIds, validateNativeReport } from "../ci-required-results";
import { createShadowObservation, createUnavailableShadow } from "./ci-shadow";

const identity = {
  event: "pull_request", mode: "", fullAcceptance: false, ref: "refs/pull/828/merge",
  base: "1".repeat(40), head: "2".repeat(40), sha: "3".repeat(40), tree: "4".repeat(40), runId: "100", attempt: "1",
};
const registry = [
  { id: "feedback-client", status: "observation-pending", risk: "R2", paths: [], consumers: [], dependencies: [], tasks: { "frontend-tests": ["src/"] }, browser: { spec: "e2e/client.spec.ts", pages: ["/"], roles: ["User"], flows: ["read"], environment: "owned-postgres-browser" } },
  { id: "feedback-domain", status: "observation-pending", risk: "R3", paths: [], consumers: [], dependencies: [], tasks: {}, browser: { spec: "e2e/domain.spec.ts", pages: ["/"], roles: ["User"], flows: ["read"], environment: "owned-postgres-browser" } },
  { id: "feedback-server", status: "observation-pending", risk: "R2", paths: [], consumers: [], dependencies: [], tasks: {}, browser: { spec: "e2e/server.spec.ts", pages: ["/"], roles: ["User"], flows: ["read"], environment: "owned-postgres-browser" } },
  { id: "feedback-ui", status: "observation-pending", risk: "R2", paths: [], consumers: [], dependencies: [], tasks: {}, browser: { spec: "e2e/ui.spec.ts", pages: ["/"], roles: ["User"], flows: ["read"], environment: "owned-postgres-browser" } },
] as const;
const selection = {
  modules: ["feedback-client"], tasks: ["frontend-tests"], reasons: [], fullFallback: false,
  moduleStates: registry.map((module) => ({ id: module.id, status: "observation-pending" as const, risk: module.risk, selected: module.id === "feedback-client" })),
};
const native = { version: 1, command: "frontend", identity, passed: 2, skipped: 0, files: 2, optionalSkips: {}, sha256: "a".repeat(64), filesSha256: "b".repeat(64) };

describe("CI shadow projection", () => {
  it("publishes four fixed observation-pending modules from the native file set", () => {
    const files = ["/repo/src/client.test.ts", "/repo/src/other.test.ts"];
    const actualFilesSha256 = createHash("sha256").update(JSON.stringify([...files].sort())).digest("hex");
    const shadow = createShadowObservation({ identity, command: "frontend", files, native: { ...native, filesSha256: actualFilesSha256 }, selection, registry, policyDigest: "c".repeat(64), registryDigest: "d".repeat(64), root: "/repo" });
    expect(shadow).toMatchObject({ version: 1, scope: "ci-shadow", status: "observed", planValid: true, command: "frontend", actualFullFileCount: 2, nativeReportSha256: "a".repeat(64), actualFilesSha256 });
    expect(shadow.modules).toHaveLength(4);
    expect(shadow.modules[0]).toMatchObject({ id: "feedback-client", status: "observation-pending", selected: true, wouldSelectFileCount: 2, matchedCount: 2, actualFullFileCount: 2 });
    expect(shadow).toMatchObject({ selectionScope: "module-subset", fullFallback: false, activationEligible: false });
    expect(JSON.stringify(shadow)).not.toContain("src/");
  });

  it("expands full fallback to the complete native discovery set", () => {
    const files = ["/repo/src/client.test.ts", "/repo/src/other.test.ts"];
    const actualFilesSha256 = createHash("sha256").update(JSON.stringify([...files].sort())).digest("hex");
    const fullSelection = { ...selection, fullFallback: true, modules: registry.map((module) => module.id), tasks: ["frontend-tests"], moduleStates: registry.map((module) => ({ id: module.id, status: "observation-pending" as const, risk: module.risk, selected: true })) };
    const shadow = createShadowObservation({ identity, command: "frontend", files, native: { ...native, filesSha256: actualFilesSha256 }, selection: fullSelection, registry, policyDigest: "c".repeat(64), registryDigest: "d".repeat(64), root: "/repo" });
    expect(shadow).toMatchObject({ status: "observed", planValid: true, selectionScope: "full-required", fullFallback: true });
    expect(shadow.modules.every((module) => module.selected && module.wouldSelectFileCount === 2 && module.matchedCount === 2)).toBe(true);
  });

  it("runs the unchanged W1 CLI once in a clean two-file Git fixture and preserves receipt bytes", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiseeff-shadow-fixture-"));
    const evidenceDirectory = path.resolve("work/efficiency/ci-shadow-p2");
    mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
    const evidenceRoot = mkdtempSync(path.join(evidenceDirectory, "native-"));
    chmodSync(evidenceRoot, 0o700);
    const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
    const git = (args: string[]) => execFileSync("/usr/bin/git", ["-c", "user.name=WiseEff fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: root, env: gitEnv, encoding: "utf8" }).trim();
    const sourceFiles = ["scripts/ci-required-results.ts", "scripts/verification/ci-shadow.ts", "scripts/verification/plan.ts", "scripts/verification/selection.ts", "scripts/verification/registry.json", "scripts/verify.ts"];
    try {
      mkdirSync(path.join(root, "scripts/verification"), { recursive: true });
      mkdirSync(path.join(root, "src"), { recursive: true });
      for (const file of sourceFiles) {
        const destination = path.join(root, file);
        mkdirSync(path.dirname(destination), { recursive: true });
        copyFileSync(path.resolve(process.cwd(), file), destination);
        expect(readFileSync(destination).equals(readFileSync(path.resolve(process.cwd(), file)))).toBe(true);
      }
      symlinkSync(path.resolve(process.cwd(), "node_modules"), path.join(root, "node_modules"), "dir");
      writeFileSync(path.join(root, ".gitignore"), "node_modules/\n");
      const first = path.join(root, "src/fixture-one.test.ts");
      const second = path.join(root, "src/fixture-two.test.ts");
      writeFileSync(first, 'import { expect, it } from "vitest"; it("fixture one", () => expect(1).toBe(1));\n');
      writeFileSync(second, 'import { expect, it } from "vitest"; it("fixture two", () => expect(2).toBe(2));\n');
      const counterFile = path.join(evidenceRoot, "native-invocations.txt");
      const invocationFile = path.join(evidenceRoot, "vitest-invocations.jsonl");
      const snapshotFile = path.join(evidenceRoot, "native-report.snapshot.json");
      const reportPathFile = path.join(evidenceRoot, "native-report.path");
      writeFileSync(counterFile, "0");
      writeFileSync(invocationFile, "");
      const vitest = path.resolve(process.cwd(), "node_modules/vitest/vitest.mjs");
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "wiseeff-shadow-fixture", private: true, type: "module", scripts: { test: "node scripts/native-shim.cjs" } }));
      writeFileSync(path.join(root, "vitest.config.ts"), [
        'import { appendFileSync } from "node:fs";',
        'import { defineConfig } from "vitest/config";',
        `const invocationFile = ${JSON.stringify(invocationFile)};`,
        'const phase = process.argv.includes("list") ? "list" : process.argv.includes("run") ? "run" : "other";',
        'appendFileSync(invocationFile, JSON.stringify({ phase, argv: process.argv }) + "\\n");',
        'export default defineConfig({ test: { environment: "node", include: ["src/fixture-one.test.ts", "src/fixture-two.test.ts"] } });',
      ].join("\n"));
      writeFileSync(path.join(root, "scripts/native-shim.cjs"), [
        "const { copyFileSync, readFileSync, writeFileSync } = require('node:fs');",
        "const { spawnSync } = require('node:child_process');",
        `const vitest = ${JSON.stringify(vitest)}; const counter = ${JSON.stringify(counterFile)}; const snapshot = ${JSON.stringify(snapshotFile)}; const reportPath = ${JSON.stringify(reportPathFile)};`,
        "const args = process.argv.slice(2); const output = args.find((arg) => arg.startsWith('--outputFile='))?.slice('--outputFile='.length);",
        "writeFileSync(counter, String(Number(readFileSync(counter, 'utf8') || '0') + 1));",
        "const result = spawnSync(process.execPath, [vitest, 'run', ...args], { stdio: 'inherit', env: process.env });",
        "if (result.status === 0 && output) { copyFileSync(output, snapshot); writeFileSync(reportPath, output); }",
        "process.exitCode = result.status ?? 1;",
      ].join("\n"));
      git(["init", "-b", "main"]);
      git(["add", "."]);
      git(["commit", "-m", "fixture base"]);
      const base = git(["rev-parse", "HEAD"]);
      git(["switch", "-c", "fixture-head"]);
      writeFileSync(first, `${readFileSync(first, "utf8")}\n// fixture-head change\n`);
      git(["add", "src/fixture-one.test.ts"]);
      git(["commit", "-m", "fixture head"]);
      const head = git(["rev-parse", "HEAD"]);
      git(["switch", "main"]);
      git(["merge", "--no-ff", "fixture-head", "-m", "fixture ordered merge"]);
      const sha = git(["rev-parse", "HEAD"]);
      const tree = git(["rev-parse", "HEAD^{tree}"]);
      const identity = { event: "pull_request" as const, mode: "", fullAcceptance: false, ref: "refs/pull/828/merge", base, head, sha, tree, runId: "828", attempt: "1" };
      const runnerTemp = mkdtempSync(path.join(evidenceRoot, "runner-"));
      chmodSync(runnerTemp, 0o700);
      const w1Output = path.join(evidenceRoot, "w1-output");
      const env = { ...process.env, GITHUB_EVENT_NAME: identity.event, GITHUB_REF: identity.ref, GITHUB_SHA: identity.sha, GITHUB_RUN_ID: identity.runId,
        GITHUB_RUN_ATTEMPT: identity.attempt, EFF_BASE_SHA: identity.base, EFF_HEAD_SHA: identity.head, EFF_MODE: "", EFF_FULL_ACCEPTANCE: "false",
        GITHUB_JOB: "l1-frontend", RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: w1Output, CI: "true" };
      const w1StartedAt = Date.now();
      const w1 = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/ci-required-results.ts", "test", "frontend"], { cwd: root, env, encoding: "utf8" });
      const w1FinishedAt = Date.now();
      writeFileSync(path.join(evidenceRoot, "w1.stdout"), w1.stdout ?? "");
      writeFileSync(path.join(evidenceRoot, "w1.stderr"), w1.stderr ?? "");
      expect(w1.status).toBe(0);
      const output = readFileSync(w1Output, "utf8");
      const outputValue = (key: string) => JSON.parse(output.split("\n").find((line) => line.startsWith(`${key}=`))!.slice(key.length + 1));
      const nativeSummary = outputValue("report");
      const shadow = outputValue("shadow");
      const reportFile = readFileSync(reportPathFile, "utf8");
      const reportSnapshot = readFileSync(snapshotFile);
      const invocations = readFileSync(invocationFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const listInvocations = invocations.filter((invocation: { phase: string }) => invocation.phase === "list");
      const runInvocations = invocations.filter((invocation: { phase: string }) => invocation.phase === "run");
      const files = [realpathSync(first), realpathSync(second)];
      const reportFiles = (JSON.parse(reportSnapshot.toString("utf8")).testResults as Array<{ name: string }>).map((result) => result.name).sort();
      expect(listInvocations).toHaveLength(1);
      expect(runInvocations).toHaveLength(1);
      expect(reportFiles).toEqual([...files].sort());
      expect(Number(readFileSync(counterFile, "utf8"))).toBe(1);
      expect(nativeSummary).toMatchObject({ command: "frontend", passed: 2, skipped: 0, files: reportFiles.length, identity });
      writeFileSync(path.join(evidenceRoot, "shadow.json"), JSON.stringify(shadow), { mode: 0o600 });
      writeFileSync(path.join(evidenceRoot, "fixture-status.txt"), git(["status", "--porcelain=v1", "--untracked-files=all"]), { mode: 0o600 });
      expect(shadow, `bounded fixture observation: ${JSON.stringify(shadow)}`).toMatchObject({ status: "observed", planValid: true, actualFullFileCount: reportFiles.length, selectionScope: "full-required", fullFallback: true });
      expect(reportSnapshot.equals(readFileSync(reportFile))).toBe(true);
      const steps = (withShadow: boolean) => Object.fromEntries(l1CommandIds["l1-frontend"].map((id) => [id, {
        outcome: "success", outputs: id === "frontend" ? { report: JSON.stringify(nativeSummary), ...(withShadow ? { shadow: JSON.stringify(shadow) } : {}) } : {},
      }]));
      const receipt = (withShadow: boolean, name: string) => {
        const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/ci-required-results.ts", "receipt"], {
          cwd: root, env: { ...env, EFF_STEPS: JSON.stringify(steps(withShadow)), GITHUB_OUTPUT: path.join(evidenceRoot, name) }, encoding: "utf8",
        });
        writeFileSync(path.join(evidenceRoot, `${name}.stdout`), result.stdout ?? "");
        writeFileSync(path.join(evidenceRoot, `${name}.stderr`), result.stderr ?? "");
        return result;
      };
      const nativeOnlyStartedAt = Date.now();
      const nativeOnlyReceipt = receipt(false, "native-only-receipt");
      const nativeOnlyFinishedAt = Date.now();
      const shadowSiblingStartedAt = Date.now();
      const shadowSiblingReceipt = receipt(true, "shadow-sibling-receipt");
      const shadowSiblingFinishedAt = Date.now();
      const nativeOnlyBytes = readFileSync(path.join(evidenceRoot, "native-only-receipt"));
      const shadowSiblingBytes = readFileSync(path.join(evidenceRoot, "shadow-sibling-receipt"));
      expect(nativeOnlyReceipt.status).toBe(0);
      expect(shadowSiblingReceipt.status).toBe(0);
      expect(nativeOnlyBytes.equals(shadowSiblingBytes)).toBe(true);
      const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
      const logIndex = (name: string) => {
        const stdout = readFileSync(path.join(evidenceRoot, `${name}.stdout`));
        const stderr = readFileSync(path.join(evidenceRoot, `${name}.stderr`));
        return { stdoutBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr) };
      };
      const fixtureFiles = [...files, ...sourceFiles.map((file) => path.join(root, file))].map((file) => ({ file, sha256: sha256(readFileSync(file)) }));
      writeFileSync(path.join(evidenceRoot, "native-evidence.json"), JSON.stringify({ syntheticFixture: true, fixtureRunId: identity.runId, fixtureAttempt: identity.attempt,
        base, head, mergeSha: sha, mergeTree: tree, orderedParents: git(["rev-list", "--parents", "-n", "1", sha]).split(" "), discoveryFileCount: files.length,
        discoveryInvocationCount: listInvocations.length, nativeInvocationCount: Number(readFileSync(counterFile, "utf8")), nativeExit: w1.status, nativeWallMs: w1FinishedAt - w1StartedAt, nativeReportSnapshotSha256: sha256(reportSnapshot), projectedReportSha256: nativeSummary.sha256,
        receiptNativeOnlyExit: nativeOnlyReceipt.status, receiptNativeOnlyWallMs: nativeOnlyFinishedAt - nativeOnlyStartedAt, receiptNativeOnlySha256: sha256(nativeOnlyBytes),
        receiptShadowSiblingExit: shadowSiblingReceipt.status, receiptShadowSiblingWallMs: shadowSiblingFinishedAt - shadowSiblingStartedAt, receiptShadowSiblingSha256: sha256(shadowSiblingBytes), receiptBytesEqual: nativeOnlyBytes.equals(shadowSiblingBytes), preShadowReceipt: "not-emitted",
        privateLogIndex: { w1: logIndex("w1"), receiptNativeOnly: logIndex("native-only-receipt"), receiptShadowSibling: logIndex("shadow-sibling-receipt") },
        sourceHashes: Object.fromEntries(sourceFiles.map((file) => [file, sha256(readFileSync(path.join(root, file)))])), fixtureFiles }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records an invalid fixed-code observation without claiming a plan", () => {
    const shadow = createUnavailableShadow({ identity, command: "frontend", native, error: "SHADOW_PLAN_INVALID" });
    expect(shadow).toMatchObject({ status: "unavailable", planValid: false, error: "SHADOW_PLAN_INVALID", command: "frontend" });
  });
});
