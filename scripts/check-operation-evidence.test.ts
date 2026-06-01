import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateOperationEvidence,
  readOperationEvidenceRecords,
  renderOperationEvidenceMarkdown,
  writeOperationEvidenceIndex,
  type OperationEvidenceRecord
} from "./check-operation-evidence";
import { operationEvidenceFileName, recordOperationEvidence } from "../e2e/acceptance/helpers/operationEvidence";

describe("operation evidence helper", () => {
  it("builds stable evidence file names from operation id and title", () => {
    expect(operationEvidenceFileName("PARAM-DRAFT-EDIT-001", "edits draft before submit")).toBe(
      "PARAM-DRAFT-EDIT-001-edits-draft-before-submit.json"
    );
  });

  it("redacts token and key values from evidence notes", async () => {
    const fileName = operationEvidenceFileName("PARAM-DRAFT-EDIT-002", "redacts sensitive notes");
    const filePath = join("test-results/acceptance/operation-evidence", fileName);

    try {
      const result = await recordOperationEvidence({
        operationId: "PARAM-DRAFT-EDIT-002",
        title: "redacts sensitive notes",
        status: "passed",
        notes: "token=abc123 key secret456"
      });

      const content = readFileSync(result.path, "utf8");
      expect(content).toContain("token=[redacted]");
      expect(content).toContain("key [redacted]");
      expect(content).not.toContain("abc123");
      expect(content).not.toContain("secret456");
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  it("records role, route, and assertions from the operation matrix", async () => {
    const fileName = operationEvidenceFileName("PARAM-HAPPY-001", "records operation metadata");
    const filePath = join("test-results/acceptance/operation-evidence", fileName);

    try {
      const result = await recordOperationEvidence({
        operationId: "PARAM-HAPPY-001",
        title: "records operation metadata",
        status: "passed"
      });

      expect(result.record).toMatchObject({
        operationId: "PARAM-HAPPY-001",
        role: "Hardware User, Hardware Committer, Software Committer, Software User, Admin",
        route: "/parameters",
        assertions: ["ui", "api", "db", "audit"]
      });
    } finally {
      rmSync(filePath, { force: true });
    }
  });
});

describe("operation evidence checker", () => {
  it("fails when a required automated operation has no evidence record", () => {
    const result = evaluateOperationEvidence({
      operations: [{ id: "PARAM-DRAFT-EDIT-001", priority: "P0", coverage: "automated" }],
      records: []
    });

    expect(result.status).toBe("failed");
    expect(result.missingOperationIds).toEqual(["PARAM-DRAFT-EDIT-001"]);
  });

  it("allows child evidence ids to satisfy a parent required operation", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));

    try {
      const artifactPath = join(root, "admin.png");
      writeFileSync(artifactPath, "fake-png", "utf8");
      const result = evaluateOperationEvidence({
        operations: [{ id: "PERM-MATRIX-001", priority: "P0", coverage: "automated" }],
        records: [
          {
            operationId: "PERM-MATRIX-001:Admin",
            status: "passed",
            role: "Admin",
            route: "core routes",
            assertions: ["ui"],
            artifacts: [artifactPath]
          }
        ]
      });

      expect(result.status).toBe("passed");
      expect(result.missingOperationIds).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when required automated operation evidence lacks review metadata", () => {
    const result = evaluateOperationEvidence({
      operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated" }],
      records: [
        {
          operationId: "PARAM-HAPPY-001",
          status: "passed",
          artifacts: []
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.invalidEvidenceIds).toEqual(["PARAM-HAPPY-001"]);
  });

  it("fails when required automated operation evidence has no artifact path", () => {
    const result = evaluateOperationEvidence({
      operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated" }],
      records: [
        {
          operationId: "PARAM-HAPPY-001",
          status: "passed",
          role: "Hardware User",
          route: "/parameters",
          assertions: ["ui"],
          artifacts: []
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.invalidEvidenceIds).toEqual(["PARAM-HAPPY-001"]);
  });

  it("fails when required automated operation evidence points at a missing artifact", () => {
    const result = evaluateOperationEvidence({
      operations: [{ id: "PARAM-HAPPY-001", priority: "P0", coverage: "automated" }],
      records: [
        {
          operationId: "PARAM-HAPPY-001",
          status: "passed",
          role: "Hardware User",
          route: "/parameters",
          assertions: ["ui"],
          artifacts: ["test-results/acceptance/operation-evidence/missing-artifact.png"]
        }
      ]
    });

    expect(result.status).toBe("failed");
    expect(result.invalidEvidenceIds).toEqual(["PARAM-HAPPY-001"]);
  });

  it("renders an operation evidence index", () => {
    const markdown = renderOperationEvidenceMarkdown({
      status: "passed",
      coveredOperationIds: ["PARAM-DRAFT-EDIT-001"],
      missingOperationIds: [],
      invalidEvidenceIds: [],
      records: [
        {
          operationId: "PARAM-DRAFT-EDIT-001",
          status: "passed",
          role: "Hardware User",
          route: "/parameters",
          assertions: ["ui", "api"],
          artifacts: ["test-results/acceptance/operation-evidence/example.png"]
        }
      ]
    });

    expect(markdown).toContain("# Operation Evidence Index");
    expect(markdown).toContain("| Operation ID | Status | Role | Route | Assertions | Artifacts |");
    expect(markdown).toContain("`PARAM-DRAFT-EDIT-001`");
    expect(markdown).toContain("Hardware User");
  });

  it("reads evidence records and writes an evidence index", () => {
    const root = mkdtempSync(join(tmpdir(), "wiseeff-operation-evidence-"));
    try {
      const artifactPath = join(root, "artifact.png");
      writeFileSync(artifactPath, "fake-png", "utf8");
      const records: OperationEvidenceRecord[] = [
        {
          operationId: "PARAM-DRAFT-EDIT-001",
          status: "passed",
          role: "Hardware User",
          route: "/parameters",
          assertions: ["ui"],
          artifacts: [artifactPath]
        }
      ];

      const indexPath = writeOperationEvidenceIndex({
        outputPath: join(root, "index.md"),
        evaluation: {
          status: "passed",
          coveredOperationIds: ["PARAM-DRAFT-EDIT-001"],
          missingOperationIds: [],
          invalidEvidenceIds: [],
          records
        }
      });

      expect(indexPath).toBe(join(root, "index.md"));
      expect(readOperationEvidenceRecords(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
