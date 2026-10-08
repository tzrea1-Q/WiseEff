import { describe, expect, it, vi } from "vitest";
import { withPgClient } from "../e2e/acceptance/helpers/database";
import { buildBrowserAcceptanceEvidence } from "../e2e/acceptance/helpers/evidence";
import { apiBaseUrl, apiRoute, smokeHeaders } from "../e2e/acceptance/helpers/runtime";
import {
  buildBrowserAcceptanceCommand,
  acceptanceShardOperations,
  assertAcceptanceShardPlan,
  assertAcceptanceShardReport,
  collectAcceptanceTests,
  deriveBrowserAcceptanceWorkflowsFromPlaywrightReport,
  buildDefaultBrowserAcceptanceWorkflows,
  buildPreflightCommand,
  createFullEvidenceRun,
  commandUsesShell,
  evaluateBrowserAcceptanceRun,
  loadEnvContent,
  npmCommand,
  parseBrowserAcceptanceArgs,
  resolveBrowserSourceMetadata,
  resolvePlaywrightHdcStatus
} from "./run-browser-acceptance";

describe("browser acceptance runner", () => {
  const shardReport = {
    suites: [
      { file: "runtime-warmup.spec.ts", specs: [{ id: "warmup", tests: [{ projectName: "runtime-warmup", results: [{ status: "passed" }] }] }] },
      { file: "parameters.acceptance.spec.ts", suites: [{ specs: [{ id: "browser", tests: [{ projectName: "Desktop Chrome", results: [{ status: "passed" }] }] }] }] },
    ],
  };
  it("forwards browser-only sharding without restricting projects or suppressing dependency warmup", () => {
    for (const args of [["--shard=2/4"], ["--shard", "2/4"]]) {
      const options = parseBrowserAcceptanceArgs(args, { WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR: "/tmp/owned/runtime.json" });
      expect(buildBrowserAcceptanceCommand({ ...options, runtimeDescriptor: undefined }, {}).args).toEqual(["run", "acceptance:e2e", "--", "--shard=2/4"]);
    }
  });
  it("refuses standalone or target/full-pilot shards rather than publishing partial full-run evidence", () => {
    expect(() => parseBrowserAcceptanceArgs(["--shard=2/4"], {})).toThrow(/owned Gate0/);
    for (const mode of ["target-non-hdc", "full-pilot"]) {
      expect(() => parseBrowserAcceptanceArgs([`--mode=${mode}`, "--shard=2/4", "--runtime-descriptor", "/tmp/owned/runtime.json"], {})).toThrow(/local-non-hdc/);
    }
  });
  it.each(["0/4", "5/4", "1/0", "1/4 --no-deps", "1/9007199254740992", ""])("rejects invalid browser shard %s", (shard) => {
    expect(() => parseBrowserAcceptanceArgs([`--shard=${shard}`], {})).toThrow();
  });
  it("requires nonzero browser collection and warmup, and refuses missing/extra/duplicate tests in shard reports", () => {
    const planned = collectAcceptanceTests(shardReport);
    expect(planned).toEqual([
      { id: "warmup", project: "runtime-warmup", file: "runtime-warmup.spec.ts" },
      { id: "browser", project: "Desktop Chrome", file: "parameters.acceptance.spec.ts" },
    ]);
    expect(() => assertAcceptanceShardReport(planned, shardReport)).not.toThrow();
    expect(() => assertAcceptanceShardPlan([])).toThrow(/zero/);
    expect(() => assertAcceptanceShardPlan(planned.slice(0, 1))).toThrow(/zero/);
    expect(() => assertAcceptanceShardPlan(planned.slice(1))).toThrow(/warmup/);
    expect(() => assertAcceptanceShardReport(planned, { suites: [] })).toThrow(/inventory/);
    expect(() => assertAcceptanceShardReport(planned, { suites: [shardReport.suites[0]] })).toThrow(/inventory/);
    expect(() => assertAcceptanceShardReport(planned, { suites: [...shardReport.suites, shardReport.suites[1]] })).toThrow(/inventory/);
    expect(() => assertAcceptanceShardPlan(planned, planned.slice(0, 1))).toThrow(/outside the full collection/);
  });
  it("scopes existing operation and workflow requirements by planned files, not by successful result files", () => {
    const operations = acceptanceShardOperations(["parameters.acceptance.spec.ts"]);
    expect(operations.map((operation) => operation.id)).toContain("PARAM-ADMIN-001");
    expect(operations.map((operation) => operation.id)).not.toContain("AUTH-RUNTIME-001");
    expect(() => acceptanceShardOperations(["parameters.acceptance.spec.ts"], ["parameters.acceptance.spec.ts"])).toThrow(/omitted required operation/);
    expect(deriveBrowserAcceptanceWorkflowsFromPlaywrightReport(shardReport, "report", ["parameters.acceptance.spec.ts"]).map((workflow) => workflow.id)).toEqual(["B", "C"]);
    expect(deriveBrowserAcceptanceWorkflowsFromPlaywrightReport({ suites: [] }, "report", ["parameters.acceptance.spec.ts"])).toEqual([
      expect.objectContaining({ id: "B", status: "skipped" }), expect.objectContaining({ id: "C", status: "skipped" }),
    ]);
  });
  it("rejects a partial owner spec even when the operation owner file is present", () => {
    const planned = collectAcceptanceTests(shardReport);
    const full = [...planned, { id: "joint-ui-proof", project: "Desktop Chrome", file: "parameters.acceptance.spec.ts" }];
    expect(() => assertAcceptanceShardPlan(planned, full)).toThrow(/split browser spec/);
    expect(() => assertAcceptanceShardPlan(full, full)).not.toThrow();
  });
  it("retains all four affected operation contracts in their actual owner specs", () => {
    const operations = acceptanceShardOperations([
      "b906-manual-sync-ui.acceptance.spec.ts",
      "b906-canonical-conflict-decision.acceptance.spec.ts",
      "dts-structured.acceptance.spec.ts",
    ]);
    for (const id of ["PARAM-FILE-SYNC-001", "PARAM-FILE-RESOLVE-001", "PROJ-CONFIG-CONFLICT-001", "PARAM-DTS-EDIT-002"]) {
      expect(operations.find((operation) => operation.id === id)?.assertions).toContain("ui");
    }
  });
  it("uses the owned descriptor pre-run source identity after visual artifacts dirty the worktree", () => {
    expect(
      resolveBrowserSourceMetadata(
        { branch: "codex/td-122", commit: "post-visual", dirty: true },
        {
          sourceCommit: "0123456789012345678901234567890123456789",
          sourceDirtyBefore: false,
        },
      ),
    ).toEqual({
      branch: "codex/td-122",
      commit: "0123456789012345678901234567890123456789",
      dirty: false,
    });
  });

  it("passes an owned descriptor through validation-only preflight", () => {
    const options = parseBrowserAcceptanceArgs(["--runtime-descriptor", "/tmp/owned/runtime.json"], {});
    expect(options).toMatchObject({
      runtimeDescriptor: "/tmp/owned/runtime.json",
      startRuntime: false
    });
    expect(buildPreflightCommand(options)?.args).toEqual([
      "run",
      "acceptance:preflight",
      "--",
      "--env-file",
      ".env",
      "--frontend-url",
      "http://127.0.0.1:5173",
      "--evidence-out",
      "test-results/acceptance-preflight/evidence.md",
      "--no-start-runtime",
      "--skip-gates",
      "--runtime-descriptor",
      "/tmp/owned/runtime.json"
    ]);
  });

  it("uses local non-HDC defaults", () => {
    expect(parseBrowserAcceptanceArgs([], {})).toEqual({
      mode: "local-non-hdc",
      envFile: ".env",
      frontendUrl: "http://127.0.0.1:5173",
      evidenceOut: "docs/generated/acceptance-browser-evidence.md",
      skipPreflight: false,
      startRuntime: true,
      headed: false
    });
  });

  it("resolves npm through the shell on Windows", () => {
    expect(npmCommand("win32")).toBe("npm");
    expect(npmCommand("linux")).toBe("npm");
    expect(npmCommand("darwin")).toBe("npm");
    expect(commandUsesShell("win32")).toBe(true);
    expect(commandUsesShell("linux")).toBe(false);
  });

  it("parses CLI overrides", () => {
    expect(
      parseBrowserAcceptanceArgs(
        [
          "--mode",
          "full-pilot",
          "--env-file",
          ".env.pilot",
          "--frontend-url",
          "https://staging.example.test",
          "--evidence-out",
          "artifacts/browser.md",
          "--skip-preflight",
          "--no-start-runtime",
          "--headed"
        ],
        {}
      )
    ).toEqual({
        mode: "full-pilot",
        envFile: ".env.pilot",
        frontendUrl: "https://staging.example.test",
        evidenceOut: "artifacts/browser.md",
      skipPreflight: true,
      startRuntime: false,
      headed: true
    });
  });

  it("rejects unsupported modes", () => {
    expect(() => parseBrowserAcceptanceArgs(["--mode", "demo"], {})).toThrow(
      "Unsupported browser acceptance mode: demo"
    );
  });

  it("maps npm config flags when npm does not forward argv on Windows", () => {
    expect(
      parseBrowserAcceptanceArgs([], {
        npm_config_mode: "target-non-hdc",
        npm_config_env_file: ".env.target",
        npm_config_frontend_url: "https://target.example.test",
        npm_config_evidence_out: "evidence/target.md",
        npm_config_skip_preflight: "true",
        npm_config_no_start_runtime: "true",
        npm_config_headed: "true"
      })
    ).toEqual({
      mode: "target-non-hdc",
      envFile: ".env.target",
      frontendUrl: "https://target.example.test",
      evidenceOut: "evidence/target.md",
      skipPreflight: true,
      startRuntime: false,
      headed: true
    });
  });

  it("builds the local non-HDC preflight command", () => {
    expect(buildPreflightCommand(parseBrowserAcceptanceArgs([], {}))).toEqual({
      command: npmCommand(),
      env: {
        DEBUG_DEVICE_GATEWAY_MODE: "simulator",
        HDC_DEVICE_LAB_AVAILABLE: "false",
        DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true"
      },
      args: [
        "run",
        "acceptance:preflight",
        "--",
        "--env-file",
        ".env",
        "--frontend-url",
        "http://127.0.0.1:5173",
        "--evidence-out",
      "test-results/acceptance-preflight/evidence.md"
      ]
    });
  });

  it("builds target non-HDC and full-pilot preflight commands", () => {
    expect(buildPreflightCommand(parseBrowserAcceptanceArgs(["--mode", "target-non-hdc"], {}))?.args).toEqual([
      "run",
      "acceptance:preflight",
      "--",
      "--env-file",
      ".env",
      "--frontend-url",
      "http://127.0.0.1:5173",
      "--evidence-out",
      "test-results/acceptance-preflight/evidence.md",
      "--no-start-runtime"
    ]);

    expect(
      buildPreflightCommand(parseBrowserAcceptanceArgs(["--mode", "full-pilot", "--no-start-runtime"], {}))?.args
    ).toEqual([
      "run",
      "acceptance:preflight",
      "--",
      "--env-file",
      ".env",
      "--frontend-url",
      "http://127.0.0.1:5173",
      "--evidence-out",
      "test-results/acceptance-preflight/evidence.md",
      "--require-pilot-ready",
      "--no-start-runtime"
    ]);
  });

  it("omits the preflight command when preflight is skipped", () => {
    expect(buildPreflightCommand(parseBrowserAcceptanceArgs(["--skip-preflight"], {}))).toBeNull();
  });

  it("loads dotenv content for Playwright without overriding explicit env", () => {
    const env = loadEnvContent(
      [
        "",
        "# ignored comment",
        "WISEEFF_API_BASE_URL=http://from-file",
        "TOKEN=file",
        "EMPTY=file",
        "QUOTED=\"quoted=value\"",
        "SINGLE='single value'",
        "NO_EQUALS"
      ].join("\n"),
      {
        TOKEN: "process",
        EMPTY: ""
      }
    );

    expect(env.WISEEFF_API_BASE_URL).toBe("http://from-file");
    expect(env.TOKEN).toBe("process");
    expect(env.EMPTY).toBe("");
    expect(env.QUOTED).toBe("quoted=value");
    expect(env.SINGLE).toBe("single value");
    expect(env.NO_EQUALS).toBeUndefined();
  });

  it("builds headed and headless Playwright commands without overriding config reporters", () => {
    const command = buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs([], {}));
    expect(command).toEqual({
      command: npmCommand(),
      args: ["run", "acceptance:e2e", "--"],
      env: expect.any(Object)
    });
    expect(command.env).toMatchObject({
      DEBUG_DEVICE_GATEWAY_MODE: "simulator",
      HDC_DEVICE_LAB_AVAILABLE: "false",
      DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true",
      VITE_PROJECT_CONFIGURATION_WORKBENCH_ENABLED: "true"
    });

    expect(buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs(["--headed"], {}))).toEqual({
      command: npmCommand(),
      args: ["run", "acceptance:e2e", "--", "--headed"],
      env: expect.any(Object)
    });
  });

  it("injects one full run and source commit namespace into Playwright", () => {
    const run = createFullEvidenceRun(
      { branch: "fix/evidence", commit: "abc123", dirty: false },
      "2026-07-18T04:00:00.000Z",
      "/tmp/wiseeff-evidence"
    );
    const command = buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs([], {}), {}, run);

    expect(command.env).toMatchObject({
      WISEEFF_ACCEPTANCE_EVIDENCE_ROOT: "/tmp/wiseeff-evidence",
      WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID: "full-20260718T040000000Z-abc123",
      WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT: "abc123",
      WISEEFF_ACCEPTANCE_EVIDENCE_RUN_KIND: "full"
    });
  });

  it("maps Playwright results to the manual acceptance A-J workflow rows", () => {
    const workflows = buildDefaultBrowserAcceptanceWorkflows({
      playwrightStatus: "passed",
      hdcStatus: "skipped",
      artifactPath: "playwright-report/acceptance/index.html"
    });

    expect(workflows.map((workflow) => workflow.id)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    expect(workflows).toContainEqual(
      expect.objectContaining({
        id: "F",
        name: "HDC device lab",
        status: "skipped"
      })
    );
  });

  it("maps Playwright JSON report results without over-reporting skipped specs", () => {
    const workflows = deriveBrowserAcceptanceWorkflowsFromPlaywrightReport(
      {
        suites: [
          {
            file: "e2e/acceptance/shell-navigation.acceptance.spec.ts",
            specs: [{ tests: [{ results: [{ status: "passed" }] }] }]
          },
          {
            file: "e2e/acceptance/xiaoze-action.acceptance.spec.ts",
            specs: [{ tests: [{ results: [{ status: "skipped" }] }] }]
          },
          {
            file: "e2e/acceptance/permissions.acceptance.spec.ts",
            specs: [
              { tests: [{ results: [{ status: "passed" }] }] },
              { tests: [{ results: [{ status: "skipped" }] }] }
            ]
          }
        ]
      },
      "playwright-report/acceptance/index.html"
    );

    expect(workflows.find((workflow) => workflow.id === "A")).toMatchObject({ status: "passed" });
    expect(workflows.find((workflow) => workflow.id === "G")).toMatchObject({ status: "skipped" });
    expect(workflows.find((workflow) => workflow.id === "H")).toMatchObject({ status: "passed" });
  });

  it("does not mark a workflow skipped when planned stubs sit beside passing tests", () => {
    const workflows = deriveBrowserAcceptanceWorkflowsFromPlaywrightReport(
      {
        suites: [
          {
            file: "e2e/acceptance/xiaoze-action.acceptance.spec.ts",
            specs: [
              { tests: [{ results: [{ status: "passed" }] }] },
              { tests: [{ results: [{ status: "skipped" }] }] }
            ]
          },
          {
            file: "e2e/acceptance/xiaoze-perception.acceptance.spec.ts",
            specs: [{ tests: [{ results: [{ status: "passed" }] }] }]
          }
        ]
      },
      "playwright-report/acceptance/index.html"
    );

    expect(workflows.find((workflow) => workflow.id === "G")).toMatchObject({ status: "passed" });
  });

  it("carries selected dotenv values into the Playwright command env", () => {
    const env = loadEnvContent("VITE_WISEEFF_API_BASE_URL=http://from-file\nM5_SMOKE_AUTHORIZATION=file-token\n", {
      VITE_WISEEFF_API_BASE_URL: "http://explicit",
      EXISTING: "kept"
    });

    expect(buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs(["--env-file", ".env.target"], {}), env).env).toMatchObject({
      VITE_WISEEFF_API_BASE_URL: "http://explicit",
      WISEEFF_ACCEPTANCE_FRONTEND_URL: "http://127.0.0.1:5173",
      M5_SMOKE_AUTHORIZATION: "file-token",
      EXISTING: "kept"
    });
  });

  it("passes the selected frontend URL into preflight and Playwright", () => {
    const options = parseBrowserAcceptanceArgs(["--frontend-url", "https://frontend.example.test"], {});

    expect(buildPreflightCommand(options)?.args).toEqual(
      expect.arrayContaining(["--frontend-url", "https://frontend.example.test"])
    );
    expect(buildBrowserAcceptanceCommand(options, {}).env).toMatchObject({
      WISEEFF_ACCEPTANCE_FRONTEND_URL: "https://frontend.example.test"
    });
  });

  it("marks Playwright no-start runtime when preflight owns runtime startup", () => {
    expect(buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs([], {}), {}).env).toMatchObject({
      WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true"
    });
  });

  it("lets Playwright start runtime when preflight is skipped", () => {
    expect(buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs(["--skip-preflight"], {}), {}).env).not.toHaveProperty(
      "WISEEFF_ACCEPTANCE_NO_START_RUNTIME"
    );
  });

  it("marks Playwright no-start runtime for target mode and no-start mode", () => {
    expect(
      buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs(["--mode", "target-non-hdc"], {}), {}).env
    ).toMatchObject({
      WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true"
    });
    expect(
      buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs(["--no-start-runtime"], {}), {}).env
    ).toMatchObject({
      WISEEFF_ACCEPTANCE_NO_START_RUNTIME: "true"
    });
  });

  it("marks Playwright HDC ready only when HDC gateway mode and lab are both enabled", () => {
    expect(
      resolvePlaywrightHdcStatus({
        DEBUG_DEVICE_GATEWAY_MODE: "hdc",
        HDC_DEVICE_LAB_AVAILABLE: "true"
      })
    ).toBe("ready");
  });

  it("marks Playwright HDC skipped for simulator mode or unavailable lab", () => {
    expect(
      resolvePlaywrightHdcStatus({
        DEBUG_DEVICE_GATEWAY_MODE: "simulator",
        HDC_DEVICE_LAB_AVAILABLE: "true"
      })
    ).toBe("skipped");
    expect(resolvePlaywrightHdcStatus({ DEBUG_DEVICE_GATEWAY_MODE: "hdc" })).toBe("skipped");
  });

  it("passes local non-HDC only with accepted preflight, passing Playwright, and skipped or absent HDC", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "local-non-hdc",
        preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
        playwright: { status: "passed" }
      })
    ).toEqual({ status: "passed", blockers: [] });

    expect(
      evaluateBrowserAcceptanceRun({
        mode: "local-non-hdc",
        preflight: { status: "passed", outcome: "pilot_ready", hdc: "absent" },
        playwright: { status: "passed" }
      })
    ).toEqual({ status: "passed", blockers: [] });

    expect(
      evaluateBrowserAcceptanceRun({
        mode: "local-non-hdc",
        preflight: { status: "passed", outcome: "pilot_ready", hdc: "ready" },
        playwright: { status: "passed" }
      }).status
    ).toBe("failed");
  });

  it("fails local non-HDC when a required browser workflow is skipped", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "local-non-hdc",
        preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
        playwright: { status: "passed" },
        workflows: buildDefaultBrowserAcceptanceWorkflows({
          playwrightStatus: "passed",
          hdcStatus: "skipped",
          artifactPath: "playwright-report/acceptance/index.html"
        }).map((workflow) => (workflow.id === "G" ? { ...workflow, status: "skipped" } : workflow))
      }).status
    ).toBe("failed");
  });

  it("adds requirement coverage gaps to blockers", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "local-non-hdc",
        preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
        playwright: { status: "passed" },
        requirementCoverage: {
          status: "failed",
          coveredIds: ["UNKNOWN-REQ-001"],
          missingRequiredIds: ["PARAM-HAPPY-001"],
          unknownIds: ["UNKNOWN-REQ-001"]
        }
      })
    ).toEqual({
      status: "failed",
      blockers: [
        "Acceptance requirement coverage is missing required IDs: PARAM-HAPPY-001.",
        "Acceptance requirement coverage references unknown IDs: UNKNOWN-REQ-001."
      ]
    });
  });

  it("adds operation evidence gaps to blockers", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "local-non-hdc",
        preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
        playwright: { status: "passed" },
        operationEvidence: {
          status: "failed",
          coveredOperationIds: [],
          missingOperationIds: ["PARAM-HAPPY-001"],
          invalidEvidenceIds: [],
          records: []
        }
      })
    ).toEqual({
      status: "failed",
      blockers: ["Operation evidence is missing required IDs: PARAM-HAPPY-001."]
    });
  });

  it("adds operation evidence metadata gaps to blockers", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "local-non-hdc",
        preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
        playwright: { status: "passed" },
        operationEvidence: {
          status: "failed",
          coveredOperationIds: ["PARAM-HAPPY-001"],
          missingOperationIds: [],
          invalidEvidenceIds: ["PARAM-HAPPY-001"],
          validationErrors: [
            {
              operationId: "PARAM-HAPPY-001",
              field: "api",
              message: "API assertions require at least one API request/response summary."
            }
          ],
          records: [{ operationId: "PARAM-HAPPY-001", status: "passed" }]
        }
      })
    ).toEqual({
      status: "failed",
      blockers: ["Operation evidence records are missing review or forensic metadata: PARAM-HAPPY-001."]
    });
  });

  it("adds operation matrix gaps to blockers", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "local-non-hdc",
        preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
        playwright: { status: "passed" },
        operationMatrix: {
          status: "failed",
          coveredOperationIds: [],
          missingAutomatedOperationIds: ["PARAM-HAPPY-001"],
          deferredOperationIdsMissingReason: [],
          operationsMissingAssertions: [],
          unknownOperationIds: ["UNKNOWN-OP-001"],
          unknownAcceptanceIds: []
        }
      })
    ).toEqual({
      status: "failed",
      blockers: [
        "Operation matrix is missing automated operation markers: PARAM-HAPPY-001.",
        "Operation matrix references unknown operation IDs: UNKNOWN-OP-001."
      ]
    });
  });

  it("passes target non-HDC when Playwright passes and HDC is explicitly excluded", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "target-non-hdc",
        preflight: { status: "passed", outcome: "pilot_ready", hdc: "ready" },
        playwright: { status: "passed" }
      })
    ).toMatchObject({ status: "failed" });

    expect(
      evaluateBrowserAcceptanceRun({
        mode: "target-non-hdc",
        preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
        playwright: { status: "passed" }
      })
    ).toEqual({ status: "passed", blockers: [] });

    expect(
      evaluateBrowserAcceptanceRun({
        mode: "target-non-hdc",
        preflight: { status: "passed", outcome: "blocked", hdc: "skipped" },
        playwright: { status: "passed" }
      }).status
    ).toBe("failed");
  });

  it("passes full pilot only with pilot-ready preflight, passing Playwright, and Playwright-ready HDC", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "full-pilot",
        preflight: { status: "passed", outcome: "pilot_ready", hdc: "ready" },
        playwright: { status: "passed", hdc: "ready" }
      })
    ).toEqual({ status: "passed", blockers: [] });

    expect(
      evaluateBrowserAcceptanceRun({
        mode: "full-pilot",
        preflight: { status: "passed", outcome: "pilot_ready", hdc: "ready" },
        playwright: { status: "passed" }
      }).status
    ).toBe("failed");

    expect(
      evaluateBrowserAcceptanceRun({
        mode: "full-pilot",
        preflight: { status: "passed", outcome: "pilot_ready", hdc: "ready" },
        playwright: { status: "passed", hdc: "skipped" }
      }).status
    ).toBe("failed");

    expect(
      evaluateBrowserAcceptanceRun({
        mode: "full-pilot",
        preflight: { status: "passed", outcome: "non_hdc_local", hdc: "ready" },
        playwright: { status: "passed", hdc: "ready" }
      }).status
    ).toBe("failed");
  });

  it("fails full pilot when the HDC browser workflow is skipped", () => {
    expect(
      evaluateBrowserAcceptanceRun({
        mode: "full-pilot",
        preflight: { status: "passed", outcome: "pilot_ready", hdc: "ready" },
        playwright: { status: "passed", hdc: "ready" },
        workflows: buildDefaultBrowserAcceptanceWorkflows({
          playwrightStatus: "passed",
          hdcStatus: "ready",
          artifactPath: "playwright-report/acceptance/index.html"
        }).map((workflow) => (workflow.id === "F" ? { ...workflow, status: "skipped" } : workflow))
      }).status
    ).toBe("failed");
  });
});

