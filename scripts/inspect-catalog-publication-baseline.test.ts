import { describe, expect, it } from "vitest";

import {
  CATALOG_BASELINE_READONLY_ENV,
  parseCollectorEnv,
  redactSecrets,
} from "./inspect-catalog-publication-baseline";

describe("inspect-catalog-publication-baseline collector", () => {
  it("requires CATALOG_BASELINE_READONLY_DATABASE_URL and does not fall back to DATABASE_URL", () => {
    const missing = parseCollectorEnv({ DATABASE_URL: "postgres://secret@127.0.0.1/wiseeff" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.kind).toBe("usage");
    expect(missing.error.message).not.toContain("postgres://");
    expect(missing.error.message).toContain(CATALOG_BASELINE_READONLY_ENV);
  });

  it("never echoes the DSN in redacted failure text", () => {
    const dsn = "postgres://wiseeff:super-secret@127.0.0.1:55438/postgres";
    expect(redactSecrets(`failed to connect to ${dsn}`, dsn)).toBe(
      "failed to connect to [redacted-dsn]",
    );
  });
});
