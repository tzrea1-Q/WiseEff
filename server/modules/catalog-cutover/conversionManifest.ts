import { createHash } from "node:crypto";
import type { CatalogReleaseBundle } from "../catalog-kernel/compiler/types";
import type { FrozenP0Graph } from "./classifier";
import { classifyFrozenP0Graph, fingerprintP0Graph } from "./classifier";
import type { MappingTargetKind } from "./mapping/types";
import type { CutoverQueryable } from "./checkpoints";
import type { ArchiveSourceGraph } from "./archive";
import type { ContractJsonValue } from "../parameter-catalog-contract/index";
import type { BindingImportIntent } from "../parameter-bindings/cutoverImport/intent";
import type { Queryable } from "../../shared/database/client";

export const CONVERSION_MANIFEST_VERSION = "pcat-conversion-manifest-v1";

/** Private, reviewed identity assertions. These are never inferred from names or keys.
 * Source generation and independent approval are the caller's artifact-owner boundary;
 * a manifest digest proves immutable input, not approval or semantic equivalence.
 */
export type ConversionManifest = {
  readonly version: typeof CONVERSION_MANIFEST_VERSION;
  readonly sourceSnapshotFingerprint: string;
  readonly sourceInventoryFingerprint: string;
  readonly targetCatalogReleaseDigest: string;
  readonly mappings: readonly {
    readonly legacyIdentityId: string;
    readonly targetKind: Extract<MappingTargetKind, "parameter-definition" | "definition-revision" | "catalog-subject">;
    readonly targetId: string;
    readonly targetSourceDigest: string;
    /** Explicit retained release for historical revision pins; never inferred from latest. */
    readonly retainedReleaseId?: string;
  }[];
};

export const conversionManifestDigest = (manifest: ConversionManifest): string =>
  `sha256:${createHash("sha256").update(JSON.stringify({
    version: manifest.version,
    sourceSnapshotFingerprint: manifest.sourceSnapshotFingerprint,
    sourceInventoryFingerprint: manifest.sourceInventoryFingerprint,
    targetCatalogReleaseDigest: manifest.targetCatalogReleaseDigest,
    mappings: [...manifest.mappings].sort((a, b) => a.legacyIdentityId.localeCompare(b.legacyIdentityId)),
  })).digest("hex")}`;

/** Full public-row boundary, including the difference between SQL NULL and JSON null.
 * Returns a digest only; raw rows and credentials never belong in a journal/report.
 * Caller must already own the quiescent source boundary. This function does not stop writers.
 */
export async function captureConversionSourceInventory(client: CutoverQueryable): Promise<string> {
  return (await scanConversionSourceInventory(client, false)).sourceInventoryFingerprint;
}

/** Read-only data from the same scan as the historical inventory digest. This
 * does not issue a plan, mapping, write boundary or archive authorization. */
export async function captureConversionSourceSnapshot(client: Queryable): Promise<ConversionSourceSnapshot> {
  return scanConversionSourceInventory(client, true);
}

