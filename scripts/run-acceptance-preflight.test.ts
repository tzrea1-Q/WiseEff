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

const deterministicXiaozeGateMessage = "Deterministic Xiaoze mode is not acceptable for pilot readiness.";

function localNonHdcBodyWithDeterministicXiaozeEvidence(blockedBy: unknown) {
  return {
    ok: false,
    status: "blocked",
    blockedBy,
    gates: {
      xiaozeLlm: {
        ok: false,
        status: "blocked",
        message: deterministicXiaozeGateMessage
      }
    }
  };
}

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
    expect(services[0].args).toEqual(["exec", "tsx", "--", "server/index.ts"]);
    expect(services[1].env).toMatchObject({
      VITE_WISEEFF_RUNTIME_MODE: "api",
      VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:8787",
      VITE_WISEEFF_API_AUTHORIZATION: "Bearer smoke"
    });
    expect(services[1].args).toEqual([
      "exec",
      "vite",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort"
    ]);
  });

  it("starts the frontend on the port selected by --frontend-url", () => {
    const services = planRuntimeServices(
      {
        envFile: ".env",
        runGates: false,
        checkFrontend: true,
        frontendUrl: "http://127.0.0.1:5175",
        startRuntime: true,
        requirePilotReady: false
      },
      {
        WISEEFF_API_BASE_URL: "http://127.0.0.1:18787",
        VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:18787"
      }
    );

    expect(services[1]).toMatchObject({
      url: "http://127.0.0.1:5175",
      args: ["exec", "vite", "--", "--host", "127.0.0.1", "--port", "5175", "--strictPort"]
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
      WISEEFF_API_BASE_URL: "http://127.0.0.1:18787",
      VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:18787",
      VITE_WISEEFF_API_AUTHORIZATION: "Bearer acceptance",
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
    expect(env).not.toHaveProperty("WISEEFF_API_BASE_URL");
    expect(env).not.toHaveProperty("VITE_WISEEFF_API_BASE_URL");
    expect(env).not.toHaveProperty("VITE_WISEEFF_API_AUTHORIZATION");
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

  it("rejects pilot readiness with blockers despite pilot_ready status", () => {
    expect(evaluatePilotReadiness({ ok: true, status: "pilot_ready", blockedBy: ["unknownGate"] })).toMatchObject({
      accepted: false,
      outcome: "blocked"
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
      evaluatePilotReadiness(localNonHdcBodyWithDeterministicXiaozeEvidence(["deviceGateway", "xiaozeLlm"]))
    ).toEqual({
      accepted: true,
      outcome: "non_hdc_local",
      detail: "Accepted for local non-HDC preflight; deviceGateway and xiaozeLlm remain blocked."
    });
  });

  it("accepts local non-HDC readiness when backup evidence is also blocked", () => {
    expect(
      evaluatePilotReadiness(
        localNonHdcBodyWithDeterministicXiaozeEvidence(["deviceGateway", "xiaozeLlm", "backups"])
      )
    ).toEqual({
      accepted: true,
      outcome: "non_hdc_local",
      detail: "Accepted for local non-HDC preflight; deviceGateway, xiaozeLlm, and backups remain blocked."
    });
  });

  it.each([
    {
      body: localNonHdcBodyWithDeterministicXiaozeEvidence(["xiaozeLlm", "deviceGateway"]),
      detail: "Accepted for local non-HDC preflight; deviceGateway and xiaozeLlm remain blocked."
    },
    {
      body: localNonHdcBodyWithDeterministicXiaozeEvidence(["backups", "xiaozeLlm", "deviceGateway"]),
      detail: "Accepted for local non-HDC preflight; deviceGateway, xiaozeLlm, and backups remain blocked."
    }
  ])("accepts local non-HDC readiness regardless of blocker order: $body.blockedBy", ({ body, detail }) => {
    expect(evaluatePilotReadiness(body)).toEqual({
      accepted: true,
      outcome: "non_hdc_local",
      detail
    });
  });

  it("rejects Xiaoze readiness blockers without gate evidence", () => {
    expect(
      evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway", "xiaozeLlm"] })
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it.each([
    [
      "missing status",
      { ok: false, status: "missing", message: "Xiaoze LLM environment is not configured for this API process." }
    ],
    ["non-deterministic message", { ok: false, status: "blocked", message: "Xiaoze LLM is unavailable." }],
    ["successful result", { ok: true, status: "blocked", message: deterministicXiaozeGateMessage }]
  ])("rejects Xiaoze readiness blockers with %s evidence", (_name, xiaozeLlm) => {
    expect(
      evaluatePilotReadiness({
        ok: false,
        status: "blocked",
        blockedBy: ["deviceGateway", "xiaozeLlm"],
        gates: { xiaozeLlm }
      })
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it("requires deterministic Xiaoze gate evidence when backups are also blocked", () => {
    expect(
      evaluatePilotReadiness({
        ok: false,
        status: "blocked",
        blockedBy: ["deviceGateway", "xiaozeLlm", "backups"]
      })
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it.each([
    ["ok true", { ok: true, status: "unexpected" }],
    ["unexpected status", { ok: false, status: "unexpected" }]
  ])("rejects non-blocked top-level readiness with %s", (_name, topLevel) => {
    expect(
      evaluatePilotReadiness({
        ...localNonHdcBodyWithDeterministicXiaozeEvidence(["deviceGateway", "xiaozeLlm"]),
        ...topLevel
      })
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it.each([
    ["nested arrays", [["deviceGateway"], ["xiaozeLlm"]]],
    ["non-string blocker", ["deviceGateway", 42]],
    ["non-array blockers", "deviceGateway,xiaozeLlm"]
  ])("rejects malformed blockedBy with %s", (_name, blockedBy) => {
    expect(
      evaluatePilotReadiness(localNonHdcBodyWithDeterministicXiaozeEvidence(blockedBy))
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it.each([
    ["null gates", null],
    ["array gates", []],
    ["non-object gates", "invalid"],
    ["null Xiaoze gate", { xiaozeLlm: null }],
    ["array Xiaoze gate", { xiaozeLlm: [] }],
    ["non-object Xiaoze gate", { xiaozeLlm: "invalid" }]
  ])("fails closed for %s", (_name, gates) => {
    expect(
      evaluatePilotReadiness({
        ok: false,
        status: "blocked",
        blockedBy: ["deviceGateway", "xiaozeLlm"],
        gates
      })
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it.each([
    [
      "two-blocker allowlist",
      localNonHdcBodyWithDeterministicXiaozeEvidence(["deviceGateway", "xiaozeLlm", "xiaozeLlm"])
    ],
    [
      "three-blocker allowlist",
      localNonHdcBodyWithDeterministicXiaozeEvidence(["deviceGateway", "xiaozeLlm", "backups", "backups"])
    ]
  ])("rejects duplicated blockers in the %s", (_name, body) => {
    expect(evaluatePilotReadiness(body)).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it("rejects the retired agentProvider blocker", () => {
    expect(
      evaluatePilotReadiness({ ok: false, status: "blocked", blockedBy: ["deviceGateway", "agentProvider"] })
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
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
        localNonHdcBodyWithDeterministicXiaozeEvidence(["deviceGateway", "xiaozeLlm"]),
        { requirePilotReady: false, startRuntime: false }
      )
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it("rejects the three-blocker local readiness when runtime startup is disabled", () => {
    expect(
      evaluatePilotReadiness(
        localNonHdcBodyWithDeterministicXiaozeEvidence(["deviceGateway", "xiaozeLlm", "backups"]),
        { requirePilotReady: false, startRuntime: false }
      )
    ).toMatchObject({
      accepted: false,
      outcome: "blocked"
    });
  });

  it.each([
    ["two-blocker", ["deviceGateway", "xiaozeLlm"]],
    ["three-blocker", ["deviceGateway", "xiaozeLlm", "backups"]]
  ])("rejects %s local readiness when full pilot readiness is required", (_name, blockedBy) => {
    expect(
      evaluatePilotReadiness(localNonHdcBodyWithDeterministicXiaozeEvidence(blockedBy), {
        requirePilotReady: true,
        startRuntime: true
      })
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

  it("rejects an unknown pilot-readiness blocker", () => {
    expect(
      evaluatePilotReadiness(
        localNonHdcBodyWithDeterministicXiaozeEvidence(["deviceGateway", "xiaozeLlm", "unknownGate"])
      )
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
