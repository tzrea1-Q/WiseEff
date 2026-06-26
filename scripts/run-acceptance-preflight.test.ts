import { describe, expect, it } from "vitest";
import {
  buildEnvSummary,
  buildPreflightEvidence,
  ensureEvidenceParentDirectory,
  isLocalHttpUrl,
  evaluatePilotReadiness,
  buildTestGateEnv,
  loadEnvContent,
  parsePreflightArgs,
  planRuntimeServices,
  shouldRetryHttpStatus
} from "./run-acceptance-preflight";

describe("acceptance preflight helpers", () => {
  it("uses local acceptance defaults", () => {
    expect(parsePreflightArgs([])).toMatchObject({
      envFile: ".env",
      runGates: true,
      checkFrontend: true,
      frontendUrl: "http://127.0.0.1:5173",
      startRuntime: true,
      requirePilotReady: false
    });
  });

  it("parses overrides for faster API-only checks", () => {
    expect(
      parsePreflightArgs([
        "--env-file",
        ".env.staging.local",
        "--skip-gates",
        "--skip-frontend",
        "--no-start-runtime",
        "--require-pilot-ready",
        "--evidence-out",
        "docs/generated/preflight.md"
      ])
    ).toMatchObject({
      envFile: ".env.staging.local",
      runGates: false,
      checkFrontend: false,
      startRuntime: false,
      requirePilotReady: true,
      evidenceOut: "docs/generated/preflight.md"
    });
  });

  it("parses npm config flags when npm does not forward argv on Windows", () => {
    expect(
      parsePreflightArgs([], {
        npm_config_env_file: ".env.local",
        npm_config_skip_gates: "true",
        npm_config_skip_frontend: "true",
        npm_config_no_start_runtime: "true",
        npm_config_require_pilot_ready: "true",
        npm_config_evidence_out: "docs/generated/preflight.md"
      })
    ).toMatchObject({
      envFile: ".env.local",
      runGates: false,
      checkFrontend: false,
      startRuntime: false,
      requirePilotReady: true,
      evidenceOut: "docs/generated/preflight.md"
    });
  });

  it("parses npm no-style config flags as false values", () => {
    expect(
      parsePreflightArgs([], {
        npm_config_start_runtime: ""
      })
    ).toMatchObject({
      startRuntime: false
    });
  });

  it("identifies local HTTP URLs that can be started by preflight", () => {
    expect(isLocalHttpUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLocalHttpUrl("http://localhost:5173")).toBe(true);
    expect(isLocalHttpUrl("https://staging.example.com")).toBe(false);
    expect(isLocalHttpUrl("not-a-url")).toBe(false);
  });

  it("plans local runtime services by default", () => {
    const services = planRuntimeServices(
      {
        envFile: ".env",
        runGates: false,
        checkFrontend: true,
        frontendUrl: "http://127.0.0.1:5173",
        startRuntime: true,
        requirePilotReady: false
      },
      {
        WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        M5_SMOKE_AUTHORIZATION: "Bearer smoke"
      }
    );

    expect(services.map((service) => service.name)).toEqual(["api runtime", "frontend runtime"]);
    expect(services[0].env).toMatchObject({ PORT: "8787", XIAOZE_DETERMINISTIC: "true" });
    expect(services[1].env).toMatchObject({
      VITE_WISEEFF_RUNTIME_MODE: "api",
      VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
      VITE_WISEEFF_API_AUTHORIZATION: "Bearer smoke"
    });
  });

  it("does not plan runtime startup for remote targets or no-start mode", () => {
    const baseOptions = {
      envFile: ".env",
      runGates: false,
      checkFrontend: true,
      frontendUrl: "https://app.example.com",
      requirePilotReady: false
    };

    expect(
      planRuntimeServices(
        { ...baseOptions, startRuntime: true },
        { WISEEFF_API_BASE_URL: "https://api.example.com", VITE_WISEEFF_API_BASE_URL: "https://api.example.com" }
      )
    ).toEqual([]);

    expect(
      planRuntimeServices(
        { ...baseOptions, frontendUrl: "http://127.0.0.1:5173", startRuntime: false },
        { WISEEFF_API_BASE_URL: "http://127.0.0.1:8787", VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:8787" }
      )
    ).toEqual([]);
  });

  it("retries transient HTTP failures and server startup responses", () => {
    expect(shouldRetryHttpStatus(0)).toBe(true);
    expect(shouldRetryHttpStatus(503)).toBe(true);
    expect(shouldRetryHttpStatus(200)).toBe(false);
    expect(shouldRetryHttpStatus(401)).toBe(false);
  });

  it("loads dotenv content without overriding explicit process values", () => {
    const env = loadEnvContent("WISEEFF_API_BASE_URL=http://from-file\nTOKEN=file\n", {
      TOKEN: "process"
    });

    expect(env.WISEEFF_API_BASE_URL).toBe("http://from-file");
    expect(env.TOKEN).toBe("process");
  });

  it("isolates test gates from acceptance runtime and pilot evidence env", () => {
    const env = buildTestGateEnv({
      KEEP_ME: "kept",
      npm_config_env_file: "E:/Prototypes/0525/WiseEff/.env",
      npm_config_mode: "local-non-hdc",
      VITE_WISEEFF_RUNTIME_MODE: "api",
      M5_CONTRACT_CHECK_PASSED: "true",
      M5_CONTRACT_ARTIFACT_CHECKED_AT: "2026-06-02T00:00:00Z",
      M5_BACKUP_RESTORE_DRILL_AT: "2026-06-02T00:00:00Z",
      M5_DEVICE_GATEWAY_EVIDENCE: "ci",
      DEBUG_DEVICE_GATEWAY_MODE: "hdc",
      HDC_DEVICE_LAB_AVAILABLE: "true",
      XIAOZE_DETERMINISTIC: "true"
    });

    expect(env.KEEP_ME).toBe("kept");
    expect(env).not.toHaveProperty("npm_config_env_file");
    expect(env).not.toHaveProperty("npm_config_mode");
    expect(env.VITE_WISEEFF_RUNTIME_MODE).toBe("mock");
    expect(env).not.toHaveProperty("M5_CONTRACT_CHECK_PASSED");
    expect(env).not.toHaveProperty("M5_CONTRACT_ARTIFACT_CHECKED_AT");
    expect(env).not.toHaveProperty("M5_BACKUP_RESTORE_DRILL_AT");
    expect(env).not.toHaveProperty("M5_DEVICE_GATEWAY_EVIDENCE");
    expect(env).not.toHaveProperty("DEBUG_DEVICE_GATEWAY_MODE");
    expect(env).not.toHaveProperty("HDC_DEVICE_LAB_AVAILABLE");
    expect(env).not.toHaveProperty("XIAOZE_DETERMINISTIC");
  });

  it("accepts full pilot readiness", () => {
    expect(evaluatePilotReadiness({ ok: true, status: "pilot_ready", blockedBy: [] })).toEqual({
      accepted: true,
      outcome: "pilot_ready",
      detail: "All pilot-readiness gates are ready."
    });
  });

  it("accepts local non-HDC readiness only when deviceGateway is the only blocker", () => {
    expect(evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway"] })).toEqual({
      accepted: true,
      outcome: "non_hdc_local",
      detail: "Accepted for local non-HDC preflight; deviceGateway remains blocked."
    });
  });

  it("accepts local non-HDC readiness when deterministic agent and device gateway are the only blockers", () => {
    expect(
      evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway", "agentProvider"] })
    ).toEqual({
      accepted: true,
      outcome: "non_hdc_local",
      detail: "Accepted for local non-HDC preflight; deviceGateway and agentProvider remain blocked."
    });
  });

  it("accepts local non-HDC readiness when backup evidence is also blocked", () => {
    expect(
      evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway", "agentProvider", "backups"] })
    ).toEqual({
      accepted: true,
      outcome: "non_hdc_local",
      detail: "Accepted for local non-HDC preflight; deviceGateway, agentProvider, and backups remain blocked."
    });
  });

  it("rejects deviceGateway-only readiness when full pilot readiness is required", () => {
    expect(
      evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway"] }, { requirePilotReady: true })
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it("rejects deterministic agent readiness blockers when runtime startup is disabled", () => {
    expect(
      evaluatePilotReadiness(
        { ok: false, status: "blocked", blockedBy: ["deviceGateway", "agentProvider"] },
        { requirePilotReady: false, startRuntime: false }
      )
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it("rejects extra pilot-readiness blockers", () => {
    expect(
      evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway", "backups"] })
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it("summarizes environment without leaking authorization tokens", () => {
    expect(
      buildEnvSummary({
        WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
        M5_SMOKE_AUTHORIZATION: "redacted-token"
      })
    ).toEqual({
      WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
      VITE_WISEEFF_API_BASE_URL: "<empty>",
      M5_SMOKE_AUTHORIZATION: "<set>",
      WISEEFF_SMOKE_AUTHORIZATION: "<empty>"
    });
  });

  it("builds a markdown evidence summary", () => {
    const evidence = buildPreflightEvidence({
      metadata: { branch: "codex/test", commit: "abc123", dirty: false },
      envSummary: { WISEEFF_API_BASE_URL: "http://127.0.0.1:8787" },
      checks: [
        { name: "docs:check", status: "passed", detail: "ok" },
        { name: "frontend", status: "skipped", detail: "disabled" }
      ],
      pilotOutcome: "non_hdc_local"
    });

    expect(evidence).toContain("## Acceptance Preflight Evidence");
    expect(evidence).toContain("- Branch: `codex/test`");
    expect(evidence).toContain("| docs:check | passed | ok |");
    expect(evidence).toContain("- Pilot outcome: `non_hdc_local`");
  });

  it("creates parent directories for evidence output paths", () => {
    expect(ensureEvidenceParentDirectory("test-results/acceptance/preflight-evidence.md")).toBe(
      "test-results/acceptance"
    );
  });
});
