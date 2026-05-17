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

  it("lists module-filtered parameters", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const [auroraParameter] = await repository.listParameters({ projectId: "aurora" });

    const rows = await repository.listParameters({ module: auroraParameter.module });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.module === auroraParameter.module)).toBe(true);
  });

  it("treats an empty risk filter as non-restrictive", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    const allRows = await repository.listParameters();
    const rows = await repository.listParameters({ risk: [] });

    expect(rows).toHaveLength(allRows.length);
  });

  it("lists risk-filtered parameters", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    const rows = await repository.listParameters({ risk: ["High"] });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.risk === "High")).toBe(true);
  });

  it("returns parameter copies that cannot mutate runtime state", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const rows = await repository.listParameters();
    const originalCurrentValue = rows[0].currentValue;
    const originalHistoryValue = rows[0].history[0].value;

    rows[0].currentValue = "mutated";
    rows[0].history[0].value = "mutated";

    const rereadRows = await repository.listParameters();

    expect(rereadRows[0].currentValue).toBe(originalCurrentValue);
    expect(rereadRows[0].history[0].value).toBe(originalHistoryValue);
  });

  it("returns submission round copies that cannot mutate runtime state", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const [round] = await repository.listSubmissionRounds();
    const originalTargetValue = round.items[0].targetValue;

    round.items[0].targetValue = "mutated";

    const [rereadRound] = await repository.listSubmissionRounds();

    expect(rereadRound.items[0].targetValue).toBe(originalTargetValue);
  });

  it("returns change request copies that cannot mutate runtime state", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const [request] = await repository.listChangeRequests();
    const originalReason = request.aiSuggestion.reasons[0];
    const originalImpactName = request.impact[0].name;

    request.aiSuggestion.reasons[0] = "mutated";
    request.impact[0].name = "mutated";

    const [rereadRequest] = await repository.listChangeRequests();

    expect(rereadRequest.aiSuggestion.reasons[0]).toBe(originalReason);
    expect(rereadRequest.impact[0].name).toBe(originalImpactName);
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

    round.items[0].targetValue = "mutated";

    const rounds = await repository.listSubmissionRounds();
    const requests = await repository.listChangeRequests();

    expect(rounds[0].id).toBe(round.id);
    expect(rounds[0].items[0].targetValue).toBe("1234");
    expect(requests[0].submissionRoundId).toBe(round.id);
  });
});
