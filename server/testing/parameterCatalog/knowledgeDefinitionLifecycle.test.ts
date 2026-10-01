import pg from "pg";
import { expect, it } from "vitest";

import {
  CatalogPageLimit, CatalogSearchText, ParameterDefinitionId, createCatalogKernel,
  jsonCatalogReleaseSource, type CatalogSnapshot,
} from "../../modules/catalog-kernel/interface";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { validCatalogReleaseBundle } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import {
  createDisposableParameterCatalogDatabase,
  installKnowledgeDefinitionLifecycleFixture,
  installKnowledgeDefinitionReferencesCatalogFixture,
  type ParameterCatalogDatabase,
} from "./index";

function definitions(snapshot: CatalogSnapshot) {
  const listed = snapshot.listDefinitions({
    selection: { kind: "all" }, scope: { kind: "all" }, lifecycles: [],
    propertyKey: { kind: "absent" }, search: { kind: "absent" },
    page: { limit: CatalogPageLimit(100), after: { kind: "absent" } },
  });
  if (listed.status !== "found") throw new Error("Knowledge fixture Definition inventory is unavailable");
  expect(listed.page.next.kind).toBe("absent");
  return listed.page.items;
}

function assertSearchPages(snapshot: CatalogSnapshot, searchTerm: string) {
  const query = {
    selection: { kind: "all" }, scope: { kind: "all" }, lifecycles: [],
    propertyKey: { kind: "absent" }, search: { kind: "present", value: CatalogSearchText(searchTerm) },
    page: { limit: CatalogPageLimit(50), after: { kind: "absent" } },
  } as const;
  const first = snapshot.listDefinitions(query);
  if (first.status !== "found") throw new Error("Knowledge fixture search is unavailable");
  expect(first.page.items).toHaveLength(50);
  expect(first.page.next.kind).toBe("present");
  const second = snapshot.listDefinitions({ ...query, page: { ...query.page, after: first.page.next } });
  if (second.status !== "found") throw new Error("Knowledge fixture second search page is unavailable");
  expect(second.page.items).toHaveLength(10);
  expect(second.page.next.kind).toBe("absent");
}

