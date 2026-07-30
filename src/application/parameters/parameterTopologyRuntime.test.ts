import { describe, expect, it, vi } from "vitest";

import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterSpecSummary } from "@/domain/parameter-topology/types";
import { createParameterTopologyRuntime } from "./parameterTopologyRuntime";

const MOCK_SPEC: ParameterSpecSummary = {
  id: "spec-sc8562-gpio-int",
  organizationId: "org-teaching",
  sourceKind: "dts",
  specificationKey: "dts/sc8562/gpio_int",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  lifecycle: "active",
  currentVersionId: "specver-sc8562-gpio-int-3",
  currentVersion: 3,
  valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 3 },
  compatiblePatterns: ["vendor,sc8562"],
  attributionModules: [{ id: "mod-charge", name: "充电策略", kind: "driver-group" }]
};

function createRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return {
    listSpecs: vi.fn().mockResolvedValue([MOCK_SPEC]),
    getSpec: vi.fn(),
    activateParameterSpec: vi.fn(),
    updateParameterSpec: vi.fn(),
    listSpecReviewTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    resolveSpecReviewTask: vi.fn().mockResolvedValue(undefined),
    listBindings: vi.fn().mockResolvedValue([]),
    getTopology: vi.fn(),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    resolveMapping: vi.fn().mockResolvedValue(undefined),
    validateRevision: vi.fn(),
    createBindingDraft: vi.fn(),
    ...overrides
  };
}

describe("createParameterTopologyRuntime", () => {
  it("accepts mock runtime mode when a repository is provided and listSpecs works", async () => {
    const dispatch = vi.fn();
    const repository = createRepository();
    const runtime = createParameterTopologyRuntime({
      runtimeMode: "mock",
      dispatch,
      repository
    });

    const result = await runtime.listSpecs({});

    expect(result).toEqual({ ok: true, value: [MOCK_SPEC] });
    expect(repository.listSpecs).toHaveBeenCalledWith({});
    expect(dispatch).toHaveBeenCalledWith({
      type: "TOPOLOGY_SPECS_READY",
      specs: [MOCK_SPEC]
    });
  });
});
