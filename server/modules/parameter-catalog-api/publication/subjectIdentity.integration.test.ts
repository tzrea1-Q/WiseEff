import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { compileLocalizedVendorCatalogSuccessor } from "../../../../scripts/compile-vendor-catalog-release";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { makeTestAuthContext } from "../../../testing/authContext";
import { seedPublishedCatalog } from "../../../testing/parameterCatalog/seedPublishedCatalog";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import { connect } from "../../catalog-kernel/install/publicationTestHarness";
import { enablePublicationPolicy } from "../../catalog-publication/authorization/testHarness";
import { encodeBundleBytes, parseBundleBytes } from "../../catalog-publication/builder/bundleCodec";
import { runPublicationManagerOnce } from "../../catalog-publication/jobs/manager";
import { getArtifactByDigest } from "../../catalog-publication/persistence/store";
import { withPublicationCoordinator } from "../../catalog-publication/coordinator";
import { adoptPreexistingCatalog } from "../../catalog-publication/runtime/adoption";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { createCatalogKernel, DriverCompatible, jsonCatalogReleaseSource, NormalizedNodeTypeName } from "../../catalog-kernel/interface";
import { verifyCurrentMaterialization } from "../../catalog-kernel/verification";
import { CatalogSubjectId, ParameterDefinitionId } from "../../parameter-catalog-contract";
import { createLocalObjectStore } from "../../logs/objectStore";
import { addConfigSetFile, createConfigSet } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../parameter-bindings/catalogProjectValueSync";
import { createRegistrationService } from "../../parameter-governance/registration/service";
import { readModuleRecognitionSubjectDefaults } from "../../parameter-governance/queries/moduleRecognition";
import { loadOrganizationCatalogSnapshot, readRegistrationRecognitionSettings,
  registrationRecognitionEtag, updateRegistrationRecognitionSettings } from "../../parameter-modules/recognitionSettings";
