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
