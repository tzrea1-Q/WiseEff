import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { assertIsolatedPostgresUrl, rewriteDatabaseHost } from "./catalog-publication-delivery-lab";

const run = (env: NodeJS.ProcessEnv) =>
  spawnSync("npx", ["tsx", "scripts/run-catalog-publication-delivery-acceptance.ts"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("catalog publication delivery acceptance runner", () => {
  it("fails closed when the delivery flag is missing", () => {
    const result = run({ WISEEFF_CATALOG_DELIVERY_ACCEPTANCE: "" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("WISEEFF_CATALOG_DELIVERY_ACCEPTANCE=1 is required");
  });

  it("fails closed when overlay capabilities are set", () => {
    const result = run({
      WISEEFF_CATALOG_DELIVERY_ACCEPTANCE: "1",
      WISEEFF_CATALOG_TEST_CAPABILITIES: "catalog:publish",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("WISEEFF_CATALOG_TEST_CAPABILITIES must be unset");
  });

  it("refuses the shared compose app database", () => {
    expect(() =>
      assertIsolatedPostgresUrl("postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff", "test"),
    ).toThrow(/5432\/wiseeff/);
    expect(() =>
      assertIsolatedPostgresUrl("postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff", "test"),
    ).toThrow(/shared g668 database name wiseeff/);
  });

  it("rewrites only the hostname for container DSNs", () => {
    const rewritten = rewriteDatabaseHost(
      "postgres://wiseeff_api:secret@127.0.0.1:55438/wiseeff_test_wk_1",
      "host.docker.internal",
    );
    expect(rewritten).toContain("host.docker.internal");
    expect(rewritten).toContain("55438");
    expect(rewritten).toContain("wiseeff_api");
    expect(rewritten).not.toContain("127.0.0.1");
  });
});
