import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../server/shared/database/client";
import { parseMigrationEnvironment, runManagementMigrations, runControlledManagementMigrations } from "./migrate";

const syntheticUrl = "postgres://synthetic:private-test-value@invalid.invalid/synthetic";
function fixture() {
  const close = vi.fn(async () => undefined);
  const db: Database & { close(): Promise<void> } = {
    query: async <Row>() => ({ rows: [] as Row[], rowCount: 0 }),
    transaction: async (work) => work(db),
    close,
  };
  return {
    close,
    ports: {
      open: vi.fn(() => db),
      apply: vi.fn(async () => ["owned-fixture.sql"]),
      prepareCheckpoints: vi.fn(async () => ({ status: "ensured" as const })),
    },
  };
}

describe("minimal management migration environment", () => {
  it.each(["candidateArtifactSha", "candidateArtifactTree"])("refuses missing candidate identity %s before lock or database", async missing => {
    const pin = `sha256:${"a".repeat(64)}`;
    const target = { systemIdentifier: "1", databaseOid: "1" };
    const intent: Record<string, unknown> = { version: "pcat-management-migration-intent-v1", runId: "candidate-pin",
      preparationPlanDigest: pin, target, candidateArtifactSha: "b".repeat(40), candidateArtifactTree: "c".repeat(40),
      sourceSnapshotDigest: pin, candidateInventoryDigest: pin, writeFenceReceiptDigest: pin, recoveryManifestDigest: pin, checkpointMode: "memory" };
    delete intent[missing];
    const assertHeld = vi.fn(async () => { throw new Error("must not acquire"); });
    const input = { intent, descriptor: { digest: pin, candidateInventoryDigest: pin, target }, expectedDescriptorDigest: pin,
      candidateMigrationsDirectory: "/unused", operationLock: { assertHeld }, boundary: { verify: async () => {} },
      journal: { begin: async () => ({ attemptId: "unused" }), finish: async () => {}, unknown: async () => {} } };
    await expect(runControlledManagementMigrations({ DATABASE_URL: syntheticUrl }, input as unknown as Parameters<typeof runControlledManagementMigrations>[1]))
      .rejects.toThrow("management-migration-pins-invalid");
    expect(assertHeld).not.toHaveBeenCalled();
  });
  it("refuses controlled migration without live lock, boundary and journal context before opening a database", async () => {
    await expect(runControlledManagementMigrations({ DATABASE_URL: syntheticUrl }, undefined as unknown as Parameters<typeof runControlledManagementMigrations>[1]))
      .rejects.toThrow("management-migration-context-required");
  });
  it("requires only the management connection and retains the memory checkpoint default", () => {
    expect(parseMigrationEnvironment({ DATABASE_URL: syntheticUrl, NODE_ENV: "production" }))
      .toEqual({ connectionString: syntheticUrl, mode: "memory" });
    expect(parseMigrationEnvironment({ DATABASE_URL: syntheticUrl, XIAOZE_CHECKPOINTER: "postgres" }).mode).toBe("postgres");
  });
  it.each([{}, { DATABASE_URL: "" }, { DATABASE_URL: "  " }])("rejects missing connections before creating a pool: %j", async (raw) => {
    const { ports } = fixture();
    await expect(runManagementMigrations(raw, ports)).rejects.toMatchObject({ code: "database-url-required" });
    expect(ports.open).not.toHaveBeenCalled();
  });
  it.each(["", "unknown", "POSTGRES", "postgres "])("rejects unknown checkpoint mode before a pool: %s", async (mode) => {
    const { ports } = fixture();
    await expect(runManagementMigrations({ DATABASE_URL: syntheticUrl, XIAOZE_CHECKPOINTER: mode }, ports))
      .rejects.toMatchObject({ code: "checkpoint-mode-invalid" });
    expect(ports.open).not.toHaveBeenCalled();
  });
  it("closes the managed root after successful checkpoint preparation", async () => {
    const { ports, close } = fixture();
    expect(await runManagementMigrations({ DATABASE_URL: syntheticUrl, XIAOZE_CHECKPOINTER: "postgres" }, ports))
      .toEqual({ applied: ["owned-fixture.sql"], checkpoint: { status: "ensured" } });
    expect(ports.prepareCheckpoints).toHaveBeenCalledWith({ connectionString: syntheticUrl, mode: "postgres" });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("sanitizes an open failure", async () => {
    const { ports } = fixture();
    ports.open.mockImplementation(() => { throw new Error(syntheticUrl); });
    await expect(runManagementMigrations({ DATABASE_URL: syntheticUrl }, ports))
      .rejects.toMatchObject({ code: "database-open-failed", message: "database-open-failed" });
  });
  it("preserves the migration failure and closes without attempting checkpoint setup", async () => {
    const { ports, close } = fixture();
    ports.apply.mockRejectedValue(new Error(syntheticUrl));
    close.mockRejectedValue(new Error(syntheticUrl));
    await expect(runManagementMigrations({ DATABASE_URL: syntheticUrl }, ports))
      .rejects.toMatchObject({ code: "migration-failed", message: "migration-failed", cleanupFailed: true });
    expect(ports.prepareCheckpoints).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("closes after checkpoint failure without exposing its raw exception", async () => {
    const { ports, close } = fixture();
    ports.prepareCheckpoints.mockRejectedValue(new Error(syntheticUrl));
    await expect(runManagementMigrations({ DATABASE_URL: syntheticUrl }, ports))
      .rejects.toMatchObject({ code: "checkpoint-setup-failed", message: "checkpoint-setup-failed" });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("does not report success when closing the managed root fails", async () => {
    const { ports, close } = fixture();
    close.mockRejectedValue(new Error(syntheticUrl));
    await expect(runManagementMigrations({ DATABASE_URL: syntheticUrl }, ports))
      .rejects.toMatchObject({ code: "database-close-failed", message: "database-close-failed" });
  });
  it("rejects actual CLI bad inputs without loading checkout dotenv or opening a database", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "wiseeff-migration-cli-input-"));
    try {
      for (const raw of [{}, { DATABASE_URL: syntheticUrl, XIAOZE_CHECKPOINTER: "invalid-secret-mode" }]) {
        const result = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), path.resolve("scripts/migrate.ts")], {
          cwd,
          env: { PATH: process.env.PATH, NODE_ENV: "production", ...raw },
          encoding: "utf8", timeout: 10000,
        });
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toMatch(/Management migration failed: (database-url-required|checkpoint-mode-invalid)/);
        expect(result.stderr).not.toContain("private-test-value");
        expect(result.stderr).not.toContain("invalid-secret-mode");
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  it("rejects actual CLI unknown/controlled-looking flags before any connection", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "wiseeff-migration-cli-flags-"));
    try {
      for (const flag of ["--controlled", "--diagnostic", "--unknown-private-value"]) {
        const result = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), path.resolve("scripts/migrate.ts"), flag], {
          cwd, env: { PATH: process.env.PATH, DATABASE_URL: syntheticUrl, NODE_ENV: "production" }, encoding: "utf8", timeout: 10000,
        });
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("migration-arguments-invalid");
        expect(result.stderr).not.toContain("private-test-value");
        expect(result.stderr).not.toContain(flag);
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
