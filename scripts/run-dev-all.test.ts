import { describe, expect, it, vi } from "vitest";
import { buildDevAllPlan, recoverDevAllPorts, type DevAllCommand, type DevAllPortRuntime } from "./run-dev-all";

function createPortRuntime(overrides: Partial<DevAllPortRuntime> = {}) {
  const calls: string[] = [];
  const runtime: DevAllPortRuntime = {
    isPortOpen: vi.fn(async () => false),
    findDockerOwnerByPublishedPort: vi.fn(async () => undefined),
    fetchText: vi.fn(async () => undefined),
    findListeningPid: vi.fn(async () => undefined),
    killPid: vi.fn(async (pid) => {
      calls.push(`kill:${pid}`);
    }),
    runCommand: vi.fn(async (command: DevAllCommand) => {
      calls.push(`${command.command} ${command.args.join(" ")}`);
    }),
    waitForPortFree: vi.fn(async (port) => {
      calls.push(`wait-free:${port}`);
    })
  };

  return {
    calls,
    runtime: { ...runtime, ...overrides }
  };
}

describe("buildDevAllPlan", () => {
  it("does not load dotenv as an import-time side effect", async () => {
    vi.resetModules();
    vi.doMock("dotenv/config", () => {
      throw new Error("dotenv should only load when the launcher runs.");
    });

    await expect(import("./run-dev-all")).resolves.toHaveProperty("buildDevAllPlan");
    vi.doUnmock("dotenv/config");
  });

  it("builds docker-compose commands when the standalone binary is selected", () => {
    const plan = buildDevAllPlan({}, "linux", {
      command: "docker-compose",
      composeArgsPrefix: [],
      fileArgs: ["-f", "compose.yaml"]
    });

    expect(plan.prepare.map((step) => [step.label, step.command, step.args])).toEqual([
      ["postgres", "docker-compose", ["-f", "compose.yaml", "up", "-d", "postgres"]],
      [
        "postgres:ready",
        "docker-compose",
        ["-f", "compose.yaml", "exec", "-T", "postgres", "sh", "-c", "until pg_isready -U wiseeff -d wiseeff; do sleep 1; done"]
      ],
      ["database", "npm", ["run", "db:migrate"]],
      ["seed:m0", "npm", ["run", "db:seed:m0"]],
      ["seed:m1", "npm", ["run", "db:seed:m1"]],
      ["seed:m2", "npm", ["run", "db:seed:m2"]],
      ["seed:m3", "npm", ["run", "db:seed:m3"]]
    ]);
  });

  it("starts PostgreSQL before migrations, seeds, API, and API-mode frontend", () => {
    const plan = buildDevAllPlan(
      {
        VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:9999"
      },
      "linux"
    );

    expect(plan.prepare.map((step) => [step.label, step.command, step.args])).toEqual([
      ["postgres", "docker", ["compose", "up", "-d", "postgres"]],
      ["postgres:ready", "docker", ["compose", "exec", "-T", "postgres", "sh", "-c", "until pg_isready -U wiseeff -d wiseeff; do sleep 1; done"]],
      ["database", "npm", ["run", "db:migrate"]],
      ["seed:m0", "npm", ["run", "db:seed:m0"]],
      ["seed:m1", "npm", ["run", "db:seed:m1"]],
      ["seed:m2", "npm", ["run", "db:seed:m2"]],
      ["seed:m3", "npm", ["run", "db:seed:m3"]]
    ]);
    expect(plan.services.map((service) => [service.label, service.command, service.args])).toEqual([
      ["api", "npm", ["run", "dev:api"]],
      ["web", "npm", ["run", "dev"]]
    ]);
    expect(plan.services[1].env).toMatchObject({
      VITE_WISEEFF_RUNTIME_MODE: "api",
      VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:9999"
    });
  });

  it("uses the local API URL when the frontend API URL is not already set", () => {
    const plan = buildDevAllPlan({}, "win32");

    expect(plan.prepare[0]).toMatchObject({
      command: "docker",
      shell: false
    });
    expect(plan.prepare[2]).toMatchObject({
      command: "npm",
      shell: true
    });
    expect(plan.prepare[2].env).toMatchObject({
      DATABASE_URL: "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff",
      OBJECT_STORE_MODE: "local",
      OBJECT_STORE_ROOT: ".wiseeff-object-store",
      DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true"
    });
    expect(plan.services[1].env).toMatchObject({
      VITE_WISEEFF_RUNTIME_MODE: "api",
      VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:8787"
    });
  });

  it("defaults one-command local startup to local account auth", () => {
    const plan = buildDevAllPlan({}, "linux");

    expect(plan.prepare[2].env).toMatchObject({
      AUTH_MODE: "production",
      AUTH_PROVIDER: "local"
    });
    expect(plan.services[0].env).toMatchObject({
      AUTH_MODE: "production",
      AUTH_PROVIDER: "local"
    });
  });

  it("preserves explicit auth provider settings for smoke or identity checks", () => {
    const plan = buildDevAllPlan(
      {
        AUTH_MODE: "production",
        AUTH_PROVIDER: "hmac",
        AUTH_TOKEN_ISSUER: "wiseeff-local",
        AUTH_TOKEN_HMAC_SECRET: "wiseeff-local-hmac-secret-32-chars-minimum"
      },
      "linux"
    );

    expect(plan.services[0].env).toMatchObject({
      AUTH_MODE: "production",
      AUTH_PROVIDER: "hmac",
      AUTH_TOKEN_ISSUER: "wiseeff-local",
      AUTH_TOKEN_HMAC_SECRET: "wiseeff-local-hmac-secret-32-chars-minimum"
    });
  });

  it("restarts an existing WiseEff PostgreSQL container on the configured database port and skips compose startup", async () => {
    const { calls, runtime } = createPortRuntime({
      isPortOpen: vi.fn(async (port) => port === 5432),
      findDockerOwnerByPublishedPort: vi.fn(async () => ({
        id: "pg-container",
        image: "postgres:16-alpine",
        names: "wiseeff-postgres",
        ports: "127.0.0.1:5432->5432/tcp"
      }))
    });

    const result = await recoverDevAllPorts({ databasePort: 5432, apiPort: 8787, webPort: 5173, shell: false }, runtime);

    expect(result.skipPrepareLabels).toEqual(["postgres", "postgres:ready"]);
    expect(calls).toEqual([
      "docker restart pg-container",
      "docker exec pg-container sh -c until pg_isready -U wiseeff -d wiseeff; do sleep 1; done"
    ]);
  });

  it("stops existing WiseEff API and web services so the current launcher can restart them", async () => {
    const { calls, runtime } = createPortRuntime({
      isPortOpen: vi.fn(async (port) => port === 8787 || port === 5173),
      fetchText: vi.fn(async (url) => {
        if (url.endsWith(":8787/health/live")) {
          return JSON.stringify({ ok: true, service: "wiseeff-api" });
        }
        if (url.endsWith(":5173/")) {
          return '<html><head><title>智效 WiseEff</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
        }
        return undefined;
      }),
      findListeningPid: vi.fn(async (port) => (port === 8787 ? 111 : 222))
    });

    const result = await recoverDevAllPorts({ databasePort: 5432, apiPort: 8787, webPort: 5173, shell: false }, runtime);

    expect(result.skipPrepareLabels).toEqual([]);
    expect(calls).toEqual(["kill:111", "wait-free:8787", "kill:222", "wait-free:5173"]);
  });

  it("fails instead of touching an unknown process on a required port", async () => {
    const { runtime } = createPortRuntime({
      isPortOpen: vi.fn(async (port) => port === 8787),
      fetchText: vi.fn(async () => "not wiseeff")
    });

    await expect(recoverDevAllPorts({ databasePort: 5432, apiPort: 8787, webPort: 5173, shell: false }, runtime)).rejects.toThrow(
      "Port 8787 is already in use, but it does not look like a WiseEff API service."
    );
  });
});