import {
  CATALOG_RELEASE_HEADER, catalogMarkdownImportResponseSchema, catalogPublicationCandidateResponseSchema,
  catalogPublicationJobResponseSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { listenCatalogPublicationHttpServer } from "./http";
import { bindCatalogPublicationCommands } from "./ports";
import type { TrustedPublicationScope } from "./types";

const subjectId = "csub_drv_huawei_direct_charger";
const transferTargetId = "csub_drv_huawei_charging_core";
const primary = "huawei,direct_charger";
const short = "direct_charger";
const organizationId = "org-identity-publication";
const foreignOrganizationId = "org-identity-foreign";
const projectId = "project-identity-publication";

it("upgrades a populated Catalog and reviews versioned identity, owner, kind, defaults and lifecycle changes", async () => {
  await withTempDatabase({ prefix: "identity1577", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { before: "0339" });
    const bootstrap = new pg.Pool({ connectionString });
    try {
      const previous = await seedPublishedCatalog(bootstrap);
      const vendor = compileLocalizedVendorCatalogSuccessor();
    await applyMigrations(db, migrationsDir);
      const adopt = await adoptPreexistingCatalog(bootstrap, {
        expectedCurrent: previous, actorPrincipalId: "identity-author",
        sourceBytes: encodeBundleBytes(vendor.bundle), artifactDigest: previous.digest, evidenceKind: "synthetic-fixture",
        adoptionEvidence: {
          source_bundle_digest: previous.digest, verification_digest: vendor.compiled.materializationFingerprint,
          data_mode: "fresh", collected_at: "2026-11-20T00:00:00.000Z", approved_by: "identity-author",
        },
      });
      expect(adopt.ok, JSON.stringify(adopt)).toBe(true);
      const observer = await connect(connectionString);
      try { await enablePublicationPolicy(observer, { publicationEnabled: true, lowRiskSingleActorPublish: true }); }
      finally { await observer.end(); }
      const token = `id${randomBytes(5).toString("hex")}`;
      const runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
      const api = createPostgresDatabase(runtime.apiUrl);
      const manager = createPostgresDatabase(runtime.managerUrl);
      const pool = getRootPostgresPool(api)!;
      const managerPool = getRootPostgresPool(manager)!;
      const scopeFor = (principalId: string, role: "platform-admin" | "admin", org = organizationId, alsoOrgAdmin = false): TrustedPublicationScope => {
        const auth = makeTestAuthContext({ userId: principalId, organizationId: org, roles: [
          { roleId: role, projectId: null },
          ...(alsoOrgAdmin ? [{ roleId: "admin" as const, projectId: null }] : []),
        ] });
        return { principalId, organizationId: org, actorKind: role === "admin" ? "org-admin" : role, projectScope: { kind: "all" },
          permissions: auth.permissions, trustedActor: createUserInvocation(auth) };
      };
      const author = scopeFor("identity-author", "platform-admin");
      const reviewer = scopeFor("identity-reviewer", "platform-admin");
      const orgAdmin = scopeFor("identity-org-admin", "admin");
      let scope = author;
      let releaseId: string = previous.id;
      const http = await listenCatalogPublicationHttpServer({
        authenticate: async () => ({ ok: true, scope }),
        currentRelease: async () => {
          const pointer = await readCurrentCatalogPointer(pool);
          return pointer.kind === "installed" ? pointer.current : null;
        },
        ...bindCatalogPublicationCommands({ db: api, pool }),
      });
      const post = async (path: string, body: unknown) => {
        const response = await fetch(`${http.baseUrl}/api/v2/catalog/publication-candidates${path}`, {
          method: "POST", headers: { "content-type": "application/json", [CATALOG_RELEASE_HEADER]: releaseId },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      };
      const preview = (change: unknown) => post("", { changeSet: [change] });
      const publish = (id: string, idempotencyKey: string) => post(`/${id}/publish`, { idempotencyKey });
      const candidateId = (body: unknown) => catalogPublicationCandidateResponseSchema.parse(body).item.id;
      const jobId = (body: unknown) => catalogPublicationJobResponseSchema.parse(body).item.id;
      const importResult = (body: unknown) => catalogMarkdownImportResponseSchema.parse(body).item;
      const importDefinition = (selector: string, selectedSubjectId?: string) => post("", {
        markdownImport: {
          fileName: "charger.md",
          document: `# Driver \`${selector}\`\n## \`support_series_bat_mode\` 串联电池模式\n| 字段 | 值 |\n| --- | --- |\n| 类型 | boolean |`,
          ...(selectedSubjectId ? { organizationSubjectSelections: [{ selector, subjectId: selectedSubjectId }] } : {}),
        },
      });
      const run = async (approvedBy = reviewer) => {
        expect(await runPublicationManagerOnce({ db: manager, pool: managerPool, installer: createCatalogInstaller(managerPool),
          resolvePublisherActor: async () => approvedBy.trustedActor })).toBe("claimed");
        const pointer = await readCurrentCatalogPointer(pool);
        if (pointer.kind !== "installed") throw new Error("missing current release");
        return pointer.current;
      };
      const objectRoot = await mkdtemp(join(tmpdir(), "wiseeff-1577-dts-"));
      try {
        expect((await managerPool.query("select rolsuper from pg_roles where rolname=current_user")).rows).toEqual([{ rolsuper: false }]);
        await db.query("insert into organizations(id,name) values ($1,$1),($2,$2)", [organizationId, foreignOrganizationId]);
        await db.query("insert into users(id,organization_id,name,title) values ($1,$2,'Editor','Editor')", [orgAdmin.principalId, organizationId]);
        await db.query("insert into projects(id,organization_id,name,code,status) values ($1,$2,'Huawei DTS','I1577','initialized')", [projectId, organizationId]);
        await db.query("insert into parameter_modules(id,organization_id,name,path,depth,kind,origin) values ('huawei-module',$1,'Huawei','huawei',1,'business','curated')", [organizationId]);
        const result = await createRegistrationService(pool).execute({
          kind: "register", organizationId, subjectId: CatalogSubjectId(subjectId), subjectKind: "driver",
          expectedRelease: previous, placement: { mode: "use-default" }, destinationModuleId: "huawei-module",
          method: "explicit", displayAlias: short, proof: {}, idempotencyKey: "identity-test-registration",
          context: { actorKind: "platform-admin", principalId: author.principalId },
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        const editor = makeTestAuthContext({ organizationId, userId: orgAdmin.principalId, roleId: "admin" });
        const configSet = await createConfigSet(api, editor, { projectId, name: "Huawei DTS" });
        const fileName = "charger.dts";
        const dts = '/dts-v1/; / { charger { compatible = "huawei,direct_charger"; use_5A = <1 0>; }; };';
        const file = await uploadProjectParameterFile(api, createLocalObjectStore(objectRoot), editor, { projectId, fileName, bytes: Buffer.from(dts) });
        await addConfigSetFile(api, editor, { configSetId: configSet.id, fileId: file.file.id, role: "base", sortOrder: 0 });
        const config = await ingestConfigRevision(api, {
          organizationId, projectId, configSetId: configSet.id, entryFile: fileName, includeSearchPaths: ["."], overlayOrder: [],
          members: [{ fileId: file.file.id, fileVersionId: file.version.id, fileName, sourceName: fileName, role: "base", sortOrder: 0, content: dts }],
        }, editor);
        const catalog = await loadPublishedCatalog(pool);
        if (!catalog) throw new Error("missing fixture Catalog");
        await api.transaction(tx => syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), catalog,
          { organizationId, projectId, configSetId: configSet.id, configRevisionId: config.id }));
        const readBindings = async () => (await listCatalogBindingRowsForProject(api, editor, { projectId })).map(binding =>
          ({ id: binding.id, definitionId: binding.definitionId, currentValueId: binding.currentValueId,
            sourceOccurrenceId: binding.sourceOccurrenceId, rawValue: binding.rawValue }));
        const bound = await readBindings();
        expect(bound).toMatchObject([{ definitionId: "pdef_drv_huawei_direct_charger_use_5A" }]);
        expect(importResult((await importDefinition(short)).body).entries[0]?.diagnostics[0]?.message).toContain("nature 和 cardinality");
        await db.query(`insert into public.registration_recognition_rules
          (organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
          select organization_id,id,subject_id,array[$3],'physical-device','multiple'
          from parameter_catalog.organization_subject_registrations where organization_id=$1 and subject_id=$2`,
        [organizationId, subjectId, short]);
        const unconfirmed = await importDefinition(short);
        expect(unconfirmed).toMatchObject({ status: 200, body: { item: { candidate: null, entries: [
          { matchCandidates: [{ subjectId, source: "organization-compatible" }] },
        ] } } });
        expect(await importDefinition(short, subjectId)).toMatchObject({ status: 201, body: { item: {
          candidate: { impactSummary: { addedDefinitionCount: 1, addedSubjectCount: 0 } },
          entries: [{ match: { subjectId, source: "organization-compatible" } }],
        } } });
        scope = scopeFor("identity-author", "platform-admin", foreignOrganizationId);
        expect(await importDefinition(short, subjectId)).toMatchObject({ status: 200, body: { item: { candidate: null } } });
        expect(importResult((await importDefinition(short)).body).entries[0]?.diagnostics[0]?.message).toContain("nature 和 cardinality");

        const alias = { op: "set-subject-alias", subjectId, selector: short, active: true };
        scope = orgAdmin;
        expect((await preview(alias)).status).toBe(403);
        scope = author;
        const add = await preview(alias);
        expect(add).toMatchObject({ status: 201, body: { item: { riskClass: "high", impactSummary: { subjectIdentity: { change: alias } } } } });
        expect(await publish(candidateId(add.body), "alias-publication")).toMatchObject({ status: 403,
          body: { error: { details: { reason: "publication-self-approval-forbidden" } } } });
        scope = scopeFor("identity-author", "platform-admin", organizationId, true);
        expect(await publish(candidateId(add.body), "alias-publication")).toMatchObject({ status: 403,
          body: { error: { details: { reason: "publication-self-approval-forbidden" } } } });
        scope = orgAdmin;
        expect((await publish(candidateId(add.body), "alias-publication")).status).toBe(403);
        scope = reviewer;
        const approved = await publish(candidateId(add.body), "alias-publication");
        expect(approved.status, JSON.stringify(approved)).toBe(201);
        expect(await publish(candidateId(add.body), "alias-publication")).toMatchObject({ status: 200, body: { item: { id: jobId(approved.body) } } });
        const aliased = await run();
        expect(aliased.id).not.toBe(previous.id);
        releaseId = aliased.id;
        scope = author;
        expect(await importDefinition(short)).toMatchObject({ status: 201, body: { item: { entries: [{ match: { subjectId, source: "catalog-alias" } }] } } });

        const renamed = "huawei,direct-charger";
        const rename = await preview({ op: "rename-subject", subjectId, selector: renamed, keepOldAlias: true });
        expect(rename.status, JSON.stringify(rename)).toBe(201);
        const competing = await preview({ op: "rename-subject", subjectId, selector: "huawei,direct-charger-alt", keepOldAlias: false });
        expect(competing.status).toBe(201);
        expect((await preview({ op: "rename-subject", subjectId, selector: short, keepOldAlias: false })).status).toBe(409);
        scope = reviewer;
        expect((await publish(candidateId(rename.body), "rename-publication")).status).toBe(201);
        const competingJob = await publish(candidateId(competing.body), "concurrent-rename");
        expect(competingJob.status).toBe(201);
        const current = await run();
        expect(current.id).not.toBe(aliased.id);
        releaseId = current.id;
        expect(await run()).toEqual(current);
        const staleJob = await fetch(`${http.baseUrl}/api/v2/catalog/publications/${jobId(competingJob.body)}`);
        expect(await staleJob.json()).toMatchObject({ item: { status: "needs-rebase" } });
        scope = author;
        const toImport = importResult((await importDefinition(renamed)).body).candidate;
        if (!toImport) throw new Error("Huawei definition import candidate was not created");
        for (const [name, source] of [[primary, "catalog-alias"], [renamed, "catalog-primary"]]) {
          expect(await importDefinition(name!)).toMatchObject({ status: 201, body: { item: {
            candidate: { impactSummary: { addedDefinitionCount: 1, addedSubjectCount: 0 } },
            entries: [{ match: { subjectId, canonicalName: renamed, source } }],
          } } });
        }
        const kernel = createCatalogKernel(pool);
        const pinned = await kernel.loadPinnedCatalog(previous);
        const active = await kernel.loadCurrentCatalog(current);
        if (!pinned.ok || !active.ok) throw new Error(`Catalog read failed: ${JSON.stringify({ pinned, active })}`);
        const match = (name: string) => ({ driverCompatibles: [DriverCompatible(name)], nodeTypeFallback: { kind: "absent" as const } });
        expect(pinned.value.resolveSubject(match(primary))).toMatchObject({ status: "matched", subject: { id: subjectId, canonicalKey: primary } });
        expect(pinned.value.resolveSubject(match(renamed)).status).toBe("unknown");
        expect(active.value.resolveSubject(match(primary))).toMatchObject({ status: "matched", subject: { id: subjectId, canonicalKey: renamed }, matchedBy: "alias" });
        expect(active.value.getSubject(CatalogSubjectId(subjectId))).toMatchObject({ status: "found", subject: { id: subjectId, canonicalKey: renamed } });
        expect(await readBindings()).toEqual(bound);
        const artifact = await withPublicationCoordinator(manager, tx => getArtifactByDigest(tx, current.digest));
        if (!artifact.ok) throw new Error(JSON.stringify(artifact));
        const bundle = parseBundleBytes(artifact.value.artifactBytes);
        if (!bundle.ok) throw new Error(bundle.detail);
        const verified = await verifyCurrentMaterialization(bootstrap, { source: jsonCatalogReleaseSource(bundle.bundle), expected: current });
        expect(verified.ok && verified.value.status, JSON.stringify(verified)).toBe("verified");
        expect((await db.query("select subject_id from parameter_catalog.organization_subject_registrations where organization_id=$1", [organizationId])).rows)
          .toEqual([{ subject_id: subjectId }]);
        expect((await publish(toImport.id, "import-huawei-definition")).status).toBe(201);
        const imported = await run(author);
        expect(imported.id).not.toBe(current.id);
        releaseId = imported.id;
        const importedSnapshot = await kernel.loadCurrentCatalog(imported);
        if (!importedSnapshot.ok) throw new Error(JSON.stringify(importedSnapshot));
        const definition = await db.query<{ id: string }>(
          "select id from parameter_catalog.parameter_definitions where property_key='support_series_bat_mode' and subject_id=$1",
          [subjectId],
        );
        expect(definition.rows).toHaveLength(1);
        expect(importedSnapshot.value.getDefinitionById(ParameterDefinitionId(definition.rows[0]!.id))).toMatchObject({
          status: "found", definition: { subjectId, propertyKey: "support_series_bat_mode" },
        });

        const publishAliasChange = async (change: unknown, key: string) => {
          scope = author;
          const candidate = await preview(change);
          expect(candidate.status, JSON.stringify(candidate)).toBe(201);
          scope = reviewer;
          expect((await publish(candidateId(candidate.body), key)).status).toBe(201);
          const installed = await run();
          expect(installed.id).not.toBe(releaseId);
          releaseId = installed.id;
          return installed;
        };
        const disabled = await publishAliasChange({ ...alias, active: false }, "disable-huawei-alias");
        const retiredAlias = await kernel.loadCurrentCatalog(disabled);
        if (!retiredAlias.ok) throw new Error(JSON.stringify(retiredAlias));
        expect(retiredAlias.value.resolveSubject(match(short)).status).toBe("retired");
        const restored = await publishAliasChange(alias, "restore-huawei-alias");
        const transferred = await publishAliasChange({ ...alias, subjectId: transferTargetId, fromSubjectId: subjectId }, "transfer-huawei-alias");
        const beforeTransfer = await kernel.loadPinnedCatalog(restored);
        const afterTransfer = await kernel.loadCurrentCatalog(transferred);
        if (!beforeTransfer.ok || !afterTransfer.ok) throw new Error("alias transfer snapshots could not be loaded");
        expect(beforeTransfer.value.resolveSubject(match(short))).toMatchObject({ status: "matched", subject: { id: subjectId }, matchedBy: "alias" });
        expect(afterTransfer.value.resolveSubject(match(short))).toMatchObject({ status: "matched", subject: { id: transferTargetId }, matchedBy: "alias" });

        const defaults = { op: "set-driver-defaults", subjectId, nature: "logical-service", cardinality: "singleton-per-project" };
        await db.query("delete from registration_recognition_rules where organization_id=$1", [organizationId]);
        const manyDts = '/dts-v1/; / { first { compatible = "huawei,direct-charger"; }; second { compatible = "huawei,direct-charger"; }; };';
        const manyFileName = "charger-two.dts";
        const manySet = await createConfigSet(api, editor, { projectId, name: "Two chargers" });
        const manyFile = await uploadProjectParameterFile(api, createLocalObjectStore(objectRoot), editor, {
          projectId, fileName: manyFileName, bytes: Buffer.from(manyDts),
        });
        await addConfigSetFile(api, editor, { configSetId: manySet.id, fileId: manyFile.file.id, role: "base", sortOrder: 0 });
        await ingestConfigRevision(api, { organizationId, projectId, configSetId: manySet.id, entryFile: manyFileName,
          includeSearchPaths: ["."], overlayOrder: [], members: [{ fileId: manyFile.file.id, fileVersionId: manyFile.version.id,
            fileName: manyFileName, sourceName: manyFileName, role: "base", sortOrder: 0, content: manyDts }] }, editor);
        scope = author;
        const blocked = await preview(defaults);
        expect(blocked).toMatchObject({ status: 201, body: { item: { riskClass: "high", impactSummary: { subjectIdentity: { rules: {
          conflictCounts: [{ count: 1, reason: "singleton-project" }],
          conflicts: [{ projectId, instanceCount: 3, reason: "singleton-project" }],
        } } } } } });
        scope = reviewer;
        expect((await publish(candidateId(blocked.body), "blocked-huawei-defaults")).status).toBe(409);
        if (!result.ok) throw new Error("missing Huawei registration");
        const currentRule = await readRegistrationRecognitionSettings(api, organizationId, result.value.registrationId);
        if (!currentRule) throw new Error("missing inherited recognition settings");
        const overridden = await updateRegistrationRecognitionSettings(api, {
          organizationId, registrationId: result.value.registrationId, ifMatch: registrationRecognitionEtag(currentRule),
          idempotencyKey: "retain-huawei-multiple", requestId: "retain-huawei-multiple", invocation: createUserInvocation(editor),
          catalogReleaseId: releaseId, body: { instanceCardinality: "multiple" },
        });
        expect(overridden).toMatchObject({ overridden: true, instanceCardinality: "multiple" });
        if (!overridden) throw new Error("missing saved override");
        scope = author;
        const untilChanged = await preview(defaults);
        expect(untilChanged.body).toMatchObject({ item: { impactSummary: { subjectIdentity: { rules: { conflictCounts: [] } } } } });
        expect((await publish(candidateId(untilChanged.body), "author-cannot-approve-shared-rules")).status).toBe(403);
        scope = reviewer;
        const queued = await publish(candidateId(untilChanged.body), "before-organization-rule-changed");
        expect(queued.status).toBe(201);
        await updateRegistrationRecognitionSettings(api, {
          organizationId, registrationId: result.value.registrationId, ifMatch: registrationRecognitionEtag(overridden),
          idempotencyKey: "narrow-huawei-multiple", requestId: "narrow-huawei-multiple", invocation: createUserInvocation(editor),
          catalogReleaseId: releaseId, body: { compatibles: [renamed] },
        });
        expect((await run()).id).toBe(releaseId);
        const drifted = await fetch(`${http.baseUrl}/api/v2/catalog/publications/${jobId(queued.body)}`);
        expect(await drifted.json()).toMatchObject({ item: { status: "needs-rebase" } });
        const updated = await publishAliasChange(defaults, "update-huawei-defaults");
        expect(await readModuleRecognitionSubjectDefaults(api, [subjectId], transferred.id)).toMatchObject([
          { nature: "physical-device", cardinality: "multiple" },
        ]);
        expect(await readModuleRecognitionSubjectDefaults(api, [subjectId], updated.id)).toMatchObject([
          { nature: "logical-service", cardinality: "singleton-per-project" },
        ]);
        expect((await db.query("select driver_nature, instance_cardinality from registration_recognition_rules where organization_id=$1", [organizationId])).rows)
          .toEqual([{ driver_nature: "physical-device", instance_cardinality: "multiple" }]);

        const makeNode = (name: string, ownerSubjectId?: string) => ({
          op: "create-subject", kind: "node-type", canonicalKey: `node-type:${name}`,
          selector: { kind: "node-type-name", value: name }, ...(ownerSubjectId ? { ownerSubjectId } : {}),
        });
        const node = "issue1578_sensor";
        const standalone = await publishAliasChange(makeNode(node), "publish-standalone-node");
        const nodeMatch = (owner?: string) => ({ driverCompatibles: [],
          nodeTypeFallback: { kind: "present" as const, name: NormalizedNodeTypeName(node) },
          ...(owner ? { ownerContext: [DriverCompatible(owner)] } : {}),
        });
        const loadAt = async (pin: typeof standalone) => {
          const loaded = await kernel.loadPinnedCatalog(pin);
          if (!loaded.ok) throw new Error(JSON.stringify(loaded));
          return loaded.value;
        };
        const originalNode = (await loadAt(standalone)).resolveSubject(nodeMatch());
        if (originalNode.status !== "matched") throw new Error(JSON.stringify(originalNode));
        const nodeId = originalNode.subject.id;
        const attached = await publishAliasChange({ op: "change-subject-owner", subjectId: nodeId, ownerSubjectId: subjectId }, "attach-shared-node");
        expect((await loadAt(attached)).resolveSubject(nodeMatch(renamed))).toMatchObject({ status: "matched", subject: { id: nodeId, owner: subjectId } });
        expect((await loadAt(attached)).resolveSubject(nodeMatch()).status).toBe("unknown");
        const aliasedChild = await publishAliasChange({ op: "set-subject-alias", subjectId: nodeId,
          selector: "issue1578_sensor_alias", active: true }, "alias-moved-child");
        const childAlias = { ...nodeMatch(renamed), nodeTypeFallback: { kind: "present" as const,
          name: NormalizedNodeTypeName("issue1578_sensor_alias") } };
        expect((await loadAt(aliasedChild)).resolveSubject(childAlias)).toMatchObject({ status: "matched", subject: { id: nodeId }, matchedBy: "alias" });
        expect((await loadAt(attached)).resolveSubject(childAlias).status).toBe("unknown");
        await publishAliasChange(makeNode(node, transferTargetId), "publish-same-name-under-another-driver");
        scope = author;
        expect((await preview({ op: "change-subject-owner", subjectId: nodeId, ownerSubjectId: transferTargetId })).status).toBe(409);
        expect((await preview({ op: "retire-subject", subjectId, successorSubjectId: transferTargetId, inheritChildren: true })).status).toBe(409);
        const detached = await publishAliasChange({ op: "change-subject-owner", subjectId: nodeId, ownerSubjectId: null }, "detach-shared-node");
        expect((await loadAt(detached)).resolveSubject(nodeMatch())).toMatchObject({ status: "matched", subject: { id: nodeId } });
        expect((await loadAt(detached)).getSubject(CatalogSubjectId(nodeId))).not.toMatchObject({ subject: { owner: subjectId } });
        expect((await loadAt(attached)).resolveSubject(nodeMatch(renamed))).toMatchObject({ status: "matched", subject: { id: nodeId, owner: subjectId } });
        expect((await loadAt(standalone)).resolveSubject(nodeMatch())).toMatchObject({ status: "matched", subject: { id: nodeId } });

        const converted = await publishAliasChange({ op: "replace-subject-kind", subjectId: nodeId,
          replacement: { kind: "driver", selector: "wiseeff,issue1578-sensor", nature: "physical-device", cardinality: "multiple" } }, "convert-node-kind");
        const changed = await loadAt(converted);
        const successor = changed.resolveSubject(match("wiseeff,issue1578-sensor"));
        expect(successor).toMatchObject({ status: "matched", subject: { kind: "driver" } });
        if (successor.status !== "matched") throw new Error(JSON.stringify(successor));
        expect(successor.subject.id).not.toBe(nodeId);
        expect(changed.getSubject(CatalogSubjectId(nodeId))).toMatchObject({ status: "retired", subject: { kind: "node-type" } });

        const register = (id: string, kind: "driver" | "node-type", pin: typeof standalone) =>
          createRegistrationService(pool).execute({ kind: "register", organizationId, subjectId: CatalogSubjectId(id),
            subjectKind: kind, expectedRelease: pin, placement: { mode: "use-default" }, destinationModuleId: "huawei-module",
            method: "explicit", proof: {}, idempotencyKey: `register-${id}`,
            context: { actorKind: "platform-admin", principalId: author.principalId } });
        expect((await register(transferTargetId, "driver", converted)).ok).toBe(true);
        const thirdDriver = "csub_drv_huawei_batt_info";
        expect((await register(thirdDriver, "driver", converted)).ok).toBe(true);
        const organizationChildName = "issue1578_overridden";
        const nextChildRelease = await publishAliasChange(makeNode(organizationChildName), "publish-organization-override-node");
        const inventory = (await loadAt(nextChildRelease)).resolveSubject({
          driverCompatibles: [], nodeTypeFallback: { kind: "present", name: NormalizedNodeTypeName(organizationChildName) },
        });
        if (inventory.status !== "matched") throw new Error(JSON.stringify(inventory));
        const orgChildId = inventory.subject.id;
        const orgChild = await register(orgChildId, "node-type", nextChildRelease);
        if (!orgChild.ok) throw new Error(JSON.stringify(orgChild.error));
        const ownerRelease = await publishAliasChange({ op: "change-subject-owner", subjectId: orgChildId, ownerSubjectId: subjectId }, "attach-registered-node");
        const local = await createRegistrationService(pool).execute({
          kind: "change-owner", organizationId, registrationId: orgChild.value.registrationId,
          expectedRelease: ownerRelease, expectedRegistrationVersion: `active:${orgChild.value.registrationVersion}`,
          ownerSubjectId: CatalogSubjectId(thirdDriver), idempotencyKey: "override-organization-owner",
          reason: "Keep organization DTS attribution",
          context: { actorKind: "org-admin", principalId: editor.user.id, invocation: createUserInvocation(editor),
            requestId: "override-organization-owner" },
        });
        if (!local.ok) throw new Error(JSON.stringify(local.error));
        const inherited = await publishAliasChange({ op: "retire-subject", subjectId, successorSubjectId: transferTargetId, inheritChildren: true },
          "inherit-children-during-shared-retirement");
        const baseSnapshot = await loadAt(inherited);
        expect(baseSnapshot.getSubject(CatalogSubjectId(orgChildId))).toMatchObject({ subject: { owner: transferTargetId } });
        const localSnapshot = await loadOrganizationCatalogSnapshot(api, organizationId, baseSnapshot);
        expect(localSnapshot.getSubject(CatalogSubjectId(orgChildId))).toMatchObject({ subject: { owner: thirdDriver } });
        const sharedRestored = await publishAliasChange({ op: "restore-subject", subjectId }, "restore-driver-after-child-inheritance");
        expect((await loadAt(sharedRestored)).getSubject(CatalogSubjectId(orgChildId))).toMatchObject({ subject: { owner: transferTargetId } });
        const withdrawnChild = await createRegistrationService(pool).execute({
          kind: "retire", organizationId, registrationId: orgChild.value.registrationId,
          expectedRelease: sharedRestored, expectedRegistrationVersion: `active:${local.value.registrationVersion}`,
          reason: "Organization decision", idempotencyKey: "retire-organization-child",
          context: { actorKind: "org-admin", principalId: editor.user.id, invocation: createUserInvocation(editor),
            requestId: "retire-organization-child" },
        });
        expect(withdrawnChild).toMatchObject({ ok: true, value: { registrationStatus: "retired" } });
        const withdrawn = await publishAliasChange({ op: "retire-subject", subjectId, successorSubjectId: transferTargetId }, "retire-shared-driver");
        expect((await loadAt(withdrawn)).resolveSubject(match(renamed))).toMatchObject({ status: "retired" });
        expect(await readBindings()).toEqual([]);
        const reinstated = await publishAliasChange({ op: "restore-subject", subjectId }, "restore-shared-driver");
        expect((await loadAt(reinstated)).resolveSubject(match(renamed))).toMatchObject({ status: "matched", subject: { id: subjectId } });
        expect(await readBindings()).toEqual(bound);
        expect((await db.query("select status, cascade_retired, owner_subject_id from parameter_catalog.organization_subject_registrations where id=$1",
          [orgChild.value.registrationId])).rows).toEqual([{ status: "retired", cascade_retired: false, owner_subject_id: thirdDriver }]);
      } finally {
        await http.close();
        await api.close();
        await manager.close();
        await dropLabRuntimeLogins(connectionString, token);
        await rm(objectRoot, { recursive: true, force: true });
      }
    } finally {
      await bootstrap.end();
    }
  });
}, 120_000);
