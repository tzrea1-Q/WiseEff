import { chmodSync, linkSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertL1Results, assertRequiredResults, assertShadowResults, assertShadowSummary, createL1Receipt, l1CommandIds, readPrivateReport, settleShadowResults, validateNativeReport } from "./ci-required-results";
import { createNotApplicableShadow, createUnavailableShadow } from "./verification/ci-shadow";

const identity = {
  event: "pull_request", mode: "", fullAcceptance: false, ref: "refs/pull/828/merge",
  base: "1".repeat(40), head: "2".repeat(40), sha: "3".repeat(40), tree: "4".repeat(40),
  runId: "100", attempt: "1",
};
const docs = { docs_only: "true", run_l1: "false", run_quality: "false", run_smoke: "false", run_l2: "false" };
const docNeeds = {
  detect: { result: "success", outputs: docs },
  "build-and-test": { result: "success", outputs: { identity: JSON.stringify(identity) } },
  "acceptance-quality": { result: "skipped" }, "acceptance-smoke": { result: "skipped" },
  "acceptance-local-non-hdc": { result: "skipped" }, "target-synthetic-acceptance": { result: "skipped" },
  "minimal-upgrade": { result: "skipped" },
};

describe("strict CI required results", () => {
  it("accepts docs-only with a successful stable Build and test", () => {
    expect(() => assertRequiredResults({ identity, needs: docNeeds })).not.toThrow();
  });
  it("requires the always-running Build and test gate on docs-only changes", () => {
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, "build-and-test": { result: "skipped" } } })).toThrow();
  });
  it.each(["failure", "cancelled", "missing", ""])("rejects %s even for unselected jobs", (result) => {
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, "acceptance-smoke": { result } } })).toThrow();
  });
  it.each(["run_l1", "run_l2", "run_quality", "run_smoke", "docs_only"])("rejects unknown %s", (flag) => {
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, detect: { result: "success", outputs: { ...docs, [flag]: "unknown" } } } })).toThrow();
  });
  it.each(["push", "schedule"])("requires complete main L1, quality and L2 for %s", (event) => {
    const mainIdentity = { ...identity, event, ref: "refs/heads/main", base: "", head: "" };
    const needs = { ...docNeeds, "build-and-test": { result: "success", outputs: { identity: JSON.stringify(mainIdentity) } }, detect: { result: "success", outputs: { docs_only: "false", run_l1: "true", run_quality: "true", run_smoke: "false", run_l2: "true" } }, "acceptance-quality": { result: "success" }, "acceptance-local-non-hdc": { result: "success" } };
    expect(() => assertRequiredResults({ identity: mainIdentity, needs })).not.toThrow();
    expect(() => assertRequiredResults({ identity: mainIdentity, needs: { ...needs, "acceptance-local-non-hdc": { result: "skipped" } } })).toThrow();
  });
  it.each(["local-non-hdc", "target-non-hdc", "full-pilot", "minimal-upgrade"])("retains %s manual dispatch requirements", (mode) => {
    const local = mode === "local-non-hdc";
    const target = mode === "target-non-hdc" || mode === "full-pilot";
    const needs = { ...docNeeds, detect: { result: "success", outputs: { docs_only: "false", run_l1: "false", run_quality: String(local), run_smoke: "false", run_l2: String(local) } }, "acceptance-quality": { result: local ? "success" : "skipped" }, "acceptance-local-non-hdc": { result: local ? "success" : "skipped" }, "target-synthetic-acceptance": { result: target ? "success" : "skipped" }, "minimal-upgrade": { result: mode === "minimal-upgrade" ? "success" : "skipped" } };
    const dispatchIdentity = { ...identity, event: "workflow_dispatch", base: "", head: "", mode };
    needs["build-and-test"] = { result: "success", outputs: { identity: JSON.stringify(dispatchIdentity) } };
    expect(() => assertRequiredResults({ identity: dispatchIdentity, needs })).not.toThrow();
  });
  it("rejects unknown events, modes, failed detection and unmapped jobs", () => {
    for (const changed of [{ event: "merge_group" }, { mode: "custom" }]) expect(() => assertRequiredResults({ identity: { ...identity, ...changed }, needs: docNeeds })).toThrow();
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, detect: { result: "failure", outputs: docs } } })).toThrow();
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, "upgrade-components": { result: "skipped" } } })).toThrow();
    expect(() => assertRequiredResults({ identity, needs: { ...docNeeds, detect: { result: "success", outputs: { ...docs, docs_only: "false", run_l1: "true" } } } })).toThrow();
  });
  it("rejects a green aggregate from another execution tree", () => {
    expect(() => assertRequiredResults({ identity: { ...identity, tree: "5".repeat(40) }, needs: docNeeds })).toThrow();
  });
  it("preserves full-acceptance even for docs-only PRs", () => {
    const labeled = { ...identity, fullAcceptance: true };
    const needs = { ...docNeeds, "build-and-test": { result: "success", outputs: { identity: JSON.stringify(labeled) } },
      detect: { result: "success", outputs: { ...docs, run_quality: "true", run_l2: "true" } },
      "acceptance-quality": { result: "success" }, "acceptance-local-non-hdc": { result: "success" } };
    expect(() => assertRequiredResults({ identity: labeled, needs })).not.toThrow();
  });
});

