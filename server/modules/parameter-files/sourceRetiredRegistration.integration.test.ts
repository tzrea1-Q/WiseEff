import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserInvocation } from "../auth/trustedInvocation";
import { publishSourceRevisionLifecycleFixture, readSourceRevisionBindingState, setSourceRevisionRegistrationStatus } from "../../testing/parameterCatalog/sourceRevision";
import { getRootPostgresPool } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { parseDtsValue } from "../dts/valueAst";
import { resolveDtsConfigSetAsync } from "../dts";
import { prepareReviewedSourceContinuity } from "../parameter-topology/ingestService";
import { sourceRevisionDigest } from "./sourceRevisionService";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { reviewCanonicalValueChange, submitCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import { loadOwnedProjectValueSourcePin, loadSourceBindingCohortReadOnly, readOwnedCurrentBinding, readOwnedProjectValueIdentity } from "../parameter-bindings/values";
import { listCatalogBindingRowsForProject, loadPublishedCatalog, loadRetiredOrganizationSourceRegistrations } from "../parameter-bindings/catalogProjectValueSync";
import { createSourceAdminFixture, sourceAdminText, sourceAdminToolchain } from "./sourceAdministration.testHelpers";
import { applyAdministratorMemberRemoval, previewAdministratorMemberRemoval } from "./canonicalMemberRemoval";

describe("whole-source retired registration boundaries (PostgreSQL API role, toolchain stub)", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  let bindingId: string;
  let registrationId: string;

  beforeAll(async () => {
    f = await createSourceAdminFixture("retired-dts", createUserInvocation);
    const row = (await f.db.query<{ id: string; registration_id: string }>(
      `select id,registration_id from parameter_catalog.current_project_parameter_bindings
       where organization_id=$1 and project_id=$2`, [f.organizationId, f.projectId])).rows[0]!;
    bindingId = row.id;
    registrationId = row.registration_id;
    await setRegistrationStatus("retired");
  }, 120_000);

  afterAll(async () => { await f?.close(); });

  // Fixture-only lifecycle changes exercise races without changing API privileges.
  async function setRegistrationStatus(status: "active" | "retired") {
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId, status });
  }

  function state() {
    return readSourceRevisionBindingState(f.api, { organizationId: f.organizationId, projectId: f.projectId, bindingId });
  }

  async function expectHidden() {
    for (const limit of [undefined, 20]) {
      expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId, limit })).toHaveLength(0);
    }
  }

  async function retained() {
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId };
    const current = await readOwnedCurrentBinding(f.api, scope);
    if (current.status !== "current") throw new Error("Retained DTS binding unavailable");
    const pin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: current.binding.currentValueId });
    if (!pin) throw new Error("Retained DTS source pin unavailable");
    return { binding: current.binding, pin, state: await state() };
  }

  async function request(requestId: string) {
    const result = (await f.api.query<{ source_revision_context: { excludedBindings: Array<Record<string, unknown>>; resumptions?: Array<Record<string, unknown>> };
      applied_source_result: { configRevisionId: string; results: Array<Record<string, unknown>> } }>(
      "select source_revision_context,applied_source_result from public.project_parameter_value_change_requests where id=$1", [requestId])).rows[0];
    if (!result) throw new Error("Source revision request unavailable");
    return result;
  }

  it.each([
    ["value", sourceAdminText.replace("<36>", "<42>")],
    ["property removal", sourceAdminText.replace("iin_max = <36>;", "")],
    ["compatible removal", sourceAdminText.replace("iin_max = <36>;", "/delete-property/ compatible; iin_max = <36>;")],
    ["node removal", sourceAdminText.replace('charger: charger { compatible = "acme,power"; iin_max = <36>; };', "")],
    ["subject change", sourceAdminText.replace('compatible = "acme,power"', 'compatible = "unknown,power"')]
  ])("saves retired %s changes while preserving exact historical values and pins", async (label, text) => {
    const before = await retained();
    const staged = await f.stage(text, `retired-${label}`);
    expect(staged.preview).toMatchObject({ canSubmit: true, impact: { parameterChanges: 0 } });
    const applied = await staged.apply();
    expect(await staged.apply()).toEqual(applied);
    expect(await retained()).toEqual(before);
    const saved = await request(applied.requestId);
    expect(saved.source_revision_context.excludedBindings).toContainEqual(expect.objectContaining({
      bindingId, oldValueId: before.binding.currentValueId, sourcePinId: before.pin.sourcePinId,
      registrationId, subjectId: "csub_acme_power", reason: "registration-inactive"
    }));
    expect(saved.applied_source_result.results).toEqual([]);
    expect(saved.applied_source_result.configRevisionId).not.toBe(before.pin.configRevisionId);
    await expectHidden();
    // In particular, an unknown compatible after node removal must not leave
    // its new unmanaged logical identity blocking the next ordinary save.
    const repeated = await f.stage(`${text}\n/* retained ${label} again */`, `retired-${label}-again`);
    expect(repeated.preview.impact.parameterChanges).toBe(0);
    await repeated.apply();
    expect(await retained()).toEqual(before);
    await expectHidden();
  });

  it("requires the exact unmanaged replacement and original parent tuple before restoring a suspended node", async () => {
    const original = await retained();
    const current = (await f.api.query<{ id: string }>(
      "select id from public.dts_config_revisions where config_set_id=$1 order by revision_number desc limit 1", [f.configSetId])).rows[0]!;
    const node = (await f.api.query<{ logical_node_id: string }>(
      "select logical_node_id from public.dts_logical_node_revisions where config_revision_id=$1 and node_locator='/charger'", [current.id])).rows[0]!;
    expect(node.logical_node_id).not.toBe(original.binding.logicalNodeId);
    const anchor = { baseConfigRevisionId: original.pin.configRevisionId, nodeLocator: "/charger", logicalNodeId: original.binding.logicalNodeId! };
    async function prepare(text: string, replacedUnmanagedLogicalNodeId?: string) {
      const resolved = await resolveDtsConfigSetAsync({ entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
        files: new Map([["board.dts", { content: text, fileVersionId: "replacement-preview" }]]) });
      return prepareReviewedSourceContinuity(f.api, { organizationId: f.organizationId, projectId: f.projectId,
        configSetId: f.configSetId, baseConfigRevisionId: current.id, effectiveNodes: resolved.effective.nodesByLocator,
        sourceDigest: sourceRevisionDigest(text), restorationNodes: [{ ...anchor, replacedUnmanagedLogicalNodeId }] });
    }
    await expect(prepare(sourceAdminText)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(prepare(sourceAdminText, "unrelated-node")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(prepare(sourceAdminText.replace('"test,board"', '"unknown,board"'), node.logical_node_id))
      .rejects.toMatchObject({ code: "CONFLICT", message: "待恢复节点与历史身份元组不一致。" });
    const prepared = await prepare(sourceAdminText, node.logical_node_id);
    expect(prepared.nodes.find(row => row.nodeLocator === anchor.nodeLocator)?.logicalNodeId).toBe(anchor.logicalNodeId);
    expect(await retained()).toEqual(original);
  });

  it("invalidates a retained preview after registration restoration", async () => {
    const before = await state();
    const staged = await f.stage(`${sourceAdminText}\n/* retained source */`, "retired-preview-restored");
    expect(staged.preview.canSubmit).toBe(true);
    await setRegistrationStatus("active");
    try {
      await expect(staged.apply()).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-revision-stale" } });
      expect(await state()).toEqual(before);
    } finally { await setRegistrationStatus("retired"); }
  });

  it("rechecks retirement when applying an earlier active-registration change", async () => {
    await setRegistrationStatus("active");
    try {
      const before = await state();
      const staged = await f.stage(sourceAdminText.replace("<36>", "<42>"), "active-preview-retired");
      await setRegistrationStatus("retired");
      await expect(staged.apply()).rejects.toMatchObject({
        code: "CONFLICT", details: { reason: "source-revision-stale" }
      });
      expect(await state()).toEqual(before);
    } finally { await setRegistrationStatus("retired"); }
  });

  it("applies unrelated source edits twice while preserving the retired DTS binding and value", async () => {
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId };
    const original = await readOwnedCurrentBinding(f.api, scope);
    if (original.status !== "current") throw new Error("Retained DTS binding unavailable");
    const originalValue = await readOwnedProjectValueIdentity(f.api, { ...scope, projectValueId: original.binding.currentValueId });
    const originalPin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId });
    const originalState = await state();
    for (const index of [1, 2]) {
      const staged = await f.stage(sourceAdminText.replace('"source administration"', `"source revision ${index}"`), `retained-dts-${index}`);
      expect(staged.preview.impact.parameterChanges).toBe(0);
      const receipt = await staged.apply();
      expect(await staged.apply()).toEqual(receipt);
      const current = await readOwnedCurrentBinding(f.api, scope);
      if (current.status !== "current") throw new Error("Retained DTS binding disappeared");
      expect(current.binding.registrationId).toBe(registrationId);
      expect(current.binding.sourceOccurrenceId).toBe(original.binding.sourceOccurrenceId);
      const value = await readOwnedProjectValueIdentity(f.api, { ...scope, projectValueId: current.binding.currentValueId });
      expect(value?.value.payload).toEqual(originalValue?.value.payload);
      const pin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: current.binding.currentValueId });
      expect(current.binding.currentValueId).toBe(original.binding.currentValueId);
      expect(pin).toEqual(originalPin);
      expect(pin?.fileId).toBe(f.fileId);
      expect(pin?.valueState).toBe("present");
      expect(await state()).toEqual(originalState);
      await expectHidden();
    }
    expect(await loadRetiredOrganizationSourceRegistrations(f.api, scope))
      .toEqual([{ id: registrationId, subjectId: "csub_acme_power" }]);
    expect((await loadSourceBindingCohortReadOnly(f.api, { ...scope, configSetId: f.configSetId })).map(row => row.bindingId))
      .toEqual([bindingId]);
  });

  it("restores eligibility without exposing the old value, then reconciles the latest DTS using the same binding", async () => {
    const original = await retained();
    const currentSource = sourceAdminText.replace("<36>", "<42>");
    const excluded = await (await f.stage(currentSource, "retired-current-value")).apply();
    await setRegistrationStatus("active");
    await expectHidden();
    expect(await retained()).toEqual(original);
    const staged = await f.stage(`${currentSource}\n/* reconcile latest source */`, "resume-latest-value");
    expect(staged.preview.impact.parameterChanges).toBe(1);
    const applied = await staged.apply();
    expect(await staged.apply()).toEqual(applied);
    const saved = await request(applied.requestId);
    expect(saved.source_revision_context.resumptions).toContainEqual({ bindingId, priorRequestId: excluded.requestId });
    expect(saved.applied_source_result.results).toContainEqual(expect.objectContaining({ bindingId, kind: "changed" }));
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: bindingId, rawValue: "<42>" }]);
    const resumed = await retained();
    expect(resumed.binding.sourceOccurrenceId).toBe(original.binding.sourceOccurrenceId);
    expect(resumed.binding.logicalNodeId).toBe(original.binding.logicalNodeId);
    expect(resumed.state.historyCount).toBe(original.state.historyCount + 1);
    expect(await loadOwnedProjectValueSourcePin(f.api, { organizationId: f.organizationId, projectId: f.projectId,
      bindingId, projectValueId: original.binding.currentValueId })).toEqual(original.pin);
  });

  it("keeps an absent retired node historical after restoration and reuses its identity when it returns", async () => {
    const original = await retained();
    await setRegistrationStatus("retired");
    const absent = sourceAdminText.replace('charger: charger { compatible = "acme,power"; iin_max = <36>; };', "");
    await (await f.stage(absent, "retired-node-absent")).apply();
    await setRegistrationStatus("active");
    await expectHidden();
    const stillAbsent = await f.stage(`${absent}\n/* still absent */`, "restored-node-absent");
    expect(stillAbsent.preview.impact.parameterChanges).toBe(0);
    await stillAbsent.apply();
    expect(await retained()).toEqual(original);
    await expectHidden();
    const returned = await f.stage(sourceAdminText.replace("<36>", "<51>"), "restored-node-returned");
    await returned.apply();
    const rows = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: bindingId, rawValue: "<51>" });
    const resumed = await retained();
    expect(resumed.binding.sourceOccurrenceId).toBe(original.binding.sourceOccurrenceId);
    expect(resumed.binding.logicalNodeId).toBe(original.binding.logicalNodeId);
    expect(resumed.state.historyCount).toBe(original.state.historyCount + 1);
  });

  it("synchronizes managed edits and new instances while leaving unknown source properties unmanaged", async () => {
    const other = 'aux: auxiliary { compatible = "acme,power"; iin_max = <61>; vendor,unmanaged = <900>; };';
    const mixed = sourceAdminText.replace("<36>", "<53>").replace(/};$/, `${other} unrecognized { vendor,opaque = "keep"; }; };`);
    const staged = await f.stage(mixed, "managed-and-unmanaged-source");
    await staged.apply();
    const rows = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === bindingId)?.rawValue).toBe("<53>");
    expect(rows.map(row => row.rawValue).sort()).toEqual(["<53>", "<61>"]);
  });
});

