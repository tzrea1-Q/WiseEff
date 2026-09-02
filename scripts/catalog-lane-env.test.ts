import { describe, expect, it } from "vitest";
import {
  COMPOSE_APP_DATABASE,
  DEFAULT_LANE_PORT,
  classifyFocusedTestOutput,
  forbiddenCatalogLaneReason,
  isAbandonedCatalogDatabase,
  laneDatabaseName,
  parseCatalogLaneArgs,
  parsePostgresUrl,
} from "./catalog-lane-env";

describe("catalog-lane-env policy", () => {
  it("names one isolated database per Issue", () => {
    expect(laneDatabaseName(687)).toBe("wiseeff_lane_687");
    expect(() => laneDatabaseName(0)).toThrow(/positive integer/);
  });

  it("rejects the default compose app database as catalog evidence", () => {
    const reason = forbiddenCatalogLaneReason(
      "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff",
    );
    expect(reason).toMatch(/5432/);
    expect(reason).toMatch(new RegExp(COMPOSE_APP_DATABASE));
    expect(reason).toMatch(String(DEFAULT_LANE_PORT));
  });

  it("rejects the shared wiseeff database name on the dedicated port", () => {
    expect(
      forbiddenCatalogLaneReason("postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff"),
    ).toMatch(/shared database name/);
  });

  it("rejects fake engines", () => {
    expect(() => parsePostgresUrl("pglite://localhost/catalog")).toThrow(/PGLite|fake|in-memory/i);
  });

  it("allows a per-issue lane URL on the dedicated pgvector port", () => {
    expect(
      forbiddenCatalogLaneReason("postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_lane_687"),
    ).toBeNull();
  });

  it("parses accept argv including the Issue-named command", () => {
    const parsed = parseCatalogLaneArgs([
      "accept",
      "--issue",
      "687",
      "--",
      "npm",
      "run",
      "test:server",
      "--",
      "server/modules/catalog-kernel/compiler",
    ]);
    expect(parsed.command).toBe("accept");
    expect(parsed.issue).toBe(687);
    expect(parsed.commandArgv).toEqual([
      "npm",
      "run",
      "test:server",
      "--",
      "server/modules/catalog-kernel/compiler",
    ]);
  });

  it("fails closed when focused tests collect no files", () => {
    const result = classifyFocusedTestOutput(
      "No test files found, exiting with code 1",
      1,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/zero test files|globalSetup/);
  });

  it("marks leftover repair and harness databases as abandoned", () => {
    expect(isAbandonedCatalogDatabase("wiseeff_s2rbac_r4")).toBe(true);
    expect(isAbandonedCatalogDatabase("wiseeff_s2pgh_r2")).toBe(true);
    expect(isAbandonedCatalogDatabase("wiseeff_pcat_p123_1_abcd")).toBe(true);
    expect(isAbandonedCatalogDatabase("wiseeff_test_tpl_ace8fc802ed4")).toBe(true);
    expect(isAbandonedCatalogDatabase("wiseeff_lane_687")).toBe(true);
    expect(isAbandonedCatalogDatabase("wiseeff_s1cmp")).toBe(false);
    expect(isAbandonedCatalogDatabase("postgres")).toBe(false);
  });
});
