import { describe, expect, it } from "vitest";
import { createPrototypeState } from "@/mockData";
import { submitParameterRound } from "./commands";

describe("submitParameterRound", () => {
  it("submits a parameter round and creates linked requests", () => {
    const state = createPrototypeState();
    const parameter = state.parameters.find((item) => item.projectId === "aurora")!;

    const next = submitParameterRound(state, {
      items: [
        {
          parameterId: parameter.id,
          targetValue: "3650",
          reason: "验证高温快充边界"
        }
      ]
    });

    const [round] = next.parameterSubmissionRounds;
    const [request] = next.changeRequests;

    expect(round.status).toBe("待审阅");
    expect(round.items[0]).toMatchObject({
      parameterId: parameter.id,
      targetValue: "3650"
    });
    expect(request.submissionRoundId).toBe(round.id);
    expect(request.targetValue).toBe("3650");
  });

  it("keeps state unchanged when no draft item matches", () => {
    const state = createPrototypeState();

    const next = submitParameterRound(state, {
      items: [{ parameterId: "missing-parameter", targetValue: "3650", reason: "ignored" }]
    });

    expect(next).toBe(state);
  });

  it("uses each item reason instead of the shared input reason", () => {
    const state = createPrototypeState();
    const parameter = state.parameters.find((item) => item.projectId === "aurora")!;

    const next = submitParameterRound(state, {
      items: [
        {
          parameterId: parameter.id,
          targetValue: "3650",
          reason: "单项原因"
        }
      ],
      reason: "共享原因不应生效"
    });

    expect(next.parameterSubmissionRounds[0].items[0].reason).toBe("单项原因");
    expect(next.changeRequests[0].aiSummary).toBe("单项原因");
  });
});
