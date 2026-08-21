import { describe, expect, it } from "vitest";

import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { IdentityMappingTask } from "@/domain/parameter-topology/types";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createMockParameterTopologyRepository } from "./mockParameterTopologyRepository";

const PROJECT_ID = "project-teaching";
const CONFIG_SET_ID = "config-set-teaching";
const REVISION_ID = "revision-teaching-1";

function resolvedMappingTask(id: string): IdentityMappingTask {
  return {
    id,
    projectId: PROJECT_ID,
    configRevisionId: REVISION_ID,
    previousLogicalNodeId: "ln-previous",
    candidateLogicalNodeIds: ["ln-a", "ln-b"],
    evidence: {
      selectedLogicalNodeId: "ln-a",
      candidates: [
        { logicalNodeId: "ln-a", nodeLocator: "/bus/a@1" },
        { logicalNodeId: "ln-b", nodeLocator: "/bus/b@2" }
      ]
    },
    taskKind: "identity-ambiguity",
    status: "resolved",
    createdAt: "2026-08-18T00:00:00.000Z"
  };
}

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

  it("lists real config revisions and refuses invented topology keys", async () => {
    const repo = createRepo();
    const listed = await repo.listConfigRevisions(PROJECT_ID, CONFIG_SET_ID);
    expect(listed.map((item) => item.id)).toEqual([REVISION_ID]);

    const current = await repo.getTopology(PROJECT_ID, CONFIG_SET_ID, "current", "effective");
    expect(current.revisionId).toBe(REVISION_ID);

    await expect(repo.getTopology(PROJECT_ID, CONFIG_SET_ID, "revision-bogus", "effective")).rejects.toMatchObject({
      code: "NOT_FOUND"
    } satisfies Partial<WiseEffApiError>);
    await expect(repo.validateRevision(PROJECT_ID, "revision-bogus")).rejects.toMatchObject({
      code: "NOT_FOUND"
    } satisfies Partial<WiseEffApiError>);

    const other = await repo.listConfigRevisions("aurora", "mock-cs-default-aurora");
    expect(other.some((item) => item.id === "revision-teaching-1")).toBe(false);
    expect(other[0]?.id).toBe("rev-mock-cs-default-aurora-head");
    const soft = await repo.validateRevision("aurora", other[0]!.id);
    expect(soft.requiresConfirmation).toBe(true);
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

  it("updateParameterSpec rejects a semantic field change with successor 409 (ADR-0032)", async () => {
    const repo = createRepo();
    const error = await repo
      .updateParameterSpec("spec-sc8562-gpio-int", {
        documentation: "gpio_int is a three-cell interrupt specifier.",
        reason: "drop extra constraint keys",
        constraints: { cells: 1 },
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { code: "semantic-edit-requires-successor", reason: "semantic-edit-requires-successor" }
    });

    const unchanged = await repo.getSpec("spec-sc8562-gpio-int");
    expect(unchanged.constraints).toEqual({ cellsPerGroup: 3 });
    expect(unchanged.currentVersion).toBe(3);
  });

  it("updateParameterSpec clears displayName when the client sends null (SE-5)", async () => {
    const repo = createRepo();
    const updated = await repo.updateParameterSpec("spec-sc8562-gpio-int", {
      documentation: "gpio_int is a three-cell interrupt specifier.",
      reason: "clear display name",
      constraints: { cellsPerGroup: 3 },
      displayName: null,
    });
    expect(updated.displayName).toBeNull();

    const retrieved = await repo.getSpec("spec-sc8562-gpio-int");
    expect(retrieved.displayName).toBeNull();
  });

  it("updateParameterSpec keeps displayName when the key is omitted (SE-5)", async () => {
    const repo = createRepo();
    const updated = await repo.updateParameterSpec("spec-sc8562-gpio-int", {
      documentation: "gpio_int is a three-cell interrupt specifier.",
      reason: "docs only",
      constraints: { cellsPerGroup: 3 },
    });
    expect(updated.displayName).toBe("SC8562 GPIO interrupt");
  });

  it("activateParameterSpec persists an empty displayName instead of keeping the stored name (SE-5)", async () => {
    const repo = createRepo();
    const activated = await repo.activateParameterSpec("spec-draft-mystery", {
      valueShape: { kind: "strings", maxItems: 1 },
      constraints: {},
      documentation: "Activated from mock",
      reason: "Ready for use",
      displayName: null,
    });
    expect(activated.lifecycle).toBe("active");
    expect(activated.displayName).toBeNull();
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

  it("activateParameterSpec on an active spec with tip bindings stages a successor cutover (ADR-0032)", async () => {
    const repo = createRepo();
    const activated = await repo.activateParameterSpec("spec-sc8562-gpio-int", {
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 4 },
      constraints: { cellsPerGroup: 4 },
      documentation: "four-cell successor",
      reason: "widen specifier"
    });

    expect(activated.lifecycle).toBe("active");
    expect(activated.currentVersion).toBe(3);
    expect(activated.valueShape).toEqual({ kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 });
    expect(activated.cutover).toMatchObject({
      status: "preparing",
      fromVersion: 3,
      toVersion: 4,
      fromVersionId: "specver-sc8562-gpio-int-3",
      impact: { pending: 1, total: 1 }
    });

    const bindings = await repo.listBindings(PROJECT_ID, REVISION_ID);
    const tip = bindings.find((binding) => binding.id === "binding-sc8562-gpio-int");
    expect(tip?.parameterSpecVersionId).toBe("specver-sc8562-gpio-int-3");
  });

  it("activateParameterSpec on an unbound active spec auto-finalizes the successor (ADR-0032)", async () => {
    const repo = createRepo();
    const created = await repo.createParameterSpec({
      attributionSubjectId: "asub:driver:sc8562",
      propertyKey: "successor_prop",
      reason: "create draft for successor path",
      valueShape: { kind: "string" },
      constraints: {},
      documentation: "draft docs"
    });
    const first = await repo.activateParameterSpec(created.id, {
      valueShape: { kind: "string" },
      constraints: {},
      documentation: "draft docs",
      reason: "first activate"
    });
    expect(first.lifecycle).toBe("active");
    expect(first.currentVersion).toBe(1);

    const successor = await repo.activateParameterSpec(created.id, {
      valueShape: { kind: "string" },
      constraints: {},
      documentation: "successor docs",
      reason: "mint successor"
    });
    expect(successor.lifecycle).toBe("active");
    expect(successor.currentVersion).toBe(2);
    expect(successor.documentation).toBe("successor docs");
    expect(successor.cutover).toBeUndefined();
  });

  it("activateParameterSpec throws CONFLICT when the spec is deprecated", async () => {
    const repo = createRepo();
    const error = await repo
      .activateParameterSpec("spec-deprecated-legacy", {
        valueShape: { kind: "string" },
        constraints: {},
        documentation: "still retired",
        reason: "retry activate"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "Only draft or active parameter specs can be activated.",
      requestId: "mock",
      details: { specId: "spec-deprecated-legacy" }
    });
  });

  it("re-resolves an already resolved identity mapping task to another candidate", async () => {
    const repo = createRepo();
    const tasks = await repo.listMappingTasks(PROJECT_ID);
    const task = tasks[0];
    const [firstCandidate, nextCandidate] = task.candidateLogicalNodeIds;
    await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: firstCandidate,
      reason: "Keep current sc8562 node"
    });

    await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: nextCandidate,
      reason: "Correct the continuity choice"
    });

    const [after] = await repo.listMappingTasks(PROJECT_ID);
    expect(after).toMatchObject({
      id: task.id,
      status: "resolved",
      reason: "Correct the continuity choice",
      evidence: { selectedLogicalNodeId: nextCandidate }
    });
  });

  it("rejects a non-resolve decision for an already resolved identity mapping task", async () => {
    const repo = createRepo();
    const [task] = await repo.listMappingTasks(PROJECT_ID);
    await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: task.candidateLogicalNodeIds[0],
      reason: "Keep current sc8562 node"
    });

    const error = await repo.resolveMapping(task.id, {
      decision: "dismissed",
      reason: "Try to discard an applied mapping"
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "CONFLICT", details: { taskId: task.id } });
  });

  it("requires continuity evidence before re-resolving a completed mock task", async () => {
    const task: IdentityMappingTask = {
      id: "mapping-incomplete",
      projectId: PROJECT_ID,
      configRevisionId: REVISION_ID,
      previousLogicalNodeId: "ln-previous",
      candidateLogicalNodeIds: ["ln-a", "ln-b"],
      evidence: {
        candidates: [
          { logicalNodeId: "ln-a", nodeLocator: "/bus/a@1" },
          { logicalNodeId: "ln-b", nodeLocator: "/bus/b@2" }
        ]
      },
      taskKind: "identity-ambiguity",
      status: "resolved",
      createdAt: "2026-08-18T00:00:00.000Z"
    };
    const repo = createMockParameterTopologyRepository({ mappingTasks: [task] });

    const error = await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: "ln-b",
      reason: "Try to infer missing continuity"
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { code: "identity-mapping-migration-required", taskId: task.id }
    });
  });

  it("preserves the singleton-cardinality gate in mock mode", async () => {
    const task: IdentityMappingTask = {
      id: "mapping-singleton",
      projectId: PROJECT_ID,
      configRevisionId: REVISION_ID,
      previousLogicalNodeId: null,
      candidateLogicalNodeIds: ["ln-a", "ln-b"],
      evidence: {},
      taskKind: "singleton-cardinality",
      status: "open",
      createdAt: "2026-08-18T00:00:00.000Z"
    };
    const repo = createMockParameterTopologyRepository({ mappingTasks: [task] });

    const error = await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: "ln-a",
      reason: "Try to discard the duplicate"
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { code: "singleton-cardinality-conflict", taskId: task.id }
    });
  });

  it("blocks mock re-resolve when the modeled task has downstream usage", async () => {
    const task = resolvedMappingTask("mapping-with-downstream");
    const downstream = { drafts: 1, submissions: 0, operations: 0 };
    const repo = createMockParameterTopologyRepository({
      mappingTasks: [task],
      mappingDownstreamUsage: { [task.id]: downstream }
    });

    const error = await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: "ln-b",
      reason: "Try to move a referenced mapping"
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "CONFLICT",
      details: {
        code: "identity-mapping-migration-required",
        taskId: task.id,
        downstream
      }
    });
  });

  it("requires explicit migration when a mock re-resolve target leaves the candidate scope", async () => {
    const task = resolvedMappingTask("mapping-outside-scope");
    const repo = createMockParameterTopologyRepository({ mappingTasks: [task] });

    const error = await repo.resolveMapping(task.id, {
      decision: "resolved",
      selectedLogicalNodeId: "ln-foreign",
      reason: "Try to cross the revision boundary"
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { code: "identity-mapping-migration-required", taskId: task.id }
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

  it("reattributeParameterSpec throws CONFLICT when a deprecated definition already owns the triple", async () => {
    const repo = createRepo();
    await repo.reattributeParameterSpec("spec-deprecated-legacy", {
      attributionSubjectId: "asub:nodetype:charger",
      reason: "park legacy"
    });
    await repo.renameParameterSpecPropertyKey("spec-deprecated-legacy", {
      propertyKey: "gpio_int",
      reason: "same key as sc8562"
    });

    const error = await repo
      .reattributeParameterSpec("spec-sc8562-gpio-int", {
        attributionSubjectId: "asub:nodetype:charger",
        reason: "collide with deprecated"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "A parameter definition already exists for this subject and property key.",
      requestId: "mock",
      details: { parameterSpecId: "spec-deprecated-legacy", lifecycle: "deprecated" }
    });
  });
});
