import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./apiClient";
import { createHttpDtsReloadRepository } from "./dtsReloadClient";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function fetchQueue(...bodies: unknown[]) {
  return vi.fn(async () => response(bodies.shift()));
}

const pinnedCandidate = {
  bindingId: "binding-1",
  projectId: "aurora",
  propertyKey: "watchdog_time",
  displayName: "Watchdog",
  module: "charger",
  moduleId: "mod-charger",
  nodePath: "/amba/i2c@1/dev@6E",
  compatible: "sc8562",
  baselineValue: "<6000>",
  description: "Watchdog timeout",
  valueShapeKind: "cells",
  resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
  unit: "ms",
  constraints: { min: 0, max: 20000, cells: 1 },
  debuggable: true,
  sensitiveMatch: null,
  lastReload: null,
  protectedReferencePin: {
    kind: "canonical-pin" as const,
    bindingId: "binding-1",
    configRevisionId: "crev-1",
    definitionRevisionId: "drev-1",
    currentValueId: "pval-1",
    catalogReleaseId: "crel-1"
  },
  writebackSourcePin: {
    kind: "source-writeback" as const,
    sourceRef: "reload-binding:binding-1",
    configRevisionId: "crev-1"
  }
};

describe("createHttpDtsReloadRepository", () => {
  it("preserves exact Binding, revision, value, and Catalog Release pins on candidates", async () => {
    const fetchMock = fetchQueue({ items: [pinnedCandidate] });
    const repository = createHttpDtsReloadRepository({
      apiClient: createApiClient({ baseUrl: "", fetchImpl: fetchMock }),
      baseUrl: ""
    });

    await expect(repository.listCandidates("aurora")).resolves.toEqual({ items: [pinnedCandidate] });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/dts-reload/projects/aurora/candidates",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("forwards exact Binding pins on start-run targets", async () => {
    const run = { id: "run-1", projectId: "aurora", status: "validated", targets: [] };
    const fetchMock = fetchQueue({ item: run });
    const repository = createHttpDtsReloadRepository({
      apiClient: createApiClient({ baseUrl: "", fetchImpl: fetchMock }),
      baseUrl: ""
    });

    await repository.startRun({
      projectId: "aurora",
      targets: [
        {
          bindingId: "binding-1",
          debugValue: "<7000>",
          definitionRevisionId: "drev-1",
          currentValueId: "pval-1",
          catalogReleaseId: "crel-1"
        }
      ]
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      targets: [
        {
          bindingId: "binding-1",
          debugValue: "<7000>",
          definitionRevisionId: "drev-1",
          currentValueId: "pval-1",
          catalogReleaseId: "crel-1"
        }
      ]
    });
  });
});
