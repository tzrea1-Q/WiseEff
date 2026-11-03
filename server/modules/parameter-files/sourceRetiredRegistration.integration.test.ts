import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserInvocation } from "../auth/trustedInvocation";
import { readSourceRevisionBindingState, setSourceRevisionRegistrationStatus } from "../../testing/parameterCatalog/sourceRevision";
import { loadOwnedProjectValueSourcePin, loadSourceBindingCohortReadOnly, readOwnedCurrentBinding, readOwnedProjectValueIdentity } from "../parameter-bindings/values";
import { loadRetiredOrganizationSourceRegistrations } from "../parameter-bindings/catalogProjectValueSync";
import { createSourceAdminFixture, sourceAdminText } from "./sourceAdministration.testHelpers";

describe("whole-source retired registration boundaries (PostgreSQL API role, toolchain stub)", () => {
  let f: Awaited<ReturnType<typeof createSourceAdminFixture>>;
  let bindingId: string;
  let registrationId: string;

  beforeAll(async () => {
    f = await createSourceAdminFixture("source-retired-boundary", createUserInvocation);
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

  it.each([
    ["value", sourceAdminText.replace("<36>", "<42>")],
    ["property removal", sourceAdminText.replace("iin_max = <36>;", "")],
    ["node removal", sourceAdminText.replace('charger: charger { compatible = "acme,power"; iin_max = <36>; };', "")],
    ["subject change", sourceAdminText.replace('compatible = "acme,power"', 'compatible = "unknown,power"')]
  ])("refuses retired %s changes without advancing values or source", async (label, text) => {
    const before = await state();
    await expect(f.stage(text, `retired-${label}`)).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "source-registration-retired-change", bindingId, registrationId,
        subjectId: "csub_acme_power", propertyName: "iin_max" }
    });
    expect(await state()).toEqual(before);
    expect((await f.api.query(`select id from public.project_parameter_value_change_requests
      where organization_id=$1 and project_id=$2`, [f.organizationId, f.projectId])).rows).toHaveLength(0);
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
    const before = await state();
    const staged = await f.stage(sourceAdminText.replace("<36>", "<42>"), "active-preview-retired");
    await setRegistrationStatus("retired");
    await expect(staged.apply()).rejects.toMatchObject({
      code: "CONFLICT", details: { reason: "source-registration-retired-change", bindingId, registrationId }
    });
    expect(await state()).toEqual(before);
  });

  it("applies unrelated source edits twice while preserving the retired DTS binding and value", async () => {
    const scope = { organizationId: f.organizationId, projectId: f.projectId, bindingId };
    const original = await readOwnedCurrentBinding(f.api, scope);
    if (original.status !== "current") throw new Error("Retained DTS binding unavailable");
    const originalValue = await readOwnedProjectValueIdentity(f.api, { ...scope, projectValueId: original.binding.currentValueId });
    let previousRevision: string | undefined;
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
      expect(pin?.configRevisionId).not.toBe(previousRevision);
      expect(pin?.fileId).toBe(f.fileId);
      expect(pin?.valueState).toBe("present");
      previousRevision = pin?.configRevisionId;
    }
    expect(await loadRetiredOrganizationSourceRegistrations(f.api, scope))
      .toEqual([{ id: registrationId, subjectId: "csub_acme_power" }]);
    expect((await loadSourceBindingCohortReadOnly(f.api, { ...scope, configSetId: f.configSetId })).map(row => row.bindingId))
      .toEqual([bindingId]);
  });
});
