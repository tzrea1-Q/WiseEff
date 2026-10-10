import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  beforeAll: [] as Array<(fixtures: { request: object }) => Promise<void>>,
  afterAll: [] as Array<(fixtures: object, testInfo: object) => Promise<void>>,
  start: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../e2e/acceptance/helpers/loadAcceptanceEnvironment", () => ({}));
vi.mock("playwright/test", () => ({
  expect,
  test: Object.assign(vi.fn(), {
    describe: (_title: string, body: () => void) => body(),
    beforeAll: (hook: typeof fixture.beforeAll[number]) => fixture.beforeAll.push(hook),
    afterAll: (hook: typeof fixture.afterAll[number]) => fixture.afterAll.push(hook),
    use: vi.fn(),
    setTimeout: vi.fn(),
  }),
}));
vi.mock("../e2e/acceptance/helpers/browserDiagnostics", () => ({ useBrowserDiagnostics: vi.fn() }));
vi.mock("pg", () => ({ default: { Pool: class { async end() {} } } }));
vi.mock("../server/testing/parameterCatalog/semanticBinding", () => ({
  seedSemanticBindingCatalog: vi.fn(),
  SEMANTIC_BINDING_FIXTURE_RELEASE_ID: "fixture-release",
}));
vi.mock("../e2e/acceptance/helpers/topologyFixture", () => ({ registerCatalogDriverSubjects: vi.fn() }));
vi.mock("../e2e/acceptance/helpers/disposablePostCutoverRuntime", () => ({
  startDisposablePostCutoverRuntime: fixture.start,
  disposableRuntimeOutcomeFromTestInfo: () => "success",
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fixture.beforeAll.length = 0;
  fixture.afterAll.length = 0;
});

describe("topology disposable runtime isolation", () => {
  it.each(["true", "false"])("keeps child endpoints and credentials together when parent no-start is %s", async (noStart) => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://test@127.0.0.1:55438/t1070fix");
    vi.stubEnv("WISEEFF_ACCEPTANCE_NO_START_RUNTIME", noStart);
    vi.stubEnv("VITE_WISEEFF_API_BASE_URL", "http://127.0.0.1:8860");
    vi.stubEnv("WISEEFF_API_BASE_URL", "http://127.0.0.1:8860");
    vi.stubEnv("WISEEFF_ACCEPTANCE_FRONTEND_URL", "http://127.0.0.1:5200");
    vi.stubEnv("AUTH_TOKEN_ISSUER", "parent-issuer");
    vi.stubEnv("AUTH_TOKEN_HMAC_SECRET", "parent-test-secret");
    fixture.start.mockImplementation(async (_databaseUrl, options) => ({
      databaseUrl: "postgres://test@127.0.0.1:55438/t1070fix_disposable_child",
      apiUrl: `http://127.0.0.1:${options.apiPort ?? 49152}`,
      frontendUrl: `http://127.0.0.1:${options.frontendPort ?? 49153}`,
      authIssuer: "child-issuer",
      authSecret: "child-test-secret",
      dispose: fixture.dispose,
    }));

    await import("../e2e/acceptance/parameter-topology.acceptance.spec");
    try {
      await fixture.beforeAll[0]!({ request: {} });
      const runtime = await fixture.start.mock.results[0]!.value;
      const options = fixture.start.mock.calls[0]![1];
      expect.soft(options.apiPort).toBeUndefined();
      expect.soft(options.frontendPort).toBeUndefined();
      expect.soft(runtime.apiUrl).not.toBe("http://127.0.0.1:8860");
      expect.soft(runtime.frontendUrl).not.toBe("http://127.0.0.1:5200");
      expect(process.env.VITE_WISEEFF_API_BASE_URL).toBe(runtime.apiUrl);
      expect(process.env.WISEEFF_API_BASE_URL).toBe(runtime.apiUrl);
      expect(process.env.DATABASE_URL).toBe(runtime.databaseUrl);
      expect(process.env.AUTH_TOKEN_ISSUER).toBe(runtime.authIssuer);
      expect(process.env.AUTH_TOKEN_HMAC_SECRET).toBe(runtime.authSecret);
    } finally {
      await fixture.afterAll[0]!({}, {});
    }
    expect(fixture.dispose).toHaveBeenCalledWith("success");
    expect(process.env.VITE_WISEEFF_API_BASE_URL).toBe("http://127.0.0.1:8860");
    expect(process.env.WISEEFF_API_BASE_URL).toBe("http://127.0.0.1:8860");
    expect(process.env.DATABASE_URL).toBe("postgres://test@127.0.0.1:55438/t1070fix");
    expect(process.env.AUTH_TOKEN_ISSUER).toBe("parent-issuer");
    expect(process.env.AUTH_TOKEN_HMAC_SECRET).toBe("parent-test-secret");
  });
});
