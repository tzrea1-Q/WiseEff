import { describe, expect, it } from "vitest";
import { createTracingBoundary, type TraceExporter } from "../../observability/tracing";
import { createDatabase, createPostgresDatabase, type Queryable } from "./client";

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

  it("exports low-cardinality database query spans without SQL text or values", async () => {
    const spans: Parameters<TraceExporter>[0][] = [];
    const queryable: Queryable = {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        return { rows: [{ ok: true } as Row], rowCount: 1 };
      }
    };
    const tracing = createTracingBoundary({
      enabled: true,
      serviceName: "wiseeff-api",
      exporter: (span) => {
        spans.push(span);
      }
    });
    const db = createDatabase(queryable, { tracing });

    await db.query<{ ok: boolean }>("select * from audit_events where actor_user_id = $1", ["u-secret"]);

    expect(spans).toEqual([
      expect.objectContaining({
        name: "db.query",
        attributes: {
          service: "wiseeff-api",
          statementType: "select",
          parameterCount: 1,
          status: "succeeded",
          rowCount: 1
        }
      })
    ]);
    expect(JSON.stringify(spans)).not.toContain("audit_events");
    expect(JSON.stringify(spans)).not.toContain("u-secret");
  });

  it("exports failed database query spans while preserving the original error", async () => {
    const spans: Parameters<TraceExporter>[0][] = [];
    const queryable: Queryable = {
      query: async () => {
        throw new Error("database password leaked in error");
      }
    };
    const tracing = createTracingBoundary({
      enabled: true,
      serviceName: "wiseeff-api",
      exporter: (span) => {
        spans.push(span);
      }
    });
    const db = createDatabase(queryable, { tracing });

    await expect(db.query("delete from audit_events where actor_user_id = $1", ["u-secret"])).rejects.toThrow(
      "database password leaked in error"
    );

    expect(spans).toEqual([
      expect.objectContaining({
        name: "db.query",
        attributes: {
          service: "wiseeff-api",
          statementType: "delete",
          parameterCount: 1,
          status: "failed",
          errorType: "Error"
        }
      })
    ]);
    expect(JSON.stringify(spans)).not.toContain("audit_events");
    expect(JSON.stringify(spans)).not.toContain("u-secret");
    expect(JSON.stringify(spans)).not.toContain("password");
  });

  it("exports separate spans for transaction control and transaction queries", async () => {
    const spans: Parameters<TraceExporter>[0][] = [];
    const queryable: Queryable = {
      query: async <Row,>() => {
        return { rows: [] as Row[], rowCount: null };
      }
    };
    const tracing = createTracingBoundary({
      enabled: true,
      serviceName: "wiseeff-api",
      exporter: (span) => {
        spans.push(span);
      }
    });
    const db = createDatabase(queryable, { tracing });

    await db.transaction(async (tx) => {
      await tx.query("update parameter_values set value = $1 where id = $2", ["secret-value", "param-secret"]);
    });

    expect(spans.map((span) => span.attributes.statementType)).toEqual(["begin", "update", "commit"]);
    expect(spans.every((span) => span.name === "db.query")).toBe(true);
    expect(JSON.stringify(spans)).not.toContain("parameter_values");
    expect(JSON.stringify(spans)).not.toContain("secret-value");
    expect(JSON.stringify(spans)).not.toContain("param-secret");
  });
});

describe("createPostgresDatabase", () => {
  it("exposes close for CLI scripts to release the Postgres pool", async () => {
    const db = createPostgresDatabase("postgres://user:pass@127.0.0.1:5432/db");

    expect(db.close).toEqual(expect.any(Function));
    await expect(db.close?.()).resolves.toBeUndefined();
  });
});
