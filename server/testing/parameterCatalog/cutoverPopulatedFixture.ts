import type pg from "pg";

import { validCatalogReleaseBundle } from "../../modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../../modules/catalog-kernel/compiler/types";
import type { FrozenP0Graph } from "../../modules/catalog-cutover/classifier";

/**
 * Populated P0 cutover fixture shared by the cutover suites and the operator CLI
 * integration test. It was duplicated verbatim in `orchestrator.test.ts` and
 * `recovery.integration.test.ts`; keeping one copy means the CLI test exercises
 * exactly the same populated catalog shape as the orchestrator tests.
 *
 * The graph carries one R1 identity (mappable) and one R10 identity (unknown), so
 * a plan has both a mapping target and an unarchived-by-design residue.
 */
export const populatedCutoverGraph = (): FrozenP0Graph => ({
  catalog: "parameter-catalog-p0-graph",
  identities: [
    {
      id: "s7orc-lid-r1",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-spec",
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      sourceId: "s7orc-spec-r1",
    },
    {
      id: "s7orc-lid-r10",
      sourceSystem: "wiseeff-v1",
      sourceKind: "parameter-spec",
      ownerScopeKind: "platform",
      ownerScopeId: "platform",
      sourceId: "s7orc-spec-r10",
    },
  ],
  specs: [
    {
      id: "s7orc-spec-r1",
      organizationId: null,
      sourceKind: "dts",
      specificationKey: "s7orc.r1.status",
      attributionSubjectId: null,
      definitionLifecycle: "active",
      propertyKey: "status",
    },
    {
      id: "s7orc-spec-r10",
      organizationId: null,
      sourceKind: "dts",
      specificationKey: "s7orc.r10.unknown",
      attributionSubjectId: null,
      definitionLifecycle: "active",
      propertyKey: "s7orc,unknown",
    },
  ],
  specVersions: [
    {
      id: "s7orc-ver-r1",
      parameterSpecId: "s7orc-spec-r1",
      version: 1,
      lifecycle: "active",
      versionStatus: "active",
    },
    {
      id: "s7orc-ver-r10",
      parameterSpecId: "s7orc-spec-r10",
      version: 1,
      lifecycle: "active",
      versionStatus: "active",
    },
  ],
  subjects: [],
  driverRegistrations: [],
  nodeTypeDefinitions: [],
  driverSchemas: [],
  driverSchemaVersions: [],
  dtsPropertySpecs: [],
  modules: [],
  placements: [],
  bindings: [],
  bindingRevisions: [],
});

/** The first-release bundle, i.e. `crel_acme_1` alone, as the installed baseline. */
export const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

/**
 * Makes the database a "populated catalog": the P0-P10 phases require legacy
 * parameter specs, their versions, and the frozen legacy identities to exist,
 * and T6 treats an empty catalog as no evidence at all.
 */
export const seedPopulatedCutover = async (
  client: pg.Client,
  graph: FrozenP0Graph,
): Promise<void> => {
  for (const spec of graph.specs) {
    await client.query(
      `
      insert into public.parameter_specs (
        id, organization_id, source_kind, specification_key,
        attribution_subject_id, definition_lifecycle, property_key
      ) values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        spec.id,
        spec.organizationId,
        spec.sourceKind,
        spec.specificationKey,
        spec.attributionSubjectId,
        spec.definitionLifecycle,
        spec.propertyKey,
      ],
    );
  }
  for (const version of graph.specVersions) {
    await client.query(
      `
      insert into public.parameter_spec_versions (
        id, parameter_spec_id, version, display_name, description, value_shape,
        lifecycle, version_status
      ) values ($1, $2, $3, $4, $4, '{}', $5, $6)
      `,
      [
        version.id,
        version.parameterSpecId,
        version.version,
        version.id,
        version.lifecycle,
        version.versionStatus,
      ],
    );
  }
  for (const identity of graph.identities) {
    await client.query(
      `
      insert into parameter_catalog.legacy_identities (
        id, source_system, source_kind, owner_scope_kind, owner_scope_id, source_id
      ) values ($1, $2, $3, $4, $5, $6)
      `,
      [
        identity.id,
        identity.sourceSystem,
        identity.sourceKind,
        identity.ownerScopeKind,
        identity.ownerScopeId,
        identity.sourceId,
      ],
    );
  }
};
