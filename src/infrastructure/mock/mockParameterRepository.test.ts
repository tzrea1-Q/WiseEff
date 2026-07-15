import { describe, expect, it } from "vitest";
import { createMockRuntimeState } from "./mockState";
import { createMockParameterRepository } from "./mockParameterRepository";
import type { ParameterImportSourceItem } from "@/application/ports/ParameterRepository";

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

  it("stores and deletes drafts per project", async () => {
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
    await expect(repository.listDrafts("aurora")).resolves.toEqual([
      {
        id: "draft-aurora-aurora-fast-charge-current",
        projectId: "aurora",
        parameterId: "aurora-fast-charge-current",
        targetValue: "3200",
        reason: "mock draft",
        updatedAt: "2026-05-25T00:00:00.000Z"
      }
    ]);
    await expect(repository.listDrafts("nebula")).resolves.toEqual([]);
    await expect(repository.deleteDraft("draft-aurora-aurora-fast-charge-current")).resolves.toBeUndefined();
    await expect(repository.listDrafts("aurora")).resolves.toEqual([]);
  });

  it("returns submission round copies that cannot mutate runtime state", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const [round] = await repository.listSubmissionRounds();
    const originalTargetValue = round.items[0].targetValue;

    round.items[0].targetValue = "mutated";

    const [rereadRound] = await repository.listSubmissionRounds();

    expect(rereadRound.items[0].targetValue).toBe(originalTargetValue);
  });

  it("filters submission rounds by project and status", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const matchingRound = (await repository.listSubmissionRounds()).find((round) => round.projectId === "aurora")!;

    const projectRows = await repository.listSubmissionRounds({ projectId: "aurora" });
    const statusRows = await repository.listSubmissionRounds({ status: [matchingRound.status] });
    const combinedRows = await repository.listSubmissionRounds({ projectId: matchingRound.projectId, status: [matchingRound.status] });

    expect(projectRows.length).toBeGreaterThan(0);
    expect(projectRows.every((round) => round.projectId === "aurora")).toBe(true);
    expect(statusRows.length).toBeGreaterThan(0);
    expect(statusRows.every((round) => round.status === matchingRound.status)).toBe(true);
    expect(combinedRows.length).toBeGreaterThan(0);
    expect(combinedRows.every((round) => round.projectId === matchingRound.projectId && round.status === matchingRound.status)).toBe(true);
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

  it("uses a deterministic updatedAt timestamp when reviewChange mutates a request", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const request = (await repository.listChangeRequests())[0];

    const reviewed = await repository.reviewChange({
      requestId: request.id,
      decision: "reject",
      note: "contract smoke test"
    });

    expect(reviewed.updatedAt).toBe("2026-05-25T00:00:00.000Z");
    expect((await repository.listChangeRequests()).find((item) => item.id === request.id)?.updatedAt).toBe(
      "2026-05-25T00:00:00.000Z"
    );
  });

  it("filters change requests by project, status, and assignee", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const matchingRequest = (await repository.listChangeRequests()).find((request) => request.projectId && request.assignedTo)!;

    const projectRows = await repository.listChangeRequests({ projectId: matchingRequest.projectId });
    const statusRows = await repository.listChangeRequests({ status: [matchingRequest.status] });
    const assigneeRows = await repository.listChangeRequests({ assignedTo: matchingRequest.assignedTo });
    const combinedRows = await repository.listChangeRequests({
      projectId: matchingRequest.projectId,
      status: [matchingRequest.status],
      assignedTo: matchingRequest.assignedTo
    });

    expect(projectRows.length).toBeGreaterThan(0);
    expect(projectRows.every((request) => request.projectId === matchingRequest.projectId)).toBe(true);
    expect(statusRows.length).toBeGreaterThan(0);
    expect(statusRows.every((request) => request.status === matchingRequest.status)).toBe(true);
    expect(assigneeRows.length).toBeGreaterThan(0);
    expect(assigneeRows.every((request) => request.assignedTo === matchingRequest.assignedTo)).toBe(true);
    expect(combinedRows.length).toBeGreaterThan(0);
    expect(
      combinedRows.every(
        (request) =>
          request.projectId === matchingRequest.projectId &&
          request.status === matchingRequest.status &&
          request.assignedTo === matchingRequest.assignedTo
      )
    ).toBe(true);
  });

  it("updates a change request from reviewChange consistently with reducer workflow", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const request = (await repository.listChangeRequests()).find((item) => item.status === "硬件Committer检视")!;

    const reviewed = await repository.reviewChange({
      requestId: request.id,
      decision: "advance",
      note: "contract smoke test"
    });

    reviewed.aiSuggestion.reasons[0] = "mutated";

    const rereadRequest = (await repository.listChangeRequests()).find((item) => item.id === request.id)!;
    expect(reviewed.id).toBe(request.id);
    expect(reviewed.status).toBe("软件Committer检视");
    expect(reviewed.reviewerNote).toBe("contract smoke test");
    expect(rereadRequest.aiSuggestion.reasons[0]).toBe(request.aiSuggestion.reasons[0]);
    expect(rereadRequest.status).toBe("软件Committer检视");
  });

  it("rejects a change request from reviewChange and updates its submission round", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const request = (await repository.listChangeRequests()).find((item) => item.submissionRoundId)!;

    const reviewed = await repository.reviewChange({
      requestId: request.id,
      decision: "reject",
      note: "Missing evidence"
    });

    const round = (await repository.listSubmissionRounds()).find((item) => item.id === request.submissionRoundId)!;

    expect(reviewed.status).toBe("已打回");
    expect(reviewed.rejectReason).toBe("Missing evidence");
    expect(round.status).toBe("已打回");
  });

  it("parseDtsImport preserves @address paths and rejects /include/", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    await expect(
      repository.parseDtsImport({
        sourceName: "board.dts",
        content: '/dts-v1/;\n/include/ "pin.dtsi"\n/ { board_id = <0>; };\n'
      })
    ).rejects.toMatchObject({
      details: { code: "dts-include-unsupported" }
    });

    const parsed = await repository.parseDtsImport({
      sourceName: "board.dts",
      content: `/dts-v1/;
&demo {
	battery_checker@0 {
		status = "ok";
	};
	battery_checker@1 {
		status = "disabled";
	};
};
`
    });

    expect(parsed.format).toBe("dts-full");
    expect(parsed.rows.map((row) => row.sourceNodePath).sort()).toEqual([
      "demo/battery_checker@0/status",
      "demo/battery_checker@1/status"
    ]);
    expect(parsed.rows.every((row) => row.module.includes("@"))).toBe(true);
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

    const applied = await repository.applyImportBatch({ batchId: preview.id });

    expect(applied).toMatchObject({
      ...preview,
      status: "applied",
      appliedAt: "2026-05-25T00:00:00.000Z"
    });
    expect(applied.items).toHaveLength(preview.items.length);
    await expect(repository.applyImportBatch({ batchId: preview.id })).rejects.toThrow("Import batch already applied: import-aurora-parameters-csv");
  });

  it("applies import batches into future parameter list results", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    const preview = await repository.createImportPreview({
      projectId: "aurora",
      sourceName: "runtime-apply.csv",
      items: [
        {
          name: "Runtime Applied Parameter",
          module: "Charging",
          risk: "High",
          unit: "mA",
          range: "0-5000",
          currentValue: "4100",
          recommendedValue: "4000",
          description: "Imported at runtime.",
          explanation: "Used by repository contract tests.",
          configFormat: "integer"
        }
      ]
    });

    await repository.applyImportBatch({ batchId: preview.id });

    const parameters = await repository.listParameters({ projectId: "aurora" });
    const imported = parameters.find((parameter) => parameter.name === "Runtime Applied Parameter");

    expect(imported).toMatchObject({
      id: "aurora-runtime-applied-parameter",
      projectId: "aurora",
      currentValue: "4100",
      recommendedValue: "4000",
      risk: "High"
    });
  });

  it("applies only selected import batch items", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    const preview = await repository.createImportPreview({
      projectId: "aurora",
      sourceName: "runtime-selected.csv",
      items: [
        {
          name: "Selected Runtime Parameter",
          module: "Charging",
          risk: "Medium",
          unit: "mA",
          range: "0-5000",
          currentValue: "3100"
        },
        {
          name: "Skipped Runtime Parameter",
          module: "Thermal",
          risk: "Low",
          unit: "C",
          range: "0-100",
          currentValue: "42"
        }
      ]
    });

    const applied = await repository.applyImportBatch({ batchId: preview.id, selectedItemIds: [preview.items[0].id] });

    const parameters = await repository.listParameters({ projectId: "aurora" });

    expect(applied.items).toHaveLength(preview.items.length);
    expect(applied.items.map((item) => item.name)).toEqual(preview.items.map((item) => item.name));
    expect(parameters.some((parameter) => parameter.name === "Selected Runtime Parameter")).toBe(true);
    expect(parameters.some((parameter) => parameter.name === "Skipped Runtime Parameter")).toBe(false);
  });

  it("defaults import apply to added and updated items only", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const items = [
      {
        name: "Eligible Runtime Parameter",
        module: "Charging",
        risk: "Medium",
        unit: "mA",
        range: "0-5000",
        currentValue: "3100",
        classification: "added"
      },
      {
        name: "Ineligible Runtime Parameter",
        module: "Thermal",
        risk: "Low",
        unit: "C",
        range: "0-100",
        currentValue: "42",
        classification: "conflict"
      }
    ] satisfies Array<ParameterImportSourceItem & { classification: "added" | "conflict" }>;

    const preview = await repository.createImportPreview({
      projectId: "aurora",
      sourceName: "runtime-eligible.csv",
      items
    });

    await repository.applyImportBatch({ batchId: preview.id });

    const parameters = await repository.listParameters({ projectId: "aurora" });
    expect(parameters.some((parameter) => parameter.name === "Eligible Runtime Parameter")).toBe(true);
    expect(parameters.some((parameter) => parameter.name === "Ineligible Runtime Parameter")).toBe(false);
  });

  it("rejects explicitly selected conflict import items without consuming the batch", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const items = [
      {
        name: "Selected Conflict Runtime Parameter",
        module: "Charging",
        risk: "High",
        unit: "mA",
        range: "0-5000",
        currentValue: "3100",
        classification: "conflict"
      }
    ] satisfies Array<ParameterImportSourceItem & { classification: "conflict" }>;

    const preview = await repository.createImportPreview({
      projectId: "aurora",
      sourceName: "runtime-conflict.csv",
      items
    });

    await expect(
      repository.applyImportBatch({ batchId: preview.id, selectedItemIds: [preview.items[0].id] })
    ).rejects.toThrow("Cannot apply import items with open change requests.");

    await expect(repository.applyImportBatch({ batchId: preview.id })).rejects.toThrow(
      "At least one eligible import item must be selected."
    );
    const parameters = await repository.listParameters({ projectId: "aurora" });
    expect(parameters.some((parameter) => parameter.name === "Selected Conflict Runtime Parameter")).toBe(false);
  });

  it("rejects import apply when no eligible items would be applied", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());
    const items = [
      {
        name: "Unchanged Runtime Parameter",
        module: "Charging",
        risk: "Medium",
        unit: "mA",
        range: "0-5000",
        currentValue: "3100",
        classification: "unchanged"
      }
    ] satisfies Array<ParameterImportSourceItem & { classification: "unchanged" }>;

    const preview = await repository.createImportPreview({
      projectId: "aurora",
      sourceName: "runtime-unchanged.csv",
      items
    });

    await expect(
      repository.applyImportBatch({ batchId: preview.id, selectedItemIds: [preview.items[0].id] })
    ).rejects.toThrow("At least one eligible import item must be selected.");

    await expect(repository.applyImportBatch({ batchId: preview.id })).rejects.toThrow(
      "At least one eligible import item must be selected."
    );
  });

  it("rejects an empty selected item list without consuming the batch", async () => {
    const repository = createMockParameterRepository(createMockRuntimeState());

    const preview = await repository.createImportPreview({
      projectId: "aurora",
      sourceName: "runtime-selected.csv",
      items: [
        {
          name: "Selected Runtime Parameter",
          module: "Charging",
          risk: "Medium",
          unit: "mA",
          range: "0-5000",
          currentValue: "3100"
        }
      ]
    });

    await expect(repository.applyImportBatch({ batchId: preview.id, selectedItemIds: [] })).rejects.toThrow(
      "At least one import item must be selected."
    );

    const applied = await repository.applyImportBatch({ batchId: preview.id });
    expect(applied.items).toHaveLength(preview.items.length);
    expect(applied.items[0].id).toBe(preview.items[0].id);
    const parameters = await repository.listParameters({ projectId: "aurora" });
    expect(parameters.some((parameter) => parameter.name === "Selected Runtime Parameter")).toBe(true);
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

    await expect(repository.applyImportBatch({ batchId: preview.id })).rejects.toThrow(
      "Import batch already applied: import-aurora-parameters-csv"
    );
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
