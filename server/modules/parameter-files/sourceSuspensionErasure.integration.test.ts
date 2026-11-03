import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRootPostgresPool } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { publishSourceRevisionLifecycleFixture, readSourceRevisionBindingState, setSourceRevisionRegistrationStatus } from "../../testing/parameterCatalog/sourceRevision";
import { createUserInvocation } from "../auth/trustedInvocation";
import { listCatalogBindingRowsForProject, loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { loadOwnedProjectValueSourcePin, readOwnedCurrentBinding } from "../parameter-bindings/values";
import { deleteDefinition, previewDefinitionDeletion } from "../parameter-catalog-api/definitionDeletion/service";
import { createSourceAdminFixture, sourceAdminText } from "./sourceAdministration.testHelpers";

const ERASED = "pdef_acme_power_iin_max";
const SURVIVING = "pdef_acme_power_iin_min";

describe("independent suspension evidence survives another definition's real purge", { timeout: 120_000 }, () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  beforeAll(async () => {
    f = await createSourceAdminFixture("ret-purge", createUserInvocation);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Current Catalog unavailable");
    await publishSourceRevisionLifecycleFixture(f.db, catalog.release, { target: "definition", lifecycle: "active",
      includeManagedSibling: true, retainArtifactForErasure: true });
    await (await f.stage(sourceAdminText.replace("iin_max = <36>;", "iin_max = <36>; iin_min = <12>;"), "initialize-purge-sibling")).apply();
  }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("purges X and its shared source request while Y resumes from latest DTS with its original identity", async () => {
    const rows = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(rows).toHaveLength(2);
    const erased = rows.find(row => row.definitionId === ERASED)!;
    const survivor = rows.find(row => row.definitionId === SURVIVING)!;
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId: survivor.id };
    const original = await readOwnedCurrentBinding(f.api, scope);
    if (original.status !== "current") throw new Error("Surviving source owner unavailable");
    const before = await readSourceRevisionBindingState(f.api, scope);
    const pin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId });
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId,
      registrationId: original.binding.registrationId, status: "retired" });
    const latest = sourceAdminText.replace("iin_max = <36>;", "iin_max = <99>; iin_min = <44>;");
    const suspended = await (await f.stage(latest, "suspend-two-before-purge")).apply();
    const shared = (await f.api.query<{ source_revision_context: { excludedBindings: Array<{ bindingId: string }> } }>(
      "select source_revision_context from public.project_parameter_value_change_requests where id=$1", [suspended.requestId])).rows[0]!;
    expect(shared.source_revision_context.excludedBindings.map(entry => entry.bindingId).sort()).toEqual([erased.id, survivor.id].sort());
    expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
    const sourceBeforePurge = (await f.api.query("select current_version_id from public.project_parameter_files where id=$1", [f.fileId])).rows;
    const platformId = "ret-purge-platform";
    await f.db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Definition erasure administrator','Platform',true)", [platformId, f.organizationId]);
    await f.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ($1,$2,$3,'platform-admin')",
      ["ret-purge-platform-role", platformId, f.organizationId]);
    const platform = makeTestAuthContext({ organizationId: f.organizationId, userId: platformId, roles: [{ roleId: "platform-admin", projectId: null }] });
    const stores = { objectStore: f.storage };
    const impact = await previewDefinitionDeletion(f.api, platform, ERASED, stores);
    expect(impact.item.affected.bindings).toBe(1);
    const purged = await deleteDefinition(f.api, createUserInvocation(platform), ERASED,
      impact.item.previewToken, "purge-one-suspended-definition", stores);
    expect(purged.item).toMatchObject({ definitionId: ERASED, deleted: true, originalFilesRetained: true });
    // This must exercise the real purge's shared-request deletion, not merely
    // leave the original request available as an alternate continuity proof.
    expect((await f.api.query("select id from public.project_parameter_value_change_requests where id=$1", [suspended.requestId])).rows).toEqual([]);
    expect((await readOwnedCurrentBinding(f.api, { ...scope, bindingId: erased.id })).status).not.toBe("current");
    expect(await readOwnedCurrentBinding(f.api, scope)).toEqual(original);
    expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
    expect(await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId })).toEqual(pin);
    expect((await f.api.query("select current_version_id from public.project_parameter_files where id=$1", [f.fileId])).rows).toEqual(sourceBeforePurge);
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId,
      registrationId: original.binding.registrationId, status: "active" });
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toHaveLength(0);
    const resume = await f.stage(`${latest}\n/* surviving definition reconciles after purge */`, "resume-surviving-definition");
    const applied = await resume.apply();
    expect(await resume.apply()).toEqual(applied);
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: survivor.id, rawValue: "<44>" }]);
    const resumed = await readOwnedCurrentBinding(f.api, scope);
    if (resumed.status !== "current") throw new Error("Reconciled survivor unavailable");
    expect(resumed.binding.sourceOccurrenceId).toBe(original.binding.sourceOccurrenceId);
    expect(resumed.binding.logicalNodeId).toBe(original.binding.logicalNodeId);
    expect((await readSourceRevisionBindingState(f.api, scope)).historyCount).toBe(before.historyCount + 1);
    expect(await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId })).toEqual(pin);
  });
});
