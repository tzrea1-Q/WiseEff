import { describe, expect, it } from "vitest";
import { createMockRuntimeState } from "./mockState";
import { createMockParameterRepository } from "./mockParameterRepository";

describe("mock parameter repository", () => {
  it("lists project-filtered parameters", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    const rows = await repository.listParameters({ projectId: "aurora" });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.projectId === "aurora")).toBe(true);
  });

  it("submits parameter changes through reducer behavior", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const [parameter] = await repository.listParameters({ projectId: "aurora" });

    const round = await repository.submitParameterChanges({
      items: [{ parameterId: parameter.id, targetValue: "1234", reason: "repository contract test" }],
      reason: "repository contract test"
    });

    expect(round.id).toMatch(/^PRS-/);
    expect(round.items[0]).toMatchObject({
      parameterId: parameter.id,
      targetValue: "1234"
    });

    const rounds = await repository.listSubmissionRounds();
    const requests = await repository.listChangeRequests();

    expect(rounds[0].id).toBe(round.id);
    expect(requests[0].submissionRoundId).toBe(round.id);
  });
});
