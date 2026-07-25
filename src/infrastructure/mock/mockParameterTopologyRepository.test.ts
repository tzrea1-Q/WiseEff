import { describe, expect, it } from "vitest";

import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
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
    expect(activated.currentVersion).toBe(2);
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
});
