import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { assertComparisonDatabaseSource, openComparisonDatabaseV2 } from "./databaseSource";

// Native pg.Client/Socket/EventEmitter objects with explicit transport/SQL
// doubles. These are checkout lifecycle tests, not authenticated PostgreSQL.
vi.mock("../../catalog-cutover/activation", () => ({ readComparisonMappingFactsOnHeldSession: async () => ({}) }));
const target = { systemIdentifier: "100", databaseOid: "101" };
let manager: pg.PoolClient & pg.Client;
let native: pg.PoolClient & pg.Client;
let observedTarget = target;
let held = true;
let rootClosed = false;
let boundary: () => Promise<void>;
let releaseBoundary: (() => void) | undefined;
const resources: Array<{ close(): Promise<void> }> = [];

function client(pid: number) {
  const value = Object.assign(new pg.Client(), { release: vi.fn() });
  Reflect.set(value, "processID", pid);
  Object.defineProperties(value.connection.stream, { remoteAddress: { value: "127.0.0.1" }, remotePort: { value: 15432, configurable: true } });
  vi.spyOn(value, "end").mockImplementation(async () => { value.emit("end"); });
  vi.spyOn(value, "query").mockImplementation(((text: string, ...args: unknown[]) => {
    const result = text.includes("pg_control_system") ? { rowCount: 1, rows: [{ system_identifier: observedTarget.systemIdentifier, database_oid: observedTarget.databaseOid }] } :
      text.includes("pg_advisory_xact_lock") ? { rowCount: 1, rows: [{ pid, username: "manager", database: "source" }] } :
      text.includes("current_schemas") ? { rowCount: 1, rows: [{ pid, username: "manager", same_identity: true, schemas: ["pg_catalog", "public"], held }] } :
      { rowCount: 1, rows: [{ value: 1 }] };
    const callback = args.at(-1);
    if (typeof callback === "function") { callback(undefined, result); return; }
    return Promise.resolve(result);
  }) as never);
  return value;
}
const input = () => ({ connectionString: "postgresql://manager:private@127.0.0.1:15432/source", managementClient: manager,
  target, cutoverRunId: "run", planPin: `sha256:${"1".repeat(64)}`, verifyBoundary: boundary });

beforeEach(() => {
  observedTarget = target; held = true; rootClosed = false;
  boundary = async () => undefined;
  manager = client(100); native = client(101);
  const pools = new WeakSet<pg.Pool>();
  vi.spyOn(pg.Pool.prototype, "connect").mockImplementation((function (this: pg.Pool, callback: (error: Error | undefined, value?: pg.PoolClient) => void) {
    if (Reflect.get(this, "ending")) { callback(new Error("pool ended")); return; }
    if (!pools.has(this)) { pools.add(this); this.emit("connect", native); }
    callback(undefined, native);
  }) as never);
  const originalEnd = pg.Pool.prototype.end;
  vi.spyOn(pg.Pool.prototype, "end").mockImplementation(function (this: pg.Pool) {
    rootClosed = true; return Reflect.apply(originalEnd, this, []);
  } as never);
});
afterEach(async () => {
  releaseBoundary?.(); releaseBoundary = undefined;
  await Promise.allSettled(resources.splice(0).map(resource => resource.close()));
  vi.restoreAllMocks();
});

describe("comparison root actual checkout ownership", () => {
  it("rejects an unrelated root/pool pair even when the database brand is genuine", async () => {
    const database = createPostgresDatabase(input().connectionString);
    resources.push(database);
    expect(() => assertComparisonDatabaseSource({ ...input(), database, pool: getRootPostgresPool(database)! })).toThrow("PCAT-CMP-REPORT-INTEGRITY");
    expect(native.query).not.toHaveBeenCalled();
  });
  it.each(["target", "challenge", "peer"] as const)("refuses a %s mismatch and finishes owned native close", async changed => {
    if (changed === "target") observedTarget = { ...target, databaseOid: "102" };
    if (changed === "challenge") held = false;
    if (changed === "peer") Object.defineProperty(native.connection.stream, "remotePort", { value: 15433 });
    await expect(openComparisonDatabaseV2(input())).rejects.toThrow("PCAT-CMP-REPORT-INTEGRITY");
    expect(native.end).toHaveBeenCalledOnce();
    expect(rootClosed).toBe(true);
    expect(manager.end).not.toHaveBeenCalled();
  });
  it("rechecks each direct Kernel-style checkout without recursively acquiring another client", async () => {
    const source = await openComparisonDatabaseV2(input()); resources.push(source);
    assertComparisonDatabaseSource({ ...input(), ...source });
    const before = vi.mocked(pg.Pool.prototype.connect).mock.calls.length;
    const lease = await source.pool.connect();
    await lease.query("begin"); await lease.query("commit"); lease.release();
    expect(vi.mocked(pg.Pool.prototype.connect).mock.calls.length).toBe(before + 1);
    expect(() => assertComparisonDatabaseSource({ ...input(), ...source, managementClient: client(102) })).toThrow();
    await source.close();
    expect(() => assertComparisonDatabaseSource({ ...input(), ...source })).toThrow();
    expect(native.end).toHaveBeenCalledOnce();
    expect(manager.end).not.toHaveBeenCalled();
  });
  it("cancels an in-flight checkout before native close and never closes the manager", async () => {
    let blocked = false;
    const source = await openComparisonDatabaseV2({ ...input(), verifyBoundary: async () => {
      if (blocked) await new Promise<void>(resolve => { releaseBoundary = resolve; });
    } }); resources.push(source);
    blocked = true;
    const checkout = source.pool.connect();
    const refusal = expect(checkout).rejects.toThrow("PCAT-CMP-REPORT-INTEGRITY");
    await source.close();
    await refusal;
    expect(native.end).toHaveBeenCalledOnce();
    expect(manager.end).not.toHaveBeenCalled();
    expect(() => assertComparisonDatabaseSource({ ...input(), ...source })).toThrow();
  });
  it("rejects substitution of the issuing owner's final boundary", async () => {
    const source = await openComparisonDatabaseV2(input()); resources.push(source);
    expect(() => assertComparisonDatabaseSource({ ...input(), ...source, verifyBoundary: async () => undefined })).toThrow("PCAT-CMP-REPORT-INTEGRITY");
  });
});
