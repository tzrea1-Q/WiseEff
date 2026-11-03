import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserInvocation } from "../auth/trustedInvocation";
import { loadOwnedProjectValueSourcePin, readOwnedCurrentBinding } from "../parameter-bindings/values";
import { setSourceRevisionRegistrationStatus } from "../../testing/parameterCatalog/sourceRevision";
import { createSourceAdminFixture, sourceAdminText, sourceAdminToolchain } from "./sourceAdministration.testHelpers";
import { freezeSourceRevisionRequest, inspectSourceRevision, loadSnapshot, sourceRevisionDigest, type SourceRevisionProof } from "./sourceRevisionService";
import type { ExcludedSourceBinding } from "./sourceManagedScope";

// Exercise the deferred SQL boundary through the restricted API role. These
// forged proofs deliberately bypass service admission; the database must refuse
// them independently. The compiler stub is not native-toolchain acceptance.
describe("managed source exclusion and resumption SQL receipts", { timeout: 120_000 }, () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  let retained: Omit<ExcludedSourceBinding, "reason">;

  beforeAll(async () => {
    f = await createSourceAdminFixture("scope-receipt", createUserInvocation);
    const staged = await f.stage(`${sourceAdminText}\n/* discover retained identity */`, "scope-discovery");
    const proof = await inspect(staged.input.candidateId);
    const entry = proof.cohort[0]!;
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId: entry.bindingId };
    const current = await readOwnedCurrentBinding(f.api, scope);
    const pin = await loadOwnedProjectValueSourcePin(f.api, { ...scope, projectValueId: entry.oldValueId });
    if (current.status !== "current" || !pin) throw new Error("Expected exact current source fixture");
    retained = { bindingId: entry.bindingId, oldValueId: entry.oldValueId, sourcePinId: entry.sourcePinId,
      sourceOccurrenceId: entry.sourceOccurrenceId, definitionId: entry.definitionId, effectiveRevisionId: entry.effectiveRevisionId,
      catalogReleaseId: entry.catalogReleaseId, valueDigest: entry.valueDigest,
      registrationId: current.binding.registrationId, subjectId: current.binding.subjectId,
      configRevisionId: pin.configRevisionId, fileId: pin.fileId, fileVersionId: pin.fileVersionId, format: pin.format };
  });
  afterAll(async () => { await f?.close(); });

  async function inspect(candidateId: string) {
    return (await inspectSourceRevision(f.api, f.storage, f.auth, { projectId: f.projectId, candidateId }, await loadSnapshot(f.db),
      { toolchain: sourceAdminToolchain })).proof;
  }

  async function freezeForged(proof: SourceRevisionProof, key: string) {
    const body = { ...proof };
    // Freeze the modified contract consistently, so refusal must come from the
    // ownership/scope rule rather than an incidental hash disagreement.
    const { proofDigest: previousDigest, ...unsigned } = body;
    expect(previousDigest).toMatch(/^[0-9a-f]{64}$/);
    body.proofDigest = sourceRevisionDigest(unsigned);
    await f.api.transaction(async tx => {
      await freezeSourceRevisionRequest(tx, f.auth, body,
        { projectId: f.projectId, reason: "Attempt a forged managed source scope", assignedToUserId: f.auth.user.id, clientMutationId: key },
        sourceRevisionDigest(key));
      await tx.query("set constraints project_parameter_source_managed_scope_receipt_ck immediate");
      throw new Error("Forged source scope escaped the SQL guard");
    });
  }

  it("grants only the bounded suspension lookup to the runtime API", async () => {
    const privilege = (await f.api.query<{ table_write: boolean; table_read: boolean; mint: boolean; lookup: boolean }>(`
      select has_table_privilege(current_user,'parameter_catalog.source_binding_suspension_receipts','INSERT,UPDATE,DELETE') as table_write,
        has_table_privilege(current_user,'parameter_catalog.source_binding_suspension_receipts','SELECT') as table_read,
        has_function_privilege(current_user,'parameter_catalog.mint_source_binding_suspensions()','EXECUTE') as mint,
        has_function_privilege(current_user,'parameter_catalog.find_source_binding_suspension(text,text,text,text,jsonb)','EXECUTE') as lookup`)).rows[0];
    expect(privilege).toEqual({ table_write: false, table_read: false, mint: false, lookup: true });
  });

  it("refuses excluding a currently managed binding by claiming retirement", async () => {
    const staged = await f.stage(sourceAdminText.replace("<36>", "<41>"), "scope-active-forgery");
    const proof = await inspect(staged.input.candidateId);
    proof.cohort = []; proof.targets = [];
    proof.excludedBindings = [{ ...retained, reason: "registration-inactive" }];
    await expect(freezeForged(proof, "scope-active-forgery-freeze")).rejects.toMatchObject({
      code: "23514", message: "Source exclusion has no exact unmanaged historical Binding"
    });
  });

  it("refuses a retired exclusion that does not retain its exact source pin", async () => {
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId: retained.registrationId, status: "retired" });
    const staged = await f.stage(sourceAdminText.replace("<36>", "<42>"), "scope-pin-forgery");
    const proof = await inspect(staged.input.candidateId);
    expect(proof.excludedBindings).toHaveLength(1);
    proof.excludedBindings[0] = { ...proof.excludedBindings[0]!, sourcePinId: "unowned-historical-source-pin" };
    await expect(freezeForged(proof, "scope-pin-forgery-freeze")).rejects.toMatchObject({
      code: "23514", message: "Source exclusion has no exact unmanaged historical Binding"
    });
  });

  it("requires approved exact evidence and a set target before resuming historical DTS", async () => {
    const suspended = await f.stage(sourceAdminText.replace("<36>", "<42>"), "scope-genuine-suspension");
    const committed = await suspended.apply();
    await setSourceRevisionRegistrationStatus(f.db, { organizationId: f.organizationId, registrationId: retained.registrationId, status: "active" });
    const resumed = await f.stage(`${sourceAdminText.replace("<36>", "<42>")}\n/* reconcile latest source */`, "scope-genuine-resumption");
    const proof = await inspect(resumed.input.candidateId);
    expect(proof.resumptions).toEqual([{ bindingId: retained.bindingId, priorRequestId: committed.requestId }]);
    expect(proof.targets).toEqual([expect.objectContaining({ bindingId: retained.bindingId, action: "set" })]);
    await expect(freezeForged({ ...proof, resumptions: [] }, "scope-missing-evidence")).rejects.toMatchObject({
      code: "23514", message: "Historical source resumption has no exact approved exclusion"
    });
    await expect(freezeForged({ ...proof, resumptions: [{ bindingId: retained.bindingId, priorRequestId: "unapproved-source-request" }] },
      "scope-unapproved-evidence")).rejects.toMatchObject({
      code: "23514", message: "Historical source resumption has no exact approved exclusion"
    });
    await expect(freezeForged({ ...proof, targets: [] }, "scope-derived-forgery")).rejects.toMatchObject({
      code: "23514", message: "Historical DTS source resumption requires a reviewed set target"
    });
    expect((await resumed.apply()).requestId).toMatch(/^pvcr_/);
  });
});
