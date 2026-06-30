import { describe, expect, it, vi } from "vitest";
import { withPgClient } from "../e2e/acceptance/helpers/database";
import { buildBrowserAcceptanceEvidence } from "../e2e/acceptance/helpers/evidence";
import { apiBaseUrl, apiRoute, smokeHeaders } from "../e2e/acceptance/helpers/runtime";
import {
  buildBrowserAcceptanceCommand,
  deriveBrowserAcceptanceWorkflowsFromPlaywrightReport,
  buildDefaultBrowserAcceptanceWorkflows,
  buildPreflightCommand,
  commandUsesShell,
  evaluateBrowserAcceptanceRun,
  loadEnvContent,
  npmCommand,
  parseBrowserAcceptanceArgs,
  resolvePlaywrightHdcStatus
} from "./run-browser-acceptance";

describe("browser acceptance runner", () => {
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
      args: [
        "run",
        "acceptance:preflight",
        "--",
        "--env-file",
        ".env",
        "--frontend-url",
        "http://127.0.0.1:5173",
        "--evidence-out",
        "test-results/acceptance/preflight-evidence.md"
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
      "test-results/acceptance/preflight-evidence.md",
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
      "test-results/acceptance/preflight-evidence.md",
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
    expect(buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs([], {}))).toEqual({
      command: npmCommand(),
      args: ["run", "acceptance:e2e", "--"],
      env: expect.any(Object)
    });

    expect(buildBrowserAcceptanceCommand(parseBrowserAcceptanceArgs(["--headed"], {}))).toEqual({
      command: npmCommand(),
      args: ["run", "acceptance:e2e", "--", "--headed"],
      env: expect.any(Object)
    });
  });

  it("maps Playwright results to the manual acceptance A-H workflow rows", () => {
    const workflows = buildDefaultBrowserAcceptanceWorkflows({
      playwrightStatus: "passed",
      hdcStatus: "skipped",
      artifactPath: "playwright-report/acceptance/index.html"
    });

    expect(workflows.map((workflow) => workflow.id)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
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
    expect(workflows.find((workflow) => workflow.id === "H")).toMatchObject({ status: "skipped" });
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
});

describe("playwright quality config", () => {
  it("uses the configured target frontend URL", async () => {
    const config = await importQualityConfig("https://frontend.example.test");

    expect(config.use).toMatchObject({ baseURL: "https://frontend.example.test" });
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
        artifactPath: "test-results/acceptance/preflight-evidence.md"
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
    return module.default as { webServer?: unknown; use?: unknown };
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
    return module.default as { use?: unknown };
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
