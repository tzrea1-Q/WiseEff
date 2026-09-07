import type pg from "pg";
import { expect, it, vi } from "vitest";
import { beginLegacyRetirementTransaction } from "./managementTransaction";

it("takes the inventory lock before returning the new transaction to its owner", async () => {
  const query = vi.fn(async (_sql: string) => ({ rows: [] }));
  await beginLegacyRetirementTransaction({ query } as unknown as pg.PoolClient);
  const commands = query.mock.calls.map(([sql]) => sql);
  expect(commands).toHaveLength(4);
  expect(commands[0]).toBe("begin isolation level serializable");
  expect(commands[3]).toMatch(/^lock table parameter_catalog\.catalog_state,[\s\S]+in share mode nowait$/);
  expect(commands.some(sql => /^select/i.test(sql))).toBe(false);
});

it("preserves a failed transaction for the caller to roll back and redacts transport errors", async () => {
  const query = vi.fn(async () => { throw new Error("private-connection-detail"); });
  await expect(beginLegacyRetirementTransaction({ query } as unknown as pg.PoolClient))
    .rejects.toThrow("PCAT-UPG-LEGACY-LOGIN-TRANSACTION-PREPARE-FAILED");
  expect(query).toHaveBeenCalledTimes(1);
});
