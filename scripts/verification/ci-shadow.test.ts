import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateNativeReport } from "../ci-required-results";
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

  it("runs one installed-Vitest two-file native group and projects its validated report", () => {
    const root = mkdtempSync(path.join(process.cwd(), "work/efficiency/ci-shadow-native-"));
    try {
      const first = path.join(root, "first.test.ts");
      const second = path.join(root, "second.test.ts");
      const config = path.join(root, "vitest.config.ts");
      writeFileSync(first, 'import { expect, it } from "vitest"; it("first", () => expect(1).toBe(1));\n');
      writeFileSync(second, 'import { expect, it } from "vitest"; it("second", () => expect(2).toBe(2));\n');
      writeFileSync(config, 'import { defineConfig } from "vitest/config"; export default defineConfig({ test: { environment: "node" } });\n');
      const vitest = path.resolve(process.cwd(), "node_modules/vitest/vitest.mjs");
      const discovered = JSON.parse(execFileSync(process.execPath, [vitest, "list", "--filesOnly", "--json", "--root", root, "--config", config, first, second], { cwd: process.cwd(), encoding: "utf8" }));
      const files = discovered.map((entry: { file: string }) => entry.file);
      expect(files).toEqual([first, second]);
      const reportFile = path.join(root, "native-report.json");
      const startedAt = Date.now();
      const result = spawnSync(process.execPath, [vitest, "run", "--root", root, "--config", config, "--reporter=json", `--outputFile=${reportFile}`, first, second], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CI: "true" } });
      const finishedAt = Date.now();
      const bytes = readFileSync(reportFile);
      const nativeReport = JSON.parse(bytes.toString("utf8"));
      const summary = validateNativeReport(nativeReport, files, { command: "frontend", root: process.cwd(), startedAt, finishedAt, platform: process.platform, missingPathDts: false, missingRehearsalContainer: false });
      const native = { version: 1 as const, command: "frontend", identity, ...summary, sha256: createHash("sha256").update(bytes).digest("hex"), filesSha256: createHash("sha256").update(JSON.stringify([...files].sort())).digest("hex") };
      const relativeFirst = path.relative(process.cwd(), first).replaceAll("\\", "/");
      const relativeSecond = path.relative(process.cwd(), second).replaceAll("\\", "/");
      const nativeRegistry = registry.map((module) => module.id === "feedback-client" ? { ...module, tasks: { "frontend-tests": [relativeFirst, relativeSecond] } } : module);
      const shadow = createShadowObservation({ identity, command: "frontend", files, native, selection, registry: nativeRegistry, policyDigest: "c".repeat(64), registryDigest: "d".repeat(64), root: process.cwd() });
      const evidence = { executionCount: 1, discoveryFileCount: files.length, nativeExit: result.status, nativePassed: summary.passed, nativeSkipped: summary.skipped, nativeFiles: summary.files, nativeReportSha256: native.sha256, actualFilesSha256: native.filesSha256, shadowStatus: shadow.status, shadowPlanValid: shadow.planValid };
      writeFileSync("work/efficiency/ci-shadow-repair-native-evidence.json", JSON.stringify(evidence));
      expect(result.status).toBe(0);
      expect(summary).toMatchObject({ passed: 2, skipped: 0, files: 2 });
      expect(shadow).toMatchObject({ status: "observed", planValid: true, actualFullFileCount: 2 });
      expect(shadow.modules[0]).toMatchObject({ wouldSelectFileCount: 2, matchedCount: 2 });
      expect(readFileSync(reportFile).equals(bytes)).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("records an invalid fixed-code observation without claiming a plan", () => {
    const shadow = createUnavailableShadow({ identity, command: "frontend", native, error: "SHADOW_PLAN_INVALID" });
    expect(shadow).toMatchObject({ status: "unavailable", planValid: false, error: "SHADOW_PLAN_INVALID", command: "frontend" });
  });
});