describe("playwright acceptance config", () => {
  it("disables Playwright retries for a validated owned Gate0 runtime while legacy CI keeps one retry", async () => {
    const previousCi = process.env.CI;
    const previousDescriptor = process.env.WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR;
    process.env.CI = "true";
    process.env.WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR = "/tmp/owned/runtime.json";
    try {
      vi.resetModules();
      vi.doMock("../e2e/acceptance/helpers/ownedRuntimeDescriptor", () => ({
        OWNED_ACCEPTANCE_DESCRIPTOR_ENV: "WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR",
        loadOwnedRuntimeDescriptorFromEnv: () => ({
          endpoints: {
            frontend: { url: "http://127.0.0.1:5180" },
            api: { url: "http://127.0.0.1:18800" },
          },
        }),
      }));
      const owned = (await import("../playwright.acceptance.config")).default;
      expect(owned.retries).toBe(0);

      vi.doUnmock("../e2e/acceptance/helpers/ownedRuntimeDescriptor");
      delete process.env.WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR;
      vi.resetModules();
      const legacy = (await import("../playwright.acceptance.config")).default;
      expect(legacy.retries).toBe(1);
    } finally {
      vi.doUnmock("../e2e/acceptance/helpers/ownedRuntimeDescriptor");
      if (previousCi === undefined) delete process.env.CI;
      else process.env.CI = previousCi;
      if (previousDescriptor === undefined) delete process.env.WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR;
      else process.env.WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR = previousDescriptor;
    }
  });

  it("honors the owned run-scoped output and report directories", async () => {
    process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR = "/tmp/owned/artifacts/browser/test-results";
    process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR = "/tmp/owned/artifacts/browser/playwright-report";
    try {
      vi.resetModules();
      const config = (await import("../playwright.acceptance.config")).default;
      expect(config.outputDir).toBe("/tmp/owned/artifacts/browser/test-results");
      expect(config.reporter).toEqual(expect.arrayContaining([
        ["html", expect.objectContaining({ outputFolder: "/tmp/owned/artifacts/browser/playwright-report" })],
      ]));
    } finally {
      delete process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR;
      delete process.env.WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR;
    }
  });

  it("disables web servers when Playwright is told not to start runtime", async () => {
    const config = await importAcceptanceConfig("true");

    expect(config.webServer).toEqual([]);
  });

  it("keeps configured web servers by default", async () => {
    const config = await importAcceptanceConfig(undefined);

    expect(Array.isArray(config.webServer)).toBe(true);
    expect(config.webServer).toHaveLength(2);
  });

  it("uses the configured target frontend URL", async () => {
    const config = await importAcceptanceConfig(undefined, "https://frontend.example.test");

    expect(config.use).toMatchObject({ baseURL: "https://frontend.example.test" });
  });

  it("starts the frontend with the configured acceptance API URL", async () => {
    const config = await importAcceptanceConfig(undefined, "http://127.0.0.1:5199", "http://127.0.0.1:8899");
    const webServers = config.webServer as Array<{ command: string; env?: Record<string, string> }>;
    const frontendServer = webServers[1];

    expect(frontendServer.command).toContain("vite");
    expect(frontendServer.command).not.toContain("npm run dev");
    expect(frontendServer.env).toMatchObject({
      VITE_WISEEFF_API_BASE_URL: "http://127.0.0.1:8899"
    });
  });

  it("defines runtime-warmup as a dependency project", async () => {
    const config = await importAcceptanceConfig(undefined);
    const projects = config.projects as Array<{
      name: string;
      timeout?: number;
      dependencies?: string[];
      testIgnore?: RegExp;
    }>;

    expect(projects.find((project) => project.name === "runtime-warmup")?.timeout).toBe(120_000);
    expect(projects.find((project) => project.name === "Desktop Chrome")?.dependencies).toContain(
      "runtime-warmup"
    );
    expect(projects.find((project) => project.name === "Desktop Chrome")?.testIgnore).toEqual(
      /runtime-warmup\.spec\.ts/
    );
  });
});

