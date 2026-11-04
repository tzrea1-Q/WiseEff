import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claimCatalogChildOwners } from "../../../scripts/catalog-claim-child-owners";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { setSourceRevisionRegistrationStatus } from "../../testing/parameterCatalog/sourceRevision";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createTrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { CatalogSubjectId, jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { CatalogReleaseDigest } from "../parameter-catalog-contract";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { buildCompleteSuccessor } from "../catalog-publication/builder/completeSuccessor";
import { firstAcmePredecessor, frozenPageIdentity, integerContent } from "../catalog-publication/builder/predecessorHarness";
import { vendorDirectoryHash } from "../catalog-publication/import/vendorYaml";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { createLegacyParameterModule } from "../../testing/legacyParameterModuleFixture";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { createCandidate } from "../parameter-files/candidateService";
import { previewSourceRevisionCandidate } from "../parameter-files/sourceRevisionService";
import { applySourceRevisionCandidate } from "../parameter-files/sourceRevisionCommit";
import { sourceAdminToolchain } from "../parameter-files/sourceAdministration.testHelpers";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import { syncPublishedCatalogProjectValues } from "./catalogProjectValueSync";

describe("child owner claims with approved historical source exclusions", { timeout: 120_000 }, () => {
  it.each([
    { label: "missing", ancestor: "", expected: "ready" },
    { label: "consistent", ancestor: 'compatible = "acme,power";', expected: "ready" },
    { label: "contradictory", ancestor: 'compatible = "vendor,other";', expected: "conflict" },
  ])("$label ancestor retains exact history and respects claim evidence", async ({ label, ancestor, expected }) => {
    const lane = await createEphemeralTestDatabase("owner-history-" + label);
    const db = createPostgresDatabase(lane.url), pool = getRootPostgresPool(db)!;
    const directory = await mkdtemp(path.join(tmpdir(), "wiseeff-owner-history-"));
    try {
      const vendor = path.join(directory, "vendor", "wiseeff");
      await mkdir(vendor, { recursive: true });
      await writeFile(path.join(vendor, "driver.yaml"), 'compatible: ["acme,power"]\nchildNodes: [legacy_child]\nproperties: {}\n');
      await writeFile(path.join(vendor, "child.yaml"), "nodename: [legacy_child]\nproperties: {}\n");
      await writeFile(path.join(directory, "catalog.json"), JSON.stringify({
        vendorContentHash: vendorDirectoryHash(vendor),
        schemaPaths: ["vendor/wiseeff/driver.yaml", "vendor/wiseeff/child.yaml"],
      }));
      const first = firstAcmePredecessor();
      expect((await installPublishedRelease(pool, { mode: "bootstrap", source: jsonCatalogReleaseSource(first.bundle),
        expectedTargetDigest: CatalogReleaseDigest(first.digest) })).ok).toBe(true);
      const built = await buildCompleteSuccessor({ productPath: "m2-core",
        predecessorArtifact: { digest: first.digest, bytes: first.bytes },
        changeSet: [
          { op: "create-subject", kind: "driver", canonicalKey: "driver:vendor,other",
            selector: { kind: "driver-compatible", value: "vendor,other" }, nature: "physical-device", cardinality: "multiple" },
          { op: "create-subject-with-definitions", kind: "node-type", canonicalKey: "node-type:legacy_child",
            selector: { kind: "node-type-name", value: "legacy_child" },
            definitions: [{ propertyKey: "weight", content: integerContent("Weight", "Historical test value.") }] },
        ],
        frozenIdentity: { ...frozenPageIdentity([], "owner-history"), subjects: [
          { canonicalKey: "driver:vendor,other", subjectId: "history-other-driver" },
          { canonicalKey: "node-type:legacy_child", subjectId: "history-child" },
        ], definitions: [{ subjectId: "history-child", propertyKey: "weight",
          definitionId: "history-weight", revisionId: "history-weight-1" }] },
      });
      if (!built.ok || built.value.kind !== "successor") throw new Error(JSON.stringify(built));
      const artifact = built.value.artifact;
      const release = { id: artifact.targetReleaseId, digest: artifact.targetReleaseDigest };
      expect((await installPublishedRelease(pool, { mode: "advance", source: jsonCatalogReleaseSource(artifact.bundle),
        expectedTargetDigest: artifact.targetReleaseDigest,
        expectedCurrent: { id: first.compiled.release.id, digest: CatalogReleaseDigest(first.digest) } })).ok).toBe(true);
      const organizationId = "history-org", projectId = "history-project", userId = "history-admin";
      const auth = makeTestAuthContext({ organizationId, userId, roles: [{ roleId: "admin", projectId: null }] });
      await db.query("insert into organizations(id,name) values ($1,'History')", [organizationId]);
      await db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [userId, organizationId]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('history-role',$1,$2,'admin')", [userId, organizationId]);
      await db.query("insert into projects(id,organization_id,name,code,status,initialization_status) values ($1,$2,'History','HISTORY','active','initialized')", [projectId, organizationId]);
      const business = await createLegacyParameterModule(db, { organizationId, name: "Business", kind: "business", origin: "curated" });
      await db.transaction(async tx => {
        for (const [subjectId, subjectKind] of [["csub_acme_power", "driver"], ["history-other-driver", "driver"], ["history-child", "node-type"]] as const) {
          const registration = await writeGuardedRegistration(tx, { kind: "register", organizationId,
            subjectId: CatalogSubjectId(subjectId), subjectKind, expectedRelease: release, placement: { mode: "use-default" },
            destinationModuleId: "module-" + subjectId, newDestination: { parentModuleId: business.id, name: subjectId },
            method: "explicit", proof: { reason: "Historical source claim test" }, idempotencyKey: "register-" + subjectId,
            context: { actorKind: "org-admin", principalId: userId } });
          if (!registration.ok) throw new Error(JSON.stringify(registration));
        }
      });
      const storage = createMemoryObjectStore();
      const configSetId = (await createConfigSet(db, auth, { projectId, name: "History" })).id;
      const text = "/dts-v1/; / { bus { " + ancestor + " legacy_child { weight = <21>; }; }; };";
      const uploaded = await uploadProjectParameterFile(db, storage, auth, { projectId, fileName: "board.dts", bytes: Buffer.from(text) });
      const fileId = uploaded.file.id;
      await addConfigSetFile(db, auth, { configSetId, fileId, role: "base", sortOrder: 0 });
      const revision = await ingestConfigRevision(db, { organizationId, projectId, configSetId,
        entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: [],
        members: [{ fileId, fileVersionId: uploaded.version.id, fileName: "board.dts", role: "base", sortOrder: 0, content: text }] }, auth);
      await syncPublishedCatalogProjectValues(pool, { organizationId, projectId, configSetId, configRevisionId: revision.id });
      const binding = (await db.query<{ id: string; registration_id: string; current_value_id: string; logical_node_id: string }>(
        "select id,registration_id,current_value_id,logical_node_id from parameter_catalog.project_parameter_bindings where subject_id='history-child'"
      )).rows[0]!;
      expect(binding).toBeDefined();
      const report = async (apply = false) => (await claimCatalogChildOwners(db, directory, apply)).candidates[0]!;
      const beforeStatus = label === "consistent" ? "ready" : "conflict";
      expect(await report()).toMatchObject({ status: beforeStatus });
      await setSourceRevisionRegistrationStatus(db, { organizationId, registrationId: binding.registration_id, status: "retired" });
      // Retirement alone is not an exclusion proof.
      expect(await report()).toMatchObject({ status: beforeStatus });
      const repaired = '/dts-v1/; / { bus { compatible = "acme,power"; legacy_child { weight = <21>; }; }; }; /* reviewed repair */';
      const candidate = await createCandidate(db, storage, auth, { projectId, fileId, fileName: "board.dts",
        bytes: Buffer.from(repaired), intent: "source_revision", expectedCurrentVersionId: uploaded.version.id,
        expectedConfigRevisionId: revision.id, clientMutationId: "history-candidate" });
      const preview = await previewSourceRevisionCandidate(db, storage, auth, { projectId, candidateId: candidate.id },
        { toolchain: sourceAdminToolchain });
      // A preview does not authorize an exception either.
      expect(await report()).toMatchObject({ status: beforeStatus });
      const applied = await applySourceRevisionCandidate(db, storage, auth, { projectId, candidateId: candidate.id,
        expectedCurrentVersionId: uploaded.version.id, expectedProofToken: preview.proofToken,
        reason: "Repair the ancestor of an unmanaged source node", clientMutationId: "history-apply" },
      { invocation: createUserInvocation(auth), requestId: "history-trace", refusalSink: createTrustedRefusalAuditSink(db) },
      { toolchain: sourceAdminToolchain });
      const request = (await db.query<{ applied_source_result: { configRevisionId: string }; source_revision_context: { excludedBindings: unknown[] } }>(
        "select applied_source_result,source_revision_context from project_parameter_value_change_requests where id=$1", [applied.requestId]
      )).rows[0]!;
      expect(request.source_revision_context.excludedBindings).toEqual([expect.objectContaining({
        bindingId: binding.id, oldValueId: binding.current_value_id, reason: "registration-inactive",
      })]);
      if (label !== "consistent") {
        const node = (await db.query<{ logical_node_id: string }>(
          "select logical_node_id from dts_logical_node_revisions where config_revision_id=$1 and node_locator='/bus/legacy_child'",
          [request.applied_source_result.configRevisionId])).rows[0]!;
        expect(node.logical_node_id).not.toBe(binding.logical_node_id);
      }
      const history = async () => (await db.query(
        "select to_jsonb(b) as binding,to_jsonb(v) as value,to_jsonb(p) as pin from parameter_catalog.project_parameter_bindings b " +
        "join parameter_catalog.project_parameter_values v on v.id=b.current_value_id " +
        "join parameter_catalog.project_value_source_pins p on p.project_value_id=v.id and p.binding_id=b.id where b.id=$1", [binding.id]
      )).rows;
      const retained = await history();
      expect(await report()).toMatchObject({ status: expected });
      if (label === "missing") {
        const historicalEvidence = [{ bindingId: binding.id, organizationId, requestId: applied.requestId, reason: "approved-source-exclusion" }];
        expect(await report()).toMatchObject({ historicalEvidence, conflicts: [] });
        // Reactivation must not use this narrowly retired-registration exception.
        await setSourceRevisionRegistrationStatus(db, { organizationId, registrationId: binding.registration_id, status: "active" });
        expect(await report()).toMatchObject({ status: "conflict" });
        await setSourceRevisionRegistrationStatus(db, { organizationId, registrationId: binding.registration_id, status: "retired" });
      }
      expect(await report(true)).toMatchObject({ status: expected === "ready" ? "claimed" : "conflict" });
      expect(await history()).toEqual(retained);
      expect(await report(true)).toMatchObject({ status: expected === "ready" ? "already-claimed" : "conflict" });
      const audits = (await db.query<{ metadata: { claims: Array<{ historicalEvidence?: unknown[] }> } }>(
        "select metadata from audit_events where kind='catalog-child-owners-claimed'"
      )).rows;
      expect(audits).toHaveLength(expected === "ready" ? 1 : 0);
      if (label === "missing") expect(audits[0]!.metadata.claims[0]!.historicalEvidence).toEqual([
        { bindingId: binding.id, organizationId, requestId: applied.requestId, reason: "approved-source-exclusion" },
      ]);
    } finally {
      await db.close();
      await lane.drop();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
