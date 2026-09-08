import { expect, it, vi } from "vitest";
import { createActivationIntent, createApplicationReadActivation, readComparisonMappingFactsOnHeldSession, type ActivationOptions } from "./index";

it("inspects on the existing management transaction without reacquiring its S7 lock or owning its commit", async () => {
  const target = { systemIdentifier: "123", databaseOid: "456" };
  const client = { query: vi.fn(async (sql: string) => {
    if (sql.includes("pg_control_system")) return { rowCount: 1, rows: [target] };
    if (sql.includes("transaction_isolation")) return { rowCount: 1, rows: [{ same_identity: true, manager: true, isolation: "serializable", timezone: "UTC", locked: true }] };
    return { rowCount: 0, rows: [] };
  }) };
  const verify = vi.fn(async () => undefined);
  const activation = createApplicationReadActivation({ target, boundary: { verify } } as unknown as ActivationOptions);
  const intent = createActivationIntent({ target, runId: "run", attemptId: "attempt", predecessorBindingDigest: null,
    planDigest: `sha256:${"1".repeat(64)}`, reportDigest: `sha256:${"2".repeat(64)}`, expectedObservationDigest: `sha256:${"3".repeat(64)}` });
  await expect(activation.inspectOnHeldManagementSession(intent, client as never)).rejects.toThrow("PCAT-ACTIVATION-RUN-MISMATCH");
  const calls = client.query.mock.calls.map(([sql]) => sql);
  expect(calls.some(sql => sql.startsWith("savepoint "))).toBe(true);
  expect(calls.some(sql => sql.startsWith("release savepoint "))).toBe(true);
  expect(calls.some(sql => /^(begin|commit|rollback|set |reset |insert |update |delete |alter )/i.test(sql) || sql.includes("pg_try_advisory_lock"))).toBe(false);
  expect(verify).toHaveBeenCalled();
});

it("does not treat a session isolation default as an active held comparison transaction", async () => {
  const target = { systemIdentifier: "123", databaseOid: "456" };
  const client = { query: vi.fn(async (sql: string) => {
    if (sql.includes("pg_control_system")) return { rowCount: 1, rows: [target] };
    if (sql.includes("transaction_isolation")) return { rowCount: 1, rows: [{ same_identity: true, manager: true,
      isolation: "repeatable read", timezone: "UTC", locked: true }] };
    if (sql.startsWith("savepoint ")) throw Object.assign(new Error("no transaction"), { code: "25P01" });
    return { rowCount: 0, rows: [] };
  }) };
  await expect(readComparisonMappingFactsOnHeldSession({ client: client as never, target, runId: "run",
    planDigest: `sha256:${"1".repeat(64)}`, verifyBoundary: async () => undefined })).rejects.toThrow("PCAT-ACTIVATION-HELD-SESSION-UNAVAILABLE");
  expect(client.query.mock.calls.some(([sql]) => sql.includes("parameter_catalog_cutover_runs"))).toBe(false);
});

it("rejects an unsafe management resolution path before its first physical identity read", async () => {
  const client = { query: vi.fn(async (sql: string) => {
    if (sql.includes("current_schemas")) return { rows: [{ schemas: ["public", "pg_catalog"] }], rowCount: 1 };
    if (sql.includes("pg_control_system")) return { rows: [{ systemIdentifier: "123", databaseOid: "456" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }) };
  await expect(readComparisonMappingFactsOnHeldSession({ client: client as never,
    target: { systemIdentifier: "123", databaseOid: "456" }, runId: "run", planDigest: `sha256:${"1".repeat(64)}`,
    verifyBoundary: async () => undefined })).rejects.toThrow("PCAT-ACTIVATION-HELD-SESSION-REJECTED");
  expect(client.query.mock.calls.some(([sql]) => sql.includes("pg_control_system") || /^set /i.test(sql))).toBe(false);
});
