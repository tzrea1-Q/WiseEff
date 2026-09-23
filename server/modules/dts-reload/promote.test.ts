import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManagedInstanceTestDatabase, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { createLocalObjectStore } from "../logs/objectStore";
import { createAgentInvocation, createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { AuthContext } from "../auth/types";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { submitCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import { parseDtsValue } from "../dts";
import { seedCanonicalParameterFixture } from "./testing/canonicalReloadFixture";
import { getReloadCandidateRow, insertReloadRun, insertReloadRunTarget, readLibraryFingerprint } from "./repository";
import { promoteReloadRunToDrafts, type PromoteReloadRunToDraftsContext } from "./promote";
import type { ReloadRunPurpose, ReloadRunStatus } from "./types";

// Promotion tests now use canonical-only data and the real canonical writer.
// These stored terminal runs are fixtures, not evidence of device deployment.
describe("canonical reload promotion", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let directory: string;
  let fixture: Awaited<ReturnType<typeof seedCanonicalParameterFixture>>;
  let context: PromoteReloadRunToDraftsContext;

  beforeEach(async () => {
    database = await createManagedInstanceTestDatabase("898promote");
    db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "wiseeff-898-promote-"));
    const objectStore = createLocalObjectStore(directory);
    fixture = await seedCanonicalParameterFixture(db, objectStore);
    context = { objectStore, invocation: createUserInvocation(fixture.editorAuth),
      requestId: `898-promote-${randomUUID()}`, refusalSink: createTrustedRefusalAuditSink(db) };
  }, 120_000);
  afterEach(async () => {
    await db?.close();
    await database?.drop();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  async function seedRun(options: { status?: ReloadRunStatus; purpose?: ReloadRunPurpose; nodePath?: string; pinless?: boolean } = {}) {
    const id = `reload-${randomUUID()}`;
    const candidate = await getReloadCandidateRow(db, { organizationId: fixture.organizationId, projectId: fixture.projectId, bindingId: fixture.bindingId });
    if (!candidate) throw new Error("Canonical candidate is unavailable");
    await insertReloadRun(db, { id, organizationId: fixture.organizationId, projectId: fixture.projectId,
      configRevisionId: fixture.configRevisionId, status: options.status ?? "verified", purpose: options.purpose ?? "ordinary",
      failureCode: null, steps: [], diagnostics: [], toolVersions: { dtc: null, fdtoverlay: null },
      overlaySourceStorageKey: null, overlaySourceSha256: null, overlayArtifactStorageKey: null,
      overlayArtifactSha256: null, overlayArtifactBytes: null, createdByUserId: fixture.editorAuth.user.id,
      completedAt: new Date().toISOString() });
    await insertReloadRunTarget(db, { id: randomUUID(), reloadRunId: id, bindingId: null,
      nodePath: options.nodePath ?? candidate.node_path!, propertyKey: candidate.property_key,
      baselineValue: "<5>", debugValue: "<6>", sortOrder: 0,
      ...(!options.pinless ? { canonicalBindingId: fixture.bindingId, canonicalDefinitionId: fixture.definitionId,
        canonicalDefinitionRevisionId: fixture.definitionRevisionId, canonicalCurrentValueId: fixture.currentValueId,
        canonicalCatalogReleaseId: fixture.catalogReleaseId, canonicalSourcePinId: candidate.source_pin_id,
        canonicalSourceOccurrenceId: candidate.source_occurrence_id, canonicalConfigRevisionId: fixture.configRevisionId,
        canonicalSourceRef: candidate.source_ref, canonicalSourceFormat: "dts" as const,
        canonicalSourceLocator: candidate.source_locator } : {}) });
    return id;
  }
  async function promote(runId: string, options: { auth?: AuthContext; acknowledged?: boolean; ids?: string[]; context?: PromoteReloadRunToDraftsContext } = {}) {
    const principal = options.auth ?? fixture.editorAuth;
    return promoteReloadRunToDrafts(db, principal, { runId, bindingIds: options.ids ?? [fixture.bindingId],
      unverifiableAcknowledged: options.acknowledged }, options.context ?? { ...context, invocation: createUserInvocation(principal) });
  }
  async function pendingCounts() {
    return (await db.query<{ drafts: number; requests: number }>(`select
      (select count(*)::int from project_parameter_value_drafts) drafts,
      (select count(*)::int from project_parameter_value_change_requests) requests`)).rows[0]!;
  }

  it("creates a real canonical draft without modifying formal values, source tips or submitting a request", async () => {
    const runId = await seedRun();
    const before = await readLibraryFingerprint(db, { organizationId: fixture.organizationId, projectId: fixture.projectId });
    const result = await promote(runId);
    expect(result.drafts).toEqual([{ bindingId: fixture.bindingId, draftId: expect.any(String), outcome: "created" }]);
    expect(result.workbenchHref).toBe(`/parameters?project=${fixture.projectId}`);
    const after = await readLibraryFingerprint(db, { organizationId: fixture.organizationId, projectId: fixture.projectId });
    expect(after).toEqual({ ...before, draftCount: before.draftCount + 1 });
    expect(await pendingCounts()).toEqual({ drafts: 1, requests: 0 });
    expect((await db.query("select id from public.parameter_drafts")).rows).toEqual([]);
    const audit = await db.query("select id from audit_events where kind='reload-value-promoted-to-draft' and target_id=$1", [runId]);
    expect(audit.rows).toHaveLength(1);
  });

  it("preserves empty-selection and all eligibility refusal messages without writing drafts", async () => {
    const runId = await seedRun();
    await expect(promote(runId, { ids: [] })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { code: "reload-promote-empty-selection" } });
    for (const [status, purpose, message] of [
      ["contradicted", "ordinary", "Reload run status contradicted cannot be promoted to parameter drafts."],
      ["failed", "ordinary", "Reload run status failed cannot be promoted to parameter drafts."],
      ["verified", "restore-baseline", "restore-baseline runs cannot be promoted; those values are already the library baseline."],
      ["unverifiable", "ordinary", "Unverifiable reload runs require unverifiableAcknowledged: true before promotion."]
    ] as const) {
      await expect(promote(await seedRun({ status, purpose }))).rejects.toMatchObject({ code: "CONFLICT", message });
    }
    expect(await pendingCounts()).toEqual({ drafts: 0, requests: 0 });
  });

  it("requires explicit acknowledgement for an unverifiable run", async () => {
    const runId = await seedRun({ status: "unverifiable" });
    await expect(promote(runId)).rejects.toMatchObject({ details: { code: "reload-promote-unverifiable-ack-required" } });
    expect((await promote(runId, { acknowledged: true })).drafts[0]!.outcome).toBe("created");
  });

  it("keeps role, tenant, project and Agent refusal boundaries before canonical writes", async () => {
    const runId = await seedRun();
    for (const principal of [
      { ...fixture.editorAuth, permissions: fixture.editorAuth.permissions.filter((permission) => permission !== "parameter:edit") },
      { ...fixture.editorAuth, permissions: fixture.editorAuth.permissions.filter((permission) => permission !== "debugging:dts-reload") },
      { ...fixture.editorAuth, roles: [{ projectId: fixture.otherProjectId, roleId: "hardware-committer" as const }] },
      fixture.otherAuth
    ]) await expect(promote(runId, { auth: principal })).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await expect(promote(runId, { context: { ...context, invocation: createAgentInvocation(fixture.editorAuth, {
      sessionId: "898-agent-session", toolCallId: "898-agent-tool", approval: { required: true, approvalId: "898-agent-approval" }
    }) } })).rejects.toMatchObject({ details: { code: "dts-reload-agent-refused", requireHuman: true } });
    expect(await pendingCounts()).toEqual({ drafts: 0, requests: 0 });
  });

  it("retains Admin promotion permission without granting an Agent exception", async () => {
    const admin = { ...fixture.editorAuth, roles: [{ projectId: null, roleId: "admin" as const }],
      permissions: [...fixture.editorAuth.permissions.filter((permission) => permission !== "debugging:dts-reload"), "admin:access" as const] };
    await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('898-admin-promotion',$1,$2,null,'admin')", [admin.user.id, admin.organization.id]);
    expect((await promote(await seedRun(), { auth: admin })).drafts[0]!.outcome).toBe("created");
  });

  it("refuses node/source drift and historical targets without canonical pins", async () => {
    await expect(promote(await seedRun({ nodePath: "/different-device-node" }))).rejects.toMatchObject({ details: { code: "reload-promote-node-drift" } });
    const runId = await seedRun();
    await db.query("update dts_reload_run_targets set canonical_source_ref='different-source' where reload_run_id=$1", [runId]);
    await expect(promote(runId)).rejects.toMatchObject({ details: { code: "reload-promote-pin-drift" } });
    await expect(promote(await seedRun({ pinless: true }))).rejects.toMatchObject({ details: { code: "reload-promote-unknown-target" } });
    expect(await pendingCounts()).toEqual({ drafts: 0, requests: 0 });
  });

  it("serializes repeat promotion and matches exact owner, target and reason", async () => {
    const runId = await seedRun();
    const results = await Promise.all([promote(runId), promote(runId)]);
    expect(results.map((result) => result.drafts[0]!.outcome).sort()).toEqual(["created", "unchanged"]);
    expect(results[0]!.drafts[0]!.draftId).toBe(results[1]!.drafts[0]!.draftId);
    expect(await pendingCounts()).toEqual({ drafts: 1, requests: 0 });
    await db.query("update project_parameter_value_drafts set reason=reason||' extra' where id=$1", [results[0]!.drafts[0]!.draftId]);
    await expect(promote(runId)).rejects.toMatchObject({ details: { code: "reload-promote-open-draft" } });
  });

  it("preserves another draft and pending requests instead of overwriting either", async () => {
    const otherContext = { ...context, invocation: createUserInvocation(fixture.reviewerAuth) };
    const draft = await createCanonicalValueDraft(db, fixture.reviewerAuth, { projectId: fixture.projectId, bindingId: fixture.bindingId,
      baseRevisionId: fixture.configRevisionId, baseCurrentValueId: fixture.currentValueId, targetValue: parseDtsValue("iin_max", "<7>").value, reason: "Existing work" }, otherContext);
    const runId = await seedRun();
    await expect(promote(runId)).rejects.toMatchObject({ details: { code: "reload-promote-open-draft" } });
    await submitCanonicalValueChange(db, fixture.reviewerAuth, { projectId: fixture.projectId, draftId: draft.id, ...otherContext });
    await expect(promote(runId)).rejects.toMatchObject({ details: { code: "reload-promote-in-flight-cr" } });
    expect(await pendingCounts()).toEqual({ drafts: 1, requests: 1 });
  });

  it("validates the entire selection before creating any draft", async () => {
    await expect(promote(await seedRun(), { ids: [fixture.bindingId, "not-a-run-target"] })).rejects.toMatchObject({ details: { code: "reload-promote-unknown-target" } });
    expect(await pendingCounts()).toEqual({ drafts: 0, requests: 0 });
  });

  it("rolls back the real prepared source and draft when the final audit fails", async () => {
    const runId = await seedRun();
    const candidatesBefore = (await db.query("select id from project_parameter_file_candidates")).rows;
    await db.query(`create function public.issue898_reject_promotion_audit() returns trigger language plpgsql as $$
      begin
        if NEW.kind = 'reload-value-promoted-to-draft' then raise exception 'issue898 controlled audit failure'; end if;
        return NEW;
      end $$`);
    await db.query(`create trigger issue898_reject_promotion_audit before insert on public.audit_events
      for each row execute function public.issue898_reject_promotion_audit()`);
    await expect(promote(runId)).rejects.toThrow("issue898 controlled audit failure");
    expect(await pendingCounts()).toEqual({ drafts: 0, requests: 0 });
    expect((await db.query("select id from project_parameter_file_candidates")).rows).toEqual(candidatesBefore);
    expect((await db.query<{ current_value_id: string }>("select current_value_id from parameter_catalog.project_parameter_bindings where id=$1", [fixture.bindingId])).rows[0]!.current_value_id).toBe(fixture.currentValueId);
  });
});