describe("L1 invocation receipts", () => {
  const report = (command: string) => ({ version: 1, command, identity, passed: 3, skipped: 0, files: 1, optionalSkips: {}, sha256: "a".repeat(64), filesSha256: "b".repeat(64) });
  const steps = (job: string) => Object.fromEntries(l1CommandIds[job].map((id) => [id, { outcome: "success", outputs: { report: JSON.stringify(report(id)) } }]));
  const receipts = () => Object.fromEntries(Object.keys(l1CommandIds).map((job) => [job, { result: "success", outputs: { receipt: JSON.stringify(createL1Receipt({ identity, job, steps: steps(job) })) } }]));
  const flags = { ...docs, docs_only: "false", run_l1: "true", run_quality: "true", run_smoke: "true" };
  it("requires every fixed command and report from the same run, attempt, SHA and tree", () => {
    const needs = { detect: { result: "success", outputs: flags }, ...receipts() };
    expect(() => assertL1Results({ identity, needs })).not.toThrow();
    for (const key of ["sha", "tree", "runId", "attempt", "head", "base"]) {
      const altered = { ...identity, [key]: ["runId", "attempt"].includes(key) ? "2" : "6".repeat(40) };
      expect(() => assertL1Results({ identity: altered, needs })).toThrow();
    }
    for (const result of ["skipped", "cancelled", "missing", "failure"]) expect(() => assertL1Results({ identity, needs: { ...needs, "l1-server": { result } } })).toThrow();
  });
  it("rejects a failed selected child even when its receipt is forged green", () => {
    const needs = { detect: { result: "success", outputs: flags }, ...receipts() };
    expect(() => assertL1Results({ identity, needs: { ...needs, "l1-server": { ...needs["l1-server"], result: "failure" } } })).toThrow();
  });
  it("does not turn a native report or digest into proof of a failed/missing command", () => {
    const selected = steps("l1-frontend");
    expect(() => createL1Receipt({ identity, job: "l1-frontend", steps: { ...selected, frontend: { ...selected.frontend, outcome: "failure" } } })).toThrow();
    expect(() => createL1Receipt({ identity, job: "l1-frontend", steps: { ...selected, frontend: { outcome: "success", outputs: {} } } })).toThrow();
    delete selected.install;
    expect(() => createL1Receipt({ identity, job: "l1-frontend", steps: selected })).toThrow();
  });
  it("keeps only DTS seed compile advisory", () => {
    const selected = steps("l1-scripts");
    selected.advisory.outcome = "failure";
    expect(() => createL1Receipt({ identity, job: "l1-scripts", steps: selected })).not.toThrow();
    selected.toolchain.outcome = "failure";
    expect(() => createL1Receipt({ identity, job: "l1-scripts", steps: selected })).toThrow();
  });
  it.each([
    ["l1-server", "ff4d3c7da48c45f7b33975d69db251e5"],
    ["l1-scripts", "24111a62073a40ca8fdefe3a90fe6230"],
  ] as const)("rejects Hosted toJSON(steps) extras and accepts the explicit %s projection", (job, generatedId) => {
    const hostedSteps = { ...steps(job), [generatedId]: { outcome: "success" } };
    expect(() => createL1Receipt({ identity, job, steps: hostedSteps })).toThrow();
    const projectedSteps = Object.fromEntries(l1CommandIds[job].map((id) => [id, hostedSteps[id]]));
    expect(() => createL1Receipt({ identity, job, steps: projectedSteps })).not.toThrow();
  });
  it("accepts the always-running docs-only aggregate without fake test receipts", () => {
    expect(() => assertL1Results({ identity, needs: { detect: docNeeds.detect, ...Object.fromEntries(Object.keys(l1CommandIds).map((job) => [job, { result: "skipped" }])) } })).not.toThrow();
  });
  it("validates shadow siblings against the already-verified native reports", () => {
    const native = (command: string) => report(command);
    const shadow = (command: string) => JSON.stringify(createUnavailableShadow({ identity, command: command as "frontend" | "scripts" | "bridge" | "server", native: native(command), error: "SHADOW_PLAN_INVALID" }));
    const needs = {
      detect: { result: "success", outputs: flags },
      "l1-frontend": { result: "success", outputs: { shadow_frontend: shadow("frontend") } },
      "l1-scripts": { result: "success", outputs: { shadow_scripts: shadow("scripts"), shadow_bridge: shadow("bridge") } },
      "l1-server": { result: "success", outputs: { shadow_server: shadow("server") } },
    };
    const nativeNeeds = { detect: { result: "success", outputs: flags }, ...receipts() };
    expect(() => assertShadowResults({ identity, needs, nativeNeeds })).not.toThrow();
    const forged = JSON.parse(needs["l1-server"].outputs.shadow_server);
    forged.nativeReportSha256 = "f".repeat(64);
    expect(() => assertShadowResults({ identity, needs: { ...needs, "l1-server": { result: "success", outputs: { shadow_server: JSON.stringify(forged) } } }, nativeNeeds })).toThrow();
  });
  it("rejects selection projections from unavailable and not-applicable shadows", () => {
    const unavailable = createUnavailableShadow({ identity, command: "frontend", native: report("frontend"), error: "SHADOW_PLAN_INVALID" });
    const unavailableSelected = { ...unavailable, modules: unavailable.modules.map((module, index) => index === 0 ? { ...module, selected: true, wouldSelectFileCount: 1, matchedCount: 1 } : module) };
    expect(() => assertShadowSummary(unavailableSelected, identity, "frontend", report("frontend"))).toThrow();

    const mainIdentity = { ...identity, event: "push", base: "", head: "", ref: "refs/heads/main" };
    const notApplicable = createNotApplicableShadow({ identity: mainIdentity, command: "frontend" });
    const notApplicableSelected = { ...notApplicable, modules: notApplicable.modules.map((module, index) => index === 0 ? { ...module, selected: true } : module) };
    expect(() => assertShadowSummary(notApplicableSelected, mainIdentity, "frontend")).toThrow();
  });
  it("keeps native Detect authoritative and settles every child before observing", () => {
    const native = (command: string) => report(command);
    const observed = (command: string) => ({ ...createUnavailableShadow({ identity, command: command as "frontend" | "scripts" | "bridge" | "server", native: native(command), error: "SHADOW_PLAN_INVALID" }),
      status: "observed" as const, error: null, planValid: true, fullFallback: false, selectionScope: "module-subset" as const,
      selectionDigest: "c".repeat(64), policyDigest: "a".repeat(64), registryDigest: "b".repeat(64) });
    const shadowNeeds = {
      detect: { result: "success", outputs: flags },
      "l1-frontend": { result: "success", outputs: { shadow_frontend: JSON.stringify(observed("frontend")) } },
      "l1-scripts": { result: "success", outputs: { shadow_scripts: JSON.stringify(observed("scripts")), shadow_bridge: JSON.stringify(observed("bridge")) } },
      "l1-server": { result: "success", outputs: { shadow_server: JSON.stringify(observed("server")) } },
    };
    const nativeNeeds = { detect: { result: "success", outputs: flags }, ...receipts() };
    const invoke = (payload: typeof shadowNeeds) => assertShadowResults({ identity, needs: payload, nativeNeeds });
    expect(() => invoke(shadowNeeds)).not.toThrow();
    expect(settleShadowResults({ identity, needs: shadowNeeds, nativeNeeds })).toEqual({ status: "observed", planValid: true, error: null });

    const suppressed = { ...shadowNeeds, detect: { result: "success", outputs: { ...flags, docs_only: "true", run_l1: "false", run_quality: "false", run_smoke: "false", run_l2: "false" } } };
    expect(() => invoke(suppressed)).toThrow();
    const unknownDetect = { ...shadowNeeds, detect: { result: "success", outputs: { ...flags, extra: "false" } } };
    expect(() => invoke(unknownDetect)).toThrow();
    const unknownEnvelope = { ...shadowNeeds, "l1-server": { result: "success", outputs: { shadow_server: shadowNeeds["l1-server"].outputs.shadow_server, unknown: "{}" } } };
    expect(() => invoke(unknownEnvelope)).toThrow();

    const unavailable = JSON.parse(shadowNeeds["l1-server"].outputs.shadow_server);
    unavailable.status = "unavailable";
    unavailable.error = "SHADOW_PLAN_INVALID";
    unavailable.planValid = false;
    unavailable.fullFallback = false;
    unavailable.selectionScope = "unavailable";
    unavailable.selectionDigest = null;
    unavailable.policyDigest = null;
    unavailable.registryDigest = null;
    unavailable.modules = unavailable.modules.map((module: Record<string, unknown>) => ({ ...module, selected: false, wouldSelectFileCount: 0, matchedCount: 0 }));
    const childUnavailable = { ...shadowNeeds, "l1-server": { result: "success", outputs: { shadow_server: JSON.stringify(unavailable) } } };
    expect(() => invoke(childUnavailable)).not.toThrow();
    expect(settleShadowResults({ identity, needs: childUnavailable, nativeNeeds })).toEqual({ status: "unavailable", planValid: false, error: "SHADOW_PLAN_INVALID" });

    const impossibleFallback = JSON.parse(shadowNeeds["l1-server"].outputs.shadow_server);
    impossibleFallback.fullFallback = true;
    impossibleFallback.selectionScope = "full-required";
    impossibleFallback.modules = impossibleFallback.modules.map((module: Record<string, unknown>) => ({ ...module, selected: false, wouldSelectFileCount: 0, matchedCount: 0 }));
    expect(() => invoke({ ...shadowNeeds, "l1-server": { result: "success", outputs: { shadow_server: JSON.stringify(impossibleFallback) } } })).toThrow();

    const mismatchedCounts = JSON.parse(shadowNeeds["l1-server"].outputs.shadow_server);
    mismatchedCounts.modules[0].matchedCount = mismatchedCounts.modules[0].wouldSelectFileCount + 1;
    expect(() => invoke({ ...shadowNeeds, "l1-server": { result: "success", outputs: { shadow_server: JSON.stringify(mismatchedCounts) } } })).toThrow();

    const mixedVector = JSON.parse(shadowNeeds["l1-server"].outputs.shadow_server);
    mixedVector.modules[0].selected = true;
    expect(() => invoke({ ...shadowNeeds, "l1-server": { result: "success", outputs: { shadow_server: JSON.stringify(mixedVector) } } })).toThrow();
  });
  it("rejects a mixed common shadow policy association while retaining command-specific native hashes", () => {
    const native = (command: string) => report(command);
    const observed = (command: string) => ({ ...createUnavailableShadow({ identity, command: command as "frontend" | "scripts" | "bridge" | "server", native: native(command), error: "SHADOW_PLAN_INVALID" }),
      status: "observed" as const, error: null, planValid: true, fullFallback: false, selectionScope: "module-subset" as const,
      selectionDigest: "c".repeat(64), policyDigest: "a".repeat(64), registryDigest: "b".repeat(64) });
    const shadowNeeds = {
      detect: { result: "success", outputs: flags },
      "l1-frontend": { result: "success", outputs: { shadow_frontend: JSON.stringify(observed("frontend")) } },
      "l1-scripts": { result: "success", outputs: { shadow_scripts: JSON.stringify(observed("scripts")), shadow_bridge: JSON.stringify(observed("bridge")) } },
      "l1-server": { result: "success", outputs: { shadow_server: JSON.stringify(observed("server")) } },
    };
    const nativeNeeds = { detect: { result: "success", outputs: flags }, ...receipts() };
    expect(() => assertShadowResults({ identity, needs: shadowNeeds, nativeNeeds })).not.toThrow();
    expect(() => assertShadowSummary({ ...observed("frontend"), selectionDigest: null, fullFallback: true, selectionScope: "full-required" }, identity, "frontend", native("frontend"))).toThrow();
    const mixed = JSON.parse(shadowNeeds["l1-server"].outputs.shadow_server);
    mixed.registryDigest = "d".repeat(64);
    expect(() => assertShadowResults({ identity, needs: { ...shadowNeeds, "l1-server": { result: "success", outputs: { shadow_server: JSON.stringify(mixed) } } }, nativeNeeds })).toThrow();
    const extra = { ...shadowNeeds, "l1-server": { result: "success", outputs: { shadow_server: shadowNeeds["l1-server"].outputs.shadow_server, unknown: "{}" } } };
    expect(() => assertShadowResults({ identity, needs: extra, nativeNeeds })).toThrow();
    const impossible = JSON.parse(shadowNeeds["l1-frontend"].outputs.shadow_frontend);
    impossible.modules[0].selected = false;
    impossible.modules[0].matchedCount = 1;
    expect(() => assertShadowResults({ identity, needs: { ...shadowNeeds, "l1-frontend": { result: "success", outputs: { shadow_frontend: JSON.stringify(impossible) } } }, nativeNeeds })).toThrow();
    const oversized = JSON.parse(shadowNeeds["l1-frontend"].outputs.shadow_frontend);
    oversized.modules[0].wouldSelectFileCount = oversized.actualFullFileCount + 1;
    expect(() => assertShadowResults({ identity, needs: { ...shadowNeeds, "l1-frontend": { result: "success", outputs: { shadow_frontend: JSON.stringify(oversized) } } }, nativeNeeds })).toThrow();
  });
  it("keeps non-PR shadow explicitly not applicable", () => {
    const mainIdentity = { ...identity, event: "push", base: "", head: "", ref: "refs/heads/main" };
    const shadow = createNotApplicableShadow({ identity: mainIdentity, command: "frontend" });
    expect(shadow).toMatchObject({ status: "not-applicable", planValid: false, error: "NOT_APPLICABLE" });
  });
  it("keeps malformed shadow outside the original standalone aggregate result", () => {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
    const mainIdentity = { ...identity, event: "push", base: "", head: "", ref: "refs/heads/main", sha, tree };
    const nativeSteps = (job: string) => Object.fromEntries(l1CommandIds[job].map((id) => [id, {
      outcome: "success", outputs: { report: JSON.stringify({ ...report(id), identity: mainIdentity }) },
    }]));
    const nativeNeeds = { detect: { result: "success", outputs: { docs_only: "false", run_l1: "true", run_quality: "true", run_smoke: "false", run_l2: "true" } },
      ...Object.fromEntries(Object.keys(l1CommandIds).map((job) => [job, { result: "success", outputs: { receipt: JSON.stringify(createL1Receipt({ identity: mainIdentity, job, steps: nativeSteps(job) })) } }])),
    };
    const env = { ...process.env, PATH: "/usr/bin:/bin", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main", GITHUB_SHA: sha,
      GITHUB_RUN_ID: "100", GITHUB_RUN_ATTEMPT: "1", EFF_BASE_SHA: "", EFF_HEAD_SHA: "", EFF_MODE: "", EFF_FULL_ACCEPTANCE: "false",
      EFF_NEEDS: JSON.stringify(nativeNeeds), GITHUB_OUTPUT: path.join(os.tmpdir(), "wiseeff-ci-shadow-aggregate-output") };
    const invoke = (extra: Record<string, string>) => spawnSync(process.execPath, ["--experimental-strip-types", "scripts/ci-required-results.ts", "l1"], { cwd: process.cwd(), env: { ...env, ...extra }, encoding: "utf8" });
    const clean = invoke({});
    const malformed = invoke({ EFF_SHADOW: "{}" });
    const oversized = invoke({ EFF_SHADOW: "x".repeat(70 * 1024) });
    const unknown = invoke({ EFF_SHADOW: JSON.stringify({ identity: mainIdentity, needs: {} }) });
    const originalFailure = invoke({ EFF_SHADOW: "{}", EFF_NEEDS: JSON.stringify({ ...nativeNeeds, "l1-server": { result: "failure", outputs: { receipt: "" } } }) });
    rmSync(env.GITHUB_OUTPUT, { force: true });
    expect(clean.status).toBe(0);
    expect(malformed.status).toBe(0);
    expect(oversized.status).toBe(0);
    expect(unknown.status).toBe(0);
    expect(originalFailure.status).not.toBe(0);
    expect(clean.stdout).toContain("CI shadow: not-applicable; planValid:false");
    expect(malformed.stdout).toContain("CI shadow: not-applicable; planValid:false");
    expect(oversized.stdout).toContain("CI shadow: not-applicable; planValid:false");
    expect(unknown.stdout).toContain("CI shadow: not-applicable; planValid:false");
  });
  it("records the applicable CLI shadow settlement matrix with stdout and exit", () => {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
    const prIdentity = { ...identity, sha, tree };
    const nativeReport = (command: string) => ({ ...report(command), identity: prIdentity });
    const nativeSteps = (job: string, nativeIdentity = prIdentity) => Object.fromEntries(l1CommandIds[job].map((id) => [id, {
      outcome: "success", outputs: { report: JSON.stringify({ ...report(id), identity: nativeIdentity }) },
    }]));
    const nativeNeeds = { detect: { result: "success", outputs: flags },
      ...Object.fromEntries(Object.keys(l1CommandIds).map((job) => [job, { result: "success", outputs: { receipt: JSON.stringify(createL1Receipt({ identity: prIdentity, job, steps: nativeSteps(job) })) } }])) };
    const shadow = (command: string, value = createUnavailableShadow({ identity: prIdentity, command: command as "frontend" | "scripts" | "bridge" | "server", native: nativeReport(command), error: "SHADOW_PLAN_INVALID" })) => JSON.stringify(value);
    const allUnavailable = {
      detect: { result: "success", outputs: flags },
      "l1-frontend": { result: "success", outputs: { shadow_frontend: shadow("frontend") } },
      "l1-scripts": { result: "success", outputs: { shadow_scripts: shadow("scripts"), shadow_bridge: shadow("bridge") } },
      "l1-server": { result: "success", outputs: { shadow_server: shadow("server") } },
    };
    const observed = (command: string) => ({ ...createUnavailableShadow({ identity: prIdentity, command: command as "frontend" | "scripts" | "bridge" | "server", native: nativeReport(command), error: "SHADOW_PLAN_INVALID" }),
      status: "observed" as const, error: null, planValid: true, selectionScope: "module-subset" as const,
      selectionDigest: "c".repeat(64), policyDigest: "a".repeat(64), registryDigest: "b".repeat(64) });
    const allObserved = {
      detect: { result: "success", outputs: flags },
      "l1-frontend": { result: "success", outputs: { shadow_frontend: shadow("frontend", observed("frontend")) } },
      "l1-scripts": { result: "success", outputs: { shadow_scripts: shadow("scripts", observed("scripts")), shadow_bridge: shadow("bridge", observed("bridge")) } },
      "l1-server": { result: "success", outputs: { shadow_server: shadow("server", observed("server")) } },
    };
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const childNames = ["frontend", "scripts", "bridge", "server"] as const;
    const childLocation = (command: typeof childNames[number]) => command === "frontend" ? ["l1-frontend", "shadow_frontend"] as const
      : command === "scripts" ? ["l1-scripts", "shadow_scripts"] as const
        : command === "bridge" ? ["l1-scripts", "shadow_bridge"] as const : ["l1-server", "shadow_server"] as const;
    const mutateChild = (command: typeof childNames[number], mutation: (value: Record<string, unknown>) => unknown) => {
      const value = clone(allObserved) as Record<string, { outputs: Record<string, string> }>;
      const [job, output] = childLocation(command);
      value[job].outputs[output] = JSON.stringify(mutation(JSON.parse(value[job].outputs[output])));
      return value;
    };
    const mainIdentity = { ...prIdentity, event: "push" as const, base: "", head: "", ref: "refs/heads/main" };
    const mainFlags = { docs_only: "false", run_l1: "true", run_quality: "true", run_smoke: "false", run_l2: "true" };
    const mainNeeds = { detect: { result: "success", outputs: mainFlags },
      ...Object.fromEntries(Object.keys(l1CommandIds).map((job) => [job, { result: "success", outputs: { receipt: JSON.stringify(createL1Receipt({ identity: mainIdentity, job, steps: nativeSteps(job, mainIdentity) })) } }])) };
    const cases: Array<{ name: string; shadow: unknown; needs?: unknown; event?: "pull_request" | "push"; expectedExit: number; expectedState: "observed" | "unavailable" | "not-applicable" | null }> = [
      { name: "all-observed", shadow: allObserved, expectedExit: 0, expectedState: "observed" },
      { name: "all-unavailable", shadow: allUnavailable, expectedExit: 0, expectedState: "unavailable" },
      ...childNames.flatMap((command) => [
        { name: `${command}-missing`, shadow: (() => { const value = clone(allObserved); const [job, output] = childLocation(command); delete value[job].outputs[output]; return value; })(), expectedExit: 0, expectedState: "unavailable" as const },
        { name: `${command}-unavailable`, shadow: (() => { const value = clone(allObserved); const [job, output] = childLocation(command); value[job].outputs[output] = shadow(command); return value; })(), expectedExit: 0, expectedState: "unavailable" as const },
        { name: `${command}-malformed`, shadow: mutateChild(command, () => ({})), expectedExit: 0, expectedState: "unavailable" as const },
        { name: `${command}-wrong-identity`, shadow: mutateChild(command, (value) => ({ ...value, identity: { ...prIdentity, sha: "f".repeat(40) } })), expectedExit: 0, expectedState: "unavailable" as const },
      ]),
      { name: "count-contradiction", shadow: mutateChild("frontend", (value) => ({ ...value, modules: (value.modules as Array<Record<string, unknown>>).map((module, index) => index === 0 ? { ...module, matchedCount: 2 } : module) })), expectedExit: 0, expectedState: "unavailable" },
      { name: "vector-contradiction", shadow: mutateChild("server", (value) => ({ ...value, modules: (value.modules as Array<Record<string, unknown>>).map((module, index) => index === 0 ? { ...module, selected: true } : module) })), expectedExit: 0, expectedState: "unavailable" },
      { name: "digest-contradiction", shadow: mutateChild("frontend", (value) => ({ ...value, nativeReportSha256: "f".repeat(64) })), expectedExit: 0, expectedState: "unavailable" },
      { name: "full-fallback-contradiction", shadow: mutateChild("frontend", (value) => ({ ...value, fullFallback: true, selectionScope: "full-required" })), expectedExit: 0, expectedState: "unavailable" },
      { name: "envelope-contradiction", shadow: (() => { const value = clone(allObserved); value["l1-server"].outputs.unknown = "{}"; return value; })(), expectedExit: 0, expectedState: "unavailable" },
      ...(["failure", "cancelled", "skipped"] as const).map((result) => ({ name: `native-${result}`, shadow: allObserved, needs: { ...clone(nativeNeeds), "l1-server": result === "skipped" ? { result } : { result, outputs: { receipt: "" } } }, expectedExit: 1, expectedState: null })),
    ];
    cases.push({ name: "non-pr-not-applicable", shadow: {}, needs: mainNeeds, event: "push", expectedExit: 0, expectedState: "not-applicable" });
    const evidenceDirectory = path.resolve("work/efficiency/ci-shadow-p2");
    mkdirSync(evidenceDirectory, { recursive: true, mode: 0o700 });
    const evidenceRoot = mkdtempSync(path.join(evidenceDirectory, "cli-"));
    const baseEnv = (event: "pull_request" | "push", needs: unknown) => ({ ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: event === "push" ? "refs/heads/main" : "refs/pull/828/merge", GITHUB_SHA: sha,
      GITHUB_RUN_ID: "100", GITHUB_RUN_ATTEMPT: "1", EFF_BASE_SHA: event === "push" ? "" : "1".repeat(40), EFF_HEAD_SHA: event === "push" ? "" : "2".repeat(40), EFF_MODE: "", EFF_FULL_ACCEPTANCE: "false", EFF_NEEDS: JSON.stringify(needs) });
    const invoke = (testCase: (typeof cases)[number], index: number) => {
      const output = path.join(evidenceRoot, `${String(index).padStart(2, "0")}-${testCase.name}.output`);
      const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/ci-required-results.ts", "l1"], { cwd: process.cwd(), env: { ...baseEnv(testCase.event ?? "pull_request", testCase.needs ?? nativeNeeds), EFF_SHADOW: JSON.stringify(testCase.shadow), GITHUB_OUTPUT: output }, encoding: "utf8" });
      writeFileSync(path.join(evidenceRoot, `${String(index).padStart(2, "0")}-${testCase.name}.stdout`), result.stdout ?? "");
      writeFileSync(path.join(evidenceRoot, `${String(index).padStart(2, "0")}-${testCase.name}.stderr`), result.stderr ?? "");
      return result;
    };
    const results = cases.map((testCase, index) => ({ testCase, result: invoke(testCase, index) }));
    writeFileSync(path.join(evidenceRoot, "cases.json"), JSON.stringify({ identity: prIdentity, evidenceRoot, cases: results.map(({ testCase, result }) => ({ name: testCase.name, expectedExit: testCase.expectedExit, expectedState: testCase.expectedState, actualExit: result.status, stdout: result.stdout, stderr: result.stderr })) }));
    for (const { testCase, result } of results) {
      expect(result.status, testCase.name).toBe(testCase.expectedExit);
      if (testCase.expectedState) expect(result.stdout, testCase.name).toContain(`CI shadow: ${testCase.expectedState}; planValid:${testCase.expectedState === "observed" ? "true" : "false"}`);
      else expect(result.stdout, testCase.name).not.toContain("CI shadow:");
    }
  });
  it("reads only a fresh private regular report and rejects symlinks and missing reports", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "ci-report-test-"));
    try {
      const file = path.join(directory, "report.json");
      expect(() => readPrivateReport(file)).toThrow();
      writeFileSync(file, "{}");
      expect(readPrivateReport(file).toString()).toBe("{}");
      const link = path.join(directory, "link.json");
      symlinkSync(file, link);
      expect(() => readPrivateReport(link)).toThrow();
      const hardlink = path.join(directory, "hard.json");
      linkSync(file, hardlink);
      expect(() => readPrivateReport(file)).toThrow();
      rmSync(hardlink);
      chmodSync(directory, 0o755);
      expect(() => readPrivateReport(file)).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe("native test report completeness", () => {
  // Shape observed from Vitest 4.1.5: nested describe counts as suites, not files.
  const options = { command: "frontend", root: "/repo", startedAt: 100, finishedAt: 400, platform: "linux", missingPathDts: false, missingRehearsalContainer: false };
  const passed = { ancestorTitles: ["outer", "inner"], title: "passes", status: "passed", failureMessages: [] };
  const native = () => ({ numTotalTestSuites: 3, numPassedTestSuites: 3, numFailedTestSuites: 0, numPendingTestSuites: 0,
    numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, startTime: 200, success: true,
    testResults: [{ name: "/repo/src/example.test.ts", status: "passed", message: "", assertionResults: [passed] }] });
  it("rejects an absent native report even if a command returned success", () => {
    expect(() => validateNativeReport(null, ["/repo/src/example.test.ts"], options)).toThrow();
  });
  it("reconciles assertion counts without equating nested suites to file count", () => {
    expect(validateNativeReport(native(), ["/repo/src/example.test.ts"], options)).toEqual({ passed: 1, skipped: 0, files: 1, optionalSkips: {} });
  });
  it.each(["numTotalTests", "numPassedTests", "numPendingTests", "numTodoTests", "numFailedTestSuites"])("rejects inconsistent %s", (key) => {
    expect(() => validateNativeReport({ ...native(), [key]: 2 }, ["/repo/src/example.test.ts"], options)).toThrow();
  });
  it("rejects missing files, duplicate files, empty suites, stale reports and all-required-skipped", () => {
    for (const report of [
      { ...native(), testResults: [] }, { ...native(), testResults: [native().testResults[0], native().testResults[0]] },
      { ...native(), startTime: 99 },
      { ...native(), testResults: [{ ...native().testResults[0], assertionResults: [] }] },
      { ...native(), numPassedTests: 0, numPendingTests: 1, testResults: [{ ...native().testResults[0], assertionResults: [{ ...passed, status: "skipped" }] }] },
    ]) expect(() => validateNativeReport(report, ["/repo/src/example.test.ts"], options)).toThrow();
  });
  it("allows only the exact optional DTS suite when its current tool condition is absent", () => {
    const file = "/repo/scripts/vendorDtSchemaGenerator.test.ts";
    const assertion = { ...passed, ancestorTitles: ["vendor schema real dt-validate fixtures"], status: "skipped" };
    const report = { ...native(), numTotalTests: 2, numPendingTests: 1, testResults: [{ ...native().testResults[0], name: file, assertionResults: [passed, assertion] }] };
    const optional = { ...options, command: "scripts", missingPathDts: true };
    expect(validateNativeReport(report, [file], optional).optionalSkips).toEqual({ "missing-path-dts": 1 });
    expect(() => validateNativeReport(report, [file], { ...optional, missingPathDts: false })).toThrow();
    expect(() => validateNativeReport({ ...report, testResults: [{ ...report.testResults[0], assertionResults: [passed, { ...assertion, ancestorTitles: ["required"] }] }] }, [file], optional)).toThrow();
  });
});
