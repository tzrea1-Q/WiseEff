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

  it("listMappingTasks never fabricates legacy identity mapping tasks in mock mode", async () => {
    const repo = createRepo();
    await expect(repo.listMappingTasks()).resolves.toEqual([]);
    await expect(repo.listMappingTasks(PROJECT_ID)).resolves.toEqual([]);
    await expect(repo.listMappingTasks("project-other")).resolves.toEqual([]);
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

  it("createBindingDraft mutate through the public port", async () => {
    const repo = createRepo();
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

  it("does not expose withdrawn Spec governance or mock minting", () => {
    const repo = createRepo();
    for (const method of [
      "createParameterSpec",
      "listSpecs",
      "getSpec",
      "activateParameterSpec",
      "updateParameterSpec",
      "deprecateParameterSpec",
      "restoreParameterSpec",
      "reattributeParameterSpec",
      "listSpecReviewTasks"
    ]) {
      expect(repo).not.toHaveProperty(method);
    }
  });

});
