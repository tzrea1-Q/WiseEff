import { describe, expect, it, vi } from "vitest";

import { WiseEffApiError, createApiClient } from "./apiClient";
import {
  bindingFromDto,
  createHttpParameterTopologyRepository,
  isParameterTopologyStaleRevisionError,
  isParameterTopologyValidationError,
  mapParameterTopologyError,
  specDetailFromDto,
  type ProjectBindingDto,
  type ParameterSpecDetailDto
} from "./parameterTopologyClient";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function fetchQueue(...bodies: unknown[]) {
  return vi.fn(async () => response(bodies.shift()));
}

const bindingDto: ProjectBindingDto = {
  id: "binding-1",
  parameterSpecId: "spec-1",
  parameterSpecVersionId: "spec-ver-1",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  logicalNodeId: "logical-1",
  instanceName: "sc8562@6E",
  locator: "/amba/i2c@FDF5E000/sc8562@6E",
  effectiveValue: {
    kind: "cells",
    bits: 32,
    groups: [[{ kind: "integer", raw: "0", value: "0" }]]
  },
  rawValue: "<0>",
  schemaState: "valid",
  policyState: "pass"
};

const specDetailDto: ParameterSpecDetailDto = {
  id: "spec-1",
  organizationId: null,
  sourceKind: "dts",
  specificationKey: "sc8562/gpio_int",
  propertyKey: "gpio_int",
  driverModule: "sc8562",
  lifecycle: "active",
  currentVersionId: "spec-ver-1",
  currentVersion: 1,
  displayName: "GPIO interrupt",
  description: "Interrupt pin",
  valueShape: { kind: "cells" },
  schemaDefault: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "0", value: "0" }]] },
  exampleValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "1", value: "1" }]] },
  schemaNamespace: "vendor,sc8562",
  units: null,
  constraints: null,
  documentation: null,
  compatiblePatterns: ["vendor,sc8562"],
  policyTarget: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "2", value: "2" }]] }
};

describe("parameterTopologyClient DTO mapping", () => {
  it("maps binding identity fields separately and never invents recommendedValue", () => {
    expect(bindingFromDto(bindingDto)).toMatchObject({
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      instanceName: "sc8562@6E",
      locator: "/amba/i2c@FDF5E000/sc8562@6E"
    });
    expect(bindingFromDto(bindingDto)).not.toHaveProperty("recommendedValue");
    expect(bindingFromDto(bindingDto).effectiveValue).toEqual(bindingDto.effectiveValue);
  });

  it("keeps exampleValue, schemaDefault, and policyTarget separate on specs", () => {
    const mapped = specDetailFromDto(specDetailDto);
    expect(mapped).toMatchObject({
      organizationId: null,
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      exampleValue: specDetailDto.exampleValue,
      schemaDefault: specDetailDto.schemaDefault,
      policyTarget: specDetailDto.policyTarget
    });
    expect(mapped).not.toHaveProperty("recommendedValue");
    expect(mapped.exampleValue).not.toEqual(mapped.schemaDefault);
    expect(mapped.schemaDefault).not.toEqual(mapped.policyTarget);
  });
});