describe.each(["present", "deleted"] as const)("retained node replacement with a %s competing owner", valueState => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  const charger = 'charger { compatible = "acme,power"; reg = <1>; iin_max = <36>; };';
  const auxiliary = 'auxiliary { compatible = "acme,power"; reg = <2>; iin_max = <52>; };';
  const source = `/dts-v1/; / { compatible = "test,board"; ${charger} ${auxiliary} };`;
  beforeAll(async () => { f = await createSourceAdminFixture(valueState === "present" ? "ret-own-cur" : "ret-own-del",
    createUserInvocation, { sourceText: source }); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("refuses to replace another retained or deleted Binding's logical identity", async () => {
    const rows = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    const chargerId = rows.find(row => row.rawValue === "<36>")!.id;
    const auxiliaryId = rows.find(row => row.rawValue === "<52>")!.id;
    const scope = { organizationId: f.organizationId, projectId: f.projectId };
    const original = await readOwnedCurrentBinding(f.api, { ...scope, bindingId: chargerId });
    const competing = await readOwnedCurrentBinding(f.api, { ...scope, bindingId: auxiliaryId });
    if (original.status !== "current" || competing.status !== "current") throw new Error("Competing source owners unavailable");
    if (valueState === "deleted") {
      await (await f.stage(source.replace("iin_max = <52>;", ""), "delete-competing-property")).apply();
    }
    const before = await Promise.all([chargerId, auxiliaryId].map(bindingId => readSourceRevisionBindingState(f.api, { ...scope, bindingId })));
    expect(before[1].valueState).toBe(valueState);
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId,
      registrationId: original.binding.registrationId, status: "retired" });
    // The unique reg keeps the auxiliary's identity while it moves to the old
    // charger's path. Its owner remains reserved even if its value was deleted.
    const moved = '/dts-v1/; / { compatible = "test,board"; charger { compatible = "unknown,power"; reg = <2>; iin_max = <61>; }; };';
    await (await f.stage(moved, "move-competing-identity")).apply();
    const current = (await f.api.query<{ logical_node_id: string }>(
      `select node.logical_node_id from public.dts_logical_node_revisions node
       where node.node_locator='/charger' and node.config_revision_id=(select id from public.dts_config_revisions
         where config_set_id=$1 order by revision_number desc limit 1)`, [f.configSetId])).rows[0]!;
    expect(current.logical_node_id).toBe(competing.binding.logicalNodeId);
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId,
      registrationId: original.binding.registrationId, status: "active" });
    await expect(f.stage(source.replace(auxiliary, ""), "reject-competing-restoration"))
      .rejects.toMatchObject({ code: "CONFLICT", message: "待恢复节点已有参数身份占用，不能覆盖。" });
    expect(await Promise.all([chargerId, auxiliaryId].map(bindingId => readSourceRevisionBindingState(f.api, { ...scope, bindingId })))).toEqual(before);
  }, 120_000);
});

