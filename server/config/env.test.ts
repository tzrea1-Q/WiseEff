import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env";

describe("loadServerEnv", () => {
  it("loads defaults for local development", () => {
    const env = loadServerEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(8787);
    expect(env.MOCK_RUNTIME_ENABLED).toBe(false);
  });

  it("parses explicit API settings", () => {
    const env = loadServerEnv({
      NODE_ENV: "test",
      PORT: "9001",
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      MOCK_RUNTIME_ENABLED: "true"
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.PORT).toBe(9001);
    expect(env.DATABASE_URL).toBe("postgres://wiseeff:wiseeff@localhost:5432/wiseeff");
    expect(env.MOCK_RUNTIME_ENABLED).toBe(true);
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
