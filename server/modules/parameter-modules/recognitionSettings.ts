import pg from "pg";
import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  CatalogPageLimit, parseCanonicalCompatibleSelector, parseCanonicalNodeName,
} from "../parameter-catalog-contract";
import {
  createCatalogKernel, DriverCompatible, NormalizedNodeTypeName, resolveCatalogSubject,
  type CatalogSnapshot, type CatalogSubjectDetailSnapshot,
} from "../catalog-kernel/interface";
import type { DriverNature, InstanceCardinality } from "./attributionSubjects";
import { listModuleRecognitionInstances } from "./recognitionInstances";
import { captureCurrentCatalogPin, createPinCapturingCatalogRuntime } from "../catalog-publication/runtime";
import { listModuleRecognitionPlacements, readModuleRecognitionSubjectDefaults,
  hasMultipleCurrentModuleSubjectInstances } from "../parameter-catalog-api/governance";

export async function captureModuleRecognitionCatalog(db: Database): Promise<CatalogSnapshot | null> {
  const pool = getRootPostgresPool(db);
  if (!pool) return null;
  const pin = await captureCurrentCatalogPin(pool);
  if (!pin) return null;
  const loaded = await createPinCapturingCatalogRuntime(pool, createCatalogKernel(pool)).loadCurrentCatalog(pin);
  if (!loaded.ok) throw new Error(`Current module Catalog unavailable: ${loaded.error.kind}`);
  return loaded.value;
}

export type ModuleRecognitionSettings = {
  recognitionSubjectId: string | null;
  compatibles: string[];
  driverNature: DriverNature | null;
  instanceCardinality: InstanceCardinality | null;
  nodeTypeName: string | null;
  overridden: boolean;
};

type ModuleRecognitionRow = {
  id: string;
  kind: "driver-group" | "node-type";
  source_key: string | null;
  legacy_compatibles: string[];
  legacy_node_type: string | null;
  legacy_nature: DriverNature | null;
  legacy_cardinality: InstanceCardinality | null;
  rule_module_id: string | null;
  canonical_subject_id: string | null;
  compatibles: string[] | null;
  driver_nature: DriverNature | null;
  instance_cardinality: InstanceCardinality | null;
  node_type_name: string | null;
};