describe("same-node suspended and deleted restoration", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  beforeAll(async () => { f = await createSourceAdminFixture("ret-mix-del", createUserInvocation); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("restores a deleted sibling after the exact suspended owner reclaims its unmanaged node", async () => {
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Current Catalog unavailable");
    await publishSourceRevisionLifecycleFixture(f.db, catalog.release, { target: "definition", lifecycle: "active", includeManagedSibling: true });
    const both = sourceAdminText.replace("iin_max = <36>;", "iin_max = <36>; iin_min = <12>;");
    await (await f.stage(both, "create-same-node-sibling")).apply();
    const rows = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    const maxId = rows.find(row => row.rawValue === "<36>")!.id;
    const minId = rows.find(row => row.rawValue === "<12>")!.id;
    const scope = { organizationId: f.organizationId, projectId: f.projectId };
    const owner = await readOwnedCurrentBinding(f.api, { ...scope, bindingId: maxId });
    if (owner.status !== "current") throw new Error("Suspended sibling owner unavailable");
    await (await f.stage(sourceAdminText, "delete-same-node-sibling")).apply();
    const before = await Promise.all([maxId, minId].map(bindingId => readSourceRevisionBindingState(f.api, { ...scope, bindingId })));
    expect(before[1].valueState).toBe("deleted");
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId: owner.binding.registrationId, status: "retired" });
    const unmanaged = both.replace('"acme,power"', '"unknown,power"');
    // Reappearing bytes for an inactive deleted Binding remain unmanaged too.
    const suspended = await f.stage(unmanaged, "suspend-same-node-identity");
    expect(suspended.preview.impact.parameterChanges).toBe(0);
    await suspended.apply();
    await (await f.stage(`${unmanaged}\n/* still unmanaged */`, "repeat-same-node-identity")).apply();
    expect(await Promise.all([maxId, minId].map(bindingId => readSourceRevisionBindingState(f.api, { ...scope, bindingId })))).toEqual(before);
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId: owner.binding.registrationId, status: "active" });
    await (await f.stage(both.replace("<36>", "<41>").replace("<12>", "<14>"), "restore-same-node-siblings")).apply();
    const restored = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(restored).toHaveLength(2);
    expect(restored.find(row => row.id === maxId)?.rawValue).toBe("<41>");
    expect(restored.find(row => row.id === minId)?.rawValue).toBe("<14>");
    for (const [index, bindingId] of [maxId, minId].entries()) {
      const after = await readSourceRevisionBindingState(f.api, { ...scope, bindingId });
      expect(after.historyCount).toBe(before[index].historyCount + 1);
      const current = await readOwnedCurrentBinding(f.api, { ...scope, bindingId });
      expect(current.status === "current" && current.binding.logicalNodeId).toBe(owner.binding.logicalNodeId);
    }
  }, 120_000);
});

