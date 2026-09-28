import type pg from "pg";

import { CatalogSubjectId, type CatalogReleasePin } from "../../modules/parameter-catalog-contract/index";
import { installRegistryProjectionCatalogFixture } from "../../modules/catalog-kernel/runtime/catalogChain.fixture";
import { validCatalogReleaseBundle, refreshAuthoritativeSource } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { createRegistrationService } from "../../modules/parameter-governance/registration/index";

export async function installParameterModuleRegistryProjectionFixture(pool: pg.Pool) {
  return installRegistryProjectionCatalogFixture(pool);
}

type RegistryProjectionFixture = Awaited<ReturnType<typeof installParameterModuleRegistryProjectionFixture>>;

/** Published Driver subjects for MOD comparison, including a 100-row pagination boundary. */
export async function installParameterModuleComparisonCatalogFixture(pool: pg.Pool, additionalDrivers = 0): Promise<{
  pin: CatalogReleasePin;
  additionalSubjectIds: readonly CatalogSubjectId[];
}> {
  if (!Number.isSafeInteger(additionalDrivers) || additionalDrivers < 0 || additionalDrivers > 100) {
    throw new Error("MOD comparison fixture supports 0..100 additional Drivers");
  }
  const complete = validCatalogReleaseBundle();
  const release = structuredClone(complete.releases[0]!);
  const documents = [...release.documents];
  const subject = release.documents.find((document) => document.kind === "subject");
  if (!subject || subject.kind !== "subject") throw new Error("MOD comparison fixture subject missing");
  const additionalSubjectIds: CatalogSubjectId[] = [];
  for (let index = 0; index < additionalDrivers; index += 1) {
    const id = CatalogSubjectId(`csub_mod_page_${index}`);
    const clone = structuredClone(subject);
    Object.assign(clone.content, {
      id, canonicalKey: `driver:mod-page-${index}`,
      selector: { ...clone.content.selector, value: `mod-page-${index}` },
    });
    documents.push(clone);
    additionalSubjectIds.push(id);
  }
  const expanded = { ...release, documents };
  refreshAuthoritativeSource(expanded as Parameters<typeof refreshAuthoritativeSource>[0]);
  const bundle = { schemaVersion: complete.schemaVersion, targetReleaseId: expanded.manifest.release.id, releases: [expanded] };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(pool, {
    mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest,
  });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));
  return { pin: { id: compiled.value.release.id, digest: compiled.value.release.digest }, additionalSubjectIds };
}

export async function registerParameterModuleComparisonDriver(pool: pg.Pool, input: {
  organizationId: string;
  subjectId: CatalogSubjectId;
  destinationModuleId: string;
  release: CatalogReleasePin;
  idempotencyKey: string;
  principalId: string;
  reason?: string;
}) {
  const registration = await createRegistrationService(pool).execute({
    kind: "register", organizationId: input.organizationId, subjectId: input.subjectId,
    subjectKind: "driver", expectedRelease: input.release, placement: { mode: "use-default" },
    destinationModuleId: input.destinationModuleId, method: "explicit",
    proof: { reason: input.reason ?? "Issue 897 MOD comparison fixture" }, idempotencyKey: input.idempotencyKey,
    context: { actorKind: "org-admin", principalId: input.principalId },
  });
  if (!registration.ok) throw new Error(JSON.stringify(registration.error));
  return registration.value;
}

export async function registerParameterModuleRegistryProjectionDriver(
  pool: pg.Pool,
  input: {
    organizationId: string;
    subjectId: CatalogSubjectId;
    destinationModuleId: string;
    release: RegistryProjectionFixture["pin"];
  },
) {
  const registration = await registerParameterModuleComparisonDriver(pool, {
    organizationId: input.organizationId,
    subjectId: input.subjectId,
    destinationModuleId: input.destinationModuleId,
    release: input.release,
    idempotencyKey: "registration-897-canonical",
    principalId: "issue-897-fixture",
    reason: "Issue 897 canonical registry fixture",
  });
  return registration.registrationId;
}
