import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptanceRequirements } from "../e2e/acceptance/requirements";
import {
  evaluateAcceptanceCoverage,
  parseAcceptanceIdsFromSpec,
  parseCoverageMapIds,
  parsePlannedAcceptanceIdsFromSpec,
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
});
