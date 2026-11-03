import { createHash } from "node:crypto";
import { lockOrganizationModuleRecognition } from "./recognitionLock";
export { lockOrganizationModuleRecognition } from "./recognitionLock";
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
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { listModuleRecognitionInstances } from "./recognitionInstances";
import { captureCurrentCatalogPin, createPinCapturingCatalogRuntime } from "../catalog-publication/runtime";
import { listModuleRecognitionPlacements, readModuleRecognitionSubjectDefaults,
  hasMultipleCurrentModuleSubjectInstances, readRegistrationRecognitionSubject,
  readRecognitionIdempotency, writeRecognitionIdempotency, lockCurrentRecognitionRelease } from "../parameter-catalog-api/governance";

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
  unmigratedRecognition?: {
    compatibles: string[]; driverNature: DriverNature | null;
    instanceCardinality: InstanceCardinality | null; nodeTypeName: string | null;
  };
};

type ModuleRecognitionRow = {
  id: string;
  kind: "driver-group" | "node-type";
  source_key: string | null;
  legacy_compatibles: string[];
  legacy_node_type: string | null;
  legacy_nature: DriverNature | null;
  legacy_cardinality: InstanceCardinality | null;
};

const validCompatibles = (values: readonly string[]): string[] => [...new Set(values.flatMap(value => {
  const parsed = parseCanonicalCompatibleSelector(value);
  return parsed.ok ? [parsed.value] : [];
}))];

async function registrationRecognitionRulesAvailable(db: Queryable): Promise<boolean> {
  // Historical upgrade fixtures run current binding code before registration rules exist.
  // Probe existence without issuing a failing statement inside their transaction.
  const result = await db.query<{ available: boolean }>(
    "select to_regclass('public.registration_recognition_rules') is not null as available",
  );
  return result.rows[0]?.available === true;
}

