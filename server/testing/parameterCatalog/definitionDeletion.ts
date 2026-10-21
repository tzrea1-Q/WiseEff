import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createEphemeralTestDatabase, type EphemeralTestDatabase } from "../testDatabase";
import { createCatalogKernel } from "../../modules/catalog-kernel/interface";
import { documentationOnlySuccessorBundle, installPublishedCatalogChain, X_DEFINITION_ID, Y_DEFINITION_ID } from "../../modules/catalog-kernel/runtime/catalogChain.fixture";
import { CatalogArtifactId, CatalogSubjectId, ParameterDefinitionId } from "../../modules/parameter-catalog-contract/index";
import { createRegistrationService } from "../../modules/parameter-governance/registration";
import { createParameterModule } from "../../modules/parameters/parameterModuleRepository";
import { createSourceBackedBindingService } from "../../modules/parameter-bindings/binding/__fixtures__/sourceBackedBinding";
import { createLocalObjectStore } from "../../modules/logs/objectStore";
import { encodeBundleBytes } from "../../modules/catalog-publication/builder/bundleCodec";
import { persistArtifact } from "../../modules/catalog-publication/persistence/store";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../modules/catalog-publication/runtime/provisionRuntimeLogins";

export const DELETION_ORGANIZATIONS = ["erase-org-a", "erase-org-b"] as const;
export const DELETION_ACTORS = {
  platform: "erase-platform", admin: "erase-admin-a", other: "erase-admin-b",
  project: "erase-project-platform", inactive: "erase-inactive", member: "erase-member",
} as const;

/** Shared populated PostgreSQL fixture: two tenants, two definitions, and real immutable source/value pins. */
export async function createDefinitionDeletionFixture(prefix = "definition_deletion", upgradedDatabase?: EphemeralTestDatabase) {
  const database = upgradedDatabase ?? await createEphemeralTestDatabase(prefix);
  const root = createPostgresDatabase(database.url);
  const pool = getRootPostgresPool(root)!;
  const chain = await installPublishedCatalogChain(pool);
  const bundle = documentationOnlySuccessorBundle();
  const stored = await persistArtifact(root, {
    id: CatalogArtifactId("cart_definition_deletion_fixture"), artifactDigest: chain.pinC.digest,
    artifactBytes: encodeBundleBytes(bundle), sourceKind: "repository-bundle", targetReleaseId: chain.pinC.id,
    targetReleaseDigest: chain.pinC.digest, predecessorReleaseId: chain.pinB.id, predecessorReleaseDigest: chain.pinB.digest,
    toolchain: bundle.releases.at(-1)!.manifest.toolchain,
  });
  if (!stored.ok) throw new Error(JSON.stringify(stored.error));
  const directory = await mkdtemp(join(tmpdir(), "wiseeff-definition-delete-"));
  const storage = createLocalObjectStore(directory);
  await root.query("insert into organizations(id,name) values ($1,'Erasure A'),($2,'Erasure B')", [...DELETION_ORGANIZATIONS]);
  for (const [index, organizationId] of DELETION_ORGANIZATIONS.entries()) {
    await root.query("insert into projects(id,organization_id,name,code) values ($1,$2,$1,$1)", [`erase-project-${index}`, organizationId]);
  }
  for (const [actor, id] of Object.entries(DELETION_ACTORS)) {
    const organizationId = actor === "other" ? DELETION_ORGANIZATIONS[1] : DELETION_ORGANIZATIONS[0];
    await root.query("insert into users(id,organization_id,name,email,title,is_active) values ($1,$2,$1,$3,'Erasure fixture',$4)",
      [id, organizationId, `${id}@deletion.test`, actor !== "inactive"]);
    const role = ["platform", "inactive", "project"].includes(actor) ? "platform-admin" : actor === "member" ? "software-user" : "admin";
    await root.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ($1,$2,$3,$4,$5)",
      [`role-${id}`, id, organizationId, actor === "project" ? "erase-project-0" : null, role]);
  }
  const loaded = await createCatalogKernel(pool).loadCurrentCatalog(chain.pinC);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.error));
  const snapshot = loaded.value;
  const owners = [];
  for (const [index, organizationId] of DELETION_ORGANIZATIONS.entries()) {
    const userId = index === 0 ? DELETION_ACTORS.admin : DELETION_ACTORS.other;
    const business = await createParameterModule(root, { organizationId, name: `Business ${index}` });
    const module = await createParameterModule(root, { organizationId, name: `Driver ${index}`, parentId: business.id, kind: "driver-group" });
    const registration = await createRegistrationService(pool).execute({ kind: "register", organizationId,
      subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: chain.pinC,
      placement: { mode: "use-default" }, destinationModuleId: module.id, method: "explicit", proof: {},
      idempotencyKey: `delete-registration-${index}`, context: { actorKind: "org-admin", principalId: userId } });
    if (!registration.ok) throw new Error(JSON.stringify(registration.error));
    const bindings = [];
    for (const [key, id] of [["x", X_DEFINITION_ID], ["y", Y_DEFINITION_ID]] as const) {
      const definitionId = ParameterDefinitionId(id);
      const definition = snapshot.getDefinitionById(definitionId);
      if (definition.status !== "found") throw new Error("Deletion fixture definition is unavailable");
      const binding = await createSourceBackedBindingService(pool, { objectStore: storage }).stabilize({ snapshot,
        organizationId, projectId: `erase-project-${index}`, logicalNodeId: `delete_${index}_${key}`,
        registrationId: registration.value.registrationId, definitionId,
        effectiveRevisionId: definition.definition.selectedRevision.id, expectedEffectiveRevisionId: null });
      if (!binding.ok) throw new Error(JSON.stringify(binding.error));
      bindings.push(binding.value.binding);
    }
    owners.push({ organizationId, projectId: `erase-project-${index}`, userId, registrationId: registration.value.registrationId, bindings });
  }
  const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: `deletion${randomBytes(5).toString("hex")}` });
  const api = createPostgresDatabase(runtime.apiUrl);
  return { database, root, pool, chain, snapshot, owners, runtime, api, storage, directory,
    async close() {
      await api.close();
      if (runtime.runToken) await dropLabRuntimeLogins(database.url, runtime.runToken);
      await root.close();
      await database.drop();
      await rm(directory, { recursive: true, force: true });
    } };
}
