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

  it("gets a parameter and its history by id", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const [listed] = await repository.listParameters();

    const parameter = await repository.getParameter(listed.id);
    const history = await repository.listParameterHistory(listed.id);

    expect(parameter).toEqual(listed);
    expect(history).toEqual(listed.history);
  });

  it("rejects unknown parameter ids with a clear error", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    await expect(repository.getParameter("missing-parameter")).rejects.toThrow("Parameter not found: missing-parameter");
  });

  it("supports deterministic draft methods without broad state mutation", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    await expect(repository.listDrafts("aurora")).resolves.toEqual([]);
    await expect(
      repository.saveDraft({
        projectId: "aurora",
        parameterId: "aurora-fast-charge-current",
        targetValue: "3200",
        reason: "mock draft"
      })
    ).resolves.toEqual({
      id: "draft-aurora-aurora-fast-charge-current",
      projectId: "aurora",
      parameterId: "aurora-fast-charge-current",
      targetValue: "3200",
      reason: "mock draft",
      updatedAt: "2026-05-25T00:00:00.000Z"
    });
    await expect(repository.deleteDraft("draft-aurora-aurora-fast-charge-current")).resolves.toBeUndefined();
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

  it("returns a cloned change request from reviewChange without state transition", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const [request] = await repository.listChangeRequests();

    const reviewed = await repository.reviewChange({
      requestId: request.id,
      decision: "advance",
      note: "contract smoke test"
    });

    reviewed.aiSuggestion.reasons[0] = "mutated";

    const [rereadRequest] = await repository.listChangeRequests();
    expect(reviewed.id).toBe(request.id);
    expect(rereadRequest.aiSuggestion.reasons[0]).toBe(request.aiSuggestion.reasons[0]);
  });

  it("creates and applies deterministic import batch previews", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    const preview = await repository.createImportPreview({
      projectId: "aurora",
      sourceName: "parameters.csv",
      items: [
        {
          name: "New high risk parameter",
          module: "Charging",
          risk: "High",
          unit: "mA",
          range: "0-4000",
          currentValue: "3000"
        },
        {
          name: "Existing low risk parameter",
          module: "Thermal",
          risk: "Low",
          unit: "C",
          range: "0-100",
          recommendedValue: "45"
        }
      ]
    });

    expect(preview).toMatchObject({
      id: "import-aurora-parameters-csv",
      projectId: "aurora",
      sourceName: "parameters.csv",
      status: "previewed",
      summary: {
        added: 2,
        updated: 0,
        unchanged: 0,
        conflict: 0,
        highRisk: 1
      }
    });
    expect(preview.items.map((item) => item.id)).toEqual(["import-aurora-parameters-csv-item-1", "import-aurora-parameters-csv-item-2"]);

    await expect(repository.applyImportBatch({ batchId: preview.id })).resolves.toMatchObject({
      ...preview,
      status: "applied",
      appliedAt: "2026-05-25T00:00:00.000Z"
    });
  });

  it("protects stored import batches from returned object mutation", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    const preview = await repository.createImportPreview({
      projectId: "aurora",
      sourceName: "parameters.csv",
      items: [
        {
          name: "New high risk parameter",
          module: "Charging",
          risk: "High",
          unit: "mA",
          range: "0-4000",
          currentValue: "3000"
        }
      ]
    });

    preview.summary.added = 99;
    preview.items[0].name = "mutated";
    preview.status = "applied";

    const applied = await repository.applyImportBatch({ batchId: preview.id });

    expect(applied.status).toBe("applied");
    expect(applied.summary.added).toBe(1);
    expect(applied.items[0].name).toBe("New high risk parameter");

    applied.summary.added = 42;
    applied.items[0].name = "mutated again";

    const reapplied = await repository.applyImportBatch({ batchId: preview.id });

    expect(reapplied.summary.added).toBe(1);
    expect(reapplied.items[0].name).toBe("New high risk parameter");
  });

  it("submits parameter changes through reducer behavior", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const [parameter] = await repository.listParameters({ projectId: "aurora" });

    const round = await repository.submitParameterChanges({
      projectId: "aurora",
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
