import { describe, expect, it } from "vitest";
import {
  evaluateOperationMatrix,
  renderOperationMatrixMarkdown,
  type AcceptanceOperation
} from "./check-acceptance-operation-matrix";
import { acceptanceOperations } from "../e2e/acceptance/operationMatrix";

const baseOperation: AcceptanceOperation = {
  id: "PARAM-DRAFT-EDIT-001",
  priority: "P0",
  area: "parameters",
  route: "/parameters",
  roles: ["Hardware User"],
  action: "Edit and remove a draft item before submission.",
  coverage: "automated",
  acceptanceIds: ["PARAM-DRAFT-EDIT-001"],
  specFiles: ["e2e/acceptance/parameters-negative.acceptance.spec.ts"],
  assertions: ["ui", "api", "db", "audit"]
};

describe("acceptance operation matrix", () => {
  it("fails when an automated P0 operation has no operation marker", () => {
    const result = evaluateOperationMatrix({
      operations: [baseOperation],
      specFiles: [
        {
          file: "e2e/acceptance/parameters-negative.acceptance.spec.ts",
          content: "// @acceptance PARAM-DRAFT-EDIT-001"
        }
      ],
      knownAcceptanceIds: ["PARAM-DRAFT-EDIT-001"]
    });

    expect(result.status).toBe("failed");
    expect(result.missingAutomatedOperationIds).toEqual(["PARAM-DRAFT-EDIT-001"]);
  });

  it("passes when every required automated operation has markers and assertions", () => {
    const result = evaluateOperationMatrix({
      operations: [baseOperation],
      specFiles: [
        {
          file: "e2e/acceptance/parameters-negative.acceptance.spec.ts",
          content: "// @acceptance PARAM-DRAFT-EDIT-001\n// @operation PARAM-DRAFT-EDIT-001"
        }
      ],
      knownAcceptanceIds: ["PARAM-DRAFT-EDIT-001"]
    });

    expect(result).toMatchObject({
      status: "passed",
      missingAutomatedOperationIds: [],
      deferredOperationIdsMissingReason: [],
      operationsMissingAssertions: [],
      unknownOperationIds: [],
      unknownAcceptanceIds: []
    });
  });

  it("requires a deferral reason for manual or future P0/P1 operations", () => {
    const result = evaluateOperationMatrix({
      operations: [{ ...baseOperation, coverage: "manual", deferralReason: "" }],
      specFiles: [],
      knownAcceptanceIds: ["PARAM-DRAFT-EDIT-001"]
    });

    expect(result.status).toBe("failed");
    expect(result.deferredOperationIdsMissingReason).toEqual(["PARAM-DRAFT-EDIT-001"]);
  });

  it("fails when an operation references an unknown acceptance id", () => {
    const result = evaluateOperationMatrix({
      operations: [{ ...baseOperation, acceptanceIds: ["UNKNOWN-REQ-001"] }],
      specFiles: [
        {
          file: "e2e/acceptance/parameters-negative.acceptance.spec.ts",
          content: "// @operation PARAM-DRAFT-EDIT-001"
        }
      ],
      knownAcceptanceIds: ["PARAM-DRAFT-EDIT-001"]
    });

    expect(result.status).toBe("failed");
    expect(result.unknownAcceptanceIds).toEqual(["UNKNOWN-REQ-001"]);
  });

  it("renders a developer-readable operation matrix", () => {
    const markdown = renderOperationMatrixMarkdown([baseOperation]);

    expect(markdown).toContain("# User Operation Coverage Matrix");
    expect(markdown).toContain("`PARAM-DRAFT-EDIT-001`");
    expect(markdown).toContain("| Operation ID | Priority | Area | Coverage | Route | Roles | Assertions | Specs |");
  });

  it("marks the M5.8 deterministic browser gaps as automated operations", () => {
    const m58OperationIds = [
      "PARAM-DRAFT-EDIT-001",
      "PARAM-REJECT-001",
      "LOG-REANALYZE-001",
      "DEBUG-PERM-001",
      "AGENT-UNAUTH-001",
      "PERM-USER-MGMT-001"
    ];

    expect(
      acceptanceOperations
        .filter((operation) => m58OperationIds.includes(operation.id))
        .map((operation) => ({
          id: operation.id,
          coverage: operation.coverage,
          hasDeferralReason: Boolean(operation.deferralReason)
        }))
    ).toEqual(m58OperationIds.map((id) => ({ id, coverage: "automated", hasDeferralReason: false })));
  });

  it("does not overstate forensic assertions for local prototype-only permission UI operations", () => {
    expect(
      acceptanceOperations
        .filter((operation) => ["PERM-GOV-001", "PERM-USER-MGMT-001"].includes(operation.id))
        .map((operation) => ({ id: operation.id, assertions: operation.assertions }))
    ).toEqual([
      { id: "PERM-GOV-001", assertions: ["ui"] },
      { id: "PERM-USER-MGMT-001", assertions: ["ui"] }
    ]);
  });
});