describe("playwright quality config", () => {
  it("honors owned run-scoped output, report, and snapshot directories", async () => {
    process.env.WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR = "/tmp/owned/artifacts/visual/test-results";
    process.env.WISEEFF_QUALITY_PLAYWRIGHT_REPORT_DIR = "/tmp/owned/artifacts/visual/playwright-report";
    process.env.WISEEFF_QUALITY_SNAPSHOT_ROOT = "/tmp/owned/artifacts/visual/snapshots";
    try {
      vi.resetModules();
      const config = (await import("../playwright.quality.config")).default;
      expect(config.outputDir).toBe("/tmp/owned/artifacts/visual/test-results");
      expect(config.snapshotPathTemplate).toBe("/tmp/owned/artifacts/visual/snapshots/{platform}/{arg}{ext}");
      expect(config.reporter).toEqual(expect.arrayContaining([
        ["html", expect.objectContaining({ outputFolder: "/tmp/owned/artifacts/visual/playwright-report" })],
      ]));
    } finally {
      delete process.env.WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR;
      delete process.env.WISEEFF_QUALITY_PLAYWRIGHT_REPORT_DIR;
      delete process.env.WISEEFF_QUALITY_SNAPSHOT_ROOT;
    }
  });

  it("uses the configured target frontend URL", async () => {
    const config = await importQualityConfig("https://frontend.example.test");

    expect(config.use).toMatchObject({ baseURL: "https://frontend.example.test" });
  });

  it("defines runtime-warmup as a dependency project", async () => {
    const config = await importQualityConfig();
    const projects = config.projects as Array<{ name: string; timeout?: number; dependencies?: string[] }>;

    expect(projects.find((project) => project.name === "runtime-warmup")?.timeout).toBe(120_000);
    for (const projectName of ["a11y", "visual", "responsive"]) {
      expect(projects.find((project) => project.name === projectName)?.dependencies).toContain(
        "runtime-warmup"
      );
    }
  });
});

