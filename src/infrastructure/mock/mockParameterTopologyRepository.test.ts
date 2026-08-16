import { describe, expect, it } from "vitest";

import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createMockParameterTopologyRepository } from "./mockParameterTopologyRepository";

const PROJECT_ID = "project-teaching";
const CONFIG_SET_ID = "config-set-teaching";
const REVISION_ID = "revision-teaching-1";

describe("createMockParameterTopologyRepository (ParameterTopologyRepository contract)", () => {
  function createRepo(): ParameterTopologyRepository {
    return createMockParameterTopologyRepository();
  }

  it("listSpecs returns semantic ParameterSpecs with version and vendor schema provenance, not path-derived identity", async () => {
    const repo = createRepo();
    const specs = await repo.listSpecs({});

    expect(specs.length).toBeGreaterThan(0);
    const gpio = specs.find((spec) => spec.propertyKey === "gpio_int" && spec.driverModule === "sc8562");
    expect(gpio).toMatchObject({
      id: expect.stringMatching(/^spec-/),
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      lifecycle: "active",
      currentVersionId: expect.any(String),
      currentVersion: expect.any(Number)
    });
    expect(gpio?.id).not.toContain("/");
    expect(gpio?.specificationKey).toBeTruthy();

    const detail = await repo.getSpec(gpio!.id);
    expect(detail).toMatchObject({
      id: gpio!.id,
      propertyKey: "gpio_int",
      schemaNamespace: expect.stringMatching(/vendor/),
      valueShape: expect.anything(),
      currentVersionId: gpio!.currentVersionId
    });
    // Identity is parameterSpecId — never a DTS path as the primary key
    expect(detail.id).not.toMatch(/^\/|^amba\//);
  });

  it("listBindings returns ProjectParameterBindings keyed by spec version identity", async () => {
    const repo = createRepo();
    const bindings = await repo.listBindings(PROJECT_ID, REVISION_ID);

    expect(bindings.length).toBeGreaterThan(0);
    for (const binding of bindings) {
      expect(binding.id).toMatch(/^binding-/);
      expect(binding.parameterSpecId).toMatch(/^spec-/);
      expect(binding.parameterSpecVersionId).toMatch(/^specver-/);
      expect(binding.moduleId).toBeTruthy();
      // Binding identity is not a path-derived flat (name, module) key
      expect(binding.id).not.toBe(`${binding.propertyKey}:${binding.driverModule}`);
    }
  });

  it("getTopology returns source and effective trees for the semantic model", async () => {
    const repo = createRepo();
    const source = await repo.getTopology(PROJECT_ID, CONFIG_SET_ID, REVISION_ID, "source");
    const effective = await repo.getTopology(PROJECT_ID, CONFIG_SET_ID, REVISION_ID, "effective");

    expect(source.view).toBe("source");
    expect(source.nodes.length).toBeGreaterThan(0);
    expect(source.nodes.some((node) => "nodePath" in node && node.nodePath.includes("sc8562"))).toBe(true);

    expect(effective.view).toBe("effective");
    expect(effective.nodes.length).toBeGreaterThan(0);
    expect(effective.nodes.some((node) => "logicalNodeId" in node && node.logicalNodeId === "logical-sc8562")).toBe(
      true
    );
  });

  it("listSpecReviewTasks and resolveSpecReviewTask cover the review queue", async () => {
    const repo = createRepo();
    const open = await repo.listSpecReviewTasks({ status: "open" });
    expect(open.items.length).toBeGreaterThan(0);
    const task = open.items[0];

    await repo.resolveSpecReviewTask(task.id, {
      decision: "resolved",
      parameterSpecId: "spec-sc8562-gpio-int",
      reason: "Matched SC8562"
    });

    const after = await repo.listSpecReviewTasks({ status: "open" });
    expect(after.items.find((item) => item.id === task.id)).toBeUndefined();
  });

  it("listMappingTasks and resolveMapping cover identity mapping governance", async () => {
    const repo = createRepo();
    const tasks = await repo.listMappingTasks(PROJECT_ID);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].candidateLogicalNodeIds.length).toBeGreaterThan(0);

    await repo.resolveMapping(tasks[0].id, {
      decision: "resolved",
      selectedLogicalNodeId: tasks[0].candidateLogicalNodeIds[0],
      reason: "Keep current sc8562 node"
    });

    const after = await repo.listMappingTasks(PROJECT_ID);
    expect(after.find((task) => task.id === tasks[0].id)?.status).toBe("resolved");
  });

  it("validateRevision returns a ValidationRun", async () => {
    const repo = createRepo();
    const run = await repo.validateRevision(PROJECT_ID, REVISION_ID);
    expect(run).toMatchObject({
      id: expect.any(String),
      status: "passed",
      stage: expect.any(String)
    });
  });

  it("listBindingHistory and listBindingCompare return optional history peers", async () => {
    const repo = createRepo();
    const history = await repo.listBindingHistory!(PROJECT_ID, "binding-sc8562-gpio-int");
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toMatchObject({
      id: expect.any(String),
      changedAt: expect.any(String),
      toRawValue: expect.any(String)
    });

    const compare = await repo.listBindingCompare!(PROJECT_ID, "binding-sc8562-gpio-int");
    expect(compare.length).toBeGreaterThan(0);
    expect(compare[0]).toMatchObject({
      projectId: expect.any(String),
      projectName: expect.any(String),
      rawValue: expect.any(String)
    });
  });

  it("activateParameterSpec and createBindingDraft mutate through the public port", async () => {
    const repo = createRepo();
    const activated = await repo.activateParameterSpec("spec-draft-mystery", {
      valueShape: { kind: "strings", maxItems: 1 },
      constraints: {},
      documentation: "Activated from mock",
      reason: "Ready for use",
      displayName: "Mystery property"
    });
    expect(activated.lifecycle).toBe("active");
    expect(activated.currentVersion).toBe(1);
    expect(activated.documentation).toBe("Activated from mock");

    const draft = await repo.createBindingDraft(PROJECT_ID, "binding-sc8562-gpio-int", {
      baseRevisionId: REVISION_ID,
      reason: "Bump gpio",
      action: "set"
    });
    expect(draft).toMatchObject({
      draftId: expect.stringMatching(/^draft-mock-/),
      parameterSpecId: "spec-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      action: "set",
      overlayFileName: expect.any(String)
    });
  });

  it("deprecateParameterSpec soft-retires and restoreParameterSpec returns to prior activated state", async () => {
    const repo = createRepo();
    const deprecated = await repo.deprecateParameterSpec("spec-sc8562-gpio-int", {
      reason: "superseded locally"
    });
    expect(deprecated.lifecycle).toBe("deprecated");

    const restored = await repo.restoreParameterSpec("spec-sc8562-gpio-int", {
      reason: "still needed"
    });
    expect(restored.lifecycle).toBe("active");
  });

  it("activateParameterSpec throws CONFLICT when the spec is not a draft", async () => {
    const repo = createRepo();
    const error = await repo
      .activateParameterSpec("spec-sc8562-gpio-int", {
        valueShape: {},
        constraints: {},
        documentation: "",
        reason: "retry activate"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "Only draft parameter specs can be activated.",
      requestId: "mock",
      details: { specId: "spec-sc8562-gpio-int" }
    });
  });

  it("resolveMapping throws CONFLICT when the identity mapping task is not open", async () => {
    const repo = createRepo();
    const tasks = await repo.listMappingTasks(PROJECT_ID);
    const task = tasks[0];
    await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: task.candidateLogicalNodeIds[0],
      reason: "Keep current sc8562 node"
    });

    const error = await repo
      .resolveMapping(task.id, {
        decision: "resolved",
        selectedLogicalNodeId: task.candidateLogicalNodeIds[0],
        reason: "retry"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "Identity mapping task is not open.",
      requestId: "mock",
      details: { taskId: task.id }
    });
  });

  it("reopenMapping throws CONFLICT when the identity mapping task is already resolved", async () => {
    const repo = createRepo();
    const tasks = await repo.listMappingTasks(PROJECT_ID);
    const task = tasks[0];
    await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: task.candidateLogicalNodeIds[0],
      reason: "Keep current sc8562 node"
    });

    const error = await repo
      .reopenMapping(task.id, { reason: "need another look" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "Resolved identity mapping tasks cannot be reopened.",
      requestId: "mock",
      details: { taskId: task.id }
    });
  });

  it("reattributeParameterSpec throws CONFLICT when another spec already uses the subject and property key", async () => {
    const repo = createRepo();
    await repo.reattributeParameterSpec("spec-sc8562-gpio-int", {
      attributionSubjectId: "sc8562",
      reason: "align subject"
    });

    const error = await repo
      .reattributeParameterSpec("spec-mt5788-gpio-int", {
        attributionSubjectId: "sc8562",
        reason: "duplicate subject"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "A parameter definition already exists for this subject and property key.",
      requestId: "mock",
      details: { parameterSpecId: "spec-sc8562-gpio-int", lifecycle: "active" }
    });
  });

  it("renameParameterSpecPropertyKey throws CONFLICT when project bindings still reference the definition", async () => {
    const repo = createRepo();
    const error = await repo
      .renameParameterSpecPropertyKey("spec-sc8562-gpio-int", {
        propertyKey: "gpio_int_renamed",
        reason: "rename bound spec"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "Cannot rename property_key while 1 project binding(s) reference this definition.",
      requestId: "mock",
      details: { parameterSpecId: "spec-sc8562-gpio-int", referenceCount: 1 }
    });
  });

  it("renameParameterSpecPropertyKey throws CONFLICT when another spec already uses the subject and property key", async () => {
    const repo = createRepo();
    const error = await repo
      .renameParameterSpecPropertyKey("spec-mt5788-gpio-int", {
        propertyKey: "mystery_prop",
        reason: "duplicate property key"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "A parameter definition already exists for this subject and property key.",
      requestId: "mock",
      details: { parameterSpecId: "spec-draft-mystery", lifecycle: "draft" }
    });
  });
});
