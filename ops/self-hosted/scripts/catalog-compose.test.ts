import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("actual Compose Catalog credential separation", () => {
  it("excludes role environment files and local private rehearsal work from image context", () => {
    const patterns = readFileSync(".dockerignore", "utf8").split("\n");
    expect(patterns).toContain("**/*.env");
    expect(patterns).toContain("**/*.env.*");
    expect(patterns).toContain("work/");
  });
  it("keeps management credentials out of API/worker/web/proxy and makes startup verify-only", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "catalog-compose-"));
    const secret = randomBytes(24).toString("hex");
    const save = (name: string, value: string) => {
      const filename = path.join(directory, name);
      writeFileSync(filename, value, { mode: 0o600 });
      return filename;
    };
    try {
      const env = {
        PATH: process.env.PATH, HOME: process.env.HOME,
        VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        POSTGRES_PASSWORD: secret, MINIO_ROOT_USER: "isolated", MINIO_ROOT_PASSWORD: secret,
        WISEEFF_CATALOG_CANDIDATE_IMAGE: `sha256:${"a".repeat(64)}`,
        WISEEFF_CATALOG_POSTGRES_VOLUME: "configuration-fixture-postgres",
        WISEEFF_CATALOG_MINIO_VOLUME: "configuration-fixture-minio",
        WISEEFF_CATALOG_REDIS_VOLUME: "configuration-fixture-redis",
        WISEEFF_CATALOG_NETWORK: "configuration-fixture-network",
        WISEEFF_ENV_FILE: save("host.env", `POSTGRES_PASSWORD=${secret}\nDATABASE_URL=postgres://manager:${secret}@postgres/wiseeff\n`),
        WISEEFF_API_ENV_FILE: save("api.env", "DATABASE_URL=postgres://reader@postgres/wiseeff\nCATALOG_GOVERNANCE_DATABASE_URL=postgres://governance@postgres/wiseeff\n"),
        WISEEFF_WORKER_ENV_FILE: save("worker.env", "DATABASE_URL=postgres://worker@postgres/wiseeff\n"),
        WISEEFF_MANAGEMENT_ENV_FILE: save("management.env", `DATABASE_URL=postgres://manager:${secret}@postgres/wiseeff\n`),
      };
      const run = (input = env, profile = "*") => spawnSync("docker", ["compose", "--profile", profile, "-f", "ops/self-hosted/compose.yaml", "-f", "ops/self-hosted/compose.catalog.yaml", "config", "--format", "json"], { env: input, encoding: "utf8" });
      const result = run();
      expect(result.status).toBe(0);
      const config = JSON.parse(result.stdout);
      for (const name of ["api", "worker", "web", "proxy"]) {
        const service = config.services[name];
        // Compare booleans so test failures never print private material.
        expect(JSON.stringify(service).includes(secret)).toBe(false);
        expect(service.environment?.POSTGRES_PASSWORD === undefined).toBe(true);
      }
      expect(config.services.api.environment.CATALOG_GOVERNANCE_DATABASE_URL).toBeDefined();
      expect(config.services.worker.environment.CATALOG_GOVERNANCE_DATABASE_URL).toBeUndefined();
      expect(config.services.api.command).toEqual(["npx", "tsx", "server/index.ts"]);
      expect(config.services["catalog-management"].command).toEqual(["npm", "run", "db:migrate"]);
      expect(config.services["catalog-management"].profiles).toEqual(["catalog-management"]);
      expect(config.services["catalog-management"].restart).toBe("no");
      for (const name of ["api", "worker", "web", "catalog-management"]) {
        expect(config.services[name].image).toBe(env.WISEEFF_CATALOG_CANDIDATE_IMAGE);
        expect(config.services[name].build).toBeUndefined();
        expect(config.services[name].pull_policy).toBe("never");
      }
      for (const name of ["wiseeff-postgres-data", "wiseeff-minio-data", "wiseeff-redis-data"]) {
        expect(config.volumes[name].external).toBe(true);
      }
      expect(config.networks.default.external).toBe(true);
      const managementOnly = JSON.parse(run(env, "catalog-management").stdout);
      expect(managementOnly.services.api).toBeUndefined();
      expect(managementOnly.services.proxy).toBeUndefined();
      const missing = { ...env, WISEEFF_API_ENV_FILE: "" };
      expect(run(missing).status).not.toBe(0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
