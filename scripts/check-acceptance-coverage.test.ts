import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptanceRequirements } from "../e2e/acceptance/requirements";
import {
  bindAcceptanceIdsFromSpec,
  evaluateAcceptanceCoverage,
  parseAcceptanceCoverageArgs,
  parseAcceptanceIdsFromSpec,
  parseCoverageMapIds,
  parsePlannedAcceptanceIdsFromSpec,
  parsePlaywrightAcceptanceOutcomes,
  readAcceptanceSpecFiles
} from "./check-acceptance-coverage";

describe("acceptance coverage checker", () => {
  it("fails when a required acceptance id has no spec marker", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "PARAM-REASON-001", workflow: "B", title: "Reason is required.", required: true },
        { id: "PARAM-ASSIGNEE-001", workflow: "B", title: "Eligible assignees only.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/parameters-negative.acceptance.spec.ts",
          content: "test('requires reason', () => {}) // @acceptance PARAM-REASON-001"
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.missingRequiredIds).toEqual(["PARAM-ASSIGNEE-001"]);
  });

  it("passes when every required acceptance id has a marker", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "AUTH-RUNTIME-001", workflow: "A", title: "API-mode auth parity.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
          content: "test('loads current user', () => {}) // @acceptance AUTH-RUNTIME-001"
        }
      ]
    });

    expect(result.status).toBe("passed");
    expect(result.coveredIds).toEqual(["AUTH-RUNTIME-001"]);
  });

  it("fails when a spec contains an unknown acceptance id", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [{ id: "AUTH-RUNTIME-001", workflow: "A", title: "API-mode auth parity.", required: true }],
      specFiles: [
        {
          file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
          content: "// @acceptance AUTH-RUNTIME-001\n// @acceptance UNKNOWN-001"
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.unknownIds).toEqual(["UNKNOWN-001"]);
  });

  it("parses multiple acceptance markers from comments", () => {
    expect(parseAcceptanceIdsFromSpec("// @acceptance PARAM-REASON-001\n// @acceptance PERM-MATRIX-001")).toEqual([
      "PARAM-REASON-001",
      "PERM-MATRIX-001"
    ]);
  });

  it("does not treat operation markers as acceptance coverage", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "PARAM-DRAFT-EDIT-001", workflow: "B", title: "Draft edit operation.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/parameters-negative.acceptance.spec.ts",
          content: "// @operation PARAM-DRAFT-EDIT-001"
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.coveredIds).toEqual([]);
    expect(result.missingRequiredIds).toEqual(["PARAM-DRAFT-EDIT-001"]);
  });

  it("treats M5.8 deterministic browser gaps as required coverage", () => {
    const m58RequiredIds = [
      "PARAM-DRAFT-EDIT-001",
      "PARAM-REJECT-001",
      "LOG-REANALYZE-001",
      "DEBUG-PERM-001",
      "XIAOZE-ACTION-AUTHZ-001",
      "PERM-USER-MGMT-001"
    ];

    expect(
      acceptanceRequirements
        .filter((requirement) => m58RequiredIds.includes(requirement.id))
        .map((requirement) => ({ id: requirement.id, required: requirement.required }))
    ).toEqual(m58RequiredIds.map((id) => ({ id, required: true })));
  });

  it("registers the canonical parameter catalog requirements as non-blocking metadata until S9", () => {
    const expectedIds = [
      "PCAT-UI-01",
      "PCAT-UI-02",
      "PCAT-UI-03",
      "PCAT-UI-04",
      "PCAT-UI-05",
      "PCAT-UI-06",
      "PCAT-UI-07",
      "PCAT-UI-08",
      "PCAT-UI-09",
      "PCAT-UI-10",
      "PCAT-UI-11",
      "PCAT-UI-12",
      "PCAT-UI-13",
      "PCAT-UI-14",
      "PCAT-UI-15"
    ];

    expect(
      acceptanceRequirements
        .filter((requirement) => requirement.id.startsWith("PCAT-UI-"))
        .map((requirement) => ({ id: requirement.id, workflow: requirement.workflow, required: requirement.required }))
    ).toEqual(expectedIds.map((id) => ({ id, workflow: "C", required: false })));
  });

  it("planned markers never satisfy a required requirement", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "MOD-ATTR-QUEUE-001", workflow: "C", title: "Queue dismiss/restore.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/parameter-topology.acceptance.spec.ts",
          content: "test('stub', () => { test.skip(true, 'pending'); }) // @acceptance-planned MOD-ATTR-QUEUE-001"
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.coveredIds).toEqual([]);
    expect(result.plannedIds).toEqual(["MOD-ATTR-QUEUE-001"]);
    expect(result.missingRequiredIds).toEqual(["MOD-ATTR-QUEUE-001"]);
  });

  it("passes when a non-required requirement carries only a planned marker", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "MOD-ATTR-QUEUE-001", workflow: "C", title: "Queue dismiss/restore.", required: false }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/parameter-topology.acceptance.spec.ts",
          content: "// @acceptance-planned MOD-ATTR-QUEUE-001"
        }
      ]
    });

    expect(result.status).toBe("passed");
    expect(result.plannedIds).toEqual(["MOD-ATTR-QUEUE-001"]);
  });

  it("fails on unknown planned ids", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [{ id: "AUTH-RUNTIME-001", workflow: "A", title: "Auth parity.", required: false }],
      specFiles: [
        {
          file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
          content: "// @acceptance-planned RETIRED-001"
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.unknownIds).toEqual(["RETIRED-001"]);
  });

  it("does not count a planned marker as an automated marker", () => {
    expect(parseAcceptanceIdsFromSpec("// @acceptance-planned MOD-ATTR-QUEUE-001")).toEqual([]);
    expect(parsePlannedAcceptanceIdsFromSpec("// @acceptance-planned MOD-ATTR-QUEUE-001")).toEqual([
      "MOD-ATTR-QUEUE-001"
    ]);
  });

  it("fails when the coverage map misses a requirement or keeps a retired row", () => {
    const requirements = [
      { id: "AUTH-RUNTIME-001", workflow: "A" as const, title: "Auth parity.", required: false },
      { id: "PARAM-REASON-001", workflow: "B" as const, title: "Reason required.", required: false }
    ];
    const specFiles = [
      {
        file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
        content: "// @acceptance AUTH-RUNTIME-001\n// @acceptance PARAM-REASON-001"
      }
    ];

    const drifted = evaluateAcceptanceCoverage({
      requirements,
      specFiles,
      coverageMapIds: ["AUTH-RUNTIME-001", "RETIRED-001"]
    });
    expect(drifted.status).toBe("failed");
    expect(drifted.coverageMapMissingIds).toEqual(["PARAM-REASON-001"]);
    expect(drifted.coverageMapOrphanIds).toEqual(["RETIRED-001"]);

    const reconciled = evaluateAcceptanceCoverage({
      requirements,
      specFiles,
      coverageMapIds: ["AUTH-RUNTIME-001", "PARAM-REASON-001"]
    });
    expect(reconciled.status).toBe("passed");
  });

  it("parses coverage map row ids from the markdown table", () => {
    const ids = parseCoverageMapIds(
      [
        "| ID | Workflow | Blocking | Expected User Behavior | Spec Owner |",
        "| --- | --- | --- | --- | --- |",
        "| `AUTH-RUNTIME-001` | A | Yes | Loads user. | `spec.ts` |",
        "| `PARAM-REASON-001` | B | No (pending automation) | Reason. | `spec.ts` |"
      ].join("\n")
    );

    expect(ids).toEqual(["AUTH-RUNTIME-001", "PARAM-REASON-001"]);
  });

  it("collects acceptance specs recursively from subdirectories", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-acceptance-specs-"));
    try {
      writeFileSync(join(root, "top.acceptance.spec.ts"), "// @acceptance TOP-001", "utf8");
      mkdirSync(join(root, "nested"), { recursive: true });
      writeFileSync(join(root, "nested", "deep.acceptance.spec.ts"), "// @acceptance DEEP-001", "utf8");
      writeFileSync(join(root, "helper.ts"), "// @acceptance IGNORED-001", "utf8");

      const files = readAcceptanceSpecFiles(root);

      expect(files.map((file) => file.content).sort()).toEqual([
        "// @acceptance DEEP-001",
        "// @acceptance TOP-001"
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("binds file-level and in-test acceptance comments to test titles", () => {
    const content = [
      "// @acceptance SHELL-DIAG-001",
      "test.describe('shell', () => {",
      "  test('loads API-mode browser current user with the local dev auth contract', {",
      "    tag: ['@ci-smoke']",
      "  }, async () => {",
      "    // @acceptance AUTH-RUNTIME-001",
      "  });",
      "  test('DTS-RELOAD-DEPLOY-001 mounts the overlay', async () => {});",
      "});"
    ].join("\n");

    expect(bindAcceptanceIdsFromSpec(content)).toEqual([
      { id: "SHELL-DIAG-001", testTitle: null },
      { id: "AUTH-RUNTIME-001", testTitle: "loads API-mode browser current user with the local dev auth contract" }
    ]);
  });

  it("parses skipped and passed outcomes from a Playwright JSON report", () => {
    const outcomes = parsePlaywrightAcceptanceOutcomes({
      suites: [
        {
          title: "auth-runtime.acceptance.spec.ts",
          file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
          suites: [
            {
              title: "M5.5 auth runtime parity",
              file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
              specs: [
                {
                  title: "loads API-mode browser current user with the local dev auth contract",
                  tests: [{ results: [{ status: "skipped" }], status: "skipped" }]
                }
              ]
            }
          ]
        },
        {
          file: "e2e/acceptance/shell-navigation.acceptance.spec.ts",
          specs: [{ title: "core routes stay usable", tests: [{ results: [{ status: "passed" }] }] }]
        }
      ]
    });

    expect(outcomes).toEqual([
      {
        file: "auth-runtime.acceptance.spec.ts",
        title: "loads API-mode browser current user with the local dev auth contract",
        status: "skipped"
      },
      {
        file: "shell-navigation.acceptance.spec.ts",
        title: "core routes stay usable",
        status: "passed"
      }
    ]);
  });

  it("fails when a required acceptance id is dynamically skipped in results.json", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "AUTH-RUNTIME-001", workflow: "A", title: "API-mode auth parity.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
          content: [
            "test('loads API-mode browser current user with the local dev auth contract', async () => {",
            "  // @acceptance AUTH-RUNTIME-001",
            "  test.skip(!process.env.DATABASE_URL, 'DATABASE_URL is required');",
            "});"
          ].join("\n")
        }
      ],
      playwrightResults: {
        suites: [
          {
            file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
            specs: [
              {
                title: "loads API-mode browser current user with the local dev auth contract",
                tests: [{ results: [{ status: "skipped" }], status: "skipped" }]
              }
            ]
          }
        ]
      }
    });

    expect(result.status).toBe("failed");
    expect(result.coveredIds).toEqual(["AUTH-RUNTIME-001"]);
    expect(result.skippedRequiredIds).toEqual(["AUTH-RUNTIME-001"]);
    expect(result.missingRequiredIds).toEqual([]);
  });

  it("keeps a required id covered when its bound results.json test passed", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "AUTH-RUNTIME-001", workflow: "A", title: "API-mode auth parity.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
          content:
            "test('loads API-mode browser current user with the local dev auth contract', async () => {\n  // @acceptance AUTH-RUNTIME-001\n});"
        }
      ],
      playwrightResults: {
        suites: [
          {
            file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
            specs: [
              {
                title: "loads API-mode browser current user with the local dev auth contract",
                tests: [{ results: [{ status: "passed" }] }]
              }
            ]
          }
        ]
      }
    });

    expect(result.status).toBe("passed");
    expect(result.skippedRequiredIds).toEqual([]);
  });

  it("does not treat a skipped planned stub as a skipped required id", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "PARAM-FILE-ROLLBACK-001", workflow: "C", title: "Rollback pointer restore.", required: false }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/parameter-files.acceptance.spec.ts",
          content:
            "test('PARAM-FILE-ROLLBACK-001: restore historical version as current pointer', async () => {\n  // @acceptance-planned PARAM-FILE-ROLLBACK-001\n  test.skip(true, 'pending');\n});"
        }
      ],
      playwrightResults: {
        suites: [
          {
            file: "e2e/acceptance/parameter-files.acceptance.spec.ts",
            specs: [
              {
                title: "PARAM-FILE-ROLLBACK-001: restore historical version as current pointer",
                tests: [{ results: [{ status: "skipped" }], status: "skipped" }]
              }
            ]
          }
        ]
      }
    });

    expect(result.status).toBe("passed");
    expect(result.skippedRequiredIds).toEqual([]);
    expect(result.plannedIds).toEqual(["PARAM-FILE-ROLLBACK-001"]);
  });

  it("fails a file-scoped required id only when every test in that file was skipped", () => {
    const requirements = [
      { id: "SHELL-DIAG-001", workflow: "A" as const, title: "Diagnostics.", required: true }
    ];
    const specFiles = [
      {
        file: "e2e/acceptance/shell-navigation.acceptance.spec.ts",
        content: "// @acceptance SHELL-DIAG-001\ntest('home', async () => {});\ntest('logs', async () => {});"
      }
    ];

    const allSkipped = evaluateAcceptanceCoverage({
      requirements,
      specFiles,
      playwrightResults: {
        suites: [
          {
            file: "e2e/acceptance/shell-navigation.acceptance.spec.ts",
            specs: [
              { title: "home", tests: [{ results: [{ status: "skipped" }] }] },
              { title: "logs", tests: [{ results: [{ status: "skipped" }] }] }
            ]
          }
        ]
      }
    });
    expect(allSkipped.status).toBe("failed");
    expect(allSkipped.skippedRequiredIds).toEqual(["SHELL-DIAG-001"]);

    const mixed = evaluateAcceptanceCoverage({
      requirements,
      specFiles,
      playwrightResults: {
        suites: [
          {
            file: "e2e/acceptance/shell-navigation.acceptance.spec.ts",
            specs: [
              { title: "home", tests: [{ results: [{ status: "passed" }] }] },
              { title: "logs", tests: [{ results: [{ status: "skipped" }] }] }
            ]
          }
        ]
      }
    });
    expect(mixed.status).toBe("passed");
    expect(mixed.skippedRequiredIds).toEqual([]);
  });

  it("ignores results.json tests that were not in this report when judging skips", () => {
    const result = evaluateAcceptanceCoverage({
      requirements: [
        { id: "AUTH-RUNTIME-001", workflow: "A", title: "API-mode auth parity.", required: true },
        { id: "PARAM-REASON-001", workflow: "B", title: "Reason is required.", required: true }
      ],
      specFiles: [
        {
          file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
          content: "test('loads current user', async () => {}) // @acceptance AUTH-RUNTIME-001"
        },
        {
          file: "e2e/acceptance/parameters-negative.acceptance.spec.ts",
          content: "test('requires reason', async () => {}) // @acceptance PARAM-REASON-001"
        }
      ],
      playwrightResults: {
        suites: [
          {
            file: "e2e/acceptance/auth-runtime.acceptance.spec.ts",
            specs: [{ title: "loads current user", tests: [{ results: [{ status: "passed" }] }] }]
          }
        ]
      }
    });

    expect(result.status).toBe("passed");
    expect(result.skippedRequiredIds).toEqual([]);
  });

  it("parses --results for the coverage CLI", () => {
    expect(parseAcceptanceCoverageArgs(["--results", "scripts/fixtures/acceptance-coverage/required-skipped.results.json"])).toEqual({
      resultsPath: "scripts/fixtures/acceptance-coverage/required-skipped.results.json"
    });
    expect(parseAcceptanceCoverageArgs([])).toEqual({});
  });
});