describe("suspended root identity with managed descendants", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  const source = '/dts-v1/; / { compatible = "acme,power"; iin_max = <36>; child { compatible = "acme,power"; iin_min = <12>; }; };';
  beforeAll(async () => { f = await createSourceAdminFixture("ret-root", createUserInvocation, { sourceText: source }); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("refuses to reclaim an unmanaged root above a currently owned descendant", async () => {
    const original = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const scope = { organizationId: f.organizationId, projectId: f.projectId };
    const before = await readSourceRevisionBindingState(f.api, { ...scope, bindingId: original.id });
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Current Catalog unavailable");
    const retired = await publishSourceRevisionLifecycleFixture(f.db, catalog.release,
      { target: "definition", lifecycle: "retired", includeManagedSibling: true });
    await (await f.stage(source.replace('compatible = "acme,power"', 'compatible = "unknown,power"'), "change-unmanaged-root")).apply();
    const child = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    expect(child.rawValue).toBe("<12>");
    const childBefore = await readSourceRevisionBindingState(f.api, { ...scope, bindingId: child.id });
    await publishSourceRevisionLifecycleFixture(f.db, retired.release,
      { target: "definition", lifecycle: "active", previousBundle: retired.bundle });
    await expect(f.stage(source, "reject-owned-root-descendant"))
      .rejects.toMatchObject({ code: "CONFLICT", message: "待恢复节点已有参数身份占用，不能覆盖。" });
    expect(await readSourceRevisionBindingState(f.api, { ...scope, bindingId: original.id })).toEqual(before);
    expect(await readSourceRevisionBindingState(f.api, { ...scope, bindingId: child.id })).toEqual(childBefore);
  }, 120_000);
});

describe.each(["subject", "definition"] as const)("whole-source current Catalog %s lifecycle", target => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  beforeAll(async () => { f = await createSourceAdminFixture(`ret-${target}`, createUserInvocation); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("retains historical pins during retirement and resumes from current source after a real Catalog publication", async () => {
    const row = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId: row.id };
    const original = await readSourceRevisionBindingState(f.api, scope);
    const current = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!current) throw new Error("Current Catalog unavailable");
    const retired = await publishSourceRevisionLifecycleFixture(f.db, current.release, { target, lifecycle: "retired" });
    const text = sourceAdminText.replace("<36>", "<72>");
    const paused = await f.stage(text, `${target}-retired-change`);
    expect(paused.preview.impact.parameterChanges).toBe(0);
    await paused.apply();
    expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(original);
    for (const limit of [undefined, 20]) {
      expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId, limit })).toHaveLength(0);
    }
    const stalePreview = await f.stage(`${text}\n/* before publication */`, `${target}-preview-restored`);
    await publishSourceRevisionLifecycleFixture(f.db, retired.release, { target, lifecycle: "active", previousBundle: retired.bundle });
    await expect(stalePreview.apply()).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "source-revision-stale" } });
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toHaveLength(0);
    const resumed = await f.stage(`${text}\n/* current managed source */`, `${target}-restored-change`);
    expect(resumed.preview.impact.parameterChanges).toBe(1);
    await resumed.apply();
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: row.id, rawValue: "<72>" }]);
    const after = await readSourceRevisionBindingState(f.api, scope);
    expect(after.catalogReleaseId).toBe(original.catalogReleaseId);
    expect(after.historyCount).toBe(original.historyCount + 1);
  }, 120_000);
});

