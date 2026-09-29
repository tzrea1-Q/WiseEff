import type pg from "pg";

import { CatalogSubjectId, type CatalogReleasePin } from "../../modules/parameter-catalog-contract/index";
import { installRegistryProjectionCatalogFixture, refreshReleaseSource, X_DEFINITION_ID } from "../../modules/catalog-kernel/runtime/catalogChain.fixture";
import { validCatalogReleaseBundle, refreshAuthoritativeSource } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { createRegistrationService } from "../../modules/parameter-governance/registration/index";

export async function installParameterModuleRegistryProjectionFixture(pool: pg.Pool) {
  return installRegistryProjectionCatalogFixture(pool);
}

type RegistryProjectionFixture = Awaited<ReturnType<typeof installParameterModuleRegistryProjectionFixture>>;

type Mutable<Value> = Value extends readonly (infer Item)[]
  ? Mutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value;

/** Published Catalog source with 60 searchable Definitions and one retired Definition. */
export function knowledgeCatalogBundle() {
  const complete = validCatalogReleaseBundle();
  const release = structuredClone(complete.releases[0]!) as Mutable<(typeof complete.releases)[number]>;
  const subjectTemplate = release.documents.find((document) => document.kind === "subject");
  const definitionTemplate = release.documents.find((document) => document.kind === "definition");
  if (!subjectTemplate || subjectTemplate.kind !== "subject" || !definitionTemplate || definitionTemplate.kind !== "definition") {
    throw new Error("Knowledge Definition fixture templates are missing.");
  }

  for (let index = 0; index < 30; index += 1) {
    const subjectId = `csub_kb_batch_${String(index).padStart(2, "0")}`;
    const subject = structuredClone(subjectTemplate);
    subject.content.id = subjectId;
    subject.content.canonicalKey = `driver:knowledge-batch,device-${index}`;
    subject.content.selector.value = `knowledge-batch,device-${index}`;
    release.documents.push(subject);
    for (let property = 0; property < 2; property += 1) {
      const item = structuredClone(definitionTemplate);
      item.content.id = `pdef_kb_batch_${index}_${property}`;
      item.content.subjectId = subjectId;
      item.content.propertyKey = `knowledge_batch_property_${index}_${property}`;
      item.content.revision.id = `drev_kb_batch_${index}_${property}_1`;
      item.content.revision.displayName = `Knowledge batch property ${index}-${property}`;
      item.content.revision.matching.sourceProperty = item.content.propertyKey;
      release.documents.push(item);
    }
  }

  const retired = structuredClone(definitionTemplate);
  retired.content.id = "pdef_kb_batch_retired";
  retired.content.propertyKey = "knowledge_retired_property";
  retired.content.revision.id = "drev_kb_batch_retired_1";
  retired.content.revision.displayName = "Retired Knowledge Batch Property";
  retired.content.revision.lifecycle = "retired";
  retired.content.revision.matching.sourceProperty = retired.content.propertyKey;
  release.documents.push(retired);
  refreshReleaseSource(release as Parameters<typeof refreshReleaseSource>[0]);
  return {
    schemaVersion: complete.schemaVersion,
    targetReleaseId: release.manifest.release.id,
    releases: [release]
  };
}

/** A published Catalog with more than two pages of searchable Definitions. */
export async function installKnowledgeDefinitionReferencesCatalogFixture(pool: pg.Pool) {
  const bundle = knowledgeCatalogBundle();
  const retiredDefinitionId = bundle.releases[0]!.documents.find(
    (document) => document.kind === "definition" && document.content.id === "pdef_kb_batch_retired"
  );
  if (!retiredDefinitionId || retiredDefinitionId.kind !== "definition") {
    throw new Error("Knowledge Definition fixture is missing its retired Definition.");
  }
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(pool, {
    mode: "bootstrap",
    source: jsonCatalogReleaseSource(bundle),
    expectedTargetDigest: compiled.value.aggregateDigest
  });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));
  return {
    pin: { id: compiled.value.release.id, digest: compiled.value.release.digest },
    activeDefinitionId: X_DEFINITION_ID,
    retiredDefinitionId: retiredDefinitionId.content.id,
    searchTerm: "knowledge_batch_property",
    searchableDefinitionCount: 60
  };
}

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
