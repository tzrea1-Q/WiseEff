import { describe, expect, it } from "vitest";
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
});
