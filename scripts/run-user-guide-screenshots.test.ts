import { describe, expect, it } from "vitest";
import { configureCaptureEnvironment, requireCaptureDatabase } from "./run-user-guide-screenshots";

describe("User Guide capture database guard", () => {
  it.each([
    undefined,
    "",
    "not-a-url",
    "postgres://demo:demo@localhost/wiseeff_dev",
    "postgres://capture:capture@ugshots/wiseeff_dev",
    "https://localhost/wiseeff_capture",
    "postgres://localhost/wiseeff_capture/wiseeff_dev",
    "postgres://localhost/wiseeff_capture?database=wiseeff_dev",
    "postgres://localhost/wiseeff_capture?dbname=wiseeff_dev"
  ])("refuses unsafe or implicit database input %s", (connectionString) => {
    expect(() => configureCaptureEnvironment({
      USER_GUIDE_CAPTURE_DATABASE_URL: connectionString,
      DATABASE_URL: "postgres://localhost/wiseeff_dev"
    })).toThrow();
  });

  it.each(["wiseeff_screenshot", "wiseeff_ugshots", "wiseeff_capture", "WiseEff_Capture"])("pins every child environment to %s", (name) => {
    const connectionString = `postgres://demo:demo@localhost/${name}`;
    const env: Record<string, string | undefined> = {
      USER_GUIDE_CAPTURE_DATABASE_URL: connectionString,
      DATABASE_URL: "postgres://localhost/wiseeff_dev",
      WISEEFF_WORKER_DATABASE_URL: "postgres://localhost/wiseeff_dev",
      AUTH_MODE: "development",
      VITE_WISEEFF_API_AUTHORIZATION: "inherited-token",
      LOG_ANALYSIS_DETERMINISTIC: "false"
    };
    configureCaptureEnvironment(env);
    expect(requireCaptureDatabase(env).name).toBe(name);
    expect(env).toMatchObject({
      DATABASE_URL: connectionString,
      WISEEFF_WORKER_DATABASE_URL: connectionString,
      AUTH_MODE: "production",
      AUTH_PROVIDER: "local",
      AUTH_LOCAL_SELF_REGISTER: "true",
      NODE_ENV: "development",
      VITE_WISEEFF_API_AUTHORIZATION: "",
      LOG_ANALYSIS_DETERMINISTIC: "true",
      LOG_ANALYSIS_QUEUE_MODE: "polling",
      XIAOZE_PROACTIVE_ENABLED: "false",
      EMBEDDING_API_BASE_URL: ""
    });
  });

  it("refuses direct Playwright seeding when DATABASE_URL disagrees", () => {
    expect(() => requireCaptureDatabase({
      USER_GUIDE_CAPTURE_DATABASE_URL: "postgres://localhost/wiseeff_ugshots",
      DATABASE_URL: "postgres://localhost/wiseeff_dev"
    })).toThrow("DATABASE_URL must match");
  });
});
