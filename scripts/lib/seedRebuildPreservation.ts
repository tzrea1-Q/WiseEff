import { createHash } from "node:crypto";

import type { ObjectStore } from "../../server/modules/logs/objectStore";
import {
  ARCHIVED_PARAMETER_PLANE_RELATIONS,
  parameterPlaneScopePredicate,
} from "../../server/modules/parameter-bindings/seedInitialization/archive";
import type { Queryable } from "../../server/shared/database/client";
import { seedRebuildDigest } from "./seedRebuildPlan";

const TARGETS = ["atlas", "aurora", "nebula"] as const;
const ROW_LIMIT = 100_000;
const OBJECT_LIMIT = 64 * 1024 * 1024;

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const relationName = (schema: string, table: string): string => `${schema}.${table}`;
const sqlRelation = (relation: string): string => relation.split(".").map(quoteIdentifier).join(".");

const archivedRelations = new Map<string, (typeof ARCHIVED_PARAMETER_PLANE_RELATIONS)[number]>(
  ARCHIVED_PARAMETER_PLANE_RELATIONS.map((item) => [item.from, item]),
);

/** These relations are rebuilt for the three reviewed projects. */
const TARGET_SCOPED_RELATIONS = new Set([
  "public.project_parameter_plane_archives",
  "public.dts_nodes",
  "public.dts_properties",
  "public.dts_phandle_refs",
  "public.dts_node_occurrences",
  "public.dts_property_occurrences",
  "public.dts_occurrence_effects",
  "public.dts_validation_runs",
  "public.dts_validation_diagnostics",
  "public.dts_reload_run_targets",
  "parameter_catalog.parameter_observations",
  "parameter_catalog.parameter_observation_matches",
  "parameter_catalog.plane_disposal_runs",
]);

/** New rows are allowed; existing rows remain protected by their primary keys. */
const APPEND_ONLY_RELATIONS = new Set([
  "public.parameter_modules",
  "public.audit_events",
  "public.audit_subject_links",
  "public.parameter_specs",
  "public.parameter_spec_versions",
  "public.dts_property_specs",
  "public.attribution_subjects",
  "public.driver_registration_placements",
  "public.driver_registrations",
  "public.driver_schema_versions",
  "public.driver_schemas",
  "public.node_type_definitions",
  "parameter_catalog.organization_subject_registrations",
  "parameter_catalog.subject_placements",
  "parameter_catalog.parameter_review_evidence",
  "parameter_catalog.parameter_review_items",
  "parameter_catalog.parameter_review_resolutions",
  "parameter_catalog.governance_command_idempotency",
  "public.seed_initialization_runs",
]);

/** Explicit publication-owned allowlist. Unlisted Catalog tables stay exact. */
const PUBLICATION_APPEND_RELATIONS = new Set([
  "parameter_catalog.catalog_releases",
  "parameter_catalog.catalog_subjects",
  "parameter_catalog.catalog_drivers",
  "parameter_catalog.catalog_node_types",
  "parameter_catalog.catalog_configuration_schemas",
  "parameter_catalog.catalog_release_subjects",
  "parameter_catalog.catalog_subject_aliases",
  "parameter_catalog.catalog_release_subject_aliases",
  "parameter_catalog.definition_revisions",
  "parameter_catalog.catalog_release_definition_heads",
  "parameter_catalog.catalog_materializations",
  "parameter_catalog.catalog_activation_receipts",
]);

const PUBLICATION_MUTABLE_RELATIONS = new Map<string, readonly string[]>([
  ["parameter_catalog.catalog_state", ["current_catalog_release_id"]],
  ["parameter_catalog.parameter_definitions", ["current_revision_id"]],
]);

type PreservationMode =
  | "exact"
  | "parameter-plane"
  | "target-scoped"
  | "append-only"
  | "publication-append"
  | "publication-window";

type RelationInventory = {
  relation: string;
  schema: string;
  table: string;
  relkind: string;
  columns: string[];
  primaryKeyColumns: string[];
};

type TableSnapshot = {
  relation: string;
  mode: PreservationMode;
  keyColumns: string[];
  ids: string[] | null;
  count: number;
  digest: string;
};

export type SeedPreservation = {
  schema: {
    relations: Array<Pick<RelationInventory, "relation" | "relkind" | "columns" | "primaryKeyColumns">>;
    digest: string;
  };
  tables: TableSnapshot[];
  objects: Array<{ key: string; size: number; digest: string }>;
};

type QuerySpec = {
  predicate: string;
  args: unknown[];
  ignoredColumns: readonly string[];
};

