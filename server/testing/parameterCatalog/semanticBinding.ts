import type pg from "pg";

import { compileConstrainedVendorCatalogSuccessor } from "../../../scripts/compile-vendor-catalog-release";
import { compileCatalogRelease } from "../../modules/catalog-kernel/compiler";
import { refreshAuthoritativeSource } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { readCurrentCatalogPointer } from "../../modules/catalog-kernel/install/currentPointer";
import { installPublishedRelease } from "../../modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../modules/catalog-kernel/interface";

export const SEMANTIC_BINDING_FIXTURE_RELEASE_ID = "crel_acceptance_bindings_1";

export async function seedSemanticBindingCatalog(pool: pg.Pool): Promise<void> {
  const pointer = await readCurrentCatalogPointer(pool);
  if (pointer.kind === "installed" && pointer.current.id === SEMANTIC_BINDING_FIXTURE_RELEASE_ID) return;
  const vendor = compileConstrainedVendorCatalogSuccessor();
  const release = structuredClone(vendor.bundle.releases.at(-1)!) as Parameters<typeof refreshAuthoritativeSource>[0];
  const subjectTemplate = release.documents.find((document) => document.kind === "subject" && document.content.id === "csub_acme_power");
  const definitionTemplate = release.documents.find((document) => document.kind === "definition" && document.content.id === "pdef_acme_power_iin_max");
  if (!subjectTemplate || subjectTemplate.kind !== "subject" || !definitionTemplate || definitionTemplate.kind !== "definition") {
    throw new Error("Missing published Binding fixture templates");
  }
  release.manifest.release = {
    ...release.manifest.release,
    id: SEMANTIC_BINDING_FIXTURE_RELEASE_ID,
    version: "1.3.0",
    sequence: 4,
    predecessor: { id: vendor.compiled.release.id, digest: vendor.compiled.release.digest }
  };
  for (const fixture of [
    { key: "td079", compatible: "wiseeff,td079-cell", properties: ["iin_max", "iin_min", "vin_min", "charge_voltage_limit_mv"] },
    { key: "chip123", compatible: "vendor,chip123", properties: ["vendor-id"] }
  ]) {
    const subject = structuredClone(subjectTemplate);
    subject.content.id = `csub_acceptance_${fixture.key}`;
    subject.content.canonicalKey = `driver:${fixture.compatible}`;
    subject.content.lifecycle = "active";
    subject.content.tombstone = null;
    subject.content.selector = { kind: "driver-compatible", value: fixture.compatible, provenance: { source: "acceptance-fixture" } };
    release.documents.push(subject);
    for (const propertyKey of fixture.properties) {
      const definition = structuredClone(definitionTemplate);
      definition.content.id = `pdef_acceptance_${fixture.key}_${propertyKey}`;
      definition.content.subjectId = subject.content.id;
      definition.content.propertyKey = propertyKey;
      definition.content.revision.id = `drev_acceptance_${fixture.key}_${propertyKey}_1`;
      definition.content.revision.displayName = propertyKey;
      definition.content.revision.documentation = `Published acceptance fixture for ${fixture.compatible}/${propertyKey}.`;
      delete definition.content.revision.unit;
      definition.content.revision.matching.sourceProperty = propertyKey;
      release.documents.push(definition);
    }
  }
  refreshAuthoritativeSource(release);
  const bundle = { ...vendor.bundle, targetReleaseId: SEMANTIC_BINDING_FIXTURE_RELEASE_ID, releases: [...vendor.bundle.releases, release] };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  const installed = await installPublishedRelease(pool, {
    mode: "advance", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest,
    expectedCurrent: { id: vendor.compiled.release.id, digest: vendor.compiled.release.digest }
  });
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));
}
