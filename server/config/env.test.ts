import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env";

describe("loadServerEnv", () => {
  it("loads defaults for local development", () => {
    const env = loadServerEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(8787);
    expect(env.AUTH_MODE).toBe("development");
    expect(env.AUTH_TOKEN_ISSUER).toBeUndefined();
    expect(env.AUTH_TOKEN_HMAC_SECRET).toBeUndefined();
    expect(env.MOCK_RUNTIME_ENABLED).toBe(false);
    expect(env.OBJECT_STORE_ROOT).toBe(".wiseeff-object-store");
    expect(env.DEBUG_DEVICE_GATEWAY_MODE).toBe("simulator");
  });

  it("parses explicit API settings", () => {
    const env = loadServerEnv({
      NODE_ENV: "test",
      PORT: "9001",
      AUTH_MODE: "production",
      AUTH_TOKEN_ISSUER: "wiseeff-test",
      AUTH_TOKEN_HMAC_SECRET: "short-test-secret",
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      DEBUG_DEVICE_GATEWAY_MODE: "simulator",
      MOCK_RUNTIME_ENABLED: "true",
      OBJECT_STORE_ROOT: "tmp/object-store"
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(9001);
    expect(env.AUTH_MODE).toBe("production");
    expect(env.AUTH_TOKEN_ISSUER).toBe("wiseeff-test");
    expect(env.AUTH_TOKEN_HMAC_SECRET).toBe("short-test-secret");
    expect(env.DATABASE_URL).toBe("postgres://wiseeff:wiseeff@localhost:5432/wiseeff");
    expect(env.DEBUG_DEVICE_GATEWAY_MODE).toBe("simulator");
    expect(env.MOCK_RUNTIME_ENABLED).toBe(true);
    expect(env.OBJECT_STORE_ROOT).toBe("tmp/object-store");
  });

  it("rejects production mock runtime", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        MOCK_RUNTIME_ENABLED: "true"
      })
    ).toThrow("MOCK_RUNTIME_ENABLED cannot be true in production");
  });

  it("requires DATABASE_URL in production", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        MOCK_RUNTIME_ENABLED: "false"
      })
    ).toThrow("DATABASE_URL is required in production");
  });

  it("requires OBJECT_STORE_ROOT in production", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        MOCK_RUNTIME_ENABLED: "false",
        OBJECT_STORE_ROOT: " "
      })
    ).toThrow("OBJECT_STORE_ROOT is required in production");
  });

  it("requires production auth mode when NODE_ENV is production", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        OBJECT_STORE_ROOT: "tmp/object-store"
      })
    ).toThrow("AUTH_MODE=production is required when NODE_ENV=production");
  });

  it("requires token issuer and secret in production auth mode", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "test",
        AUTH_MODE: "production",
        AUTH_TOKEN_ISSUER: "wiseeff-test"
      })
    ).toThrow("AUTH_TOKEN_ISSUER and AUTH_TOKEN_HMAC_SECRET are required when AUTH_MODE=production");
  });

  it("requires long HMAC secrets outside tests", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "development",
        AUTH_MODE: "production",
        AUTH_TOKEN_ISSUER: "wiseeff-dev",
        AUTH_TOKEN_HMAC_SECRET: "too-short"
      })
    ).toThrow("AUTH_TOKEN_HMAC_SECRET must be at least 32 characters outside tests");
  });
});
