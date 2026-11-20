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
import { permissionsForRoles } from "../../auth/policy";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import { enablePublicationPolicy } from "../../catalog-publication/authorization/testHarness";
import { encodeBundleBytes, parseBundleBytes } from "../../catalog-publication/builder/bundleCodec";
import { runPublicationManagerOnce } from "../../catalog-publication/jobs/manager";
import { getArtifactByDigest } from "../../catalog-publication/persistence/store";
import { withPublicationCoordinator } from "../../catalog-publication/coordinator";
import { adoptPreexistingCatalog } from "../../catalog-publication/runtime/adoption";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../catalog-publication/runtime/provisionRuntimeLogins";
import { createCatalogKernel, DriverCompatible, jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { verifyCurrentMaterialization } from "../../catalog-kernel/verification";
import { CatalogSubjectId, ParameterDefinitionId } from "../../parameter-catalog-contract";
import { createLocalObjectStore } from "../../logs/objectStore";
import { addConfigSetFile, createConfigSet } from "../../parameter-files/configSetService";
import { uploadProjectParameterFile } from "../../parameter-files/service";
import { ingestConfigRevision } from "../../parameter-topology/ingestService";
import { asValueClient, listCatalogBindingRowsForProject, loadPublishedCatalog, syncPublishedCatalogProjectValuesInTransaction } from "../../parameter-bindings/catalogProjectValueSync";
import { createRegistrationService } from "../../parameter-governance/registration/service";
import { CATALOG_RELEASE_HEADER } from "../../contracts/dtoSchemas/parameterCatalog";
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

it("upgrades the populated Catalog and publishes versioned identities with exact-base approval", async () => {
  await withTempDatabase({ prefix: "identity1577", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { before: "0339" });
    const bootstrap = new pg.Pool({ connectionString });
    try {
      const previous = await seedPublishedCatalog(bootstrap);
      const vendor = compileLocalizedVendorCatalogSuccessor();
      await applyMigrations(db, migrationsDir, { through: "0339_catalog_subject_identity_corrections.sql" });
      const adopt = await adoptPreexistingCatalog(bootstrap, {
        expectedCurrent: previous, actorPrincipalId: "identity-author",
        sourceBytes: encodeBundleBytes(vendor.bundle), artifactDigest: previous.digest, evidenceKind: "synthetic-fixture",
        adoptionEvidence: {
          source_bundle_digest: previous.digest, verification_digest: vendor.compiled.materializationFingerprint,
          data_mode: "fresh", collected_at: "2026-11-20T00:00:00.000Z", approved_by: "identity-author",
        },
      });
      expect(adopt.ok, JSON.stringify(adopt)).toBe(true);
      const observer = await bootstrap.connect();
      try { await enablePublicationPolicy(observer, { publicationEnabled: true, lowRiskSingleActorPublish: true }); }
      finally { observer.release(); }
      const token = `id${randomBytes(5).toString("hex")}`;
      const runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
      const api = createPostgresDatabase(runtime.apiUrl);
      const manager = createPostgresDatabase(runtime.managerUrl);
      const pool = getRootPostgresPool(api)!;
      const managerPool = getRootPostgresPool(manager)!;
      const scopeFor = (principalId: string, role: "platform-admin" | "admin", org = organizationId): TrustedPublicationScope => {
        const auth = makeTestAuthContext({ userId: principalId, organizationId: org, roleId: role, permissions: permissionsForRoles([role]) });
        return { principalId, organizationId: org, actorKind: role === "admin" ? "org-admin" : role,
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
        const editor = makeTestAuthContext({ organizationId, userId: orgAdmin.principalId, roleId: "admin", permissions: permissionsForRoles(["admin"]) });
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
        expect((await importDefinition(short)).body.item.entries[0].diagnostics[0].message).toContain("nature 和 cardinality");
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
        expect((await importDefinition(short)).body.item.entries[0].diagnostics[0].message).toContain("nature 和 cardinality");

        const alias = { op: "set-subject-alias", subjectId, selector: short, active: true };
        scope = orgAdmin;
        expect((await preview(alias)).status).toBe(403);
        scope = author;
        const add = await preview(alias);
        expect(add).toMatchObject({ status: 201, body: { item: { riskClass: "high", impactSummary: { subjectIdentity: { change: alias } } } } });
        const duplicate = await preview(alias);
        expect(duplicate.status).toBe(201);
        expect(await publish(add.body.item.id, "alias-publication")).toMatchObject({ status: 403,
          body: { error: { details: { reason: "publication-self-approval-forbidden" } } } });
        scope = orgAdmin;
        expect((await publish(add.body.item.id, "alias-publication")).status).toBe(403);
        scope = reviewer;
        const approved = await publish(add.body.item.id, "alias-publication");
        expect(approved.status, JSON.stringify(approved)).toBe(201);
        expect(await publish(add.body.item.id, "alias-publication")).toMatchObject({ status: 200, body: { item: { id: approved.body.item.id } } });
        const aliased = await run();
        expect(aliased.id).not.toBe(previous.id);
        releaseId = aliased.id;
        const stale = await publish(duplicate.body.item.id, "concurrent-alias");
        expect(stale.status).toBe(201);
        expect(await run()).toEqual(aliased);
        const staleJob = await fetch(`${http.baseUrl}/api/v2/catalog/publications/${stale.body.item.id}`);
        expect(await staleJob.json()).toMatchObject({ item: { status: "needs-rebase" } });
        scope = author;
        expect(await importDefinition(short)).toMatchObject({ status: 201, body: { item: { entries: [{ match: { subjectId, source: "catalog-alias" } }] } } });

        const renamed = "huawei,direct-charger";
        const rename = await preview({ op: "rename-subject", subjectId, selector: renamed, keepOldAlias: true });
        expect(rename.status, JSON.stringify(rename)).toBe(201);
        expect((await preview({ op: "rename-subject", subjectId, selector: short, keepOldAlias: false })).status).toBe(409);
        scope = reviewer;
        expect((await publish(rename.body.item.id, "rename-publication")).status).toBe(201);
        const current = await run();
        expect(current.id).not.toBe(aliased.id);
        releaseId = current.id;
        scope = author;
        const toImport = await importDefinition(renamed);
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
        expect((await publish(toImport.body.item.candidate.id, "import-huawei-definition")).status).toBe(201);
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
          expect((await publish(candidate.body.item.id, key)).status).toBe(201);
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
