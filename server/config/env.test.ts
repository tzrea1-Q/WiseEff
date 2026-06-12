import { describe, expect, it } from "vitest";
import { loadServerEnv } from "./env";

const productionOidcEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
  OBJECT_STORE_MODE: "s3",
  OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
  OBJECT_STORAGE_BUCKET: "wiseeff-prod",
  OBJECT_STORAGE_ACCESS_KEY_ID: "key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
  AUTH_MODE: "production",
  AUTH_PROVIDER: "oidc",
  AUTH_OIDC_ISSUER: "https://id.example.com/realms/wiseeff",
  AUTH_OIDC_AUDIENCE: "wiseeff-api"
} as const;

describe("loadServerEnv", () => {
  it("loads defaults for local development", () => {
    const env = loadServerEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.PORT).toBe(8787);
    expect(env.AUTH_MODE).toBe("development");
    expect(env.AUTH_PROVIDER).toBe("local");
    expect(env.AUTH_TOKEN_ISSUER).toBeUndefined();
    expect(env.AUTH_TOKEN_HMAC_SECRET).toBeUndefined();
    expect(env.MOCK_RUNTIME_ENABLED).toBe(false);
    expect(env.OBJECT_STORE_MODE).toBe("local");
    expect(env.OBJECT_STORE_ROOT).toBe(".wiseeff-object-store");
    expect(env.OBJECT_STORAGE_ENDPOINT).toBeUndefined();
    expect(env.OBJECT_STORAGE_BUCKET).toBeUndefined();
    expect(env.OBJECT_STORAGE_ACCESS_KEY_ID).toBeUndefined();
    expect(env.OBJECT_STORAGE_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.OBJECT_STORAGE_REGION).toBeUndefined();
    expect(env.DEBUG_DEVICE_GATEWAY_MODE).toBe("simulator");
    expect(env.HDC_TIMEOUT_MS).toBe(5000);
    expect(env.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION).toBe(false);
    expect(env.AGENT_PROVIDER).toBe("deterministic");
    expect(env.AGENT_API_FORMAT).toBe("wiseeff");
    expect(env.AGENT_PI_PROVIDER).toBeUndefined();
    expect(env.AGENT_MODEL).toBeUndefined();
    expect(env.AGENT_API_KEY).toBeUndefined();
    expect(env.AGENT_API_BASE_URL).toBeUndefined();
    expect(env.AGENT_API_TIMEOUT_MS).toBe(5000);
    expect(env.AGENT_PROMPT_VERSION).toBe("m5-agent-v1");
    expect(env.LOG_WORKER_ENABLED).toBe(true);
  });

  it("parses explicit API settings", () => {
    const env = loadServerEnv({
      NODE_ENV: "test",
      HOST: "0.0.0.0",
      PORT: "9001",
      AUTH_MODE: "production",
      AUTH_TOKEN_ISSUER: "wiseeff-test",
      AUTH_TOKEN_HMAC_SECRET: "short-test-secret",
      AUTH_PROVIDER: "hmac",
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      MOCK_RUNTIME_ENABLED: "true",
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORE_ROOT: "tmp/object-store",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-test",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      OBJECT_STORAGE_REGION: "ap-southeast-1",
      DEBUG_DEVICE_GATEWAY_MODE: "hdc",
      HDC_TIMEOUT_MS: "2500",
      DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
      AGENT_PROVIDER: "live",
      AGENT_API_FORMAT: "openai",
      AGENT_MODEL: "pilot-model",
      AGENT_API_KEY: "secret",
      AGENT_API_BASE_URL: "https://agent.example.com",
      AGENT_API_TIMEOUT_MS: "1500",
      AGENT_PROMPT_VERSION: "m5-agent-v1",
      LOG_WORKER_ENABLED: "false"
    });

    expect(env.NODE_ENV).toBe("test");
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe(9001);
    expect(env.AUTH_MODE).toBe("production");
    expect(env.AUTH_PROVIDER).toBe("hmac");
    expect(env.AUTH_TOKEN_ISSUER).toBe("wiseeff-test");
    expect(env.AUTH_TOKEN_HMAC_SECRET).toBe("short-test-secret");
    expect(env.DATABASE_URL).toBe("postgres://wiseeff:wiseeff@localhost:5432/wiseeff");
    expect(env.DEBUG_DEVICE_GATEWAY_MODE).toBe("hdc");
    expect(env.HDC_TIMEOUT_MS).toBe(2500);
    expect(env.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION).toBe(true);
    expect(env.MOCK_RUNTIME_ENABLED).toBe(true);
    expect(env.OBJECT_STORE_MODE).toBe("s3");
    expect(env.OBJECT_STORE_ROOT).toBe("tmp/object-store");
    expect(env.OBJECT_STORAGE_ENDPOINT).toBe("https://storage.example.com");
    expect(env.OBJECT_STORAGE_BUCKET).toBe("wiseeff-test");
    expect(env.OBJECT_STORAGE_ACCESS_KEY_ID).toBe("key");
    expect(env.OBJECT_STORAGE_SECRET_ACCESS_KEY).toBe("secret");
    expect(env.OBJECT_STORAGE_REGION).toBe("ap-southeast-1");
    expect(env.AGENT_PROVIDER).toBe("live");
    expect(env.AGENT_API_FORMAT).toBe("openai");
    expect(env.AGENT_PI_PROVIDER).toBeUndefined();
    expect(env.AGENT_MODEL).toBe("pilot-model");
    expect(env.AGENT_API_KEY).toBe("secret");
    expect(env.AGENT_API_BASE_URL).toBe("https://agent.example.com");
    expect(env.AGENT_API_TIMEOUT_MS).toBe(1500);
    expect(env.AGENT_PROMPT_VERSION).toBe("m5-agent-v1");
    expect(env.LOG_WORKER_ENABLED).toBe(false);
  });

  it("loads Pi-backed live agent provider settings without a base URL", () => {
    const env = loadServerEnv({
      ...productionOidcEnv,
      DEBUG_DEVICE_GATEWAY_MODE: "hdc",
      AGENT_PROVIDER: "live",
      AGENT_API_FORMAT: "pi",
      AGENT_PI_PROVIDER: "minimax",
      AGENT_MODEL: "MiniMax-M2.7",
      AGENT_API_KEY: "secret",
      AGENT_PROMPT_VERSION: "m7-pi-agent-v1"
    });

    expect(env.AGENT_API_FORMAT).toBe("pi");
    expect(env.AGENT_PI_PROVIDER).toBe("minimax");
    expect(env.AGENT_MODEL).toBe("MiniMax-M2.7");
    expect(env.AGENT_API_BASE_URL).toBeUndefined();
    expect(env.AGENT_PROMPT_VERSION).toBe("m7-pi-agent-v1");
  });

  it("requires a Pi provider id for Pi-backed live agent provider settings", () => {
    expect(() =>
      loadServerEnv({
        ...productionOidcEnv,
        DEBUG_DEVICE_GATEWAY_MODE: "hdc",
        AGENT_PROVIDER: "live",
        AGENT_API_FORMAT: "pi",
        AGENT_MODEL: "MiniMax-M2.7",
        AGENT_API_KEY: "secret"
      })
    ).toThrow("AGENT_PI_PROVIDER is required when AGENT_API_FORMAT=pi");
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

  it("requires s3 object storage mode in production", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        MOCK_RUNTIME_ENABLED: "false"
      })
    ).toThrow("OBJECT_STORE_MODE=s3 is required when NODE_ENV=production");
  });

  it("requires S3 object storage settings in s3 mode", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "test",
        OBJECT_STORE_MODE: "s3",
        OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
        OBJECT_STORAGE_BUCKET: "wiseeff-test",
        OBJECT_STORAGE_ACCESS_KEY_ID: "key"
      })
    ).toThrow(
      "OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY_ID, and OBJECT_STORAGE_SECRET_ACCESS_KEY are required when OBJECT_STORE_MODE=s3"
    );
  });

  it("requires production auth mode when NODE_ENV is production", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        OBJECT_STORE_MODE: "s3",
        OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
        OBJECT_STORAGE_BUCKET: "wiseeff-test",
        OBJECT_STORAGE_ACCESS_KEY_ID: "key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret"
      })
    ).toThrow("AUTH_MODE=production is required when NODE_ENV=production");
  });

  it("requires token issuer and secret in production auth mode", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "test",
        AUTH_MODE: "production",
        AUTH_PROVIDER: "hmac",
        AUTH_TOKEN_ISSUER: "wiseeff-test"
      })
    ).toThrow("AUTH_TOKEN_ISSUER and AUTH_TOKEN_HMAC_SECRET are required when AUTH_MODE=production");
  });

  it("loads OIDC provider settings for production auth", () => {
    const env = loadServerEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-prod",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      AUTH_MODE: "production",
      AUTH_PROVIDER: "oidc",
      AUTH_OIDC_ISSUER: "https://id.example.com/realms/wiseeff",
      AUTH_OIDC_AUDIENCE: "wiseeff-api",
      AUTH_OIDC_JWKS_URI: "https://id.example.com/realms/wiseeff/protocol/openid-connect/certs",
      DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
      AGENT_PROVIDER: "live",
      AGENT_MODEL: "pilot-model",
      AGENT_API_KEY: "secret",
      AGENT_API_BASE_URL: "https://agent.example.com"
    });

    expect(env.AUTH_PROVIDER).toBe("oidc");
    expect(env.AUTH_OIDC_ISSUER).toBe("https://id.example.com/realms/wiseeff");
    expect(env.AUTH_OIDC_AUDIENCE).toBe("wiseeff-api");
    expect(env.AUTH_OIDC_JWKS_URI).toBe("https://id.example.com/realms/wiseeff/protocol/openid-connect/certs");
  });

  it("loads local account provider settings for production auth", () => {
    const env = loadServerEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
      OBJECT_STORE_MODE: "s3",
      OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
      OBJECT_STORAGE_BUCKET: "wiseeff-prod",
      OBJECT_STORAGE_ACCESS_KEY_ID: "key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
      AUTH_MODE: "production",
      AUTH_PROVIDER: "local",
      DEBUG_DEVICE_GATEWAY_MODE: "hdc",
      AGENT_PROVIDER: "live",
      AGENT_MODEL: "pilot-model",
      AGENT_API_KEY: "secret",
      AGENT_API_BASE_URL: "https://agent.example.com"
    });

    expect(env.AUTH_PROVIDER).toBe("local");
    expect(env.AUTH_OIDC_ISSUER).toBeUndefined();
    expect(env.AUTH_TOKEN_HMAC_SECRET).toBeUndefined();
  });

  it("rejects HMAC as the production identity provider", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        OBJECT_STORE_MODE: "s3",
        OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
        OBJECT_STORAGE_BUCKET: "wiseeff-prod",
        OBJECT_STORAGE_ACCESS_KEY_ID: "key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
        AUTH_MODE: "production",
        AUTH_PROVIDER: "hmac",
        AUTH_TOKEN_ISSUER: "wiseeff-prod",
        AUTH_TOKEN_HMAC_SECRET: "a-production-secret-with-enough-length",
        DEBUG_DEVICE_GATEWAY_MODE: "hdc",
        AGENT_PROVIDER: "live",
        AGENT_MODEL: "pilot-model",
        AGENT_API_KEY: "secret",
        AGENT_API_BASE_URL: "https://agent.example.com"
      })
    ).toThrow("AUTH_PROVIDER=oidc or AUTH_PROVIDER=local is required when NODE_ENV=production");
  });

  it("requires OIDC issuer and audience when production auth uses OIDC", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
        OBJECT_STORE_MODE: "s3",
        OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
        OBJECT_STORAGE_BUCKET: "wiseeff-prod",
        OBJECT_STORAGE_ACCESS_KEY_ID: "key",
        OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
        AUTH_MODE: "production",
        AUTH_PROVIDER: "oidc",
        DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
        AGENT_PROVIDER: "live",
        AGENT_MODEL: "pilot-model",
        AGENT_API_KEY: "secret",
        AGENT_API_BASE_URL: "https://agent.example.com"
      })
    ).toThrow("AUTH_OIDC_ISSUER and AUTH_OIDC_AUDIENCE are required when AUTH_PROVIDER=oidc");
  });

  it("requires long HMAC secrets outside tests", () => {
    expect(() =>
      loadServerEnv({
        NODE_ENV: "development",
        AUTH_MODE: "production",
        AUTH_PROVIDER: "hmac",
        AUTH_TOKEN_ISSUER: "wiseeff-dev",
        AUTH_TOKEN_HMAC_SECRET: "too-short"
      })
    ).toThrow("AUTH_TOKEN_HMAC_SECRET must be at least 32 characters outside tests");
  });

  it("requires live agent provider settings in production", () => {
    expect(() =>
      loadServerEnv({
        ...productionOidcEnv,
        DEBUG_DEVICE_GATEWAY_MODE: "hdc",
        AGENT_PROVIDER: "deterministic",
        AGENT_MODEL: "pilot-model",
        AGENT_API_KEY: "secret",
        AGENT_API_BASE_URL: "https://agent.example.com"
      })
    ).toThrow("AGENT_PROVIDER=live is required when NODE_ENV=production");

    expect(() =>
      loadServerEnv({
        ...productionOidcEnv,
        DEBUG_DEVICE_GATEWAY_MODE: "hdc",
        AGENT_PROVIDER: "live",
        AGENT_MODEL: "pilot-model",
        AGENT_API_BASE_URL: "https://agent.example.com"
      })
    ).toThrow("AGENT_API_KEY is required when AGENT_PROVIDER=live");
  });

  it("requires AGENT_API_BASE_URL for URL-backed live agent provider formats", () => {
    expect(() =>
      loadServerEnv({
        ...productionOidcEnv,
        DEBUG_DEVICE_GATEWAY_MODE: "hdc",
        AGENT_PROVIDER: "live",
        AGENT_API_FORMAT: "openai",
        AGENT_MODEL: "pilot-model",
        AGENT_API_KEY: "secret"
      })
    ).toThrow("AGENT_API_BASE_URL is required when AGENT_API_FORMAT=openai");
  });

  it("requires the HDC gateway in production unless simulator staging is explicitly allowed", () => {
    const productionEnv = {
      ...productionOidcEnv,
      AGENT_PROVIDER: "live",
      AGENT_MODEL: "pilot-model",
      AGENT_API_KEY: "secret",
      AGENT_API_BASE_URL: "https://agent.example.com"
    };

    expect(() =>
      loadServerEnv({
        ...productionEnv,
        DEBUG_DEVICE_GATEWAY_MODE: "simulator"
      })
    ).toThrow(
      "DEBUG_DEVICE_GATEWAY_MODE=hdc is required when NODE_ENV=production. Set DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true only for non-customer staging environments that intentionally run the simulator."
    );

    expect(
      loadServerEnv({
        ...productionEnv,
        DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true"
      }).DEBUG_DEVICE_GATEWAY_MODE
    ).toBe("simulator");
  });
});
