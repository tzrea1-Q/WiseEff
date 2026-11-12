import { createHash } from "node:crypto";
import { lockOrganizationModuleRecognition } from "./recognitionLock";
import { assertRecognitionUpdate } from "./recognitionValidation";
export { lockOrganizationModuleRecognition } from "./recognitionLock";
import { getRootPostgresPool, type Database, type Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  CatalogPageLimit, parseCanonicalCompatibleSelector, parseCanonicalNodeName,
} from "../parameter-catalog-contract";
import {
  createCatalogKernel, CatalogSubjectId, DriverCompatible, NormalizedNodeTypeName, resolveCatalogSubject,
  listOrganizationSubjectOwnerOverrides,
  type CatalogSnapshot, type CatalogSubjectDetailSnapshot,
} from "../catalog-kernel/interface";
import type { DriverNature, InstanceCardinality } from "./attributionSubjects";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { listModuleRecognitionInstances } from "./recognitionInstances";
import { captureCurrentCatalogPin, createPinCapturingCatalogRuntime } from "../catalog-publication/runtime";
import { listModuleRecognitionPlacements, readModuleRecognitionSubjectDefaults,
  hasMultipleCurrentModuleSubjectInstances, readRegistrationRecognitionSubject,
  readRecognitionSubjectIdentity,
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
export async function loadOrganizationCatalogSnapshot<T extends CatalogSnapshot>(
  db: Queryable, organizationId: string, supplied: T,
): Promise<T> {
  const snapshot = (baseSnapshots.get(supplied) ?? supplied) as T;
  const rules = await loadOrganizationRecognitionRules(db, organizationId);
  const owners = await listOrganizationSubjectOwnerOverrides(db as Parameters<typeof listOrganizationSubjectOwnerOverrides>[0], organizationId);
  const overrides = new Map(rules.filter(row => row.canonical_subject_id !== null).map(row => [row.canonical_subject_id!, row]));
  if (overrides.size === 0 && owners.size === 0) return snapshot;
  const listed = snapshot.listSubjects({ selection: { kind: "all" }, kinds: [], lifecycles: [], search: { kind: "absent" },
    page: { limit: CatalogPageLimit(Number.MAX_SAFE_INTEGER), after: { kind: "absent" } } });
  if (listed.status !== "found") throw new Error(`Organization subject snapshot unavailable: ${listed.status}`);
  const effectiveSubject = (subject: CatalogSubjectDetailSnapshot): CatalogSubjectDetailSnapshot => {
    const owner = owners.get(subject.id);
    if (owner) subject = { ...subject, owner: CatalogSubjectId(owner) };
    const override = overrides.get(subject.id);
    if (!override) return subject;
    const kind = override.node_type_name === null ? "driver" : "node-type";
    if (subject.kind === "configuration-schema" || (kind === "driver" && subject.owner)) {
      throw new Error("Organization recognition type is incompatible with the published Subject ownership");
    }
    const selector = kind === "driver"
      ? { kind: "driver-compatible" as const, values: override.compatibles.map(DriverCompatible) }
      : { kind: "node-type-name" as const, value: NormalizedNodeTypeName(override.node_type_name ?? "") };
    const canonicalKind = subject.canonicalKind ?? subject.kind;
    return { ...subject, kind, ...(kind !== canonicalKind ? { canonicalKind } : {}),
      aliases: [], membership: { ...subject.membership, selector } };
  };
  const subjects = listed.page.items.map(item => {
    const detail = snapshot.getSubject(item.id);
    if (detail.status !== "found" && detail.status !== "retired") throw new Error("Published subject detail is unavailable");
    return effectiveSubject(detail.subject);
  });
  const subjectsById = new Map(subjects.map(subject => [subject.id, subject]));
  const effective = new Proxy(snapshot, {
    get(target, property) {
      if (property === "resolveSubject") return (selector: Parameters<CatalogSnapshot["resolveSubject"]>[0]) => resolveCatalogSubject(subjects, selector);
      if (property === "getSubject") return (id: Parameters<CatalogSnapshot["getSubject"]>[0]) => {
        const result = target.getSubject(id);
        return result.status === "found" || result.status === "retired" ? { ...result, subject: effectiveSubject(result.subject) } : result;
      };
      if (property === "listSubjects") return (query: Parameters<CatalogSnapshot["listSubjects"]>[0]) => {
        // Filter the complete effective set before delegating native cursor pagination.
        // Keep the published identity ordering; include the effective type scope in the
        // cursor fingerprint so a changed override cannot silently reuse a stale page.
        const selectedIds = query.selection.kind === "only" ? new Set(query.selection.ids) : null;
        const ids = subjects.filter(subject =>
          (query.kinds.length === 0 || query.kinds.includes(subject.kind)) &&
          (!selectedIds || selectedIds.has(subject.id))).map(subject => subject.id);
        const fingerprint = createHash("sha256").update(JSON.stringify({ organizationId, selection: query.selection,
          kinds: query.kinds, types: subjects.map(subject => [subject.id, subject.kind]) })).digest("hex");
        const result = target.listSubjects({ ...query, kinds: [], selection: { kind: "only", ids, fingerprint } });
        return result.status === "found" ? { ...result, page: { ...result.page, items: result.page.items.map(item =>
          subjectsById.get(item.id) ?? item) } } : result;
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  baseSnapshots.set(effective, snapshot);
  return effective;
}

export type UpdateModuleRecognition = {
  /** Internal module-import request; the ordinary recognition endpoint does not expose type changes. */
  kind?: "driver";
  compatibles?: string[]; driverNature?: DriverNature; instanceCardinality?: InstanceCardinality; nodeTypeName?: string;
};

export const hasModuleRecognitionUpdate = (body: Omit<UpdateModuleRecognition, "kind">): boolean =>
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
  const kind = saved ? saved.node_type_name === null ? "driver" : "node-type" : registration.kind;
  return {
    kind, recognitionSubjectId: registration.subject_id,
    compatibles: saved?.compatibles ?? (selector?.kind === "driver-compatible" ? validCompatibles([...(selector.values ?? []), ...(published?.aliases ?? [])]) : []),
    nodeTypeName: saved ? saved.node_type_name : selector?.kind === "node-type-name" ? selector.value ?? null : null,
    driverNature: kind === "driver" ? saved?.driver_nature ?? published?.nature ?? "physical-device" : null,
    instanceCardinality: kind === "driver" ? saved?.instance_cardinality ?? published?.cardinality ?? "multiple" : null,
    overridden: saved !== undefined,
  };
}

export function registrationRecognitionEtag(settings: ModuleRecognitionSettings & { kind: "driver" | "node-type" }): string {
  return `"${createHash("sha256").update(JSON.stringify(settings)).digest("hex")}"`;
}

/** Validate the effective rule against current project usage before any governed write. */
export async function validateRegistrationRecognitionSettings(db: Queryable, organizationId: string,
  current: ModuleRecognitionSettings & { kind: "driver" | "node-type" }, body: UpdateModuleRecognition,
): Promise<ModuleRecognitionSettings & { kind: "driver" | "node-type" }> {
  const kind = body.kind ?? current.kind;
  let canonicalKind: string | undefined;
  if (body.kind !== undefined) {
    const identity = current.recognitionSubjectId
      ? await readRecognitionSubjectIdentity(db, organizationId, current.recognitionSubjectId) : null;
    if (body.kind !== "driver" || !identity || !["driver", "node-type"].includes(identity.kind) ||
        identity.owner_subject_id || identity.organization_owner_subject_id) {
      throw new ApiError("VALIDATION_FAILED", "该主体不能转换为驱动识别。", { reason: "invalid-recognition-rule", issues: [{
        path: "compatibles", code: "recognition-kind-conversion-not-supported", received: body.compatibles,
        message: "只有独立的节点主体支持转换为驱动；所属子节点和配置规范不支持此转换。",
        rule: "转换保留主体身份，只能对无目录归属和无组织归属的根主体设置驱动识别。",
        hint: "检查该主体的 ownerSubjectId 和目录类型；所属子节点请保留节点识别，使用独立驱动主体管理 compatible。",
      }] });
    }
    canonicalKind = identity.kind;
  }
  assertRecognitionUpdate(kind, body);
  if (kind === "driver" && body.compatibles?.length === 0 && canonicalKind === undefined && current.recognitionSubjectId) {
    canonicalKind = (await readRecognitionSubjectIdentity(db, organizationId, current.recognitionSubjectId))?.kind;
  }
  if (kind === "driver" && ((current.kind === "node-type" && !body.compatibles?.length) ||
      (canonicalKind === "node-type" && body.compatibles?.length === 0))) {
    throw new ApiError("VALIDATION_FAILED", "转换为驱动需要明确的 compatible。", { reason: "invalid-recognition-rule", issues: [{
      path: "compatibles", code: "driver-conversion-requires-compatible", received: body.compatibles ?? null,
      message: "节点主体转换为驱动时，compatibles 必须包含至少一个精确标识。",
      rule: "提供非空的 compatible 字符串数组。", hint: "填写实际 DTS compatible，例如 [\"fdw,fm1230_swi\"]；示例仅用于说明格式。",
    }] });
  }
  const next = { ...current, ...(kind !== current.kind ? {
    kind, nodeTypeName: null, driverNature: "physical-device" as const, instanceCardinality: "multiple" as const,
  } : {}), ...body, overridden: true };
  if (body.compatibles) next.compatibles = validCompatibles(body.compatibles);
  await validateRecognitionCapacity(db, organizationId, next);
  return next;
}

export async function validateRecognitionCapacity(db: Queryable, organizationId: string, next: ModuleRecognitionSettings) {
  if (next.instanceCardinality !== "singleton-per-project") return;
  const multiple = await hasMultipleCurrentModuleSubjectInstances(db, organizationId, next.recognitionSubjectId);
  const instances = await listModuleRecognitionInstances(db, organizationId, next);
  const projects = new Map<string, Set<string>>();
  for (const instance of instances) {
    const nodes = projects.get(instance.projectId) ?? new Set<string>();
    nodes.add(instance.logicalNodeId); projects.set(instance.projectId, nodes);
  }
  if (multiple || [...projects.values()].some(nodes => nodes.size > 1)) {
    throw new ApiError("CONFLICT", "已有项目实例超过单例容量。");
  }
}

/** Delete the override only after validating the published rule and the reviewed version. */
export async function resetRegistrationRecognitionSettingsInTransaction(tx: Queryable, input: {
  organizationId: string; registrationId: string; ifMatch: string; catalogReleaseId: string;
}) {
  await lockOrganizationModuleRecognition(tx, input.organizationId);
  if (await lockCurrentRecognitionRelease(tx) !== input.catalogReleaseId) throw new ApiError("CONFLICT", "规范目录已更新，请刷新后重试。");
  const current = await readRegistrationRecognitionSettings(tx, input.organizationId, input.registrationId);
  if (!current || registrationRecognitionEtag(current) !== input.ifMatch) throw new ApiError("CONFLICT", "识别规则已变化，请刷新后重试。");
  const inherited = await readInheritedRegistrationRecognitionSettings(tx, current, input.catalogReleaseId);
  await validateRecognitionCapacity(tx, input.organizationId, inherited);
  await tx.query("delete from public.registration_recognition_rules where organization_id=$1 and registration_id=$2", [input.organizationId, input.registrationId]);
  return inherited;
}

export async function readInheritedRegistrationRecognitionSettings(tx: Queryable,
  current: ModuleRecognitionSettings & { kind: "driver" | "node-type" }, catalogReleaseId: string) {
  const published = (await readModuleRecognitionSubjectDefaults(tx, [current.recognitionSubjectId!], catalogReleaseId))[0];
  if (!published) throw new ApiError("CONFLICT", "规范目录中的识别默认值不可用。");
  const selector = published.selector_snapshot;
  if (selector.kind !== "driver-compatible" && selector.kind !== "node-type-name") {
    throw new ApiError("CONFLICT", "规范目录中的识别类型不匹配。");
  }
  const kind = selector.kind === "driver-compatible" ? "driver" as const : "node-type" as const;
  return { ...current, kind, overridden: false,
    compatibles: selector.kind === "driver-compatible" ? validCompatibles([...(selector.values ?? []), ...published.aliases]) : [],
    nodeTypeName: selector.kind === "node-type-name" ? selector.value ?? null : null,
    driverNature: kind === "driver" ? published.nature ?? "physical-device" : null,
    instanceCardinality: kind === "driver" ? published.cardinality ?? "multiple" : null };
}

export async function updateRegistrationRecognitionSettings(
  db: Database, input: { organizationId: string; registrationId: string; body: UpdateModuleRecognition;
    invocation: TrustedInvocationContext; requestId: string; ifMatch: string; idempotencyKey: string; catalogReleaseId: string },
): Promise<(ModuleRecognitionSettings & { kind: "driver" | "node-type" }) | null> {
  try {
    return await db.transaction(tx => updateRegistrationRecognitionSettingsInTransaction(tx, input));
  } catch (error) {
    if ((error as { constraint?: string } | null)?.constraint === "organization_subject_owner_selector_unique")
      throw new ApiError("CONFLICT", "该驱动下已存在相同的子节点名称或别名，请调整识别规则。");
    throw error;
  }
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
    const next = await validateRegistrationRecognitionSettings(tx, input.organizationId, current, input.body);
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
      metadata: { subjectId: next.recognitionSubjectId, previousKind: current.kind, kind: next.kind, compatibles: next.compatibles,
        driverNature: next.driverNature, instanceCardinality: next.instanceCardinality, nodeTypeName: next.nodeTypeName },
    });
    return next;
}