type Classification = {
  mode: PreservationMode;
  ignoredColumns: readonly string[];
};

function keyExpression(columns: readonly string[]): string {
  if (columns.length === 0) throw new Error("seed-rebuild-preservation-primary-key-unavailable");
  return `jsonb_build_array(${columns.map((column) => `to_jsonb(t)->${quoteLiteral(column)}`).join(", ")})::text`;
}

function projectionExpression(ignoredColumns: readonly string[]): string {
  if (ignoredColumns.length === 0) return "to_jsonb(t)";
  const names = ignoredColumns.map(quoteLiteral).join(", ");
  return `(to_jsonb(t) - array[${names}]::text[])`;
}

function targetProjectScopes(scope: string): { predicate: string; args: unknown[] } {
  const predicates = TARGETS.map((_, index) => scope.replaceAll("$2", `$${index + 2}`));
  return {
    predicate: `not coalesce((${predicates.join(") or (")}), false)`,
    args: ["__organization_id__", ...TARGETS],
  };
}

function targetScopedPredicate(relation: string, columns: Set<string>): string {
  if (columns.has("project_id") && columns.has("organization_id")) {
    return "organization_id = $1 and project_id = $2";
  }
  if (columns.has("file_version_id")) {
    return `file_version_id in (
      select version.id
      from public.project_parameter_file_versions version
      join public.project_parameter_files file on file.id = version.file_id
      where file.organization_id = $1 and file.project_id = $2
    )`;
  }
  if (columns.has("config_revision_id")) {
    return `config_revision_id in (
      select revision.id
      from public.dts_config_revisions revision
      where revision.organization_id = $1 and revision.project_id = $2
    )`;
  }
  if (relation === "public.dts_reload_run_targets" && columns.has("reload_run_id")) {
    return `reload_run_id in (
      select run.id
      from public.dts_reload_runs run
      where run.organization_id = $1 and run.project_id = $2
    )`;
  }
  if (columns.has("binding_id")) {
    const bindingScope = `binding_id in (
      select binding.id
      from public.project_parameter_bindings binding
      where binding.organization_id = $1 and binding.project_id = $2
    )`;
    if (relation === "public.dts_reload_run_targets" && columns.has("disposed_binding_id")) {
      return `(${bindingScope} or disposed_binding_id in (
        select binding.id
        from public.project_parameter_bindings binding
        where binding.organization_id = $1 and binding.project_id = $2
      ))`;
    }
    return bindingScope;
  }
  if (relation === "public.dts_properties" && columns.has("node_id")) {
    return `node_id in (
      select node.id
      from public.dts_nodes node
      join public.project_parameter_file_versions version on version.id = node.file_version_id
      join public.project_parameter_files file on file.id = version.file_id
      where file.organization_id = $1 and file.project_id = $2
    )`;
  }
  if (relation === "public.dts_phandle_refs" && columns.has("from_property_id")) {
    return `from_property_id in (
      select property.id
      from public.dts_properties property
      join public.dts_nodes node on node.id = property.node_id
      join public.project_parameter_file_versions version on version.id = node.file_version_id
      join public.project_parameter_files file on file.id = version.file_id
      where file.organization_id = $1 and file.project_id = $2
    )`;
  }
  if (relation === "public.dts_validation_diagnostics" && columns.has("validation_run_id")) {
    return `validation_run_id in (
      select run.id
      from public.dts_validation_runs run
      join public.dts_config_revisions revision on revision.id = run.config_revision_id
      where revision.organization_id = $1 and revision.project_id = $2
    )`;
  }
  throw new Error("seed-rebuild-preservation-scope-unavailable");
}

function classifyRelation(row: RelationInventory): Classification {
  const archived = archivedRelations.get(row.relation);
  if (archived) return { mode: "parameter-plane", ignoredColumns: [] };
  const publicationMutable = PUBLICATION_MUTABLE_RELATIONS.get(row.relation);
  if (publicationMutable) return { mode: "publication-window", ignoredColumns: publicationMutable };
  if (PUBLICATION_APPEND_RELATIONS.has(row.relation)) {
    return { mode: "publication-append", ignoredColumns: [] };
  }
  if (TARGET_SCOPED_RELATIONS.has(row.relation)) {
    targetScopedPredicate(row.relation, new Set(row.columns));
    return { mode: "target-scoped", ignoredColumns: [] };
  }
  if (APPEND_ONLY_RELATIONS.has(row.relation)) return { mode: "append-only", ignoredColumns: [] };
  return { mode: "exact", ignoredColumns: [] };
}

