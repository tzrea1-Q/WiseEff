import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRootPostgresPool } from "../../../shared/database/client";
import { publishSourceRevisionLifecycleFixture, setSourceRevisionRegistrationStatus } from "../../../testing/parameterCatalog/sourceRevision";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createSourceAdminFixture, sourceAdminText } from "../../parameter-files/sourceAdministration.testHelpers";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import {
  exportCanonicalBindingSource, findCatalogBindingRow, listCanonicalInitializationBindingCandidates,
  listCatalogBindingRowsForProject, listCatalogBindingsForImport, loadPublishedCatalog, readCanonicalBindingChangeHistory,
} from "../catalogProjectValueSync";
import { registerCatalogProjectValueConsumerRoutes } from "../catalogProjectValueRoutes";
import { countSourceBackedBindingsByProject } from "../dashboardRead";
import { readOwnedCurrentBinding } from "../values";
import { readCanonicalCompareRows } from "./dts";
import { readCurrentManagedSourceBindingIds } from "./currentManagedBindings";
import { createRouter } from "../../../shared/http/router";
import { createHttpServer } from "../../../shared/http/server";
import { requestJson } from "../../../test/testClient";
import { registerParameterCatalogApi } from "../../parameter-catalog-api/productionWire";
import { catalogProjectConfigurationsResponseSchema } from "../../contracts/dtoSchemas/parameterCatalog";