describe("mixed managed and retired definitions", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  beforeAll(async () => { f = await createSourceAdminFixture("ret-mixed", createUserInvocation); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("creates a newly recognized property while preserving the retired property's historical pin", async () => {
    const original = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId: original.id };
    const before = await readSourceRevisionBindingState(f.api, scope);
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Current Catalog unavailable");
    await publishSourceRevisionLifecycleFixture(f.db, catalog.release, { target: "definition", lifecycle: "retired", includeManagedSibling: true });
    const text = sourceAdminText.replace("iin_max = <36>;", "iin_max = <84>; iin_min = <12>; vendor,unmanaged = <999>;");
    const staged = await f.stage(text, "mixed-retired-new-managed");
    await staged.apply();
    expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
    const rows = await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(original.id);
    expect(rows[0]?.rawValue).toBe("<12>");
    const second = await f.stage(text.replace("<84>", "<85>").replace("<12>", "<14>"), "mixed-retired-managed-again");
    await second.apply();
    expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: rows[0]!.id, rawValue: "<14>" }]);
    const reviewerId = "ret-mixed-reviewer";
    await f.db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Source reviewer','Reviewer',true)", [reviewerId, f.organizationId]);
    await f.db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,'software-committer')",
      ["ret-mixed-review-role", reviewerId, f.organizationId, f.projectId]);
    const reviewer = makeTestAuthContext({ organizationId: f.organizationId, userId: reviewerId,
      roles: [{ roleId: "software-committer", projectId: f.projectId }] });
    const snapshot = await loadPublishedCatalog(getRootPostgresPool(f.api)!);
    if (!snapshot) throw new Error("Current Catalog unavailable");
    for (const value of [16, 18]) {
      const bindingId = rows[0]!.id;
      const active = await readOwnedCurrentBinding(f.api, { ...scope, bindingId });
      if (active.status !== "current") throw new Error("Managed sibling unavailable");
      const pin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, bindingId, projectValueId: active.binding.currentValueId });
      if (!pin) throw new Error("Managed sibling source pin unavailable");
      const security = { ...f.security, requestId: `mixed-single-${value}` };
      const draft = await createCanonicalValueDraft(f.api, f.auth, { projectId: f.projectId, bindingId,
        targetValue: parseDtsValue("iin_min", `<${value}>`).value, reason: "Edit active sibling while history remains suspended",
        baseRevisionId: pin.configRevisionId, baseCurrentValueId: active.binding.currentValueId }, { ...security, objectStore: f.storage });
      const submitted = await submitCanonicalValueChange(f.api, f.auth, { projectId: f.projectId, draftId: draft.id,
        assignedToUserId: reviewerId, ...security });
      expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
      await reviewCanonicalValueChange(f.api, reviewer, { projectId: f.projectId, requestId: submitted.id, decision: "approve" }, {
        objectStore: f.storage, snapshot, invocation: createUserInvocation(reviewer), traceId: `mixed-single-${value}-review`, refusalSink: f.security.refusalSink
      });
      expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: bindingId, rawValue: `<${value}>` }]);
      expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
    }
  }, 120_000);
});

