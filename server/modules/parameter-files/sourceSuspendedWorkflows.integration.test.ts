import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRootPostgresPool } from "../../shared/database/client";
import { publishSourceRevisionLifecycleFixture, readSourceRevisionBindingState } from "../../testing/parameterCatalog/sourceRevision";
import { createUserInvocation } from "../auth/trustedInvocation";
import { listCatalogBindingRowsForProject, loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { loadOwnedProjectValueSourcePin, readOwnedCurrentBinding } from "../parameter-bindings/values";
import { applyCanonicalBaselineRestore, previewCanonicalBaselineRestore } from "./canonicalBaselineRestore";
import { applyCanonicalMemberAddition, previewCanonicalMemberAddition } from "./canonicalMemberAddition";
import { applyAdministratorMemberRemoval, previewAdministratorMemberRemoval } from "./canonicalMemberRemoval";
import { createBaseline } from "./baselineService";
import { createCandidate } from "./candidateService";
import { evaluateReleaseReadiness } from "./releaseReadinessService";
import { createSourceAdminFixture, sourceAdminText, sourceAdminToolchain } from "./sourceAdministration.testHelpers";

// Member setup uses explicit injected compiler validation. Baseline creation and
// restoration retain the native toolchain; all mutations use the restricted API role.
describe("source workflows with suspended historical bindings", { timeout: 120_000 }, () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  let retainedBindingId: string;
  let managedBindingId: string;
  let before: Awaited<ReturnType<typeof retained>>;
  const text = sourceAdminText.replace("iin_max = <36>;", "iin_max = <80>; iin_min = <12>;");
  const options = { toolchain: sourceAdminToolchain };

  async function retained() {
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId: retainedBindingId };
    const current = await readOwnedCurrentBinding(f.api, scope);
    if (current.status !== "current") throw new Error("Retained source owner unavailable");
    return { state: await readSourceRevisionBindingState(f.api, scope),
      pin: await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: current.binding.currentValueId }) };
  }

  beforeAll(async () => {
    f = await createSourceAdminFixture("ret-flows", createUserInvocation);
    retainedBindingId = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!.id;
    before = await retained();
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Current Catalog unavailable");
    await publishSourceRevisionLifecycleFixture(f.db, catalog.release, { target: "definition", lifecycle: "retired", includeManagedSibling: true });
    await (await f.stage(text, "suspend-before-workflows")).apply();
    managedBindingId = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!.id;
    expect(managedBindingId).not.toBe(retainedBindingId);
    expect(await retained()).toEqual(before);
  }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("adds and removes an unrelated member without repinning suspended history", async () => {
    const candidate = await createCandidate(f.api, f.storage, f.auth, { projectId: f.projectId,
      fileName: "metadata.dtsi", bytes: Buffer.from('/ { unmanaged { note = "metadata"; }; };\n') });
    const body = { projectId: f.projectId, configSetId: f.configSetId, candidateId: candidate.id, role: "misc" as const, sortOrder: 1 };
    const preview = await previewCanonicalMemberAddition(f.api, f.storage, f.auth, body, f.security, options);
    const input = { ...body, proofToken: preview.proofToken, reason: "Add independent source member", clientMutationId: "suspended-member-add" };
    const added = await applyCanonicalMemberAddition(f.api, f.storage, f.auth, input, f.security, options);
    expect(await applyCanonicalMemberAddition(f.api, f.storage, f.auth, input, f.security, options)).toEqual(added);
    expect(await retained()).toEqual(before);
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: managedBindingId, rawValue: "<12>" }]);
    const target = { projectId: f.projectId, configSetId: f.configSetId, fileId: added.fileId };
    const removal = await previewAdministratorMemberRemoval(f.api, f.storage, f.auth, target, options);
    const remove = { ...target, expectedProofToken: removal.proofToken, reason: "Remove independent source member", clientMutationId: "suspended-member-remove" };
    await applyAdministratorMemberRemoval(f.api, f.storage, f.auth, remove, f.security, options);
    await applyAdministratorMemberRemoval(f.api, f.storage, f.auth, remove, f.security, options);
    expect(await retained()).toEqual(before);
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: managedBindingId, rawValue: "<12>" }]);
  });

  it("creates and restores a complete baseline while leaving suspended parameter history untouched", async () => {
    const gate = await evaluateReleaseReadiness(f.api, f.auth, { configSetId: f.configSetId }, { objectStore: f.storage });
    expect(gate.canCreateBaseline, JSON.stringify(gate)).toBe(true);
    const baseline = await createBaseline(f.api, f.auth, { configSetId: f.configSetId, name: "Managed and suspended source",
      gateToken: gate.gateToken, acknowledgedWarningIds: gate.warnings.filter(row => row.acknowledgementRequired).map(row => row.id) }, {}, { objectStore: f.storage });
    const saved = (await f.api.query("select * from public.dts_release_baseline where id=$1", [baseline.id])).rows;
    await (await f.stage(text.replace("<80>", "<99>").replace("<12>", "<22>"), "source-after-suspended-baseline")).apply();
    expect(await retained()).toEqual(before);
    const preview = await previewCanonicalBaselineRestore(f.api, f.storage, f.auth, { projectId: f.projectId, baselineId: baseline.id });
    expect(preview.canRestore, JSON.stringify(preview)).toBe(true);
    const input = { projectId: f.projectId, baselineId: baseline.id, sourceConfigRevisionId: preview.sourceConfigRevisionId,
      proofToken: preview.proofToken!, confirmCompositionChanges: true, reason: "Restore source snapshot with suspended history", clientMutationId: "restore-suspended-baseline" };
    const restored = await applyCanonicalBaselineRestore(f.api, f.storage, f.auth, input, f.security);
    expect(await applyCanonicalBaselineRestore(f.api, f.storage, f.auth, input, f.security)).toEqual(restored);
    expect(await retained()).toEqual(before);
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: managedBindingId, rawValue: "<12>" }]);
    expect((await f.api.query("select * from public.dts_release_baseline where id=$1", [baseline.id])).rows).toEqual(saved);
    const file = (await f.api.query<{ storage_key: string }>(`select version.storage_key from public.project_parameter_files file
      join public.project_parameter_file_versions version on version.id=file.current_version_id where file.id=$1`, [f.fileId])).rows[0]!;
    const bytes = await f.storage.getBounded!(file.storage_key, 1024 * 1024);
    expect(bytes.toString("utf8")).toBe(text);
    expect(bytes.toString("utf8")).not.toContain("iin_max = <36>");
  });
});