async function scanConversionSourceInventory(client: Queryable, capture: boolean): Promise<ConversionSourceSnapshot> {
  const prior = await client.query<{ row_security: string }>("show row_security");
  await client.query("set row_security = off");
  try {
  const tables = await client.query<{ table_name: string; columns: string[] }>(`
    select c.relname as table_name, array_agg(a.attname::text order by a.attnum) as columns
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    group by c.relname order by c.relname
  `);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const hash = createHash("sha256");
  const records: ConversionSourceRecord[] = [];
  const capturedRelations = new Set<string>();
  for (const table of tables.rows) {
    const nullFlags = table.columns.map((column) => `(source.${quote(column)} is null)`).join(", ");
    const rows = await client.query<{ source_row: unknown; sql_nulls: boolean[] }>(
      `select to_jsonb(source) as source_row, array[${nullFlags}] as sql_nulls from public.${quote(table.table_name)} source`,
    );
    const canonicalRows = rows.rows.map((row) => JSON.stringify(row)).sort();
    hash.update(JSON.stringify({ table: table.table_name, columns: table.columns, rows: canonicalRows }));
    if (capture && Object.hasOwn(conversionSourceRelations, table.table_name)) {
      capturedRelations.add(table.table_name);
      const sourceKind = conversionSourceRelations[table.table_name as keyof typeof conversionSourceRelations];
      for (const row of rows.rows) {
        const payload = structuredClone(row.source_row);
        if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
          typeof Reflect.get(payload, "id") !== "string" || !Reflect.get(payload, "id") ||
          row.sql_nulls.length !== table.columns.length || row.sql_nulls.some(flag => typeof flag !== "boolean") ||
          new Set(table.columns).size !== table.columns.length ||
          Object.keys(payload).sort().join("\0") !== [...table.columns].sort().join("\0")) {
          throw new Error("PCAT-CONVERSION-SOURCE-PROJECTION-INVALID");
        }
        records.push({ sourceKind, sourceId: Reflect.get(payload, "id"),
          payload: payload as Record<string, ContractJsonValue>,
          sqlNullColumns: table.columns.filter((_, index) => row.sql_nulls[index]).sort() });
      }
    }
  }
    if (capture && capturedRelations.size !== Object.keys(conversionSourceRelations).length) {
      throw new Error("PCAT-CONVERSION-SOURCE-PROJECTION-INCOMPLETE");
    }
    records.sort((left, right) => left.sourceKind < right.sourceKind ? -1 : left.sourceKind > right.sourceKind ? 1 :
      left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0);
    if (records.some((record, index) => index > 0 && record.sourceKind === records[index - 1]!.sourceKind &&
      record.sourceId === records[index - 1]!.sourceId)) throw new Error("PCAT-CONVERSION-SOURCE-PROJECTION-DUPLICATE");
    return { sourceInventoryFingerprint: `sha256:${hash.digest("hex")}`, records };
  } finally {
    await client.query(prior.rows[0]?.row_security === "off" ? "set row_security = off" : "set row_security = on");
  }
}

// Only the existing definition/subject/module-placement owners needed by the
// complete source graph are exposed. Other public rows remain digest-only.
const conversionSourceRelations = {
  parameter_specs: "parameter-spec", parameter_spec_versions: "parameter-spec-version",
  driver_schemas: "driver-schema", driver_schema_versions: "driver-schema-version",
  dts_property_specs: "dts-property-spec", attribution_subjects: "parameter-subject",
  parameter_modules: "parameter-module", driver_registration_placements: "parameter-placement",
  parameter_module_mappings: "parameter-module-mapping",
} as const;
export type ConversionSourceRecord = {
  readonly sourceKind: typeof conversionSourceRelations[keyof typeof conversionSourceRelations];
  readonly sourceId: string;
  readonly payload: Readonly<Record<string, ContractJsonValue>>;
  readonly sqlNullColumns: readonly string[];
};
export type ConversionSourceSnapshot = {
  readonly sourceInventoryFingerprint: string;
  readonly records: readonly ConversionSourceRecord[];
};

export async function captureArchivedDefinitionGraph(client: CutoverQueryable, sourceId: string): Promise<ArchiveSourceGraph | null> {
  const source = await client.query<{ source_payload: ContractJsonValue }>("select to_jsonb(source) as source_payload from public.parameter_specs source where id = $1", [sourceId]);
  if (source.rows.length !== 1) return null;
  const revisions = await client.query<{ revision: ContractJsonValue }>("select to_jsonb(revision) as revision from public.parameter_spec_versions revision where parameter_spec_id = $1 order by version, id", [sourceId]);
  return { sourcePayload: source.rows[0].source_payload, relationGraph: { sourceId, revisions: revisions.rows.map((row) => row.revision) } };
}

