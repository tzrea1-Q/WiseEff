/**
 * Behavior-level coverage for the local demo credential seeder: the fixed
 * roster, the development-only gate, and the idempotent upsert against a real
 * database.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  LOCAL_DEMO_CREDENTIALS,
  LOCAL_DEMO_SHARED_PASSWORD,
  seedLocalDemoCredentials,
  shouldSeedLocalDemoCredentials
} from "./seedLocalDemoCredentials";
import { validateLocalAccountPassword, validateLocalAccountUsername } from "./localAccountCredentials";

const databaseAvailable = await isTestDatabaseAvailable();

describe("seedLocalDemoCredentials roster", () => {
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
});

describe.skipIf(!databaseAvailable)("seedLocalDemoCredentials (database)", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    // The seeder targets the fixed demo user ids; user_password_credentials
    // references users, so the demo roster must exist first (as it does in the
    // local demo dataset the seeder complements).
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: LOCAL_DEMO_CREDENTIALS.map((row) => ({
        id: row.userId,
        name: row.username,
        email: `${row.username}@example.com`
      }))
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function credentialRows() {
    const result = await db.query<{ user_id: string; username: string; password_hash: string }>(
      `select user_id, username, password_hash from user_password_credentials order by username`
    );
    return result.rows;
  }

  it("upserts credentials in development and stays idempotent", async () => {
    const result = await seedLocalDemoCredentials(db, { NODE_ENV: "development" });
    expect(result).toEqual({ seeded: true, count: 7 });

    const rows = await credentialRows();
    expect(rows.map((row) => row.username).sort()).toEqual(
      LOCAL_DEMO_CREDENTIALS.map((row) => row.username).slice().sort()
    );
    for (const row of rows) {
      expect(row.user_id).toMatch(/^u-/);
      expect(row.password_hash).toMatch(/^scrypt\$/);
    }

    // Re-seeding updates in place instead of duplicating.
    await expect(seedLocalDemoCredentials(db, { NODE_ENV: "development" })).resolves.toEqual({
      seeded: true,
      count: 7
    });
    await expect(credentialRows()).resolves.toHaveLength(7);
  });

  it("skips writes outside development", async () => {
    const result = await seedLocalDemoCredentials(db, { NODE_ENV: "production" });
    expect(result).toEqual({ seeded: false, count: 0 });
    await expect(credentialRows()).resolves.toEqual([]);
  });
});
