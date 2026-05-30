import { describe, expect, it } from "vitest";
import {
  canAcceptPilotReadiness,
  canSkipWithoutApi,
  loadEnvContent,
  parseAllowedBlockedGates,
  resolveApiBaseUrl
} from "./run-m5-smoke.shared";

describe("M5 smoke helpers", () => {
  it("does not allow skipping the API probe by default", () => {
    expect(canSkipWithoutApi({})).toBe(false);
  });

  it("allows skipping the API probe only with an explicit local flag", () => {
    expect(canSkipWithoutApi({ M5_SMOKE_ALLOW_NO_API: "true" })).toBe(true);
  });

  it("ignores the local skip flag when the require-api override is present", () => {
    expect(canSkipWithoutApi({ M5_SMOKE_ALLOW_NO_API: "true" }, ["--require-api"])).toBe(false);
  });

  it("resolves the API base URL from the shared env vars", () => {
    expect(
      resolveApiBaseUrl({
        WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:5173"
      })
    ).toBe("http://127.0.0.1:8787");
  });

  it("loads dotenv values without overriding explicit process values", () => {
    const env = loadEnvContent(
      "WISEEFF_API_BASE_URL=http://from-file\nTOKEN=file\nQUOTED=\"quoted=value\"\n",
      { TOKEN: "process" }
    );

    expect(env.WISEEFF_API_BASE_URL).toBe("http://from-file");
    expect(env.TOKEN).toBe("process");
    expect(env.QUOTED).toBe("quoted=value");
  });

  it("parses allowed pilot-readiness blockers from argv", () => {
    expect(parseAllowedBlockedGates(["--allow-only-blocked=deviceGateway"])).toEqual(["deviceGateway"]);
    expect(parseAllowedBlockedGates(["--allow-only-blocked=deviceGateway, agentProvider"])).toEqual([
      "deviceGateway",
      "agentProvider"
    ]);
  });

  it("parses allowed pilot-readiness blockers from npm config env on Windows", () => {
    expect(parseAllowedBlockedGates([], { npm_config_allow_only_blocked: "deviceGateway" })).toEqual([
      "deviceGateway"
    ]);
  });

  it("accepts pilot readiness when the API is fully ready", () => {
    expect(canAcceptPilotReadiness({ ok: true, status: "pilot_ready", blockedBy: [] }, [])).toBe(true);
  });

  it("accepts blocked pilot readiness only when the blocked gates exactly match the allowed list", () => {
    expect(
      canAcceptPilotReadiness(
        { ok: false, status: "blocked", blockedBy: ["deviceGateway"] },
        ["deviceGateway"]
      )
    ).toBe(true);
    expect(
      canAcceptPilotReadiness(
        { ok: false, status: "blocked", blockedBy: ["agentProvider", "deviceGateway"] },
        ["deviceGateway"]
      )
    ).toBe(false);
  });
});
