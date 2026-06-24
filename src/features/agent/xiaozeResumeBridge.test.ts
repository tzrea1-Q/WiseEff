import { describe, expect, it } from "vitest";
import { buildXiaozeResumeEntries } from "./xiaozeResumeBridge";

describe("buildXiaozeResumeEntries", () => {
  it("maps CopilotKit resolve command to AG-UI resume entries", () => {
    expect(
      buildXiaozeResumeEntries({
        resume: { decision: "approve", editedArgs: { targetValue: "18A" } },
        interruptEvent: { approvalId: "approval-1", toolName: "action.submitParameterChange" }
      })
    ).toEqual([
      {
        interruptId: "approval-1",
        status: "resolved",
        payload: {
          approvalId: "approval-1",
          decision: "approve",
          editedArgs: { targetValue: "18A" },
          reason: undefined
        }
      }
    ]);
  });

  it("maps reject decisions to cancelled resume status", () => {
    expect(
      buildXiaozeResumeEntries({
        resume: { decision: "reject", reason: "Not now" },
        interruptEvent: { approvalId: "approval-2" }
      })
    ).toEqual([
      {
        interruptId: "approval-2",
        status: "cancelled",
        payload: {
          approvalId: "approval-2",
          decision: "reject",
          editedArgs: undefined,
          reason: "Not now"
        }
      }
    ]);
  });

  it("returns undefined when interrupt approval id is missing", () => {
    expect(buildXiaozeResumeEntries({ resume: { decision: "approve" } })).toBeUndefined();
  });
});
