import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createShadowObservation, createUnavailableShadow } from "./ci-shadow";

const identity = {
  event: "pull_request", mode: "", fullAcceptance: false, ref: "refs/pull/828/merge",
  base: "1".repeat(40), head: "2".repeat(40), sha: "3".repeat(40), tree: "4".repeat(40), runId: "100", attempt: "1",
};
const registry = [
  { id: "feedback-client", status: "observation-pending", risk: "R2", paths: [], consumers: [], dependencies: [], tasks: { "frontend-tests": ["src/client.test.ts"] }, browser: { spec: "e2e/client.spec.ts", pages: ["/"], roles: ["User"], flows: ["read"], environment: "owned-postgres-browser" } },
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
    expect(shadow.modules[0]).toMatchObject({ id: "feedback-client", status: "observation-pending", selected: true, wouldSelectFileCount: 1, matchedCount: 1, actualFullFileCount: 2 });
    expect(JSON.stringify(shadow)).not.toContain("src/client.test.ts");
  });

  it("records an invalid fixed-code observation without claiming a plan", () => {
    const shadow = createUnavailableShadow({ identity, command: "frontend", native, error: "SHADOW_PLAN_INVALID" });
    expect(shadow).toMatchObject({ status: "unavailable", planValid: false, error: "SHADOW_PLAN_INVALID", command: "frontend" });
  });
});
