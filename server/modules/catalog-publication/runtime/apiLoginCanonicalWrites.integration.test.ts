import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { createManagedInstanceTestDatabase } from "../../../testing/testDatabase";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../../testing/labRuntimeLogins";
import { makeTestAuthContext } from "../../../testing/authContext";
import { captureConfigurationSourceState } from "../../../testing/parameterCatalog/configurationSource";
import { seedCanonicalParameterFixture } from "../../agent/testing/canonicalParameterFixture";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import { parseDtsValue } from "../../dts";
import { asValueClient, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../parameter-bindings/catalogProjectValueSync";
import { loadCanonicalBindingPins } from "../../parameter-bindings/drafts/repository";
import { createCanonicalValueDraft } from "../../parameter-bindings/drafts/service";
import { submitCanonicalValueChange, reviewCanonicalValueChange } from "../../parameter-bindings/drafts/changeService";
import { loadSourceBindingCohort, readOwnedCurrentBinding, loadOwnedProjectValueSourcePin } from "../../parameter-bindings/values";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { createConfigSet, addConfigSetFile } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { registerCanonicalJsonSource } from "../../parameter-files/canonicalJsonSource";
import { createDebugNode } from "../../debugging/catalogSplitRepository";
import {
  resolveDebugNodeCanonicalReference, lockDebugNodeCanonicalAssociation,
  assertDebugNodeCanonicalReferenceCurrent, type CanonicalDebugReference,
} from "../../debugging/canonicalProtectedReference";

describe("API LOGIN canonical source writes", () => {
  it.each(["json", "dts"] as const)("registers/initializes, drafts, submits, approves and locks a %s source as the API LOGIN", async (sourceFormat) => {
    const database = await createManagedInstanceTestDatabase(`api-canonical-${sourceFormat}`);
    const owner = createPostgresDatabase(database.url);
    const directory = await mkdtemp(join(tmpdir(), "wiseeff-api-canonical-"));
    const storage = createLocalObjectStore(directory);
    const runToken = `source${randomBytes(5).toString("hex")}`;
    let api: RootDatabase | undefined;
    try {
      const fixture = await seedCanonicalParameterFixture(owner, storage, { sourceFormat });
      await owner.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id)
        values ('api-source-admin',$1,$2,null,'admin')`, [fixture.reviewerAuth.user.id, fixture.organizationId]);
      const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken });
      api = createPostgresDatabase(runtime.apiUrl);
      const db = api;
      const scope = { organizationId: fixture.organizationId, projectId: fixture.projectId };
      const admin = makeTestAuthContext({ userId: fixture.reviewerAuth.user.id, organizationId: fixture.organizationId,
        roles: [{ roleId: "admin", projectId: null }] });
      const refusalSink = createTrustedRefusalAuditSink(db);
      const snapshot = await loadPublishedCatalog(getRootPostgresPool(db)!);
      if (!snapshot) throw new Error("Published fixture is unavailable.");
      const source = (await db.query<{ storageKey: string }>(
        'select storage_key as "storageKey" from project_parameter_file_versions where id=$1',
        [fixture.sourceFileVersionId],
      )).rows[0]!;
      const bytes = await storage.get(source.storageKey);
      const set = await createConfigSet(db, admin, { projectId: fixture.projectId, name: "API source" });
      const fileName = `api-source.${sourceFormat}`;
      const uploaded = await uploadProjectParameterFile(db, storage, admin, { projectId: fixture.projectId, fileName, bytes });
      await addConfigSetFile(db, admin, { configSetId: set.id, fileId: uploaded.file.id, role: "base", sortOrder: 0 });
      if (sourceFormat === "json") {
        const registered = await db.transaction((tx) => registerCanonicalJsonSource(tx, storage, admin, snapshot, {
          projectId: fixture.projectId, configSetId: set.id, fileId: uploaded.file.id, fileVersionId: uploaded.version.id,
          configurationSchemaId: "wiseeff.issue905.parameters", rootPointer: "",
          mappings: [{ definitionId: fixture.definitionId, pointer: "/limit" }],
          invocation: createUserInvocation(admin), requestId: "api-json-register", refusalSink,
        }));
        expect(registered.bindings).toHaveLength(1);
      } else {
        const revision = await ingestConfigRevision(db, {
          ...scope, configSetId: set.id, entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
          members: [{ fileId: uploaded.file.id, fileVersionId: uploaded.version.id, fileName,
            role: "base", sortOrder: 0, content: bytes.toString("utf8") }],
        }, admin, { legacyProjection: "skip" });
        expect(revision.status).toBe("resolved");
        expect(await db.transaction((tx) => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot,
          { ...scope, configSetId: set.id, configRevisionId: revision.id }))).toBe(1);
      }
      const cohort = await db.transaction((tx) => loadSourceBindingCohort(tx, { ...scope, configSetId: set.id }));
      expect(cohort).toHaveLength(1);
      const bindingId = cohort[0]!.bindingId;
      const pins = await loadCanonicalBindingPins(db, { ...scope, bindingId });
      if (!pins) throw new Error("API-created source pin is unavailable.");
      expect(pins.sourceFormat).toBe(sourceFormat);
      const before = await captureConfigurationSourceState(db, scope);
      const draftInput = { projectId: fixture.projectId, bindingId, baseRevisionId: pins.configRevisionId,
        baseCurrentValueId: pins.currentValueId, reason: "API LOGIN source write",
        ...(sourceFormat === "json" ? { sourceTarget: { format: "json" as const, sourceText: "9" } }
          : { targetValue: parseDtsValue("iin_max", "<9>").value }) };
      const options = { objectStore: storage, invocation: createUserInvocation(fixture.editorAuth),
        requestId: "api-source-draft", refusalSink };
      await expect(createCanonicalValueDraft(db, fixture.otherAuth, draftInput, {
        ...options, invocation: createUserInvocation(fixture.otherAuth),
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
      const draft = await createCanonicalValueDraft(db, fixture.editorAuth, draftInput, options);
      const submitted = await submitCanonicalValueChange(db, fixture.editorAuth, {
        projectId: fixture.projectId, draftId: draft.id, assignedToUserId: fixture.reviewerAuth.user.id,
        invocation: createUserInvocation(fixture.editorAuth), requestId: "api-source-submit", refusalSink,
      });
      expect(submitted.status).toBe("pending");
      expect(await readOwnedCurrentBinding(db, { ...scope, bindingId }))
        .toMatchObject({ status: "current", binding: { currentValueId: pins.currentValueId } });
      expect(await loadOwnedProjectValueSourcePin(db, { ...scope, bindingId, projectValueId: pins.currentValueId }))
        .toMatchObject({ sourcePinId: pins.sourcePinId, configRevisionId: pins.configRevisionId });
      const reviewInput = { projectId: fixture.projectId, requestId: submitted.id, decision: "approve" as const };
      const reviewOptions = { objectStore: storage, snapshot, invocation: createUserInvocation(fixture.reviewerAuth),
        traceId: "api-source-review", refusalSink };
      await expect(reviewCanonicalValueChange(db, fixture.editorAuth, reviewInput, {
        ...reviewOptions, invocation: createUserInvocation(fixture.editorAuth),
      })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const pending = await captureConfigurationSourceState(db, scope);
      expect(pending.bindings).toEqual(before.bindings);
      expect(pending.values).toEqual(before.values);
      expect(pending.pins).toEqual(before.pins);
      await expect(db.transaction(async (tx) => {
        expect((await reviewCanonicalValueChange(tx, fixture.reviewerAuth, reviewInput, reviewOptions)).status).toBe("approved");
        throw new Error("late-source-rollback");
      })).rejects.toThrow("late-source-rollback");
      expect(await captureConfigurationSourceState(db, scope)).toEqual(pending);
      const approved = await reviewCanonicalValueChange(db, fixture.reviewerAuth, reviewInput, reviewOptions);
      expect(approved.status).toBe("approved");
      expect(approved.appliedValueId).toBeTruthy();
      expect(approved.appliedValueId).not.toBe(pins.currentValueId);
      expect(await reviewCanonicalValueChange(db, fixture.reviewerAuth, reviewInput, reviewOptions)).toEqual(approved);
      const after = await captureConfigurationSourceState(db, scope);
      expect(after.values).toHaveLength(before.values.length + 1);
      expect(after.pins).toHaveLength(before.pins.length + 1);
      const current = await readOwnedCurrentBinding(db, { ...scope, bindingId });
      expect(current).toMatchObject({ status: "current", binding: { currentValueId: approved.appliedValueId } });
      const reference = await resolveDebugNodeCanonicalReference(db, fixture.editorAuth, {
        projectId: fixture.projectId, bindingId, mode: "mutate",
      });
      expect(reference.protectedReferenceKind).toBe("canonical-pin");
      const exact = reference as CanonicalDebugReference;
      expect(exact.sourcePinId).not.toBe(pins.sourcePinId);
      expect(exact.configRevisionId).not.toBe(pins.configRevisionId);
      const node = await createDebugNode(db, { organizationId: fixture.organizationId, name: "API canonical node",
        canonicalProjectId: fixture.projectId, canonicalBindingId: bindingId });
      await db.transaction(async (tx) => {
        const identity = () => tx.query(`select current_user as actor, session_user as login, pg_backend_pid() as pid`);
        const started = (await identity()).rows[0];
        expect(started).toMatchObject({ actor: runtime.apiRole, login: runtime.apiRole });
        await lockDebugNodeCanonicalAssociation(tx, fixture.editorAuth, node.id, exact);
        await assertDebugNodeCanonicalReferenceCurrent(tx, fixture.editorAuth, exact);
        await loadSourceBindingCohort(tx, { ...scope, configSetId: set.id });
        for (const [relation, id] of [
          ["project_parameter_source_occurrences", exact.sourcePin.sourceOccurrenceId],
          ["current_project_parameter_bindings", bindingId],
          ["project_value_source_pins", exact.sourcePinId],
        ] as const) {
          await expect(db.transaction((rival) => rival.query(
            `select id from parameter_catalog.${relation} where id=$1 for update nowait`, [id],
          ))).rejects.toMatchObject({ code: "55P03" });
        }
        expect((await identity()).rows[0]).toEqual(started);
      });
      await expect(db.transaction((tx) => lockDebugNodeCanonicalAssociation(tx, fixture.otherAuth, node.id, exact)))
        .rejects.toMatchObject({ code: "CONFLICT", details: { reason: "association-drift" } });
      await expect(db.transaction((tx) => assertDebugNodeCanonicalReferenceCurrent(tx, fixture.otherAuth, exact)))
        .rejects.toMatchObject({ code: "CONFLICT", details: { reason: "version-drift" } });
    } finally {
      await api?.close();
      const roles = await dropLabRuntimeLogins(database.url, runToken);
      await owner.close();
      await database.drop();
      await rm(directory, { recursive: true, force: true });
      expect(roles.failed).toEqual([]);
    }
  }, 120_000);
});