/** Effective current settings; legacy records are defaults only, never the write target. */
export async function loadModuleRecognitionSettings(
  db: Queryable, organizationId: string, catalog: Partial<CatalogSnapshot> | null = null,
): Promise<Map<string, ModuleRecognitionSettings>> {
  const rulesAvailable = await registrationRecognitionRulesAvailable(db);
  const rows = await db.query<ModuleRecognitionRow>(
    `select module.id, module.kind, module.source_key,
       coalesce((select array_agg(mapping.match_value order by mapping.match_value)
         from public.parameter_module_mappings mapping where mapping.organization_id = module.organization_id
           and mapping.parameter_module_id = module.id and mapping.match_kind = 'compatible'), '{}') as legacy_compatibles,
       node_type.bare_node_name as legacy_node_type,
       driver.driver_nature as legacy_nature, driver.instance_cardinality as legacy_cardinality
     from public.parameter_modules module
     left join public.driver_registrations driver on driver.attribution_subject_id = module.attribution_subject_id
     left join public.node_type_definitions node_type on node_type.attribution_subject_id = module.attribution_subject_id
     where module.organization_id = $1 and module.kind in ('driver-group', 'node-type')`,
    [organizationId],
  );
  const effectiveRules = rulesAvailable ? await loadOrganizationRecognitionRules(db, organizationId) : [];
  // Unmigrated selectors are display-only evidence and never enter the Catalog overlay.
  const unmigrated = rulesAvailable ? (await db.query<{
    module_id: string; compatibles: string[]; driver_nature: DriverNature | null;
    instance_cardinality: InstanceCardinality | null; node_type_name: string | null;
  }>(`select rule.module_id,rule.compatibles,rule.driver_nature,rule.instance_cardinality,rule.node_type_name
      from public.module_recognition_rules rule
      left join public.registration_recognition_migration_map migrated
        on migrated.organization_id=rule.organization_id and migrated.module_id=rule.module_id
      where rule.organization_id=$1 and migrated.module_id is null`, [organizationId])).rows : [];
  if (rows.rows.length === 0 && unmigrated.length === 0) return new Map();
  const unmigratedByModule = new Map(unmigrated.map(rule => [rule.module_id, rule]));
  const rules = new Map(effectiveRules.filter(rule => rule.module_id !== null).map(rule => [rule.module_id, rule]));
  const placements = await listModuleRecognitionPlacements(db, organizationId);
  const settings = new Map<string, ModuleRecognitionSettings>();
  for (const row of rows.rows) {
    const subjectIds = [...new Set(placements.filter(placement => placement.module_id === row.id).map(placement => placement.subject_id))];
    const rule = subjectIds.length === 1 ? effectiveRules.find(value => value.canonical_subject_id === subjectIds[0])
      : subjectIds.length === 0 ? rules.get(row.id) : undefined;
    const sourceCompatible = row.source_key?.startsWith("compatible:") ? row.source_key.slice("compatible:".length) : "";
    let compatibles = validCompatibles([...row.legacy_compatibles, ...(sourceCompatible ? [sourceCompatible] : [])]);
    const sourceNodeType = row.source_key?.startsWith("nodetype:") ? row.source_key.slice("nodetype:".length) : "";
    const parsedNode = parseCanonicalNodeName(row.legacy_node_type || sourceNodeType);
    let nodeTypeName: string | null = parsedNode.ok ? parsedNode.value : null;
    let subjectId = subjectIds.length === 1 ? subjectIds[0]!
      : subjectIds.length > 1 ? null : rule?.canonical_subject_id ?? null;
    if (!subjectId && subjectIds.length === 0 && catalog?.resolveSubject) {
      const match = catalog.resolveSubject({ driverCompatibles: row.kind === "driver-group" ? compatibles.map(DriverCompatible) : [],
        nodeTypeFallback: row.kind === "node-type" && nodeTypeName
          ? { kind: "present", name: NormalizedNodeTypeName(nodeTypeName) } : { kind: "absent" } });
      if (match.status === "matched" && match.subject.kind === (row.kind === "driver-group" ? "driver" : "node-type")) {
        subjectId = match.subject.id;
      }
    }
    if (rule) {
      compatibles = rule.compatibles;
      nodeTypeName = rule.node_type_name;
    }
    const legacyRule = unmigratedByModule.get(row.id);
    settings.set(row.id, {
      recognitionSubjectId: subjectId, compatibles: row.kind === "driver-group" ? compatibles : [],
      nodeTypeName: row.kind === "node-type" ? nodeTypeName : null,
      driverNature: row.kind === "driver-group" ? (rule?.driver_nature ?? row.legacy_nature ?? "physical-device") : null,
      instanceCardinality: row.kind === "driver-group" ? (rule?.instance_cardinality ?? row.legacy_cardinality ?? "multiple") : null,
      overridden: rule !== undefined,
      ...(legacyRule ? { unmigratedRecognition: { compatibles: legacyRule.compatibles,
        driverNature: legacyRule.driver_nature, instanceCardinality: legacyRule.instance_cardinality,
        nodeTypeName: legacyRule.node_type_name } } : {}),
    });
  }
  for (const legacyRule of unmigrated) {
    if (settings.has(legacyRule.module_id)) continue;
    settings.set(legacyRule.module_id, { recognitionSubjectId: null, compatibles: [], nodeTypeName: null,
      driverNature: null, instanceCardinality: null, overridden: false,
      unmigratedRecognition: { compatibles: legacyRule.compatibles, driverNature: legacyRule.driver_nature,
        instanceCardinality: legacyRule.instance_cardinality, nodeTypeName: legacyRule.node_type_name } });
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
  module_id: string | null; canonical_subject_id: string | null; compatibles: string[];
  driver_nature: DriverNature | null; instance_cardinality: InstanceCardinality | null; node_type_name: string | null;
};

/** Only registration-scoped rules can override a subject. */
export async function loadOrganizationRecognitionRules(db: Queryable, organizationId: string): Promise<EffectiveModuleRecognitionRule[]> {
  if (!await registrationRecognitionRulesAvailable(db)) return [];
  return (await db.query<EffectiveModuleRecognitionRule>(
    `select effective.module_id, effective.subject_id as canonical_subject_id, rule.compatibles,
            rule.driver_nature, rule.instance_cardinality, rule.node_type_name
       from public.registration_recognition_rules rule
       join parameter_catalog.registration_effective_module effective
         on effective.registration_id = rule.registration_id and effective.organization_id = rule.organization_id
      where rule.organization_id = $1`, [organizationId],
  )).rows;
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

export async function readRegistrationRecognitionSettings(
  db: Queryable, organizationId: string, registrationId: string,
): Promise<(ModuleRecognitionSettings & { kind: "driver" | "node-type" }) | null> {
  const registration = await readRegistrationRecognitionSubject(db, organizationId, registrationId);
  if (!registration) return null;
  if (registration.kind !== "driver" && registration.kind !== "node-type") {
    throw new ApiError("VALIDATION_FAILED", "该主体类型不支持识别规则。");
  }
  const saved = (await loadOrganizationRecognitionRules(db, organizationId))
    .find(rule => rule.canonical_subject_id === registration.subject_id);
  const published = (await readModuleRecognitionSubjectDefaults(db, [registration.subject_id], null))[0];
  const selector = published?.selector_snapshot;
  return {
    kind: registration.kind, recognitionSubjectId: registration.subject_id,
    compatibles: saved?.compatibles ?? (selector?.kind === "driver-compatible" ? validCompatibles([...(selector.values ?? []), ...(published?.aliases ?? [])]) : []),
    nodeTypeName: saved?.node_type_name ?? (selector?.kind === "node-type-name" ? selector.value ?? null : null),
    driverNature: registration.kind === "driver" ? saved?.driver_nature ?? published?.nature ?? "physical-device" : null,
    instanceCardinality: registration.kind === "driver" ? saved?.instance_cardinality ?? published?.cardinality ?? "multiple" : null,
    overridden: saved !== undefined,
  };
}

export function registrationRecognitionEtag(settings: ModuleRecognitionSettings & { kind: "driver" | "node-type" }): string {
  return `"${createHash("sha256").update(JSON.stringify(settings)).digest("hex")}"`;
}

export async function updateRegistrationRecognitionSettings(
  db: Database, input: { organizationId: string; registrationId: string; body: UpdateModuleRecognition;
    invocation: TrustedInvocationContext; requestId: string; ifMatch: string; idempotencyKey: string; catalogReleaseId: string },
): Promise<(ModuleRecognitionSettings & { kind: "driver" | "node-type" }) | null> {
  return db.transaction(tx => updateRegistrationRecognitionSettingsInTransaction(tx, input));
}

/** Governance callers must own the surrounding transaction. */
export async function updateRegistrationRecognitionSettingsInTransaction(
  tx: Database, input: { organizationId: string; registrationId: string; body: UpdateModuleRecognition;
    invocation: TrustedInvocationContext; requestId: string; ifMatch: string; idempotencyKey: string; catalogReleaseId: string },
): Promise<(ModuleRecognitionSettings & { kind: "driver" | "node-type" }) | null> {
    if (input.invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "只有组织管理员可以修改识别规则。");
    assertTrustedInvocationMatchesScope(input.invocation.principal, input.invocation, input.organizationId, "registration recognition");
    await lockOrganizationModuleRecognition(tx, input.organizationId);
    const fingerprint = createHash("sha256").update(JSON.stringify({ registrationId: input.registrationId,
      body: input.body, ifMatch: input.ifMatch, catalogReleaseId: input.catalogReleaseId })).digest("hex");
    const prior = await readRecognitionIdempotency(tx, input.organizationId, input.idempotencyKey);
    if (prior) {
      if (prior.request_fingerprint !== fingerprint || prior.state !== "committed") {
        throw new ApiError("CONFLICT", "此幂等键已用于其他识别规则更新。");
      }
      return JSON.parse(prior.result_ref!) as ModuleRecognitionSettings & { kind: "driver" | "node-type" };
    }
    const live = await lockCurrentRecognitionRelease(tx);
    if (live !== input.catalogReleaseId) {
      throw new ApiError("CONFLICT", "规范目录已更新，请刷新后重试。");
    }
    const current = await readRegistrationRecognitionSettings(tx, input.organizationId, input.registrationId);
    if (!current) return null;
    if (registrationRecognitionEtag(current) !== input.ifMatch) throw new ApiError("CONFLICT", "识别规则已变化，请刷新后重试。");
    if (!hasModuleRecognitionUpdate(input.body) ||
      (current.kind === "driver" && input.body.nodeTypeName !== undefined) ||
      (current.kind === "node-type" && (input.body.compatibles !== undefined || input.body.driverNature !== undefined || input.body.instanceCardinality !== undefined)) ||
      input.body.compatibles?.some(value => !parseCanonicalCompatibleSelector(value).ok) ||
      (input.body.nodeTypeName !== undefined && !parseCanonicalNodeName(input.body.nodeTypeName).ok)) {
      throw new ApiError("VALIDATION_FAILED", "识别规则与主体类型不匹配，或识别标识格式无效。");
    }
    const next = { ...current, ...input.body, overridden: true };
    if (input.body.compatibles) next.compatibles = validCompatibles(input.body.compatibles);
    if (next.instanceCardinality === "singleton-per-project") {
      const multiple = await hasMultipleCurrentModuleSubjectInstances(tx, input.organizationId, next.recognitionSubjectId);
      const instances = await listModuleRecognitionInstances(tx, input.organizationId, next);
      const projects = new Map<string, Set<string>>();
      for (const instance of instances) {
        const nodes = projects.get(instance.projectId) ?? new Set<string>();
        nodes.add(instance.logicalNodeId); projects.set(instance.projectId, nodes);
      }
      if (multiple || [...projects.values()].some(nodes => nodes.size > 1)) {
        throw new ApiError("CONFLICT", "已有项目实例超过单例容量。");
      }
    }
    await tx.query(`insert into public.registration_recognition_rules
      (organization_id, registration_id, canonical_subject_id, compatibles, driver_nature, instance_cardinality, node_type_name)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (organization_id, registration_id) do update set compatibles=excluded.compatibles,
        driver_nature=excluded.driver_nature, instance_cardinality=excluded.instance_cardinality,
        node_type_name=excluded.node_type_name, updated_at=clock_timestamp()`,
    [input.organizationId, input.registrationId, next.recognitionSubjectId, next.compatibles, next.driverNature, next.instanceCardinality, next.nodeTypeName]);
    await writeRecognitionIdempotency(tx, input.organizationId, input.idempotencyKey, fingerprint, JSON.stringify(next));
    await writeAuditEventInTx(asAuditTx(tx), input.invocation, { requestId: input.requestId }, {
      app: "parameters", kind: "registration-recognition-update", action: "update", severity: "Medium",
      projectId: null, targetType: "subject-registration", targetId: input.registrationId,
      metadata: { subjectId: next.recognitionSubjectId, compatibles: next.compatibles,
        driverNature: next.driverNature, instanceCardinality: next.instanceCardinality, nodeTypeName: next.nodeTypeName },
    });
    return next;
}