describe("browser acceptance evidence", () => {
  it("contains the required sections and escapes workflow table cells", () => {
    const evidence = buildBrowserAcceptanceEvidence({
      date: "2026-05-30T00:00:00.000Z",
      metadata: { branch: "codex/browser", commit: "abc123", dirty: true },
      mode: "local-non-hdc",
      status: "failed",
      preflight: {
        status: "passed",
        outcome: "non_hdc_local",
        hdc: "skipped",
        artifactPath: "test-results/acceptance-preflight/evidence.md"
      },
      playwright: {
        status: "failed",
        artifactPath: "playwright-report/acceptance/index.html"
      },
      workflows: [
        {
          id: "B",
          name: "Parameters | governance",
          status: "passed",
          notes: "review\napproved",
          artifacts: ["test-results/acceptance/parameters.md"]
        }
      ],
      artifactPaths: ["test-results/acceptance", "playwright-report/acceptance"],
      blockers: ["Playwright failed"]
    });

    expect(evidence).toContain("## Browser Acceptance Evidence");
    expect(evidence).toContain("- Mode: `local-non-hdc`");
    expect(evidence).toContain("### Preflight Result");
    expect(evidence).toContain("### Playwright Result");
    expect(evidence).toContain("### Workflow Table");
    expect(evidence).toContain("| ID | Workflow | Status | Notes | Artifacts |");
    expect(evidence).toContain("| B | Parameters \\| governance | passed | review<br>approved | test-results/acceptance/parameters.md |");
    expect(evidence).toContain("### Requirement Coverage");
    expect(evidence).toContain("### Operation Evidence");
    expect(evidence).toContain("### Artifact Paths");
    expect(evidence).toContain("### Blockers");
  });

  it("renders operation evidence validation errors", () => {
    const evidence = buildBrowserAcceptanceEvidence({
      date: "2026-06-01T00:00:00.000Z",
      metadata: { branch: "codex/browser", commit: "abc123", dirty: false },
      mode: "local-non-hdc",
      status: "failed",
      preflight: { status: "passed", outcome: "non_hdc_local", hdc: "skipped" },
      playwright: { status: "passed" },
      workflows: [],
      operationEvidence: {
        status: "failed",
        coveredOperationIds: ["PARAM-HAPPY-001"],
        missingOperationIds: [],
        invalidEvidenceIds: ["PARAM-HAPPY-001"],
        validationErrors: [
          {
            operationId: "PARAM-HAPPY-001",
            field: "api",
            message: "API assertions require at least one API request/response summary."
          }
        ],
        records: [{ operationId: "PARAM-HAPPY-001", status: "passed" }]
      },
      artifactPaths: [],
      blockers: []
    });

    expect(evidence).toContain("- Validation errors: `1`");
    expect(evidence).toContain("PARAM-HAPPY-001 api: API assertions require at least one API request/response summary.");
  });

  it("trims trailing whitespace from multiline command details", () => {
    const evidence = buildBrowserAcceptanceEvidence({
      date: "2026-06-01T00:00:00.000Z",
      metadata: { branch: "codex/browser", commit: "abc123", dirty: true },
      mode: "local-non-hdc",
      status: "failed",
      preflight: {
        status: "failed",
        outcome: "non_hdc_local",
        hdc: "skipped",
        detail: "first line   \nsecond line\t\nthird line"
      },
      playwright: {
        status: "passed",
        detail: "playwright ok  "
      },
      workflows: [],
      artifactPaths: [],
      blockers: ["preflight failed  "]
    });

    expect(evidence).not.toMatch(/[ \t]+$/m);
    expect(evidence).toContain("- Detail: first line\nsecond line\nthird line");
    expect(evidence).toContain("- Detail: playwright ok");
    expect(evidence).toContain("- preflight failed");
  });
});

