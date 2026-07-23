import { describe, expect, it } from "vitest";
import { seedM0Foundation } from "../../scripts/seed-m0";
import type { Database, QueryResult, Queryable } from "../shared/database/client";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createFakeDb() {
  const calls: QueryCall[] = [];
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

describe("M0 foundation seed contract", () => {
  it("seeds the active workflow users used by the API-mode parameter submission UI", async () => {
    const { db, calls } = createFakeDb();

    await seedM0Foundation(db);

    const userInserts = calls.filter((call) => call.text.includes("insert into users"));
    const insertedUserIds = userInserts.map((call) => call.values[0]);

    expect(insertedUserIds).toEqual(
      expect.arrayContaining(["u-wang-jie", "u-sun-mei", "u-liu-min"])
    );
  });

  it("seeds role permission inclusion rules into the database role catalog", async () => {
    const { db, calls } = createFakeDb();

    await seedM0Foundation(db);

    const roleInserts = calls.filter((call) => call.text.includes("insert into roles"));
    const permissionsByRole = new Map(roleInserts.map((call) => [call.values[0], call.values[3] as string[]]));
    const hardwareUserPermissions = permissionsByRole.get("hardware-user") ?? [];

    expect(permissionsByRole.get("software-user")).toEqual(expect.arrayContaining(hardwareUserPermissions));
    expect(permissionsByRole.get("hardware-committer")).toEqual(expect.arrayContaining(hardwareUserPermissions));
    expect(permissionsByRole.get("software-committer")).toEqual(expect.arrayContaining(hardwareUserPermissions));
  });

  it("writes demo password credentials when NODE_ENV is development", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const { db, calls } = createFakeDb();
      await seedM0Foundation(db);
      const credentialInserts = calls.filter((call) => call.text.includes("user_password_credentials"));
      expect(credentialInserts).toHaveLength(7);
      expect(credentialInserts.map((call) => call.values[1])).toContain("xu.yun");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("does not write demo password credentials outside development", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { db, calls } = createFakeDb();
      await seedM0Foundation(db);
      expect(calls.some((call) => call.text.includes("user_password_credentials"))).toBe(false);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
