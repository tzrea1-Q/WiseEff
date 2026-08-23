import { describe, expect, it } from "vitest";

import { buildGate0OwnedChildProcessEnv } from "./gate0-child-process-env";

describe("Gate0 owned child process environment", () => {
  it("inherits only the minimum OS process environment and overlays the exact owned runtime", () => {
    const child = buildGate0OwnedChildProcessEnv(
      {
        DATABASE_URL: "postgres://owned:owned@127.0.0.1:5432/owned",
        AUTH_TOKEN_HMAC_SECRET: "owned-auth-secret",
        OMIT_ME: undefined,
      },
      {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/runner",
        TMPDIR: "/tmp/runner",
        LANG: "en_US.UTF-8",
        PGPASSWORD: "host-postgres-secret",
        DOCKER_AUTH_CONFIG: "host-docker-secret",
        GIT_ASKPASS: "/tmp/credential-helper",
        CI_JOB_JWT: "host-ci-jwt",
        CI_JOB_JWT_V2: "host-ci-jwt-v2",
        XIAOZE_LLM_API_KEY: "host-provider-secret",
        UNRELATED_HOST_SETTING: "must-not-cross-boundary",
      },
    );

    expect(child).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/runner",
      TMPDIR: "/tmp/runner",
      LANG: "en_US.UTF-8",
      DATABASE_URL: "postgres://owned:owned@127.0.0.1:5432/owned",
      AUTH_TOKEN_HMAC_SECRET: "owned-auth-secret",
    });
    expect(child).not.toHaveProperty("PGPASSWORD");
    expect(child).not.toHaveProperty("DOCKER_AUTH_CONFIG");
    expect(child).not.toHaveProperty("GIT_ASKPASS");
    expect(child).not.toHaveProperty("CI_JOB_JWT");
    expect(child).not.toHaveProperty("CI_JOB_JWT_V2");
  });
});