describe("deprecated managed definition", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  beforeAll(async () => { f = await createSourceAdminFixture("ret-deprec", createUserInvocation); }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("continues current reads and source synchronization for a deprecated definition", async () => {
    const original = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const catalog = await loadPublishedCatalog(getRootPostgresPool(f.db)!);
    if (!catalog) throw new Error("Current Catalog unavailable");
    await publishSourceRevisionLifecycleFixture(f.db, catalog.release, { target: "definition", lifecycle: "deprecated" });
    for (const limit of [undefined, 20]) {
      expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId, limit })).toMatchObject([{ id: original.id, rawValue: "<36>" }]);
    }
    const staged = await f.stage(sourceAdminText.replace("<36>", "<58>"), "deprecated-managed-change");
    expect(staged.preview.impact.parameterChanges).toBe(1);
    await staged.apply();
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: original.id, rawValue: "<58>" }]);
  }, 120_000);
});

describe("retired source origin movement", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  const inherited = '/dts-v1/;\n/include/ "defaults.dtsi"\n/ { compatible = "test,board"; model = "retired origin"; };\n';
  beforeAll(async () => {
    f = await createSourceAdminFixture("ret-origin", createUserInvocation, { sourceText: `${inherited}&charger { iin_max = <36>; };\n`,
      includes: [{ fileName: "defaults.dtsi", content: '/ { charger: charger { compatible = "acme,power"; iin_max = <18>; }; };\n' }] });
  }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("allows a retired property to move to an included file and resumes from that latest origin", async () => {
    const row = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId: row.id };
    const original = await readOwnedCurrentBinding(f.api, scope);
    if (original.status !== "current") throw new Error("Retained source binding unavailable");
    const pin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId });
    expect(pin?.fileId).toBe(f.fileId);
    const before = await readSourceRevisionBindingState(f.api, scope);
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId,
      registrationId: original.binding.registrationId, status: "retired" });
    await (await f.stage(inherited, "retired-origin-moved")).apply();
    await (await f.stage(`${inherited}/* keep inherited origin */\n`, "retired-origin-again")).apply();
    expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
    expect(await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId })).toEqual(pin);
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId,
      registrationId: original.binding.registrationId, status: "active" });
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toHaveLength(0);
    await (await f.stage(`${inherited}/* resume inherited source */\n`, "restored-origin")).apply();
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: row.id, rawValue: "<18>" }]);
    const resumed = await readOwnedCurrentBinding(f.api, scope);
    if (resumed.status !== "current") throw new Error("Resumed source binding unavailable");
    expect(resumed.binding.sourceOccurrenceId).toBe(original.binding.sourceOccurrenceId);
    expect(resumed.binding.logicalNodeId).toBe(original.binding.logicalNodeId);
    const currentPin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: resumed.binding.currentValueId });
    expect(currentPin?.fileId).toBe(f.includeFileIds.get("defaults.dtsi"));
    expect((await readSourceRevisionBindingState(f.api, scope)).historyCount).toBe(before.historyCount + 1);
  }, 120_000);
});

