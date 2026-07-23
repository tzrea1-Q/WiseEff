import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_DEMO_CREDENTIALS,
  LOCAL_DEMO_SHARED_PASSWORD,
  seedLocalDemoCredentials,
  shouldSeedLocalDemoCredentials
} from "./seedLocalDemoCredentials";
import { validateLocalAccountPassword, validateLocalAccountUsername } from "./localAccountCredentials";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";

function createFakeDb() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const queryable: Queryable = {
    async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    }
  };
  const db: Database = {
    query: queryable.query,
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return fn(queryable);
    }
  };
  return { db, calls };
}

describe("seedLocalDemoCredentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes seven fixed usernames and a password that pass local policy", () => {
    expect(LOCAL_DEMO_CREDENTIALS).toHaveLength(7);
    expect(LOCAL_DEMO_SHARED_PASSWORD).toBe("WiseEff-Dev!");
    validateLocalAccountPassword(LOCAL_DEMO_SHARED_PASSWORD);
    for (const row of LOCAL_DEMO_CREDENTIALS) {
      validateLocalAccountUsername(row.username);
    }
    expect(LOCAL_DEMO_CREDENTIALS.map((row) => row.username)).toEqual([
      "xu.yun",
      "zhao.heng",
      "liu.min",
      "wang.jie",
      "chen.na",
      "li.peng",
      "sun.mei"
    ]);
  });

  it("gates on NODE_ENV=development only", () => {
    expect(shouldSeedLocalDemoCredentials({ NODE_ENV: "development" })).toBe(true);
    expect(shouldSeedLocalDemoCredentials({ NODE_ENV: "production" })).toBe(false);
    expect(shouldSeedLocalDemoCredentials({ NODE_ENV: "test" })).toBe(false);
  });

  it("upserts credentials in development", async () => {
    const { db, calls } = createFakeDb();
    const result = await seedLocalDemoCredentials(db, { NODE_ENV: "development" });
    expect(result).toEqual({ seeded: true, count: 7 });
    const credentialCalls = calls.filter((call) => call.text.includes("user_password_credentials"));
    expect(credentialCalls).toHaveLength(7);
    expect(credentialCalls.map((call) => call.values[1])).toEqual([
      "xu.yun",
      "zhao.heng",
      "liu.min",
      "wang.jie",
      "chen.na",
      "li.peng",
      "sun.mei"
    ]);
    for (const call of credentialCalls) {
      expect(call.values[0]).toMatch(/^u-/);
      expect(String(call.values[2])).toMatch(/^scrypt\$/);
      expect(call.text.toLowerCase()).toContain("on conflict");
    }
  });

  it("skips writes outside development", async () => {
    const { db, calls } = createFakeDb();
    const result = await seedLocalDemoCredentials(db, { NODE_ENV: "production" });
    expect(result).toEqual({ seeded: false, count: 0 });
    expect(calls).toHaveLength(0);
  });
});
