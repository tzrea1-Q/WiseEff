/** Catalog-owned setup for the two-Definition source-origin erasure regression. */
import { getRootPostgresPool, type Database } from "../../shared/database/client";
import type { AuthContext } from "../../modules/auth/types";
import { validCatalogReleaseBundle, refreshAuthoritativeSource } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { encodeBundleBytes, sha256Digest } from "../../modules/catalog-publication/builder/bundleCodec";
import { CatalogSubjectId } from "../../modules/parameter-catalog-contract";
import { executeRegistration } from "../../modules/parameter-governance/registration";
import { createParameterModule } from "../../modules/parameters/parameterModuleRepository";
import { createParameterModuleForAuth } from "../../modules/parameters/service";

export async function installMemberAdditionErasureCatalogFixture(db: Database, auth: AuthContext) {
  const full = validCatalogReleaseBundle(), release = structuredClone(full.releases[0]!) as Parameters<typeof refreshAuthoritativeSource>[0];
  const definition = release.documents.find(document => document.kind === "definition");
  if (!definition || definition.kind !== "definition") throw new Error("Missing Definition fixture");
  const retained = structuredClone(definition); retained.content.id = "pdef_acme_power_retained"; retained.content.propertyKey = "retained";
  retained.content.revision.id = "drev_acme_power_retained_1"; retained.content.revision.matching.sourceProperty = "retained";
  release.documents.push(retained); refreshAuthoritativeSource(release);
  const bundle = { schemaVersion: full.schemaVersion, targetReleaseId: release.manifest.release.id, releases: [release] };
  const compiled = compileCatalogRelease(bundle); if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(getRootPostgresPool(db)!, { mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));
  const bytes = encodeBundleBytes(bundle);
  await db.query(`insert into catalog_publication.release_artifacts(id,artifact_digest,bytes_checksum,artifact_bytes,
    source_kind,target_release_id,target_release_digest,toolchain) values ('cart_add_erasure',$1,$2,$3,'repository-bundle',$4,$1,$5)`,
  [compiled.value.aggregateDigest, sha256Digest(bytes), Buffer.from(bytes), release.manifest.release.id, release.manifest.toolchain]);
  const business = await createParameterModuleForAuth(db, auth, { name: "Erasure", kind: "business" });
  const driver = await createParameterModule(db, { organizationId: auth.organization.id, name: "Erasure driver", kind: "driver-group", parentId: business.id, sourceKey: "compatible:acme,power" });
  const registration = await executeRegistration(getRootPostgresPool(db)!, { kind: "register", organizationId: auth.organization.id,
    subjectId: CatalogSubjectId("csub_acme_power"), subjectKind: "driver", expectedRelease: compiled.value.release,
    destinationModuleId: driver.id, placement: { mode: "use-default" }, method: "explicit", proof: { reason: "Addition erasure regression" },
    idempotencyKey: "add-erasure-register", context: { actorKind: "org-admin", principalId: auth.user.id } });
  if (!registration.ok) throw new Error(JSON.stringify(registration.error));
}
