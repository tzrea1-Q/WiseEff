import { describe, expect, it, vi } from "vitest";

import type { QueryResult } from "../shared/database/client";
import { createSerializedTestQueryable } from "./testDatabase";

describe("test database query scheduling", () => {
  it("serializes concurrent service queries on the transaction client", async () => {
    let activeQueries = 0;
    let maximumConcurrentQueries = 0;
    const execute = vi.fn(async <Row>(text: string): Promise<QueryResult<Row>> => {
      activeQueries += 1;
      maximumConcurrentQueries = Math.max(maximumConcurrentQueries, activeQueries);
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      activeQueries -= 1;
      return { rows: [{ text }] as Row[], rowCount: 1 };
    });
    const queryable = createSerializedTestQueryable(execute);

    const results = await Promise.all([
      queryable.query<{ text: string }>("first"),
      queryable.query<{ text: string }>("second"),
      queryable.query<{ text: string }>("third")
    ]);

    expect(maximumConcurrentQueries).toBe(1);
    expect(results.map((result) => result.rows[0]?.text)).toEqual(["first", "second", "third"]);
  });
});
