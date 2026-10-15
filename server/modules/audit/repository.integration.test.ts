import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { firstReleaseBundle } from "../../testing/parameterCatalog/cutoverPopulatedFixture";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { createCatalogKernel, jsonCatalogReleaseSource, type CatalogSnapshot } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId } from "../parameter-catalog-contract";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { appendSourceCommittedValue, createSourceBackedBindingService } from "../parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import type { Binding } from "../parameter-bindings/binding";
import { insertBindingHistoryEvent, insertProjectValue, loadProjectValueById } from "../parameter-bindings/values/repositories";
import { createAuditEvent, listAuditEvents } from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();
const revisionId = DefinitionRevisionId("drev_acme_power_iin_max_1");

describe.skipIf(!databaseAvailable)("audit immutable value evidence", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let snapshot: CatalogSnapshot;
  let local: Binding;
  let foreign: Binding;

  beforeAll(async () => {
    database = await createEphemeralTestDatabase("auditctx");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    const bundle = firstReleaseBundle();
    const compiled = compileCatalogRelease(bundle);
    if (!compiled.ok) throw new Error("Invalid catalog test fixture");
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest
    });
    if (!installed.ok) throw new Error(`Catalog fixture install failed: ${installed.error.kind}`);
    const pin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(pin);
    if (!loaded.ok) throw new Error("Catalog fixture snapshot failed");
    snapshot = loaded.value;
    const bindings: Binding[] = [];
    for (const suffix of ["local", "foreign"]) {
      const org = `audit-${suffix}`;
      const project = `audit-project-${suffix}`;
      const module = `audit-module-${suffix}`;
      await seedCoreGraph(pool, { organization: { id: org }, projects: [{ id: project, name: `${suffix} project` }] });
      await pool.query(`insert into attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
        values ($1, $2, 'driver-registration', 'Driver', 'compatible:acme,power')`, [`attr-${suffix}`, org]);
      await pool.query(`insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality)
        values ($1, 'physical-device', 'multiple')`, [`attr-${suffix}`]);
      await pool.query(`insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id)
        values ($1, $2, 'Driver', $1, 1, 'driver-group', 'curated', $3)`, [module, org, `attr-${suffix}`]);
      const client = await pool.connect();
      let registrationId: Binding["registrationId"];
      try {
        await client.query("begin");
        await client.query("set constraints all deferred");
        const registration = await writeGuardedRegistration(client, {
          kind: "register", organizationId: org, subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver",
          expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: module, method: "explicit",
          proof: { reason: "audit-context-test" }, idempotencyKey: `audit-registration-${suffix}`,
          context: { actorKind: "org-admin", principalId: "user-org-admin" }
        });
        if (!registration.ok) throw new Error(`Registration fixture failed: ${registration.error.kind}`);
        registrationId = registration.value.registrationId;
        await client.query("set constraints all immediate");
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally { client.release(); }
      const stabilized = await createSourceBackedBindingService(pool, { sourceRef: "audit-source", initialPayload: { kind: "number", value: 5 } }).stabilize({
        snapshot, organizationId: org, projectId: project, logicalNodeId: `audit-node-${suffix}`, registrationId,
        definitionId: ParameterDefinitionId("pdef_acme_power_iin_max"), effectiveRevisionId: revisionId, expectedEffectiveRevisionId: null
      });
      if (!stabilized.ok) throw new Error(`Binding fixture failed: ${stabilized.error.kind}`);
      bindings.push(stabilized.value.binding);
    }
    [local, foreign] = bindings;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await database?.drop();
  });

  it("retains exact old/new evidence after later changes and refuses foreign binding enrichment", async () => {
    const first = await appendSourceCommittedValue(pool, {
      snapshot, binding: local, definitionRevisionId: revisionId,
      source: { sourceRef: "audit-source", configRevisionId: "audit-config-1" },
      payload: { kind: "number", value: 7 }, expectedTip: local.currentValueId
    });
    if (!first.ok) throw new Error(`Append failed: ${first.error.kind}`);
    const history = await pool.query<{ success_audit_ref: string }>(
      "select success_audit_ref from parameter_catalog.binding_history_events where new_current_value_id=$1", [first.value.currentTip]);
    const auditId = history.rows[0].success_audit_ref;
    const second = await appendSourceCommittedValue(pool, {
      snapshot, binding: local, definitionRevisionId: revisionId,
      source: { sourceRef: "audit-source", configRevisionId: "audit-config-2" },
      payload: { kind: "number", value: 9 }, expectedTip: first.value.currentTip
    });
    if (!second.ok) throw new Error(`Second append failed: ${JSON.stringify(second.error)}`);
    const event = (await listAuditEvents(pool, { organizationId: "audit-local", eventId: auditId })).items[0];
    expect(event).toMatchObject({
      targetName: "Input current limit", projectName: "local project",
      evidence: { previousValue: 5, newValue: 7, sourceLabel: "不可变参数变更历史" }
    });
    expect((await listAuditEvents(pool, { organizationId: "audit-foreign", eventId: auditId })).items).toEqual([]);
    // Older owner-written append events can retain a precise immutable value pin
    // even when no binding_history_events row refers to their audit id.
    await createAuditEvent(pool, {
      id: "audit-value-only", organizationId: "audit-local", projectId: local.projectId,
      actorUserId: null, actorType: "system", app: "parameter-bindings", kind: "project-value", action: "project-value-appended",
      severity: "Low", targetType: "project-value", targetId: first.value.currentTip,
      metadata: { bindingId: local.id, valueId: first.value.currentTip }, traceId: "audit-value-only"
    });
    const valueOnly = (await listAuditEvents(pool, { organizationId: "audit-local", eventId: "audit-value-only" })).items[0];
    expect(valueOnly.evidence).toEqual({ newValue: 7, newValueState: "present", sourceLabel: "不可变参数值记录" });
    await createAuditEvent(pool, {
      id: "audit-foreign-context-decoy", organizationId: "audit-local", projectId: local.projectId,
      actorUserId: null, actorType: "system", app: "parameter-bindings", kind: "project-value", action: "project-value-appended",
      severity: "Low", targetType: "project-value", targetId: foreign.currentValueId,
      metadata: { bindingId: foreign.id, valueId: foreign.currentValueId }, traceId: "audit-decoy"
    });
    const decoy = (await listAuditEvents(pool, { organizationId: "audit-local", eventId: "audit-foreign-context-decoy" })).items[0];
    expect(decoy.targetName).toBeUndefined();
    expect(decoy.evidence).toBeUndefined();

    const unchanged = await appendSourceCommittedValue(pool, {
      snapshot, binding: local, definitionRevisionId: revisionId,
      source: { sourceRef: "audit-source", configRevisionId: "audit-config-3" },
      payload: { kind: "number", value: 9 }, expectedTip: second.value.currentTip
    });
    if (!unchanged.ok) throw new Error(`Unchanged append failed: ${JSON.stringify(unchanged.error)}`);
    const unchangedHistory = await pool.query<{ success_audit_ref: string }>(
      "select success_audit_ref from parameter_catalog.binding_history_events where new_current_value_id=$1", [unchanged.value.currentTip]);
    const unchangedAuditId = unchangedHistory.rows[0].success_audit_ref;
    expect((await listAuditEvents(pool, { organizationId: "audit-local", eventId: unchangedAuditId })).items[0].evidence).toEqual({
      sourceLabel: "不可变参数变更历史 · 1 项历史记录未改变参数值"
    });
    // A read fixture for a multi-history source commit: both immutable value
    // pairs come from the real append owner; no current tip or history is edited.
    await createAuditEvent(pool, {
      id: "audit-cohort", organizationId: "audit-local", projectId: local.projectId,
      actorUserId: null, actorType: "system", app: "parameters", kind: "parameter-topology-governance", action: "value-change-applied",
      severity: "Medium", targetType: "project-parameter-binding", targetId: local.id,
      metadata: { targetBindingId: local.id }, traceId: "audit-cohort"
    });
    await pool.query(`insert into parameter_catalog.binding_history_events (
      id, binding_id, old_effective_revision_id, new_effective_revision_id,
      old_current_value_id, new_current_value_id, reason, success_audit_ref, catalog_release_id
    ) select 'cohort-' || id, binding_id, old_effective_revision_id, new_effective_revision_id,
      old_current_value_id, new_current_value_id, reason, 'audit-cohort', catalog_release_id
      from parameter_catalog.binding_history_events where success_audit_ref = any($1::text[])`, [[auditId, unchangedAuditId]]);
    expect((await listAuditEvents(pool, { organizationId: "audit-local", eventId: "audit-cohort" })).items[0].evidence).toEqual({
      previousValue: 5, newValue: 7,
      previousValueState: "present", newValueState: "present",
      sourceLabel: "不可变参数变更历史 · 另 1 项历史记录未改变参数值"
    });
  });

  it("preserves state-only deletion and restoration evidence without rewriting retained payloads", async () => {
    const client = { query: pool.query.bind(pool) };
    const present = await loadProjectValueById(client, local.currentValueId);
    if (!present) throw new Error("Missing immutable present-value fixture");
    // Read fixtures use the existing immutable persistence owners. They do not
    // move the live tip or claim that terminal deleted bindings can be restored.
    const deleted = await insertProjectValue(client, {
      id: "audit-state-deleted-value", bindingId: local.id, definitionId: local.definitionId,
      definitionRevisionId: local.effectiveRevisionId, sourceRef: present.source_ref,
      configRevisionId: present.config_revision_id, valueDigest: present.value_digest,
      valueKind: "number", valueJson: JSON.stringify(present.value), valueState: "deleted"
    });
    if (!deleted) throw new Error("Missing immutable deleted-value fixture");
    for (const [action, oldValueId, newValueId, previousValueState, newValueState] of [
      ["delete", present.id, deleted.id, "present", "deleted"],
      ["restore", deleted.id, present.id, "deleted", "present"]
    ] as const) {
      const auditId = `audit-state-${action}`;
      await createAuditEvent(pool, {
        id: auditId, organizationId: "audit-local", projectId: local.projectId,
        actorUserId: null, actorType: "system", app: "parameters", kind: "parameter-topology-governance", action: "value-change-applied",
        severity: "Medium", targetType: "project-parameter-binding", targetId: local.id,
        metadata: { targetBindingId: local.id }, traceId: auditId
      });
      await insertBindingHistoryEvent(client, {
        id: `history-state-${action}`, bindingId: local.id, effectiveRevisionId: local.effectiveRevisionId,
        oldCurrentValueId: oldValueId, newCurrentValueId: newValueId,
        successAuditRef: auditId, catalogReleaseId: local.catalogRelease.id
      });
      const event = (await listAuditEvents(pool, { organizationId: "audit-local", eventId: auditId })).items[0];
      expect(event.evidence).toEqual({
        previousValue: present.value, newValue: present.value,
        previousValueState, newValueState, sourceLabel: "不可变参数变更历史"
      });
    }
    await createAuditEvent(pool, {
      id: "audit-deleted-value-only", organizationId: "audit-local", projectId: local.projectId,
      actorUserId: null, actorType: "system", app: "parameter-bindings", kind: "project-value", action: "project-value-appended",
      severity: "Low", targetType: "project-value", targetId: deleted.id,
      metadata: { bindingId: local.id, valueId: deleted.id }, traceId: "audit-deleted-value-only"
    });
    expect((await listAuditEvents(pool, { organizationId: "audit-local", eventId: "audit-deleted-value-only" })).items[0].evidence).toEqual({
      newValue: present.value, newValueState: "deleted", sourceLabel: "不可变参数值记录"
    });
  });
});