function usesPrimaryKeys(mode: PreservationMode): boolean {
  return mode === "append-only"
    || mode === "publication-append"
    || mode === "publication-window";
}

async function loadInventory(db: Queryable): Promise<RelationInventory[]> {
  const result = await db.query<{
    schema_name: string;
    table_name: string;
    relkind?: string;
    columns: string[];
    primary_key_columns?: string[];
  }>(`
    select
      namespace.nspname as schema_name,
      relation.relname as table_name,
      relation.relkind::text as relkind,
      array_agg(attribute.attname::text order by attribute.attnum) as columns,
      coalesce(primary_key.primary_key_columns, '{}'::text[]) as primary_key_columns
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_attribute attribute
      on attribute.attrelid = relation.oid
     and attribute.attnum > 0
     and not attribute.attisdropped
    left join lateral (
      select array_agg(primary_attribute.attname::text order by key.ordinality) as primary_key_columns
      from pg_index index_record
      cross join lateral unnest(index_record.indkey) with ordinality as key(attnum, ordinality)
      join pg_attribute primary_attribute
        on primary_attribute.attrelid = relation.oid
       and primary_attribute.attnum = key.attnum
       and not primary_attribute.attisdropped
      where index_record.indrelid = relation.oid
        and index_record.indisprimary
    ) primary_key on true
    where relation.relkind in ('r', 'p')
      and namespace.nspname in ('public', 'parameter_catalog')
    group by namespace.nspname, relation.relname, relation.relkind, primary_key.primary_key_columns
    order by namespace.nspname, relation.relname`,
  );
  return result.rows.map((row) => ({
    relation: relationName(row.schema_name, row.table_name),
    schema: row.schema_name,
    table: row.table_name,
    relkind: row.relkind ?? "r",
    columns: [...row.columns],
    primaryKeyColumns: [...(row.primary_key_columns ?? [])],
  }));
}

function schemaSnapshot(inventory: readonly RelationInventory[]): SeedPreservation["schema"] {
  const relations = inventory.map(({ relation, relkind, columns, primaryKeyColumns }) => ({
    relation,
    relkind,
    columns: [...columns],
    primaryKeyColumns: [...primaryKeyColumns],
  }));
  return { relations, digest: seedRebuildDigest(relations) };
}

function targetExclusionForRelation(
  row: RelationInventory,
  mode: "parameter-plane" | "target-scoped",
): { predicate: string; args: unknown[] } {
  const source = mode === "parameter-plane"
    ? parameterPlaneScopePredicate(archivedRelations.get(row.relation)!.scope)
    : targetScopedPredicate(row.relation, new Set(row.columns));
  const target = targetProjectScopes(source);
  return {
    predicate: target.predicate,
    args: target.args.map((value) => value === "__organization_id__" ? null : value),
  };
}

function querySpec(
  row: RelationInventory,
  mode: PreservationMode,
  ids: string[] | null,
  organizationId: string,
  ignoredColumns: readonly string[],
): QuerySpec {
  if (mode === "parameter-plane" || mode === "target-scoped") {
    const target = targetExclusionForRelation(row, mode);
    target.args[0] = organizationId;
    return { ...target, ignoredColumns };
  }
  if (usesPrimaryKeys(mode)) {
    return {
      predicate: `${keyExpression(row.primaryKeyColumns)} = any($1::text[])`,
      args: [ids ?? []],
      ignoredColumns,
    };
  }
  return { predicate: "true", args: [], ignoredColumns };
}

async function captureKeyIds(db: Queryable, row: RelationInventory): Promise<string[]> {
  const result = await db.query<{ key: string }>(
    `select ${keyExpression(row.primaryKeyColumns)} as key
     from ${sqlRelation(row.relation)} t
     order by key
     limit ${ROW_LIMIT + 1}`,
  );
  if (result.rows.length > ROW_LIMIT) throw new Error("seed-rebuild-preservation-row-limit");
  return result.rows.map((item) => item.key);
}

async function hashRows(db: Queryable, row: RelationInventory, spec: QuerySpec) {
  const result = await db.query<{ hash: string }>(
    `select encode(sha256(convert_to((${projectionExpression(spec.ignoredColumns)})::text, 'UTF8')), 'hex') as hash
     from ${sqlRelation(row.relation)} t
     where ${spec.predicate}
     order by 1
     limit ${ROW_LIMIT + 1}`,
    spec.args,
  );
  if (result.rows.length > ROW_LIMIT) throw new Error("seed-rebuild-preservation-row-limit");
  return {
    count: result.rows.length,
    digest: seedRebuildDigest(result.rows.map((item) => item.hash)),
  };
}

