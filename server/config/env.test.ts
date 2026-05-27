import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env";

describe("loadServerEnv", () => {
  it("loads defaults for local development", () => {
    const env = loadServerEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(8787);
    expect(env.MOCK_RUNTIME_ENABLED).toBe(false);
    expect(env.OBJECT_STORE_ROOT).toBe(".wiseeff-object-store");
    expect(env.DEBUG_DEVICE_GATEWAY_MODE).toBe("simulator");
  });

  it("parses explicit API settings", () => {
    const env = loadServerEnv({
      NODE_ENV: "test",
      PORT: "9001",
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      DEBUG_DEVICE_GATEWAY_MODE: "simulator",
      MOCK_RUNTIME_ENABLED: "true",
      OBJECT_STORE_ROOT: "tmp/object-store"
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(9001);
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
});