export async function lockOrganizationModuleRecognition(db: Queryable, organizationId: string) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-recognition:${organizationId}`]);
}

const validCompatibles = (values: readonly string[]): string[] => [...new Set(values.flatMap(value => {
  const parsed = parseCanonicalCompatibleSelector(value);
  return parsed.ok ? [parsed.value] : [];
}))];

async function moduleRecognitionRulesAvailable(db: Queryable): Promise<boolean> {
  // Historical upgrade fixtures run current binding code before migration 0212.
  // Probe existence without issuing a failing statement inside their transaction.
  const result = await db.query<{ available: boolean }>(
    "select to_regclass('public.module_recognition_rules') is not null as available",
  );
  return result.rows[0]?.available === true;
}

/** Effective current settings; legacy records are defaults only, never the write target. */
export async function loadModuleRecognitionSettings(
  db: Queryable, organizationId: string, catalog: Partial<CatalogSnapshot> | null = null,
): Promise<Map<string, ModuleRecognitionSettings>> {
  const rulesAvailable = await moduleRecognitionRulesAvailable(db);
  const rows = await db.query<ModuleRecognitionRow>(
    `select module.id, module.kind, module.source_key,
       coalesce((select array_agg(mapping.match_value order by mapping.match_value)
         from public.parameter_module_mappings mapping where mapping.organization_id = module.organization_id
           and mapping.parameter_module_id = module.id and mapping.match_kind = 'compatible'), '{}') as legacy_compatibles,
       node_type.bare_node_name as legacy_node_type,
       driver.driver_nature as legacy_nature, driver.instance_cardinality as legacy_cardinality,
       ${rulesAvailable ? `rule.module_id as rule_module_id, rule.canonical_subject_id, rule.compatibles,
       rule.driver_nature, rule.instance_cardinality, rule.node_type_name` : `null::text as rule_module_id,
       null::text as canonical_subject_id, null::text[] as compatibles,
       null::text as driver_nature, null::text as instance_cardinality, null::text as node_type_name`}
     from public.parameter_modules module
     left join public.driver_registrations driver on driver.attribution_subject_id = module.attribution_subject_id
     left join public.node_type_definitions node_type on node_type.attribution_subject_id = module.attribution_subject_id
     ${rulesAvailable ? "left join public.module_recognition_rules rule on rule.organization_id = module.organization_id and rule.module_id = module.id" : ""}
     where module.organization_id = $1 and module.kind in ('driver-group', 'node-type')`,
    [organizationId],
  );
  if (rows.rows.length === 0) return new Map();
  const placements = await listModuleRecognitionPlacements(db, organizationId);
  const settings = new Map<string, ModuleRecognitionSettings>();
  for (const row of rows.rows) {
    const subjectIds = [...new Set(placements.filter(placement => placement.module_id === row.id).map(placement => placement.subject_id))];
    const sourceCompatible = row.source_key?.startsWith("compatible:") ? row.source_key.slice("compatible:".length) : "";
    let compatibles = validCompatibles([...row.legacy_compatibles, ...(sourceCompatible ? [sourceCompatible] : [])]);
    const sourceNodeType = row.source_key?.startsWith("nodetype:") ? row.source_key.slice("nodetype:".length) : "";
    const parsedNode = parseCanonicalNodeName(row.legacy_node_type || sourceNodeType);
    let nodeTypeName: string | null = parsedNode.ok ? parsedNode.value : null;
    let subjectId = subjectIds.length === 1 ? subjectIds[0]!
      : subjectIds.length > 1 ? null : row.canonical_subject_id;
    if (!subjectId && subjectIds.length === 0 && catalog?.resolveSubject) {
      const match = catalog.resolveSubject({ driverCompatibles: row.kind === "driver-group" ? compatibles.map(DriverCompatible) : [],
        nodeTypeFallback: row.kind === "node-type" && nodeTypeName
          ? { kind: "present", name: NormalizedNodeTypeName(nodeTypeName) } : { kind: "absent" } });
      if (match.status === "matched" && match.subject.kind === (row.kind === "driver-group" ? "driver" : "node-type")) {
        subjectId = match.subject.id;
      }
    }
    if (row.rule_module_id) {
      compatibles = row.compatibles ?? [];
      nodeTypeName = row.node_type_name;
    }
    settings.set(row.id, {
      recognitionSubjectId: subjectId, compatibles: row.kind === "driver-group" ? compatibles : [],
      nodeTypeName: row.kind === "node-type" ? nodeTypeName : null,
      driverNature: row.kind === "driver-group" ? (row.driver_nature ?? row.legacy_nature ?? "physical-device") : null,
      instanceCardinality: row.kind === "driver-group" ? (row.instance_cardinality ?? row.legacy_cardinality ?? "multiple") : null,
      overridden: row.rule_module_id !== null,
    });
  }
  const subjectIds = [...new Set([...settings.values()].flatMap(value => value.recognitionSubjectId ? [value.recognitionSubjectId] : []))];
  if (subjectIds.length === 0) return settings;
  const defaults = await readModuleRecognitionSubjectDefaults(db, subjectIds, catalog?.release?.id ?? null);
  const bySubject = new Map(defaults.map(row => [row.subject_id, row]));
  for (const [moduleId, value] of settings) {
    const published = value.recognitionSubjectId ? bySubject.get(value.recognitionSubjectId) : null;
    const placement = placements.find(row => row.subject_id === value.recognitionSubjectId);
    if (placement && placement.module_id !== moduleId) {
      value.recognitionSubjectId = null;
      continue;
    }
    if (!published || value.overridden) continue;
    if (published.selector_snapshot.kind === "driver-compatible") {
      value.compatibles = validCompatibles([...(published.selector_snapshot.values ?? []), ...published.aliases]);
      value.driverNature = published.nature ?? value.driverNature;
      value.instanceCardinality = published.cardinality ?? value.instanceCardinality;
    } else if (published.selector_snapshot.kind === "node-type-name") {
      value.nodeTypeName = published.selector_snapshot.value ?? value.nodeTypeName;
    }
  }
  return settings;
}

const baseSnapshots = new WeakMap<CatalogSnapshot, CatalogSnapshot>();

export type EffectiveModuleRecognitionRule = {
  module_id: string; canonical_subject_id: string | null; compatibles: string[];
  driver_nature: DriverNature | null; instance_cardinality: InstanceCardinality | null; node_type_name: string | null;
};

/** Placement is authoritative when a Subject is registered or moved after a local rule was saved. */
export async function loadOrganizationRecognitionRules(db: Queryable, organizationId: string): Promise<EffectiveModuleRecognitionRule[]> {
  if (!await moduleRecognitionRulesAvailable(db)) return [];
  const rules = await db.query<EffectiveModuleRecognitionRule>(
    `select module_id, canonical_subject_id, compatibles, driver_nature, instance_cardinality, node_type_name
     from public.module_recognition_rules where organization_id = $1`, [organizationId],
  );
  if (rules.rows.length === 0) return [];
  const placements = await listModuleRecognitionPlacements(db, organizationId);
  return rules.rows.map(rule => {
    const currentSubjects = [...new Set(placements.filter(placement => placement.module_id === rule.module_id).map(placement => placement.subject_id))];
    const prior = placements.find(placement => placement.subject_id === rule.canonical_subject_id);
    const subjectId = currentSubjects.length === 1 ? currentSubjects[0]!
      : currentSubjects.length > 1 || (prior && prior.module_id !== rule.module_id) ? null : rule.canonical_subject_id;
    return { ...rule, canonical_subject_id: subjectId };
  });
}

/** Overlay only current organization recognition; the underlying published snapshot remains unchanged. */
export async function loadOrganizationCatalogSnapshot(
  db: Queryable, organizationId: string, supplied: CatalogSnapshot,
): Promise<CatalogSnapshot> {
  const snapshot = baseSnapshots.get(supplied) ?? supplied;
  const rules = await loadOrganizationRecognitionRules(db, organizationId);
  const overrides = new Map(rules.filter(row => row.canonical_subject_id !== null).map(row => [row.canonical_subject_id!, row]));
  if (overrides.size === 0) return snapshot;
  const listed = snapshot.listSubjects({ selection: { kind: "all" }, kinds: [], lifecycles: [], search: { kind: "absent" },
    page: { limit: CatalogPageLimit(Number.MAX_SAFE_INTEGER), after: { kind: "absent" } } });
  if (listed.status !== "found") throw new Error(`Organization subject snapshot unavailable: ${listed.status}`);
  const effectiveSubject = (subject: CatalogSubjectDetailSnapshot): CatalogSubjectDetailSnapshot => {
    const override = overrides.get(subject.id);
    if (!override) return subject;
    const selector = subject.kind === "driver"
      ? { kind: "driver-compatible" as const, values: override.compatibles.map(DriverCompatible) }
      : { kind: "node-type-name" as const, value: NormalizedNodeTypeName(override.node_type_name ?? "") };
    return { ...subject, aliases: [], membership: { ...subject.membership, selector } };
  };
  const subjects = listed.page.items.map(item => {
    const detail = snapshot.getSubject(item.id);
    if (detail.status !== "found" && detail.status !== "retired") throw new Error("Published subject detail is unavailable");
    return effectiveSubject(detail.subject);
  });
  const effective = new Proxy(snapshot, {
    get(target, property) {
      if (property === "resolveSubject") return (selector: Parameters<CatalogSnapshot["resolveSubject"]>[0]) => resolveCatalogSubject(subjects, selector);
      if (property === "getSubject") return (id: Parameters<CatalogSnapshot["getSubject"]>[0]) => {
        const result = target.getSubject(id);
        return result.status === "found" || result.status === "retired" ? { ...result, subject: effectiveSubject(result.subject) } : result;
      };
      if (property === "listSubjects") return (query: Parameters<CatalogSnapshot["listSubjects"]>[0]) => {
        const result = target.listSubjects(query);
        return result.status === "found" ? { ...result, page: { ...result.page, items: result.page.items.map(item =>
          subjects.find(subject => subject.id === item.id) ?? item) } } : result;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  baseSnapshots.set(effective, snapshot);
  return effective;
}

export type UpdateModuleRecognition = {
  compatibles?: string[]; driverNature?: DriverNature; instanceCardinality?: InstanceCardinality; nodeTypeName?: string;
};

export const hasModuleRecognitionUpdate = (body: UpdateModuleRecognition): boolean =>
  body.compatibles !== undefined || body.driverNature !== undefined || body.instanceCardinality !== undefined || body.nodeTypeName !== undefined;

export async function updateModuleRecognitionSettings(
  db: Queryable, input: { organizationId: string; moduleId: string; kind: string; body: UpdateModuleRecognition;
    catalog: CatalogSnapshot | null },
): Promise<ModuleRecognitionSettings> {
  await lockOrganizationModuleRecognition(db, input.organizationId);
  if ((input.kind !== "driver-group" && input.kind !== "node-type") ||
    (input.kind === "driver-group" && input.body.nodeTypeName !== undefined) ||
    (input.kind === "node-type" && (input.body.compatibles !== undefined || input.body.driverNature !== undefined || input.body.instanceCardinality !== undefined))) {
    throw new ApiError("VALIDATION_FAILED", "Recognition fields do not match the module kind");
  }
  const current = (await loadModuleRecognitionSettings(db, input.organizationId, input.catalog)).get(input.moduleId);
  if (!current) throw new ApiError("NOT_FOUND", "Parameter module was not found");
  if (input.body.compatibles?.some(value => !parseCanonicalCompatibleSelector(value).ok) ||
    (input.body.nodeTypeName !== undefined && !parseCanonicalNodeName(input.body.nodeTypeName).ok)) {
    throw new ApiError("VALIDATION_FAILED", "Recognition selectors must be complete compatible or node-type names");
  }
  const next = { ...current, ...input.body, overridden: true };
  if (input.body.compatibles) next.compatibles = validCompatibles(input.body.compatibles);
  if (next.instanceCardinality === "singleton-per-project") {
    const multipleBindings = await hasMultipleCurrentModuleSubjectInstances(db, input.organizationId, next.recognitionSubjectId);
    const sourceInstances = await listModuleRecognitionInstances(db, input.organizationId, next);
    const projects = new Map<string, Set<string>>();
    for (const instance of sourceInstances) {
      const nodes = projects.get(instance.projectId) ?? new Set<string>();
      nodes.add(instance.logicalNodeId); projects.set(instance.projectId, nodes);
    }
    if (multipleBindings || [...projects.values()].some(nodes => nodes.size > 1)) {
      throw new ApiError("CONFLICT", "Existing project instances exceed singleton capacity", { moduleId: input.moduleId });
    }
  }
  try {
    if (next.recognitionSubjectId) {
      const placement = (await listModuleRecognitionPlacements(db, input.organizationId))
        .find(row => row.subject_id === next.recognitionSubjectId);
      await db.query(`update public.module_recognition_rules rule set canonical_subject_id = null
        where rule.organization_id = $1 and rule.module_id <> $2 and rule.canonical_subject_id = $3
          and ($4::text is null or rule.module_id <> $4)`,
      [input.organizationId, input.moduleId, next.recognitionSubjectId, placement?.module_id ?? null]);
    }
    await db.query(
      `insert into public.module_recognition_rules (organization_id, module_id, canonical_subject_id,
         compatibles, driver_nature, instance_cardinality, node_type_name)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (organization_id, module_id) do update set canonical_subject_id = excluded.canonical_subject_id,
         compatibles = excluded.compatibles, driver_nature = excluded.driver_nature,
         instance_cardinality = excluded.instance_cardinality, node_type_name = excluded.node_type_name, updated_at = clock_timestamp()`,
      [input.organizationId, input.moduleId, next.recognitionSubjectId, next.compatibles, next.driverNature, next.instanceCardinality, next.nodeTypeName],
    );
  } catch (error) {
    if (error instanceof pg.DatabaseError && error.code === "23505" && error.constraint === "module_recognition_rules_org_subject_unique") {
      throw new ApiError("CONFLICT", "This subject already has recognition settings in another module");
    }
    throw error;
  }
  return next;
}
