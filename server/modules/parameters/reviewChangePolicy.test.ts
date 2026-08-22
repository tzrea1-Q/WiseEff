import { describe, expect, it } from "vitest";

import { ApiError } from "../../shared/http/errors";
import { resolveSemanticMergeSubject } from "./reviewChangePolicy";

function captureApiError(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("Expected policy to reject the semantic merge subject.");
}

describe("semantic review subject policy", () => {
  it("rejects semantic merge when projectId is missing", () => {
    expect(
      captureApiError(() =>
        resolveSemanticMergeSubject({
          requestId: "request-1",
          projectId: undefined,
          editSubjectKind: "binding",
          parameterId: "binding-1"
        })
      )
    ).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message: "Semantic merge requires a project-scoped change request.",
      details: { requestId: "request-1" }
    });
  });

  it.each([
    {
      label: "binding without a parameter binding",
      input: { requestId: "request-binding", projectId: "project-1", editSubjectKind: "binding" as const },
      message: "Semantic merge requires a project parameter binding write lock."
    },
    {
      label: "enablement without a logical node",
      input: {
        requestId: "request-enablement",
        projectId: "project-1",
        editSubjectKind: "node-enablement" as const
      },
      message: "Semantic enablement merge requires a logical node write lock."
    }
  ])("rejects $label", ({ input, message }) => {
    expect(captureApiError(() => resolveSemanticMergeSubject(input))).toMatchObject({
      code: "CONFLICT",
      status: 409,
      message,
      details: { requestId: input.requestId }
    });
  });

  it("resolves binding and node-enablement subjects for writeback", () => {
    expect(
      resolveSemanticMergeSubject({
        requestId: "request-binding",
        projectId: "project-1",
        editSubjectKind: "binding",
        parameterId: "binding-1"
      })
    ).toEqual({ kind: "binding", projectId: "project-1", parameterId: "binding-1" });
    expect(
      resolveSemanticMergeSubject({
        requestId: "request-enablement",
        projectId: "project-1",
        logicalNodeId: "logical-node-1"
      })
    ).toEqual({ kind: "node-enablement", projectId: "project-1", logicalNodeId: "logical-node-1" });
  });
});
