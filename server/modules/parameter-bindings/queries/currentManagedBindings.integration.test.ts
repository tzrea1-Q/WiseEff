import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRootPostgresPool } from "../../../shared/database/client";
import { setSourceRevisionRegistrationStatus } from "../../../testing/parameterCatalog/sourceRevision";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createSourceAdminFixture } from "../../parameter-files/sourceAdministration.testHelpers";
import {
  exportCanonicalBindingSource, findCatalogBindingRow, listCanonicalInitializationBindingCandidates,
  listCatalogBindingRowsForProject, listCatalogBindingsForImport, readCanonicalBindingChangeHistory,
} from "../catalogProjectValueSync";
import { countSourceBackedBindingsByProject } from "../dashboardRead";
import { readOwnedCurrentBinding } from "../values";
import { readCanonicalCompareRows } from "./dts";
import { readCurrentManagedSourceBindingIds } from "./currentManagedBindings";

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
  });
});
