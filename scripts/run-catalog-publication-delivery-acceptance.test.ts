import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { assertIsolatedPostgresUrl, rewriteDatabaseHost } from "./catalog-publication-delivery-lab";

const run = (env: NodeJS.ProcessEnv) =>
  spawnSync("npx", ["tsx", "scripts/run-catalog-publication-delivery-acceptance.ts"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

describe("catalog publication delivery acceptance runner", () => {
  it.each(["", "/nonexistent-wiseeff-delivery-evidence.json"])(
    "collects the full browser inventory without loading delivery prerequisites (%s)",
    (evidencePath) => {
      const result = spawnSync(process.execPath, [
        "node_modules/playwright/cli.js", "test", "--config", "playwright.acceptance.config.ts", "--list",
      ], {
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          WISEEFF_ACCEPTANCE_OWNED_RUNTIME: "true",
          WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR: "",
          WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true",
          WISEEFF_CATALOG_DELIVERY_EVIDENCE: evidencePath,
          WISEEFF_CATALOG_DELIVERY_LOGIN_FILE: evidencePath,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("catalog-publication-delivery.acceptance.spec.ts");
      expect(result.stdout).toContain("shell-navigation.acceptance.spec.ts");
      expect(result.stdout).toContain("runtime-warmup.spec.ts");
      expect(result.stdout).not.toContain("Total: 0 tests");
    },
  );

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
