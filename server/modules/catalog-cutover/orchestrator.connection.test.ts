import pg from "pg";
import { expect, it, vi } from "vitest";
import { executeCutover } from "./orchestrator";
import type { ExecuteCutoverInput } from "./interface";

// Native EventEmitter delivery on an actual pg.Client, with only checkout/SQL
// transport doubled. This proves lifecycle ordering, not LOGIN or P0 success.
it.each(["callback-error", "callback-end", "checkout-error-client", "journal-error"] as const)(
  "contains the management session loss before a comparison source can open: %s", async fault => {
    const release = vi.fn();
    const client = Object.assign(new pg.Client(), { release });
    const pool = new pg.Pool();
    const queries: string[] = [];
    const privateError = new Error("private-connection-material");
    const lose = () => client.emit(fault === "callback-end" ? "end" : "error", privateError);
    vi.spyOn(client, "query").mockImplementation((async (sql: string) => {
      queries.push(sql);
      const rows = sql.includes("pg_try_advisory_lock") ? [{ acquired: true }]
        : sql.includes(" as safe") ? [{ safe: true }]
          : sql.includes("system_identifier") ? [{ system_identifier: "1", database_oid: "2" }] : [];
      return { rows, rowCount: rows.length };
    }) as never);
    vi.spyOn(pool, "connect").mockImplementation(((callback?: (error: Error | undefined, client: pg.PoolClient, release: () => void) => void) => {
      if (callback) callback(fault === "checkout-error-client" ? privateError : undefined, client, release);
      else if (fault === "checkout-error-client") return Promise.reject(privateError);
      // Crucially, emit before pool.connect itself returns, not in a later
      // timer after an awaited checkout has already attached its listeners.
      if (fault.startsWith("callback-")) lose();
      return callback ? undefined : Promise.resolve(client);
    }) as never);
    const begin = vi.fn();
    const source = vi.fn();
    const input = { pool, bindingManagementPool: pool, graph: {}, plan: { comparisonRules: {} },
      openComparisonSource: source, bindingJournal: {
        unresolved: async () => { if (fault === "journal-error") lose(); return []; }, begin,
      },
    } as unknown as ExecuteCutoverInput;
    try {
      const result = await executeCutover(input).catch(() => ({ rejected: true }));
      expect(result).toEqual({ ok: false, error: { code: "PCAT-ORC-PHASE-FAILED", detail: "cutover-management-session-unavailable" } });
      expect(begin).not.toHaveBeenCalled();
      expect(source).not.toHaveBeenCalled();
      expect(queries.some(sql => /^(?:begin|insert|update|delete)\b/i.test(sql))).toBe(false);
      if (fault !== "journal-error") expect(queries).toEqual([]);
      expect(release).toHaveBeenCalledExactlyOnceWith(true);
      expect(client.listenerCount("error")).toBe(0);
      expect(client.listenerCount("end")).toBe(0);
    } finally { vi.restoreAllMocks(); await pool.end(); }
  },
);

it("keeps the original unresolved-attempt refusal and returns a healthy borrowed session", async () => {
  const release = vi.fn();
  const client = Object.assign(new pg.Client(), { release });
  const pool = new pg.Pool();
  const queries: string[] = [];
  vi.spyOn(client, "query").mockImplementation((async (sql: string) => {
    queries.push(sql);
    const rows = sql.includes("pg_try_advisory_lock") ? [{ acquired: true }]
      : sql.includes(" as safe") ? [{ safe: true }]
        : sql.includes("system_identifier") ? [{ system_identifier: "1", database_oid: "2" }] : [];
    return { rows, rowCount: rows.length };
  }) as never);
  vi.spyOn(pool, "connect").mockImplementation(((callback: (error: undefined, client: pg.PoolClient, release: () => void) => void) => callback(undefined, client, release)) as never);
  const endClient = vi.spyOn(client, "end");
  const endPool = vi.spyOn(pool, "end");
  try {
    const result = await executeCutover({ pool, bindingManagementPool: pool, graph: {}, plan: { comparisonRules: {} },
      openComparisonSource: vi.fn(), bindingJournal: { unresolved: async () => [{}] },
    } as unknown as ExecuteCutoverInput);
    expect(result).toEqual({ ok: false, error: { code: "PCAT-ORC-RESUME-INVALIDATED", detail: "binding-unresolved-phase-attempt" } });
    expect(queries.at(-1)).toBe("reset role");
    expect(queries.some(sql => sql.includes("pg_advisory_unlock"))).toBe(true);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
    expect(endClient).not.toHaveBeenCalled();
    expect(endPool).not.toHaveBeenCalled();
    expect(client.listenerCount("error")).toBe(0);
    expect(client.listenerCount("end")).toBe(0);
  } finally { vi.restoreAllMocks(); await pool.end(); }
});