describe("current managed source reads (PostgreSQL API role)", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  let bindingId: string, valueId: string, registrationId: string, definitionId: string;

  beforeAll(async () => {
    f = await createSourceAdminFixture("managed-read", createUserInvocation);
    const row = (await f.api.query<{ id: string; current_value_id: string; registration_id: string; definition_id: string }>(
      `select id,current_value_id,registration_id,definition_id from parameter_catalog.current_project_parameter_bindings
       where organization_id=$1 and project_id=$2`, [f.organizationId, f.projectId])).rows[0]!;
    bindingId = row.id; valueId = row.current_value_id; registrationId = row.registration_id; definitionId = row.definition_id;
  }, 120_000);

  afterAll(async () => { await f?.close(); });

  const scope = () => ({ organizationId: f.organizationId, projectId: f.projectId, bindingId });
  const candidates = () => listCanonicalInitializationBindingCandidates(f.api, {
    organizationId: f.organizationId, projectIds: [f.projectId], bindingIds: [bindingId],
  });
  const importCandidates = () => listCatalogBindingsForImport(f.api, {
    ...scope(), names: ["iin_max"], definitionIds: [definitionId],
  });

  it("shows active current pins consistently without broadening tenant scope", async () => {
    expect((await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).map(row => row.id)).toEqual([bindingId]);
    expect((await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId, limit: 1 })).map(row => row.id)).toEqual([bindingId]);
    expect((await candidates()).map(row => row.sourceBindingId)).toEqual([bindingId]);
    expect((await importCandidates()).map(row => row.projectParameterValueId)).toEqual([bindingId]);
    expect(await findCatalogBindingRow(f.api, scope())).toMatchObject({ id: bindingId });
    expect(await readCanonicalCompareRows(f.api, scope())).toEqual([]);
    expect((await countSourceBackedBindingsByProject(f.api, f.organizationId)).get(f.projectId)).toBe(1);
    expect(await exportCanonicalBindingSource(f.api, f.storage, f.auth, scope())).toMatchObject({ currentValueId: valueId });
    expect(await readCurrentManagedSourceBindingIds(f.api, { ...scope(), bindingIds: [bindingId], organizationId: "other-org" })).toEqual(new Set());
  });

  it("hides retired values from every current surface while retaining exact owner and history reads", async () => {
    const pool = getRootPostgresPool(f.api)!;
    const history = await readCanonicalBindingChangeHistory(pool, scope());
    const historicalExport = await exportCanonicalBindingSource(f.api, f.storage, f.auth, { ...scope(), projectValueId: valueId });
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId, status: "retired" });
    try {
      expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toEqual([]);
      expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId, limit: 1 })).toEqual([]);
      expect(await candidates()).toEqual([]);
      expect(await importCandidates()).toEqual([]);
      expect(await findCatalogBindingRow(f.api, scope())).toBeNull();
      expect(await readCanonicalCompareRows(f.api, scope())).toBeNull();
      expect((await countSourceBackedBindingsByProject(f.api, f.organizationId)).get(f.projectId)).toBeUndefined();
      expect(await exportCanonicalBindingSource(f.api, f.storage, f.auth, scope())).toBeNull();
      expect(await readOwnedCurrentBinding(f.api, scope())).toMatchObject({ status: "current", binding: { currentValueId: valueId } });
      expect(await readCanonicalBindingChangeHistory(pool, scope())).toEqual(history);
      expect(await exportCanonicalBindingSource(f.api, f.storage, f.auth, { ...scope(), projectValueId: valueId })).toEqual(historicalExport);
    } finally {
      await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId, status: "active" });
    }
    expect((await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).map(row => row.id)).toEqual([bindingId]);
    expect((await candidates()).map(row => row.sourceBindingId)).toEqual([bindingId]);
    expect((await importCandidates()).map(row => row.projectParameterValueId)).toEqual([bindingId]);
    expect((await countSourceBackedBindingsByProject(f.api, f.organizationId)).get(f.projectId)).toBe(1);
  });

  it("keeps an eligible exact pin current after an unrelated configuration parse", async () => {
    const pin = (await f.api.query<{ config_revision_id: string; file_version_id: string }>(
      `select config_revision_id,file_version_id from parameter_catalog.project_value_source_pins
       where binding_id=$1 and project_value_id=$2`, [bindingId, valueId])).rows[0]!;
    const newer = await ingestConfigRevision(f.db, {
      organizationId: f.organizationId, projectId: f.projectId, configSetId: f.configSetId,
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
      members: [{ fileId: f.fileId, fileVersionId: pin.file_version_id, fileName: "board.dts",
        sourceName: "board.dts", role: "base", sortOrder: 0, content: sourceAdminText }],
    }, f.auth);
    expect(newer.id).not.toBe(pin.config_revision_id);
    for (const limit of [undefined, 1]) {
      expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId, limit }))
        .toMatchObject([{ id: bindingId, currentValueId: valueId, rawValue: "<36>" }]);
    }
    expect((await candidates()).map(row => row.sourceBindingId)).toEqual([bindingId]);
    expect((await importCandidates()).map(row => row.projectParameterValueId)).toEqual([bindingId]);
    expect(await findCatalogBindingRow(f.api, scope())).toMatchObject({ id: bindingId });
    expect(await readCurrentManagedSourceBindingIds(f.api, { ...scope(), bindingIds: [bindingId] })).toEqual(new Set([bindingId]));
    expect((await countSourceBackedBindingsByProject(f.api, f.organizationId)).get(f.projectId)).toBe(1);
    expect(await exportCanonicalBindingSource(f.api, f.storage, f.auth, scope()))
      .toMatchObject({ currentValueId: valueId, configRevisionId: pin.config_revision_id });
  });

  it("returns current configuration and excludes a retired registration over HTTP with the PostgreSQL API role", async () => {
    const read = async (query = "") => {
      const router = createRouter();
      registerParameterCatalogApi(router, { db: f.api, objectStore: f.storage, resolveAuth: () => f.auth });
      return requestJson(createHttpServer(router), `/api/v2/catalog/definitions/${definitionId}/project-configurations${query}`);
    };
    const active = await read(`?selectedBindingId=${bindingId}`);
    expect(active.status).toBe(200);
    const body = catalogProjectConfigurationsResponseSchema.parse(active.body);
    expect(body.summary).toEqual({ configuredProjectCount: 1, configuredInstanceCount: 1 });
    expect(body.selected?.rawValue).toBe("<36>");
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId, status: "retired" });
    try {
      const retired = await read();
      expect(retired.status).toBe(200);
      expect(catalogProjectConfigurationsResponseSchema.parse(retired.body)).toMatchObject({
        summary: { configuredProjectCount: 0, configuredInstanceCount: 0 }, items: [],
      });
    } finally {
      await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId, status: "active" });
    }
  });
});