async function importAcceptanceConfig(noStartRuntime: string | undefined, frontendUrl?: string, apiUrl?: string) {
  const previous = process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME;
  const previousFrontendUrl = process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL;
  const previousApiUrl = process.env.VITE_WISEEFF_API_BASE_URL;
  if (noStartRuntime === undefined) {
    delete process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME;
  } else {
    process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME = noStartRuntime;
  }
  if (frontendUrl === undefined) {
    delete process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL;
  } else {
    process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL = frontendUrl;
  }
  if (apiUrl === undefined) {
    delete process.env.VITE_WISEEFF_API_BASE_URL;
  } else {
    process.env.VITE_WISEEFF_API_BASE_URL = apiUrl;
  }

  try {
    vi.resetModules();
    const module = await import("../playwright.acceptance.config");
    return module.default as { webServer?: unknown; use?: unknown; projects?: unknown };
  } finally {
    if (previous === undefined) {
      delete process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME;
    } else {
      process.env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME = previous;
    }
    if (previousFrontendUrl === undefined) {
      delete process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL;
    } else {
      process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL = previousFrontendUrl;
    }
    if (previousApiUrl === undefined) {
      delete process.env.VITE_WISEEFF_API_BASE_URL;
    } else {
      process.env.VITE_WISEEFF_API_BASE_URL = previousApiUrl;
    }
  }
}