describe("retained source owner after member removal", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  const surviving = sourceAdminText.replace("<36>", "<18>");
  beforeAll(async () => {
    f = await createSourceAdminFixture("ret-unmount", createUserInvocation, {
      sourceText: `${surviving}\n/include/ "override.dtsi"\n`,
      includes: [{ fileName: "override.dtsi", content: "&charger { iin_max = <36>; };\n" }]
    });
  }, 120_000);
  afterAll(async () => { await f?.close(); });

  it("keeps the suspended owner discoverable after its original member is removed and resumes the same binding", async () => {
    const row = (await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId }))[0]!;
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId: row.id };
    const original = await readOwnedCurrentBinding(f.api, scope);
    if (original.status !== "current") throw new Error("Original source owner unavailable");
    const pin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId });
    const removedFileId = f.includeFileIds.get("override.dtsi")!;
    expect(pin?.fileId).toBe(removedFileId);
    const before = await readSourceRevisionBindingState(f.api, scope);
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId,
      registrationId: original.binding.registrationId, status: "retired" });
    const moved = await f.stage(`${surviving}\n/* property now belongs to board.dts */`, "suspended-before-unmount");
    await moved.apply();
    expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
    const target = { projectId: f.projectId, configSetId: f.configSetId, fileId: removedFileId };
    const options = { toolchain: sourceAdminToolchain };
    const preview = await previewAdministratorMemberRemoval(f.api, f.storage, f.auth, target, options);
    await applyAdministratorMemberRemoval(f.api, f.storage, f.auth, { ...target, expectedProofToken: preview.proofToken,
      reason: "Remove the now-unused historical source member", clientMutationId: "remove-suspended-owner-member" }, f.security, options);
    expect((await f.api.query("select config_set_id from public.project_parameter_files where id=$1", [removedFileId])).rows).toEqual([{ config_set_id: null }]);
    expect(await readOwnedCurrentBinding(f.api, scope)).toEqual(original);
    expect((await loadSourceBindingCohortReadOnly(f.api, { ...scope, configSetId: f.configSetId })).map(entry => entry.bindingId)).toEqual([row.id]);
    expect(await readSourceRevisionBindingState(f.api, scope)).toEqual(before);
    expect(await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId })).toEqual(pin);
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toHaveLength(0);
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId,
      registrationId: original.binding.registrationId, status: "active" });
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toHaveLength(0);
    await (await f.stage(`${surviving}\n/* reconcile surviving source */`, "resume-after-owner-unmount")).apply();
    expect(await listCatalogBindingRowsForProject(f.api, f.auth, { projectId: f.projectId })).toMatchObject([{ id: row.id, rawValue: "<18>" }]);
    const resumed = await readOwnedCurrentBinding(f.api, scope);
    if (resumed.status !== "current") throw new Error("Resumed source owner unavailable");
    expect(resumed.binding.sourceOccurrenceId).toBe(original.binding.sourceOccurrenceId);
    expect(resumed.binding.logicalNodeId).toBe(original.binding.logicalNodeId);
    expect((await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: resumed.binding.currentValueId }))?.fileId).toBe(f.fileId);
    expect((await readSourceRevisionBindingState(f.api, scope)).historyCount).toBe(before.historyCount + 1);
    expect(await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: original.binding.currentValueId })).toEqual(pin);
  }, 120_000);
});
