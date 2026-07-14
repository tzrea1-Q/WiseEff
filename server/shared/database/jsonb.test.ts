import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "./client";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { sanitizeForJson, serializePostgresJsonb, stripLoneSurrogates } from "./jsonb";

const databaseAvailable = await isTestDatabaseAvailable();

describe("postgres jsonb serialization", () => {
  it("preserves valid surrogate pairs such as emoji", () => {
    expect(stripLoneSurrogates("hello 😀")).toBe("hello 😀");
    expect(serializePostgresJsonb({ label: "hello 😀" })).toBe('{"label":"hello 😀"}');
  });

  it("replaces lone surrogates before json serialization", () => {
    const lone = "\uD800";
    expect(stripLoneSurrogates(`bad${lone}value`)).toBe("bad\uFFFDvalue");
    expect(
      serializePostgresJsonb([{ type: "parameter", id: "x", label: "y", snippet: lone }], "array")
    ).toBe('[{"type":"parameter","id":"x","label":"y","snippet":"\uFFFD"}]');
  });

  it("sanitizes nested citation payloads", () => {
    expect(
      sanitizeForJson({
        citations: [{ snippet: "\uD800" }],
        runSteps: [{ summary: "ok\uDFFF" }]
      })
    ).toEqual({
      citations: [{ snippet: "\uFFFD" }],
      runSteps: [{ summary: "ok\uFFFD" }]
    });
  });

  it("falls back when json serialization is undefined", () => {
    expect(serializePostgresJsonb(undefined)).toBe("{}");
    expect(serializePostgresJsonb(undefined, "array")).toBe("[]");
  });

  it.skipIf(!databaseAvailable)("accepts serialized json in postgres jsonb casts", async () => {
    const databaseUrl = process.env.DATABASE_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";
    const db = createPostgresDatabase(databaseUrl);
    const payload = serializePostgresJsonb([{ snippet: "\uD800" }], "array");
    await expect(db.query("select $1::jsonb as value", [payload])).resolves.toBeDefined();
  });
});