it("publishes one same-Definition deprecation, preserves pinned history and refuses the wrong predecessor", async () => {
  const database = await createDisposableParameterCatalogDatabase("kblifecycle");
  const producer = new pg.Pool({ connectionString: database.url });
  let defaultDatabase: ParameterCatalogDatabase | undefined;
  let defaultProducer: pg.Pool | undefined;
  // Existing NOLOGIN read capability, not a new runtime LOGIN or a deployed API identity.
  const reader = new pg.Pool({ connectionString: database.url, options: "-c role=catalog_baseline_reader_role" });
  try {
    defaultDatabase = await createDisposableParameterCatalogDatabase("kbdefault");
    defaultProducer = new pg.Pool({ connectionString: defaultDatabase.url });
    const producerIdentity = await producer.query("select session_user, current_user");
    const readerIdentity = await reader.query(
      "select session_user, current_user, rolsuper, rolcanlogin, rolbypassrls from pg_roles where rolname=current_user",
    );
    expect(readerIdentity.rows[0]).toMatchObject({
      session_user: producerIdentity.rows[0].session_user,
      current_user: "catalog_baseline_reader_role", rolsuper: false, rolcanlogin: false, rolbypassrls: false,
    });
    console.info("Knowledge lifecycle fixture DB identity", {
      producer: producerIdentity.rows[0], reader: readerIdentity.rows[0],
      boundary: "fixture bootstrap login / existing effective read role; not deployment or API-login acceptance",
    });

    const unchangedDefault = await installKnowledgeDefinitionReferencesCatalogFixture(defaultProducer);
    const defaultSnapshot = await createCatalogKernel(defaultProducer).loadCurrentCatalog(unchangedDefault.pin);
    if (!defaultSnapshot.ok) throw new Error(JSON.stringify(defaultSnapshot.error));
    assertSearchPages(defaultSnapshot.value, unchangedDefault.searchTerm);
    expect(defaultSnapshot.value.getDefinitionById(ParameterDefinitionId(unchangedDefault.activeDefinitionId))).toMatchObject({
      status: "found", definition: { selectedRevision: { content: { lifecycle: "active" } } },
    });
    expect(defaultSnapshot.value.getDefinitionById(ParameterDefinitionId(unchangedDefault.retiredDefinitionId))).toMatchObject({ status: "retired" });

    const fixture = await installKnowledgeDefinitionLifecycleFixture(producer);
    const kernel = createCatalogKernel(reader);
    const initial = await kernel.loadCurrentCatalog(fixture.pin);
    if (!initial.ok) throw new Error(JSON.stringify(initial.error));
    const before = definitions(initial.value);
    assertSearchPages(initial.value, fixture.searchTerm);
    const original = initial.value.getDefinitionById(ParameterDefinitionId(fixture.activeDefinitionId));
    if (original.status !== "found") throw new Error("Initial Knowledge fixture Definition is unavailable");
    expect(original).toMatchObject({
      status: "found", definition: { selectedRevision: { id: fixture.initialRevisionId, content: { lifecycle: "active" } } },
    });

    // Valid artifact, but its predecessor digest is not this installed fixture's digest.
    const unrelated = validCatalogReleaseBundle();
    const compiledUnrelated = compileCatalogRelease(unrelated);
    if (!compiledUnrelated.ok) throw new Error(JSON.stringify(compiledUnrelated.error));
    const refused = await installPublishedRelease(producer, {
      mode: "advance", source: jsonCatalogReleaseSource(unrelated),
      expectedCurrent: fixture.pin, expectedTargetDigest: compiledUnrelated.value.aggregateDigest,
    });
    expect(refused).toMatchObject({ ok: false, error: { kind: "unsupported-lineage", reason: "wrong-predecessor" } });
    expect(await kernel.resolveCatalogReleasePin(compiledUnrelated.value.release.id)).toMatchObject({
      ok: false, error: { kind: "historical-release-unavailable" },
    });
    const afterRefusal = await kernel.loadCurrentCatalog(fixture.pin);
    if (!afterRefusal.ok) throw new Error(JSON.stringify(afterRefusal.error));
    expect(definitions(afterRefusal.value)).toEqual(before);

    const advanced = await fixture.advanceToDeprecated();
    expect(advanced).toMatchObject({
      previous: fixture.pin, definitionId: fixture.activeDefinitionId,
      previousRevisionId: fixture.initialRevisionId, successorDefinitionId: fixture.successorDefinitionId,
      publicationMode: "pre-regime", activationReceipt: null, activationAudit: null,
      installOutcome: { status: "installed", mode: "advance", previous: fixture.pin, current: advanced.current },
    });
    expect(advanced.installOutcome).not.toHaveProperty("receipt");
    const current = await kernel.loadCurrentCatalog(advanced.current);
    const historical = await kernel.loadPinnedCatalog(fixture.pin);
    if (!current.ok || !historical.ok) throw new Error("Published Knowledge lifecycle snapshots are unavailable");
    expect(definitions(historical.value)).toEqual(before);
    const changed = current.value.getDefinitionById(ParameterDefinitionId(fixture.activeDefinitionId));
    expect(changed).toMatchObject({
      status: "found", definition: {
        id: fixture.activeDefinitionId, subjectId: original.definition.subjectId, propertyKey: original.definition.propertyKey,
        selectedRevision: {
          id: advanced.revisionId, revisionNumber: 2, content: { lifecycle: "deprecated" },
      } },
    });
    expect(current.value.getDefinitionById(ParameterDefinitionId(fixture.successorDefinitionId))).toMatchObject({
      status: "found", definition: {
        subjectId: original.definition.subjectId, selectedRevision: { content: { lifecycle: "active" } },
      },
    });
    const after = definitions(current.value);
    expect(after.map((definition) => definition.id)).toEqual(before.map((definition) => definition.id));
    expect(after.filter((definition) => definition.id !== fixture.activeDefinitionId))
      .toEqual(before.filter((definition) => definition.id !== fixture.activeDefinitionId));
    assertSearchPages(current.value, fixture.searchTerm);
    // The public Definition DTO omits successorDefinitionId; its test owner checks
    // this exact immutable revision field without adding a new production DTO.
    const persistedSuccessor = await reader.query(
      "select content->>'successorDefinitionId' as successor_id from parameter_catalog.definition_revisions where id=$1 and definition_id=$2",
      [advanced.revisionId, fixture.activeDefinitionId],
    );
    expect(persistedSuccessor.rows).toEqual([{ successor_id: fixture.successorDefinitionId }]);
    expect(await kernel.loadCurrentCatalog(fixture.pin)).toMatchObject({ ok: false });
    const replayed = await fixture.advanceToDeprecated();
    expect(replayed.installOutcome).toMatchObject({ status: "already-current" });
    const afterReplay = await kernel.loadCurrentCatalog(advanced.current);
    if (!afterReplay.ok) throw new Error(JSON.stringify(afterReplay.error));
    expect(definitions(afterReplay.value)).toEqual(after);
  } finally {
    await Promise.all([reader.end(), producer.end(), defaultProducer?.end()]);
    await Promise.all([database.close(), defaultDatabase?.close()]);
  }
});
