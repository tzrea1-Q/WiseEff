import { describe, expect, it } from "vitest";

import { buildAcceptanceFailureInventory } from "./acceptance-failure-inventory";

describe("acceptance Gate 0 failure inventory", () => {
  it("preserves exact phase, project, file, title, error class, route, and attachments", () => {
    const inventory = buildAcceptanceFailureInventory({
      runId: "full-owned-1",
      sourceCommit: "0123456789012345678901234567890123456789",
      reports: [
        {
          phase: "visual",
          reportPath: "test-results/quality/results.json",
          report: {
            suites: [
              {
                file: "e2e/quality/visual.quality.spec.ts",
                specs: [
                  {
                    title: "parameter home baseline",
                    tests: [
                      {
                        projectName: "visual",
                        results: [
                          {
                            status: "failed",
                            error: { name: "ScreenshotComparisonError", message: "snapshot differs at /parameter-home" },
                            attachments: [{ name: "actual", path: "test-results/quality/actual.png" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(inventory.failures).toEqual([
      {
        phase: "visual",
        project: "visual",
        file: "e2e/quality/visual.quality.spec.ts",
        title: "parameter home baseline",
        route: "/parameter-home",
        errorClass: "ScreenshotComparisonError",
        message: "snapshot differs at /parameter-home",
        attachments: ["test-results/quality/actual.png"],
      },
    ]);
    expect(inventory.failureCount).toBe(1);
  });

  it("uses the visual spec route instead of a Playwright screenshot filesystem path", () => {
    const inventory = buildAcceptanceFailureInventory({
      runId: "full-owned-visual-screenshot",
      sourceCommit: "0123456789012345678901234567890123456789",
      reports: [
        {
          phase: "visual",
          reportPath: "test-results/quality/results.json",
          report: {
            suites: [
              {
                file: "e2e/quality/visual.quality.spec.ts",
                specs: [
                  {
                    title: "keeps stable visual baseline for /organization",
                    tests: [
                      {
                        projectName: "visual",
                        results: [
                          {
                            status: "failed",
                            error: {
                              message:
                                "Error: A snapshot doesn't exist at /Users/example/Develop/WiseEff/e2e/quality/visual.quality.spec.ts-snapshots/darwin/organization.png, writing actual.",
                              snippet:
                                'await expect(page.locator("main, .main-content").first()).toHaveScreenshot(`${route.name}.png`);',
                            },
                            attachments: [
                              {
                                name: "organization-actual.png",
                                path: "/Users/example/Develop/WiseEff/test-results/quality/organization-actual.png",
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(inventory.failures).toEqual([
      expect.objectContaining({
        project: "visual",
        route: "/organization",
        errorClass: "ScreenshotComparisonError",
      }),
    ]);
  });

  it("classifies a status assertion and reads its API route from Playwright source metadata", () => {
    const inventory = buildAcceptanceFailureInventory({
      runId: "full-owned-status-assertion",
      sourceCommit: "0123456789012345678901234567890123456789",
      reports: [
        {
          phase: "browser",
          reportPath: "test-results/acceptance/results.json",
          report: {
            suites: [
              {
                file: "e2e/acceptance/permissions.acceptance.spec.ts",
                specs: [
                  {
                    title: "lets Admin rename the home organization while denying non-Admin writes",
                    tests: [
                      {
                        projectName: "Desktop Chrome",
                        results: [
                          {
                            status: "failed",
                            error: {
                              message:
                                "Error: \u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoBe\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m // Object.is equality\n\n\u001b[32mExpected: 201\u001b[39m\n\u001b[31mReceived: 409\u001b[39m",
                              snippet:
                                'const response = await expectSuccessfulApiGet(page, "/api/v1/organization");\nexpect(response.status).toBe(201);',
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(inventory.failures).toEqual([
      expect.objectContaining({
        project: "Desktop Chrome",
        route: "/api/v1/organization",
        errorClass: "AssertionError",
      }),
    ]);
  });

  it("preserves a current versioned API route from an explicit annotation", () => {
    const inventory = buildAcceptanceFailureInventory({
      runId: "full-owned-api-v2",
      sourceCommit: "0123456789012345678901234567890123456789",
      reports: [
        {
          phase: "browser",
          reportPath: "test-results/acceptance/results.json",
          report: {
            suites: [{
              file: "e2e/acceptance/current-api.acceptance.spec.ts",
              specs: [{
                title: "uses current API",
                annotations: [{ type: "route", description: "/api/v2/organizations/current" }],
                tests: [{
                  projectName: "Desktop Chrome",
                  results: [{ status: "failed", error: { message: "Expected: 200\nReceived: 500" } }],
                }],
              }],
            }],
          },
        },
      ],
    });

    expect(inventory.failures[0]).toMatchObject({ route: "/api/v2/organizations/current" });
  });

  it("prefers an explicit Playwright route annotation over an API path in the failing assertion", () => {
    const inventory = buildAcceptanceFailureInventory({
      runId: "full-owned-annotated-route",
      sourceCommit: "0123456789012345678901234567890123456789",
      reports: [
        {
          phase: "browser",
          reportPath: "test-results/acceptance/results.json",
          report: {
            suites: [
              {
                file: "e2e/acceptance/project-configuration-workbench.acceptance.spec.ts",
                specs: [
                  {
                    title: "creates, compares, releases, and restores baselines in source context",
                    tests: [
                      {
                        projectName: "Desktop Chrome",
                        annotations: [
                          {
                            type: "route",
                            description: "/parameter-admin/projects/aurora/configuration",
                          },
                        ],
                        results: [
                          {
                            status: "failed",
                            error: {
                              message:
                                "Error: expect(received).toBe(expected)\n\nExpected: 201\nReceived: 409",
                              snippet:
                                'const response = await request.post("/api/v1/projects/aurora/config-sets");',
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(inventory.failures[0]).toMatchObject({
      route: "/parameter-admin/projects/aurora/configuration",
      errorClass: "AssertionError",
    });
  });

  it("resolves retained pre-annotation reports from exact spec and test metadata", () => {
    const inventory = buildAcceptanceFailureInventory({
      runId: "full-owned-retained-visual",
      sourceCommit: "0123456789012345678901234567890123456789",
      reports: [
        {
          phase: "visual",
          reportPath: "test-results/quality/results.json",
          report: {
            suites: [
              {
                file: "e2e/quality/visual.quality.spec.ts",
                specs: [
                  {
                    title: "captures the data-table row hover state",
                    tests: [
                      {
                        projectName: "visual",
                        results: [
                          {
                            status: "failed",
                            error: {
                              message: "Error: expect(locator).toHaveScreenshot(expected) failed",
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(inventory.failures[0]).toMatchObject({
      route: "/organization/members",
      errorClass: "ScreenshotComparisonError",
    });
  });

  it("records a missing or unreadable phase report as a forensic failure", () => {
    const inventory = buildAcceptanceFailureInventory({
      runId: "full-owned-2",
      sourceCommit: "0123456789012345678901234567890123456789",
      reports: [{ phase: "browser", reportPath: "missing.json", error: "ENOENT" }],
    });

    expect(inventory.failures).toContainEqual(
      expect.objectContaining({
        phase: "browser",
        errorClass: "ReportUnavailable",
        message: "ENOENT",
      }),
    );
  });

  it("records only the final failed retry and omits flaky retries that ultimately pass", () => {
    const inventory = buildAcceptanceFailureInventory({
      runId: "full-owned-retries",
      sourceCommit: "0123456789012345678901234567890123456789",
      reports: [
        {
          phase: "browser",
          reportPath: "test-results/acceptance/results.json",
          report: {
            suites: [
              {
                file: "e2e/acceptance/retry.spec.ts",
                specs: [
                  {
                    title: "passes on retry for /logs",
                    tests: [
                      {
                        projectName: "Desktop Chrome",
                        results: [
                          { status: "failed", error: { message: "first attempt at /logs" } },
                          { status: "passed" },
                        ],
                      },
                    ],
                  },
                  {
                    title: "still fails for /parameter-home",
                    tests: [
                      {
                        projectName: "Desktop Chrome",
                        results: [
                          { status: "failed", error: { message: "first failure" } },
                          {
                            status: "timedOut",
                            error: { message: "waiting for page" },
                            attachments: [{ path: "test-results/final-trace.zip" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(inventory.failureCount).toBe(1);
    expect(inventory.failures[0]).toMatchObject({
      title: "still fails for /parameter-home",
      route: "/parameter-home",
      message: "waiting for page",
      attachments: ["test-results/final-trace.zip"],
    });
  });
});
