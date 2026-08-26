import { describe, expect, it } from "vitest";

import { createDatabase, createPostgresDatabase, createSavepointDatabase, type Queryable } from "../../shared/database/client";
import { TrustedInvocationContextError } from "../auth/trustedInvocation";
import {
  assertTrustedRefusalAuditSink,
  createTrustedRefusalAuditSink
} from "./trustedRefusalSink";

describe("trusted refusal audit sink", () => {
  it("accepts only a sink created from a server-owned pool root", async () => {
    const queryable: Queryable = {
      query: async <Row,>() => ({ rows: [] as Row[], rowCount: null })
    };
    const sessionDatabase = createDatabase(queryable);
    const transactionDatabase = createSavepointDatabase(queryable);
    const poolRoot = createPostgresDatabase("postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff");
    const sink = createTrustedRefusalAuditSink(poolRoot);

    try {
      expect(() => assertTrustedRefusalAuditSink(sink)).not.toThrow();
      for (const value of [sessionDatabase, transactionDatabase, { write: async () => undefined }]) {
        expect(() => assertTrustedRefusalAuditSink(value)).toThrowError(
          expect.objectContaining({
            name: "TrustedInvocationContextError",
            code: "INVALID_TRUSTED_INVOCATION_CONTEXT",
            reason: "refusal audit sink must come from the server-owned PostgreSQL pool assembly"
          })
        );
      }
    } finally {
      await poolRoot.close();
    }
  });

  it("rejects a non-root factory input at runtime instead of wrapping it", () => {
    const queryable: Queryable = {
      query: async <Row,>() => ({ rows: [] as Row[], rowCount: null })
    };
    const sessionDatabase = createDatabase(queryable);

    expect(() =>
      Reflect.apply(createTrustedRefusalAuditSink, undefined, [sessionDatabase])
    ).toThrowError(
      expect.objectContaining<Partial<TrustedInvocationContextError>>({
        code: "INVALID_TRUSTED_INVOCATION_CONTEXT",
        reason: "refusal audit sink requires a server-owned PostgreSQL root database"
      })
    );
  });
});