function assertSchemaMatches(
  baseline: SeedPreservation["schema"],
  current: SeedPreservation["schema"],
): void {
  if (baseline.digest !== current.digest) throw new Error("seed-rebuild-preservation-schema-drift");
  const baselineRelations = baseline.relations.map((item) => item.relation).sort();
  const currentRelations = current.relations.map((item) => item.relation).sort();
  if (seedRebuildDigest(baselineRelations) !== seedRebuildDigest(currentRelations)) {
    throw new Error("seed-rebuild-preservation-schema-drift");
  }
}

/** Hashes only; row contents (including credentials) never leave PostgreSQL. */
export async function captureSeedPreservation(
  db: Queryable,
  store: ObjectStore,
  organizationId: string,
): Promise<SeedPreservation> {
  const inventory = await loadInventory(db);
  const schema = schemaSnapshot(inventory);
  const tables: SeedPreservation["tables"] = [];
  const protectedKeys = new Set<string>();

  for (const row of inventory) {
    const classification = classifyRelation(row);
    const ids = usesPrimaryKeys(classification.mode) ? await captureKeyIds(db, row) : null;
    const spec = querySpec(row, classification.mode, ids, organizationId, classification.ignoredColumns);
    const hash = await hashRows(db, row, spec);
    tables.push({
      relation: row.relation,
      mode: classification.mode,
      keyColumns: [...row.primaryKeyColumns],
      ids,
      ...hash,
    });

    if (row.columns.includes("storage_key")) {
      const keys = await db.query<{ key: string }>(
        `select distinct storage_key as key
         from ${sqlRelation(row.relation)} t
         where (${spec.predicate}) and storage_key is not null
         limit ${ROW_LIMIT + 1}`,
        spec.args,
      );
      if (keys.rows.length > ROW_LIMIT) throw new Error("seed-rebuild-preservation-row-limit");
      for (const item of keys.rows) protectedKeys.add(item.key);
    }
  }

  if (!store.getBounded) throw new Error("seed-rebuild-bounded-object-read-required");
  const objects: SeedPreservation["objects"] = [];
  for (const key of [...protectedKeys].sort()) {
    const bytes = await store.getBounded(key, OBJECT_LIMIT);
    objects.push({
      key,
      size: bytes.length,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });
  }
  return { schema, tables, objects };
}

export async function verifySeedPreservation(
  db: Queryable,
  store: ObjectStore,
  organizationId: string,
  baseline: SeedPreservation,
): Promise<void> {
  const inventory = await loadInventory(db);
  const schema = schemaSnapshot(inventory);
  assertSchemaMatches(baseline.schema, schema);

  const currentByRelation = new Map(inventory.map((row) => [row.relation, row]));
  if (baseline.tables.length !== inventory.length) throw new Error("seed-rebuild-preservation-schema-drift");

  const driftedRelations: string[] = [];
  for (const saved of baseline.tables) {
    const row = currentByRelation.get(saved.relation);
    if (!row) throw new Error("seed-rebuild-preservation-schema-drift");
    const classification = classifyRelation(row);
    if (classification.mode !== saved.mode
      || JSON.stringify(row.primaryKeyColumns) !== JSON.stringify(saved.keyColumns)) {
      throw new Error(`seed-rebuild-preservation-scope-drift:${saved.relation}`);
    }
    if (usesPrimaryKeys(classification.mode) && !saved.ids) {
      throw new Error(`seed-rebuild-preservation-keys-missing:${saved.relation}`);
    }
    if (!usesPrimaryKeys(classification.mode) && saved.ids !== null) {
      throw new Error(`seed-rebuild-preservation-keys-unexpected:${saved.relation}`);
    }
    const spec = querySpec(row, classification.mode, saved.ids, organizationId, classification.ignoredColumns);
    const now = await hashRows(db, row, spec);
    if (now.count !== saved.count || now.digest !== saved.digest) {
      if (driftedRelations.length < 10) driftedRelations.push(saved.relation);
    }
  }
  if (driftedRelations.length > 0) {
    const suffix = driftedRelations.length === 10 ? ",..." : "";
    throw new Error(`seed-rebuild-preservation-drift:${driftedRelations.join(",")}${suffix}`);
  }

  if (!store.getBounded) throw new Error("seed-rebuild-bounded-object-read-required");
  for (const saved of baseline.objects) {
    const bytes = await store.getBounded(saved.key, OBJECT_LIMIT);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.length !== saved.size || digest !== saved.digest) {
      throw new Error("seed-rebuild-preservation-object-drift");
    }
  }
}
