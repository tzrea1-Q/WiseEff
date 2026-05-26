import { describe, expect, it } from "vitest";
import { createDatabase, type Queryable } from "./client";

describe("createDatabase", () => {
  it("delegates queries to the provided query function", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queryable: Queryable = {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [{ ok: true } as Row], rowCount: 1 };
      }
    };
    const db = createDatabase(queryable);

    const result = await db.query<{ ok: boolean }>("select $1::boolean as ok", [true]);

    expect(result.rows).toEqual([{ ok: true }]);
    expect(calls).toEqual([{ text: "select $1::boolean as ok", values: [true] }]);
  });

  it("commits successful transactions using the same queryable", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queryable: Queryable = {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [] as Row[], rowCount: null };
      }
    };
    const db = createDatabase(queryable);

    await db.transaction(async (tx) => {
      await tx.query("insert into audit_events default values");
    });

    expect(calls).toEqual([
      { text: "begin", values: [] },
      { text: "insert into audit_events default values", values: [] },
      { text: "commit", values: [] }
    ]);
  });

  it("rolls back failed transactions", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const queryable: Queryable = {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [] as Row[], rowCount: null };
      }
    };
    const db = createDatabase(queryable);

    await expect(
      db.transaction(async (tx) => {
        await tx.query("insert into audit_events default values");
        throw new Error("write failed");
      })
    ).rejects.toThrow("write failed");

    expect(calls).toEqual([
      { text: "begin", values: [] },
      { text: "insert into audit_events default values", values: [] },
      { text: "rollback", values: [] }
    ]);
  });
});