async function importQualityConfig(frontendUrl?: string) {
  const previousFrontendUrl = process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL;
  if (frontendUrl === undefined) {
    delete process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL;
  } else {
    process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL = frontendUrl;
  }

  try {
    vi.resetModules();
    const module = await import("../playwright.quality.config");
    return module.default as { use?: unknown; projects?: unknown };
  } finally {
    if (previousFrontendUrl === undefined) {
      delete process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL;
    } else {
      process.env.WISEEFF_ACCEPTANCE_FRONTEND_URL = previousFrontendUrl;
    }
  }
}

describe("acceptance runtime helpers", () => {
  it("resolves API URLs and smoke headers from the browser acceptance env contract", () => {
    expect(
      apiBaseUrl({
        VITE_WISEEFF_API_BASE_URL: "http://vite.example",
        WISEEFF_API_BASE_URL: "http://wiseeff.example"
      })
    ).toBe("http://vite.example");
    expect(apiBaseUrl({ WISEEFF_API_BASE_URL: "http://wiseeff.example" })).toBe("http://wiseeff.example");
    expect(apiBaseUrl({})).toBe("http://127.0.0.1:8787");
    expect(apiRoute("/api/v1/me", { VITE_WISEEFF_API_BASE_URL: "http://api.example/" })).toBe(
      "http://api.example/api/v1/me"
    );
    expect(smokeHeaders({ M5_SMOKE_AUTHORIZATION: "Bearer m5" })).toMatchObject({
      Authorization: "Bearer m5"
    });
    expect(smokeHeaders({ WISEEFF_SMOKE_AUTHORIZATION: "Bearer smoke" })).toMatchObject({
      Authorization: "Bearer smoke"
    });
  });
});

describe("acceptance database helpers", () => {
  it("requires DATABASE_URL before creating a pg client", async () => {
    await expect(withPgClient(() => Promise.resolve("unused"), {})).rejects.toThrow(
      "DATABASE_URL is required for acceptance database helpers."
    );
  });
});
