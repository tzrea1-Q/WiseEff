import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { applyPlaywrightRuntimeLane, resolvePlaywrightRuntimeLane } from "./playwright-runtime-lane";

describe("local Playwright runtime lanes", () => {
  beforeEach(() => {
    for (const key of ["PORT", "WISEEFF_FRONTEND_PORT", "VITE_WISEEFF_API_BASE_URL", "WISEEFF_DEV_API_PROXY_URL", "WISEEFF_LOCAL_BRIDGE_PROXY_URL", "WISEEFF_ACCEPTANCE_FRONTEND_URL", "DATABASE_URL", "TEST_DATABASE_URL", "OBJECT_STORE_ROOT", "WISEEFF_TEST_DATABASE_PREFIX", "WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR", "WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR", "WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR", "WISEEFF_QUALITY_PLAYWRIGHT_REPORT_DIR"]) vi.stubEnv(key, process.env[key]);
    vi.stubEnv("WISEEFF_RUNTIME_LANE", undefined);
    vi.stubEnv("WISEEFF_DEV_API_PROXY_URL", undefined);
    vi.stubEnv("WISEEFF_LOCAL_BRIDGE_PROXY_URL", undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it("resolves two isolated lanes from the same environment", () => {
    const env = { DATABASE_URL: "postgres://user:password@localhost:5432/wiseeff?sslmode=disable", OBJECT_STORE_ROOT: "/tmp/objects" };
    const first = resolvePlaywrightRuntimeLane({ ...env, WISEEFF_RUNTIME_LANE: "1" });
    const second = resolvePlaywrightRuntimeLane({ ...env, WISEEFF_RUNTIME_LANE: "2" });
    expect(first).toEqual({
      id: "1", apiURL: "http://127.0.0.1:20002", baseURL: "http://127.0.0.1:20003",
      bridgeURL: "http://127.0.0.1:40002",
      databaseUrl: "postgres://user:password@localhost:5432/wiseeff_lane_1?sslmode=disable",
      objectStoreRoot: "/tmp/objects/lane-1", outputDir: "test-results/lanes/1", reportDir: "playwright-report/lanes/1"
    });
    expect(second?.databaseUrl).not.toBe(first?.databaseUrl);
    expect(second?.objectStoreRoot).not.toBe(first?.objectStoreRoot);
    expect(second?.outputDir).not.toBe(first?.outputDir);
    expect(second?.reportDir).not.toBe(first?.reportDir);
    expect(new Set([first?.apiURL, first?.baseURL, first?.bridgeURL, second?.apiURL, second?.baseURL, second?.bridgeURL]).size).toBe(6);
  });
  it("allocates bridge ports disjoint from every supported lane's API and frontend ports", () => {
    const ports = new Set<number>();
    for (let id = 1; id <= 10000; id++) {
      const lane = resolvePlaywrightRuntimeLane({ WISEEFF_RUNTIME_LANE: String(id), DATABASE_URL: "postgres://localhost/app" })!;
      expect(lane.bridgeURL).toBe(`http://127.0.0.1:${40000 + 2 * id}`);
      for (const url of [lane.apiURL, lane.baseURL, lane.bridgeURL]) {
        const port = Number(new URL(url).port);
        expect(port).toBeLessThanOrEqual(65535);
        expect(ports.has(port)).toBe(false);
        ports.add(port);
      }
    }
    expect(ports.size).toBe(30000);
  });
  it("overrides a shared bridge upstream only when a lane is selected", () => {
    const env = { WISEEFF_LOCAL_BRIDGE_PROXY_URL: "http://127.0.0.1:18787" };
    expect(applyPlaywrightRuntimeLane(env)).toBeUndefined();
    expect(env.WISEEFF_LOCAL_BRIDGE_PROXY_URL).toBe("http://127.0.0.1:18787");
    const laneEnv = { ...env, WISEEFF_RUNTIME_LANE: "2", DATABASE_URL: "postgres://localhost/app" };
    applyPlaywrightRuntimeLane(laneEnv);
    expect(laneEnv.WISEEFF_LOCAL_BRIDGE_PROXY_URL).toBe("http://127.0.0.1:40004");
  });
  it("preserves legacy defaults and rejects unsafe or ambiguous lane selections", () => {
    expect(resolvePlaywrightRuntimeLane({})).toBeUndefined();
    for (const id of ["0", "01", "-1", "1.5", "../1", "10001"]) {
      expect(() => resolvePlaywrightRuntimeLane({ WISEEFF_RUNTIME_LANE: id, DATABASE_URL: "postgres://localhost/app" })).toThrow("WISEEFF_RUNTIME_LANE");
    }
    expect(() => resolvePlaywrightRuntimeLane({ WISEEFF_RUNTIME_LANE: "1" })).toThrow("DATABASE_URL");
    expect(() => resolvePlaywrightRuntimeLane({ WISEEFF_RUNTIME_LANE: "1", DATABASE_URL: "https://localhost/app" })).toThrow("PostgreSQL");
    expect(() => resolvePlaywrightRuntimeLane({ WISEEFF_RUNTIME_LANE: "1", DATABASE_URL: "postgres://localhost/" })).toThrow("database name");
    expect(() => resolvePlaywrightRuntimeLane({ WISEEFF_RUNTIME_LANE: "1", DATABASE_URL: `postgres://localhost/${"a".repeat(63)}` })).toThrow("database name");
    expect(() => resolvePlaywrightRuntimeLane({ WISEEFF_RUNTIME_LANE: "1", WISEEFF_ACCEPTANCE_OWNED_RUNTIME: "true" })).toThrow("owned");
    expect(() => resolvePlaywrightRuntimeLane({ WISEEFF_RUNTIME_LANE: "1", DATABASE_URL: "postgres://localhost/app", OBJECT_STORE_MODE: "s3" })).toThrow("local object store");
  });
  it("drives quality and acceptance launch environments without reusing another runtime", async () => {
    vi.stubEnv("WISEEFF_RUNTIME_LANE", "2");
    vi.stubEnv("DATABASE_URL", "postgres://localhost/app");
    vi.stubEnv("WISEEFF_ACCEPTANCE_ENV_FILE", "/tmp/wiseeff-nonexistent-lane.env");
    vi.stubEnv("WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR", "/tmp/shared-output");
    vi.stubEnv("WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR", "/tmp/shared-output");
    vi.stubEnv("VITE_WISEEFF_API_AUTHORIZATION", "Bearer lane-smoke");
    for (const [kind, config] of [
      ["quality", (await import("../playwright.quality.config")).default],
      ["acceptance", (await import("../playwright.acceptance.config")).default]
    ] as const) {
      expect(process.env.DATABASE_URL).toBe("postgres://localhost/app_lane_2");
      expect(process.env.VITE_WISEEFF_API_BASE_URL).toBe("http://127.0.0.1:20004");
      expect(process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR).toBe("test-results/lanes/2/acceptance");
      expect(config.use?.baseURL).toBe("http://127.0.0.1:20005");
      expect(config.outputDir).toBe(`test-results/lanes/2/${kind}`);
      const servers = config.webServer as Array<{ env: Record<string, string>; reuseExistingServer: boolean; command: string }>;
      expect(servers[0].env).toMatchObject({ PORT: "20004", DATABASE_URL: "postgres://localhost/app_lane_2", OBJECT_STORE_ROOT: ".wiseeff-object-store/lane-2" });
      expect(servers[0].env.VITE_WISEEFF_API_BASE_URL).toBe("http://127.0.0.1:20004");
      expect(new URL(servers[1].env.VITE_WISEEFF_API_BASE_URL).origin).toBe(new URL(config.use!.baseURL!).origin);
      expect(servers[1].env.WISEEFF_DEV_API_PROXY_URL).toBe("http://127.0.0.1:20004");
      expect(servers[1].env.WISEEFF_LOCAL_BRIDGE_PROXY_URL).toBe("http://127.0.0.1:40004");
      expect(servers[1].env.VITE_WISEEFF_API_AUTHORIZATION).toBe("Bearer lane-smoke");
      expect(servers[1].command).toContain("--port 20005");
      expect(servers.every((server) => !server.reuseExistingServer)).toBe(true);
    }
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:20005");
    vi.stubEnv("WISEEFF_DEV_API_PROXY_URL", "http://127.0.0.1:20004");
    const vite = (await import("../vite.config")).default as { server: { proxy: Record<string, { target: string }> } };
    expect(vite.server.proxy["/api"].target).toBe("http://127.0.0.1:20004");
    expect(vite.server.proxy["/downloads"].target).toBe("http://127.0.0.1:20004");
    expect(vite.server.proxy["/local-bridge"].target).toBe("http://127.0.0.1:40004");
  });
  it.each([undefined, "", "   "])("keeps the legacy local-bridge proxy when its override is %s, including CI", async (override) => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("WISEEFF_LOCAL_BRIDGE_PROXY_URL", override);
    const config = (await import("../vite.config")).default as { server: { proxy: Record<string, { target: string; rewrite: (path: string) => string }> } };
    expect(config.server.proxy["/local-bridge"].target).toBe("http://127.0.0.1:18787");
    expect(config.server.proxy["/local-bridge"].rewrite("/local-bridge/health")).toBe("/health");
    const { buildPlaywrightWebServers } = await import("../playwright.shared");
    const servers = buildPlaywrightWebServers({ baseURL: "http://127.0.0.1:5173", apiURL: "http://127.0.0.1:8787", reuseExistingServer: true }, {}) as Array<{ env: Record<string, string> }>;
    expect(servers[1].env).not.toHaveProperty("WISEEFF_LOCAL_BRIDGE_PROXY_URL");
  });
  it("honors a configured local-bridge proxy without changing the API upstream", async () => {
    vi.stubEnv("WISEEFF_LOCAL_BRIDGE_PROXY_URL", " http://127.0.0.1:40100 ");
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:8787");
    const config = (await import("../vite.config")).default as { server: { proxy: Record<string, { target: string }> } };
    expect(config.server.proxy["/local-bridge"].target).toBe("http://127.0.0.1:40100");
    expect(config.server.proxy["/api"].target).toBe("http://127.0.0.1:8787");
    const { buildPlaywrightWebServers } = await import("../playwright.shared");
    const servers = buildPlaywrightWebServers({ baseURL: "http://127.0.0.1:5173", apiURL: "http://127.0.0.1:8787", reuseExistingServer: true }, process.env) as Array<{ env: Record<string, string> }>;
    expect(servers[1].env.WISEEFF_LOCAL_BRIDGE_PROXY_URL?.trim()).toBe("http://127.0.0.1:40100");
  });
  it("keeps npm dev API overrides and Vite proxies aligned with the requested ports", async () => {
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:20004");
    vi.stubEnv("WISEEFF_FRONTEND_PORT", "20005");
    const config = (await import("../vite.config")).default as { server: { port: number; proxy: Record<string, { target: string }> } };
    expect(config.server.port).toBe(20005);
    expect(config.server.proxy["/api"].target).toBe("http://127.0.0.1:20004");
    expect(config.server.proxy["/downloads"].target).toBe("http://127.0.0.1:20004");
    const command = JSON.parse(readFileSync("package.json", "utf8")).scripts.dev;
    const shell = `vite() { printf '%s' "$VITE_WISEEFF_API_BASE_URL"; }; ${command}`;
    expect(execFileSync("sh", ["-c", shell], { encoding: "utf8" })).toBe("http://127.0.0.1:20004");
    const env = { ...process.env };
    delete env.VITE_WISEEFF_API_BASE_URL;
    expect(execFileSync("sh", ["-c", shell], { encoding: "utf8", env })).toBe("http://127.0.0.1:8787");
    const { buildPlaywrightWebServers } = await import("../playwright.shared");
    const servers = buildPlaywrightWebServers({ baseURL: "http://127.0.0.1:5173", apiURL: "http://127.0.0.1:8787", reuseExistingServer: true }) as Array<{ env: Record<string, string> }>;
    expect(servers[1].env.VITE_WISEEFF_API_BASE_URL).toBe("http://127.0.0.1:8787");
  });
});
