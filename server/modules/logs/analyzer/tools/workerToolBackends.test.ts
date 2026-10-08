import { readFile } from "node:fs/promises";

import { expect, it, vi } from "vitest";

import type { RelatedParameterRunSnapshot } from "../../relatedParameter";
import type { Queryable } from "../../../../shared/database/client";
import { createWorkerLogAnalysisToolBackends } from "./workerToolBackends";

const snapshot = {
  schemaVersion: 1,
  propertyKey: "pressure.limit",
  pin: {
    kind: "canonical-pin",
    organizationId: "org-1",
    projectId: "project-1",
    bindingId: "binding-1",
    definitionId: "definition-1",
    definitionRevisionId: "revision-1",
    payload: { kind: "number", value: 42 }
  },
  revision: {},
  sourcePin: {}
} as unknown as RelatedParameterRunSnapshot;

it("serves the frozen canonical context without making a database parameter read", async () => {
  const query = vi.fn();
  const tools = createWorkerLogAnalysisToolBackends({
    db: { query } as unknown as Queryable,
    organizationId: "org-1",
    relatedParameterId: "binding-1",
    relatedParameterSnapshot: snapshot
  });

  await expect(tools.loadRelatedParameterContext?.()).resolves.toMatchObject({
    parameterId: "binding-1",
    name: "pressure.limit",
    projectId: "project-1",
    currentValue: "42",
    protectedReference: {
      kind: "canonical-pin",
      bindingId: "binding-1",
      definitionId: "definition-1",
      definitionRevisionId: "revision-1"
    },
    snapshot
  });
  expect(query).not.toHaveBeenCalled();
});

it("fails closed when the related binding has no matching frozen snapshot", () => {
  const db = { query: vi.fn() } as unknown as Queryable;
  expect(() => createWorkerLogAnalysisToolBackends({ db, organizationId: "org-1", relatedParameterId: "binding-1" })).toThrow(
    /snapshot is unavailable/
  );
  expect(() =>
    createWorkerLogAnalysisToolBackends({
      db,
      organizationId: "org-1",
      relatedParameterId: "binding-2",
      relatedParameterSnapshot: snapshot
    })
  ).toThrow(/does not match/);
});

it("exposes exact frozen history without reading live parameter data", async () => {
  const query = vi.fn();
  const recentChanges = [{
    valueId: "value-1",
    payload: { kind: "number" as const, value: 41 },
    definitionRevisionId: "revision-1",
    effectiveRevisionId: "revision-1",
    source: { sourceRef: "source-1", configRevisionId: "config-1" },
    sourcePin: { ...snapshot.sourcePin, sourcePinId: "pin-1", projectValueId: "value-1", configRevisionId: "config-1" },
    valueState: "present" as const,
    changedAt: "2026-10-07T00:00:00.000Z"
  }];
  const tools = createWorkerLogAnalysisToolBackends({
    db: { query } as unknown as Queryable,
    organizationId: "org-1",
    relatedParameterId: "binding-1",
    relatedParameterSnapshot: { ...snapshot, recentChanges }
  });
  expect((await tools.loadRelatedParameterContext?.())?.recentChanges).toEqual([{ ...recentChanges[0], value: "41" }]);
  expect(query).not.toHaveBeenCalled();
});

it("keeps old snapshots without history readable and unrelated logs unbound", async () => {
  const db = { query: vi.fn() } as unknown as Queryable;
  const tools = createWorkerLogAnalysisToolBackends({
    db, organizationId: "org-1", relatedParameterId: "binding-1", relatedParameterSnapshot: snapshot
  });
  expect(await tools.loadRelatedParameterContext?.()).not.toHaveProperty("recentChanges");
  expect(createWorkerLogAnalysisToolBackends({ db, organizationId: "org-1" }).loadRelatedParameterContext).toBeUndefined();
});

it("wires the default production analyzer to the snapshot-only worker binder", async () => {
  const analyzerSource = await readFile(new URL("../analyzerFromEnv.ts", import.meta.url), "utf8");
  expect(analyzerSource).toContain('from "./tools/workerToolBackends"');
  expect(analyzerSource).not.toContain('from "./tools/dbToolBackends"');
});