export async function definitionGraphMatchesSource(client: CutoverQueryable, graph: FrozenP0Graph): Promise<boolean> {
  const specs = await client.query<{ record: unknown }>(`select jsonb_build_object('id', id, 'organizationId', organization_id, 'sourceKind', source_kind, 'specificationKey', specification_key, 'attributionSubjectId', attribution_subject_id, 'definitionLifecycle', definition_lifecycle, 'propertyKey', property_key) as record from public.parameter_specs order by id`);
  const versions = await client.query<{ record: unknown }>(`select jsonb_build_object('id', id, 'parameterSpecId', parameter_spec_id, 'version', version, 'lifecycle', lifecycle, 'versionStatus', version_status) as record from public.parameter_spec_versions order by id`);
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
    return JSON.stringify(value);
  };
  return canonical(specs.rows.map((row) => row.record)) === canonical([...graph.specs].sort((a, b) => a.id.localeCompare(b.id))) && canonical(versions.rows.map((row) => row.record)) === canonical([...graph.specVersions].sort((a, b) => a.id.localeCompare(b.id)));
}

export function inspectConversionManifest(input: {
  readonly graph: FrozenP0Graph;
  readonly targetCatalogReleaseDigest: string;
  readonly bundle: CatalogReleaseBundle;
  readonly manifest: ConversionManifest;
  readonly bindingImportIntent?: BindingImportIntent;
}): string | null {
  const { manifest, graph, bundle } = input;
  if (manifest.version !== CONVERSION_MANIFEST_VERSION || !/^sha256:[a-f0-9]{64}$/.test(manifest.sourceInventoryFingerprint) || manifest.sourceSnapshotFingerprint !== fingerprintP0Graph(graph) || manifest.targetCatalogReleaseDigest !== input.targetCatalogReleaseDigest) return "conversion-manifest-pin-mismatch";
  const classification = classifyFrozenP0Graph(graph);
  if (!classification.ok) return "conversion-classification-unavailable";
  if (classification.value.assignments.some((assignment) => ["blocked", "review-evidence", "definition-proposal"].includes(assignment.disposition))) return "conversion-disposition-producer-unavailable";
  if ((graph.bindings.length || graph.bindingRevisions.length || graph.placements.length) && !input.bindingImportIntent) return "conversion-business-history-producer-unavailable";
  const businessKinds = new Set(["project-parameter-binding","project-parameter-binding-revision"]);
  const expected = classification.value.assignments.filter((assignment) => assignment.disposition === "mapped" && !(input.bindingImportIntent && businessKinds.has(assignment.sourceKind)));
  if (manifest.mappings.length !== expected.length || new Set(manifest.mappings.map((mapping) => mapping.legacyIdentityId)).size !== manifest.mappings.length) return "conversion-mapping-conservation";
  const target = bundle.releases.find((release) => release.manifest.release.id === bundle.targetReleaseId);
  if (!target) return "conversion-release-unavailable";
  for (const mapping of manifest.mappings) {
    const identity = graph.identities.find((row) => row.id === mapping.legacyIdentityId);
    if (!identity || !expected.some((row) => row.identityId === mapping.legacyIdentityId)) return "conversion-identity-unavailable";
    const assignment = expected.find(row => row.identityId === identity.id);
    const expectedKind = assignment?.rClass === "R2" && ["parameter-spec","driver-schema"].includes(identity.sourceKind) ? "catalog-subject"
      : identity.sourceKind === "parameter-spec" ? "parameter-definition"
      : identity.sourceKind === "parameter-spec-version" ? "definition-revision"
      : identity.sourceKind === "parameter-subject" ? "catalog-subject" : null;
    if (!expectedKind || mapping.targetKind !== expectedKind) return "conversion-source-kind-unavailable";
    const retained = mapping.targetKind === "definition-revision" && mapping.retainedReleaseId ? bundle.releases.find(r => r.manifest.release.id === mapping.retainedReleaseId) : target;
    const document = retained?.documents.find((doc) => mapping.targetKind === "catalog-subject"
      ? doc.kind === "subject" && doc.content.id === mapping.targetId
      : doc.kind === "definition" && (mapping.targetKind === "parameter-definition" ? doc.content.id : doc.content.revision.id) === mapping.targetId);
    if (!document || document.source.digest !== mapping.targetSourceDigest) return "conversion-target-authority-mismatch";
  }
  return null;
}
