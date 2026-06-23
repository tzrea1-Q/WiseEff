import { describe, expect, it } from "vitest";
import { bootstrapLocalAdmin, countLocalAdminBindings } from "./bootstrapLocalAdmin";
import type { Database, QueryResult } from "../../shared/database/client";

type QueryCall = { text: string; values?: unknown[] };

function createFakeDb(options: { adminCount?: number; existingUsername?: boolean } = {}) {
  const calls: QueryCall[] = [];
  const db = {
    query<T = unknown>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
      calls.push({ text, values });
      if (text.includes("count(*)::text as count") && text.includes("role_id = 'admin'")) {
        return Promise.resolve({ rows: [{ count: String(options.adminCount ?? 0) } as T], rowCount: 1 });
      }
      if (text.includes("from user_password_credentials") && text.includes("lower(username)")) {
        return Promise.resolve({
          rows: (options.existingUsername ? [{ id: "u-existing" }] : []) as T[],
          rowCount: options.existingUsername ? 1 : 0
        });
      }
      return Promise.resolve({ rows: [] as T[], rowCount: 0 });
    },
    async transaction<T>(fn: (tx: Database) => Promise<T>) {
      return fn(db as Database);
    }
  } as Database;

  return { db, calls };
}

describe("bootstrapLocalAdmin", () => {
  it("creates the first local admin when none exist", async () => {
    const { db, calls } = createFakeDb({ adminCount: 0 });

    const result = await bootstrapLocalAdmin(db, {
      name: "Platform Admin",
      username: "admin.ops",
      password: "WiseEff@2026",
      organization: "硬件部"
    });

    expect(result.username).toBe("admin.ops");
    expect(result.organizationId).toBe("org-hardware-department");
    expect(calls.some((call) => call.text.includes("insert into user_role_bindings") && call.text.includes("'admin'"))).toBe(true);
  });

  it("rejects bootstrap when an admin already exists", async () => {
    const { db } = createFakeDb({ adminCount: 1 });

    await expect(
      bootstrapLocalAdmin(db, {
        name: "Platform Admin",
        username: "admin.ops",
        password: "WiseEff@2026"
      })
    ).rejects.toMatchObject({
      code: "CONFLICT"
    });
  });

  it("counts existing admin bindings", async () => {
    const { db } = createFakeDb({ adminCount: 2 });
    await expect(countLocalAdminBindings(db)).resolves.toBe(2);
  });
});
