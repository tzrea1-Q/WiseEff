import { describe, expect, it } from "vitest";
import { acceptanceRequirements } from "../e2e/acceptance/requirements";
import { evaluateAcceptanceCoverage, parseAcceptanceIdsFromSpec } from "./check-acceptance-coverage";

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
      "AGENT-UNAUTH-001",
      "PERM-USER-MGMT-001"
    ];

    expect(
      acceptanceRequirements
        .filter((requirement) => m58RequiredIds.includes(requirement.id))
        .map((requirement) => ({ id: requirement.id, required: requirement.required }))
    ).toEqual(m58RequiredIds.map((id) => ({ id, required: true })));
  });
});
