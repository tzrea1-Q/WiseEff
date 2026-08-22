import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OWNED_ACCEPTANCE_DESCRIPTOR_ENV } from "../e2e/acceptance/helpers/ownedRuntimeDescriptor";
import {
  OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV,
  initializeNestedRuntimeManifest,
  recordNestedRuntimeFinish,
  recordNestedRuntimeStart,
} from "../e2e/acceptance/helpers/nestedRuntimeManifest";
import {
  applyDisposableRuntimeEnv,
  captureProcessEnvForDisposableRuntime,
  restoreProcessEnvFromDisposableRuntime,
} from "../e2e/acceptance/helpers/semanticBindingFixture";
import type { DisposablePostCutoverRuntime } from "../e2e/acceptance/helpers/disposablePostCutoverRuntime";

afterEach(() => vi.unstubAllEnvs());

describe("Gate0 nested disposable runtime contract", () => {
  it("records secret-free child resources and exact lifecycle in the parent run manifest", () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), "wiseeff-nested-runtime-"));
    const manifestPath = path.join(runRoot, "nested-runtime-manifest.json");
    initializeNestedRuntimeManifest(manifestPath, {
      parentRunId: "full-owned",
      sourceCommit: "0123456789012345678901234567890123456789",
    });
    recordNestedRuntimeStart(manifestPath, {
      id: "wiseeff_acceptance_disposable_child",
      databaseName: "wiseeff_acceptance_disposable_child",
      markerPurpose: "parameter-topology",
      migrationRunId: "migration-child",
      objectStoreRoot: path.join(runRoot, "object-child"),
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      apiPid: 111,
      frontendPid: 222,
    });
    recordNestedRuntimeFinish(manifestPath, "wiseeff_acceptance_disposable_child", "cleaned");

    const raw = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { children: Array<Record<string, unknown>> };
    expect(raw).not.toContain("postgres://");
    expect(raw).not.toContain("auth-secret");
    expect(manifest.children).toContainEqual(
      expect.objectContaining({
        id: "wiseeff_acceptance_disposable_child",
        state: "cleaned",
        databaseName: "wiseeff_acceptance_disposable_child",
        apiPid: 111,
        frontendPid: 222,
      }),
    );
  });

  it("unsets only the root descriptor during child runtime use and restores it afterward", () => {
    vi.stubEnv(OWNED_ACCEPTANCE_DESCRIPTOR_ENV, "/tmp/root-owned-runtime.json");
    vi.stubEnv(OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV, "parent-scope");
    const snapshot = captureProcessEnvForDisposableRuntime();
    const runtime = {
      databaseUrl: "postgres://child-runtime",
      databaseName: "wiseeff_acceptance_disposable_child",
      migrationRunId: "migration-child",
      markerPurpose: "parameter-topology",
      apiUrl: "http://127.0.0.1:19100",
      frontendUrl: "http://127.0.0.1:5190",
      authIssuer: "child-issuer",
      authSecret: "child-secret",
      nestedRuntimeId: "wiseeff_acceptance_disposable_child",
      dispose: async () => undefined,
    } satisfies DisposablePostCutoverRuntime;

    applyDisposableRuntimeEnv(runtime);
    expect(process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]).toBeUndefined();
    expect(process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]).toBe(runtime.nestedRuntimeId);

    restoreProcessEnvFromDisposableRuntime(snapshot);
    expect(process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]).toBe("/tmp/root-owned-runtime.json");
    expect(process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]).toBe("parent-scope");
  });
});