describe("createHttpParameterTopologyRepository", () => {
  it("lists bindings via v2 project bindings and maps DTOs", async () => {
    const fetchMock = fetchQueue({ items: [bindingDto] });
    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    const items = await repository.listBindings("project-1", "rev-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v2/projects/project-1/parameter-bindings?revisionId=rev-1",
      expect.objectContaining({ method: "GET" })
    );
    expect(items[0]).toMatchObject({
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      instanceName: "sc8562@6E",
      locator: "/amba/i2c@FDF5E000/sc8562@6E"
    });
    expect(items[0]).not.toHaveProperty("recommendedValue");
  });

  it("loads topology source/effective views", async () => {
    const topology = {
      view: "effective" as const,
      revisionId: "rev-1",
      configSetId: "cs-1",
      projectId: "project-1",
      nodes: [
        {
          id: "lnr-1",
          logicalNodeId: "ln-1",
          locator: "/amba/i2c@FDF5E000/sc8562@6E",
          name: "sc8562",
          unitAddress: "6E",
          compatible: "vendor,sc8562",
          parentLogicalNodeId: null,
          effects: []
        }
      ]
    };
    const fetchMock = fetchQueue({ item: topology });
    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    const result = await repository.getTopology("project-1", "cs-1", "rev-1", "effective");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v2/projects/project-1/config-sets/cs-1/revisions/rev-1/topology?view=effective",
      expect.objectContaining({ method: "GET" })
    );
    expect(result.view).toBe("effective");
    expect(result.nodes[0]?.locator).toBe("/amba/i2c@FDF5E000/sc8562@6E");
  });

  it("lists and resolves identity mapping tasks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          items: [
            {
              id: "map-1",
              projectId: "project-1",
              configRevisionId: "rev-1",
              previousLogicalNodeId: null,
              candidateLogicalNodeIds: ["ln-a", "ln-b"],
              status: "open",
              reason: null,
              createdAt: "2026-07-16T00:00:00.000Z",
              resolvedAt: null
            }
          ]
        })
      )
      .mockResolvedValueOnce(response({ item: { id: "map-1", status: "resolved", selectedLogicalNodeId: "ln-a" } }));

    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    const tasks = await repository.listMappingTasks("project-1");
    expect(tasks[0]?.id).toBe("map-1");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/v2/identity-mapping-tasks?projectId=project-1");

    await repository.resolveMapping("map-1", {
      decision: "resolved",
      selectedLogicalNodeId: "ln-a",
      reason: "Same board instance"
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://api.test/api/v2/identity-mapping-tasks/map-1/resolve");
  });

  it("validates a config revision", async () => {
    const fetchMock = fetchQueue({
      item: {
        id: "run-1",
        status: "passed",
        stage: "toolchain",
        artifactHashes: { revisionId: "rev-1", stage: "toolchain" }
      }
    });
    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    const run = await repository.validateRevision("project-1", "rev-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v2/projects/project-1/config-revisions/rev-1/validate",
      expect.objectContaining({ method: "POST" })
    );
    expect(run).toMatchObject({ id: "run-1", status: "passed", stage: "toolchain" });
  });

  it("creates a typed binding draft via v2 drafts API", async () => {
    const fetchMock = fetchQueue({
      item: {
        draftId: "draft-1",
        parameterId: "binding-1",
        candidateRevisionId: "rev-2",
        rawText: "<3000>",
        action: "set",
        parameterSpecId: "spec-1",
        projectParameterBindingId: "binding-1",
        writeTarget: { role: "overlay", propertyKey: "iin_max", targetRef: "charging_core" },
        overlayFileId: "file-1",
        overlayFileName: "overlay.dts"
      }
    });
    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    const draft = await repository.createBindingDraft("project-1", "binding-1", {
      baseRevisionId: "rev-1",
      targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "3000", value: "3000" }]] },
      reason: "Raise limit"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/api/v2/projects/project-1/parameter-bindings/binding-1/drafts",
      expect.objectContaining({ method: "POST" })
    );
    expect(draft).toMatchObject({
      draftId: "draft-1",
      parameterId: "binding-1",
      candidateRevisionId: "rev-2",
      action: "set",
      projectParameterBindingId: "binding-1"
    });
  });

  it("lists and gets parameter specs without path identity or recommendedValue", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          items: [
            {
              id: "spec-1",
              sourceKind: "dts",
              specificationKey: "sc8562/gpio_int",
              propertyKey: "gpio_int",
              driverModule: "sc8562",
              lifecycle: "active",
              currentVersionId: "spec-ver-1",
              currentVersion: 1
            }
          ]
        })
      )
      .mockResolvedValueOnce(response({ item: specDetailDto }));

    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    const specs = await repository.listSpecs({ propertyKey: "gpio_int", driverModule: "sc8562" });
    expect(specs[0]).toMatchObject({ propertyKey: "gpio_int", driverModule: "sc8562" });
    expect(specs[0]).not.toHaveProperty("path");
    expect(specs[0]).not.toHaveProperty("recommendedValue");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("propertyKey=gpio_int");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("driverModule=sc8562");

    const detail = await repository.getSpec("spec-1");
    expect(detail.exampleValue).toEqual(specDetailDto.exampleValue);
    expect(detail.schemaDefault).toEqual(specDetailDto.schemaDefault);
    expect(detail.policyTarget).toEqual(specDetailDto.policyTarget);
    expect(detail).not.toHaveProperty("recommendedValue");
  });

  it("lists and resolves parameter spec review tasks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          items: [
            {
              id: "task-1",
              status: "open",
              propertyKey: "gpio_int",
              driverModule: "vendor,sc8562",
              evidence: ["ambiguous"],
              candidates: [{ id: "pspec:a", label: "vendor,sc8562 / gpio_int" }],
              ambiguous: false,
              projectCount: 1,
              createdAt: "2026-07-16T01:00:00.000Z"
            }
          ],
          nextCursor: "cursor-1"
        })
      )
      .mockResolvedValueOnce(response({ item: { id: "task-1", status: "resolved" } }));

    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    const listed = await repository.listSpecReviewTasks({ status: "open", limit: 20 });
    expect(listed.items[0]).toMatchObject({ id: "task-1", propertyKey: "gpio_int" });
    expect(listed.nextCursor).toBe("cursor-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/v2/parameter-spec-review-tasks");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("status=open");

    await repository.resolveSpecReviewTask("task-1", {
      decision: "resolved",
      parameterSpecId: "pspec:a",
      reason: "ok"
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/api/v2/parameter-spec-review-tasks/task-1/resolve"
    );

    const resolveBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body));
    expect(resolveBody).toMatchObject({
      decision: "resolved",
      parameterSpecId: "pspec:a",
      reason: "ok"
    });
  });

  it("forwards confirmPropertyMismatch and createSpec on resolve", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ item: { id: "task-2", status: "resolved" } }));

    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    await repository.resolveSpecReviewTask("task-2", {
      decision: "resolved",
      createSpec: true,
      reason: "create from review",
      confirmPropertyMismatch: true
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    expect(body).toEqual({
      decision: "resolved",
      createSpec: true,
      reason: "create from review",
      confirmPropertyMismatch: true
    });
  });

  it("preserves WiseEffApiError for stale-revision and structured diagnostics", async () => {
    const fetchMock = vi.fn(async () =>
      response(
        {
          error: {
            code: "CONFLICT",
            message: "Base config revision is stale for this binding.",
            details: { reason: "stale-revision", bindingId: "binding-1", baseRevisionId: "rev-old" },
            requestId: "req-1"
          }
        },
        409
      )
    );
    const repository = createHttpParameterTopologyRepository(
      createApiClient({ baseUrl: "http://api.test", fetchImpl: fetchMock })
    );

    await expect(repository.listBindings("project-1", "rev-old")).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(WiseEffApiError);
      expect(isParameterTopologyStaleRevisionError(error)).toBe(true);
      const mapped = mapParameterTopologyError(error);
      expect(mapped).toMatchObject({
        kind: "stale-revision",
        reason: "stale-revision",
        bindingId: "binding-1",
        baseRevisionId: "rev-old"
      });
      expect(typeof mapped).not.toBe("string");
      return true;
    });
  });

  it("preserves structured validation diagnostics instead of collapsing to a string", async () => {
    const diagnostics = [
      { severity: "error", code: "schema-constraint", message: "gpio_int must be a phandle", path: "gpio_int" }
    ];
    const error = new WiseEffApiError("VALIDATION_FAILED", "Schema validation failed.", { diagnostics }, "req-2");
    expect(isParameterTopologyValidationError(error)).toBe(true);
    const mapped = mapParameterTopologyError(error);
    expect(mapped).toMatchObject({
      kind: "diagnostics",
      diagnostics
    });
    expect(typeof mapped).not.toBe("string");
  });

  it("surfaces abort/cancellation without converting it to a generic failure string", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const mapped = mapParameterTopologyError(abortError);
    expect(mapped).toMatchObject({ kind: "cancelled" });
    expect(typeof mapped).not.toBe("string");
  });
});