describe.each(["definition", "subject"] as const)("current project surfaces after %s publication", target => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  beforeAll(async () => { f = await createSourceAdminFixture(`current-${target}`, createUserInvocation); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("hides retired current values and restores them without changing exact history or source", async () => {
    const row = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId: row.id };
    const router = createRouter();
    registerCatalogProjectValueConsumerRoutes(router, { db: f.api, objectStore: f.storage, getCurrentAuthContext: () => f.auth });
    const read = <T,>(path: string) => requestJson<T>(createHttpServer(router), path);
    const projectPath = `/api/v2/projects/${f.projectId}/parameter-bindings`;
    const exportPath = `${projectPath}/${row.id}/export?projectValueId=${row.currentValueId}`;
    const historyPath = `${projectPath}/${row.id}/change-history`;
    const historicalExport = await read(exportPath);
    const history = await read(historyPath);
    expect(historicalExport.status).toBe(200);
    expect(history.status).toBe(200);
    const checkCurrent = async (visible: boolean) => {
      const response = await read<{ items: Array<{ id: string; currentValueId: string; rawValue: string }> }>(projectPath);
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual(visible ? [expect.objectContaining({ id: row.id, currentValueId: row.currentValueId, rawValue: "<36>" })] : []);
      for (const limit of [undefined, 1]) {
        expect((await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId, limit })).map(item => item.id))
          .toEqual(visible ? [row.id] : []);
      }
      expect((await listCanonicalInitializationBindingCandidates(f.api, { organizationId: f.organizationId,
        projectIds: [f.projectId], bindingIds: [row.id] })).map(item => item.sourceBindingId)).toEqual(visible ? [row.id] : []);
      expect((await listCatalogBindingsForImport(f.api, { ...scope, names: ["iin_max"], definitionIds: [row.definitionId] }))
        .map(item => item.projectParameterValueId)).toEqual(visible ? [row.id] : []);
      expect(await findCatalogBindingRow(f.api, scope)).toEqual(visible ? expect.objectContaining({ id: row.id }) : null);
      expect(await readCanonicalCompareRows(f.api, scope)).toEqual(visible ? [] : null);
      expect((await countSourceBackedBindingsByProject(f.api, f.organizationId)).get(f.projectId)).toBe(visible ? 1 : undefined);
      expect((await read(exportPath)).body).toEqual(historicalExport.body);
      expect((await read(historyPath)).body).toEqual(history.body);
    };
    const current = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!current) throw new Error("Current Catalog unavailable");
    await checkCurrent(true);
    const retired = await publishSourceRevisionLifecycleFixture(f.db, current.release, { target, lifecycle: "retired" });
    await checkCurrent(false);
    await publishSourceRevisionLifecycleFixture(f.db, retired.release, { target, lifecycle: "active", previousBundle: retired.bundle });
    await checkCurrent(true);
  }, 120_000);
});

describe("deprecated current definitions", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  beforeAll(async () => { f = await createSourceAdminFixture("current-deprecated", createUserInvocation); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("keeps the bound exact revision visible after a deprecated head is published", async () => {
    const before = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(before).toHaveLength(1);
    const current = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!current) throw new Error("Current Catalog unavailable");
    await publishSourceRevisionLifecycleFixture(f.db, current.release, { target: "definition", lifecycle: "deprecated" });
    const after = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(after).toMatchObject([{ id: before[0]!.id, currentValueId: before[0]!.currentValueId, rawValue: "<36>" }]);
    expect((await countSourceBackedBindingsByProject(f.api, f.organizationId)).get(f.projectId)).toBe(1);
  }, 120_000);
});
