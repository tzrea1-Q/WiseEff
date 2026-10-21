import { readFile } from "node:fs/promises";

import { expect, it, vi } from "vitest";

import type { RelatedParameterRunSnapshot } from "../../relatedParameter";
import { createDatabase, type Queryable } from "../../../../shared/database/client";
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

it("binds source tools only to a ready run snapshot and rejects another snapshot before querying", async () => {
  const query = vi.fn();
  const db = createDatabase({ query } as unknown as Queryable);
  const ready = createWorkerLogAnalysisToolBackends({ db, organizationId: "org-1", sourceSnapshot: { id: "source", status: "ready" } });
  expect(ready.searchSource).toBeTypeOf("function");
  expect(ready.readSourceRange).toBeTypeOf("function");
  await expect(ready.readSourceRange!({ snapshotId: "other", path: "power.c", startLine: 1, endLine: 80 })).resolves.toBeNull();
  expect(query).not.toHaveBeenCalled();
  for (const status of ["queued", "indexing", "failed", "archived"] as const) {
    const unavailable = createWorkerLogAnalysisToolBackends({ db, organizationId: "org-1", sourceSnapshot: { id: "source", status } });
    expect(unavailable.searchSource).toBeUndefined();
    expect(unavailable.readSourceRange).toBeUndefined();
  }
});

it("serves the frozen canonical context without making a database parameter read", async () => {
  const query = vi.fn();
  const tools = createWorkerLogAnalysisToolBackends({
    db: createDatabase({ query } as unknown as Queryable),
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

it("uses an immutable database root without wrapping query for related-parameter or knowledge search", async () => {
  const query = vi.fn(async (sql: string) => {
    expect(sql).not.toContain("ps.specification_key");
    return { rows: [], rowCount: 0 };
  });
  const db = Object.freeze({ query });
  const tools = createWorkerLogAnalysisToolBackends({
    db: createDatabase(db),
    organizationId: "org-1",
    relatedParameterId: "binding-1",
    relatedParameterSnapshot: snapshot,
    knowledgeEntryIds: ["36bb42b6-3cc6-4d57-a86c-5a684aa09c21"]
  });
  expect(await tools.loadRelatedParameterContext!()).toMatchObject({ name: snapshot.propertyKey, snapshot });
  expect(query).not.toHaveBeenCalled();
  await tools.searchDomainKnowledge!("iin_max");
  expect(db.query).toBe(query);
  expect(query.mock.calls.some(([sql]) => sql.includes("log_domain_knowledge_links"))).toBe(false);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("knowledge_entries"),
    ["org-1", "iin_max", "%iin_max%", ["36bb42b6-3cc6-4d57-a86c-5a684aa09c21"], 5]);
});

it("records only the pages of the returned PDF chunk, keeping non-PDF provenance unchanged", async () => {
  const onKnowledgeRetrieved = vi.fn();
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("knowledge_entries") ? [{
    id: "pdf", title: "PDF", content_form: "file", tags: [], search_text: "all pages",
    head_revision_id: "revision", updated_at: "2026-10-21T00:00:00.000Z",
    chunk_text: "retrieved page", chunk_revision_id: "revision", page_start: 3, page_end: 4
  }, {
    id: "markdown", title: "Notes", content_form: "markdown", tags: [], search_text: "notes",
    head_revision_id: "notes-revision", updated_at: "2026-10-21T00:00:00.000Z"
  }] : [], rowCount: 0 }));
  const tools = createWorkerLogAnalysisToolBackends({ db: createDatabase({ query } as unknown as Queryable),
    organizationId: "org-1", onKnowledgeRetrieved });
  const result = await tools.searchDomainKnowledge!("retrieved");
  expect(result.items[0]).toMatchObject({ excerpt: "retrieved page", pageStart: 3, pageEnd: 4 });
  expect(onKnowledgeRetrieved).toHaveBeenCalledWith([
    { entryId: "pdf", revisionId: "revision", pages: [3, 4] },
    { entryId: "markdown", revisionId: "notes-revision" }
  ]);
});

it("fails closed when the related binding has no matching frozen snapshot", () => {
  const db = createDatabase({ query: vi.fn() } as unknown as Queryable);
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
    db: createDatabase({ query } as unknown as Queryable),
    organizationId: "org-1",
    relatedParameterId: "binding-1",
    relatedParameterSnapshot: { ...snapshot, recentChanges }
  });
  expect((await tools.loadRelatedParameterContext?.())?.recentChanges).toEqual([{ ...recentChanges[0], value: "41" }]);
  expect(query).not.toHaveBeenCalled();
});

it("keeps old snapshots without history readable and unrelated logs unbound", async () => {
  const db = createDatabase({ query: vi.fn() } as unknown as Queryable);
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
