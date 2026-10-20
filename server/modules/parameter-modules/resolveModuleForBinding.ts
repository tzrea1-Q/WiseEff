/**
 * Shared module resolution for DTS topology binding writes.
 *
 * Every binding write (ingest, spec review, legacy migration, seeds) must persist a
 * durable module_id — never null. Attribution levers (ADR-0010): compatible >
 * node-type > unclassified root. Never materializes per-instance modules.
 */

import { createHash } from "node:crypto";

import { normalizeMatchToken } from "./modulePlacement";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";

export type ModuleBindingMatchKind = "compatible" | "node-type";

const UNCLASSIFIED_MODULE_NAME = "未分类";

function normalizeMatchValue(value: string | null | undefined): string | null {
  return normalizeMatchToken(value);
}

/** Deterministic id for the org-scoped unclassified module, matching migration 0067's backfill formula. */
export function unclassifiedModuleId(organizationId: string): string {
  const hash = createHash("md5").update(UNCLASSIFIED_MODULE_NAME, "utf8").digest("hex");
  return `pmod-${organizationId}-${hash}`;
}

async function ensureUnclassifiedModule(db: Queryable, organizationId: string): Promise<string> {
  const id = unclassifiedModuleId(organizationId);
  await db.query(
    `
    insert into parameter_modules (
      id, organization_id, parent_id, name, path, depth, sort_order, description, scope,
      kind, origin, attribution_subject_id
    ) values ($1, $2, null, $3, $1, 1, 999, '', '', 'unclassified', 'auto', null)
    on conflict (id) do nothing
    `,
    [id, organizationId, UNCLASSIFIED_MODULE_NAME],
  );
  return id;
}

async function findMappedModuleId(
  db: Queryable,
  input: { organizationId: string; matchKind: ModuleBindingMatchKind; matchValue: string },
): Promise<string | null> {
  const result = await db.query<{ parameter_module_id: string }>(
    `
    select mm.parameter_module_id
    from parameter_module_mappings mm
    inner join parameter_modules pm
      on pm.id = mm.parameter_module_id and pm.organization_id = mm.organization_id
    where mm.organization_id = $1
      and mm.match_kind = $2
      and lower(trim(both '"' from trim(both '''' from trim(both from mm.match_value)))) = $3
      and not exists (select 1 from public.module_recognition_rules rule
        where rule.organization_id=mm.organization_id and rule.module_id=mm.parameter_module_id)
    order by mm.priority desc
    limit 1
    `,
    [input.organizationId, input.matchKind, input.matchValue],
  );
  return result.rows[0]?.parameter_module_id ?? null;
}

/** A saved rule replaces old selectors, including their automatic-discovery source keys. */
export async function findModuleRecognitionOverride(db: Queryable, input: {
  organizationId: string; compatible: string | null; nodeType: string | null;
}): Promise<{ moduleId: string | null; replacesLegacyMatch: boolean }> {
  const compatible = normalizeMatchValue(input.compatible);
  const nodeType = normalizeMatchValue(input.nodeType);
  const currentCompatible = input.compatible?.trim().replace(/^(['"])(.*)\1$/, "$2") ?? null;
  const currentNodeType = input.nodeType?.trim() ?? null;
  const rules = await db.query<{ module_id: string; matches: boolean; replaces: boolean }>(
    `select rule.module_id,
       (($4::text is not null and $4=any(rule.compatibles))
         or ($4::text is null and $5::text is not null and rule.node_type_name=$5)) as matches,
       (module.source_key=concat('compatible:',$2::text) or module.source_key=concat('nodetype:',$3::text)
         or exists (select 1 from public.parameter_module_mappings mapping
           where mapping.organization_id=rule.organization_id and mapping.parameter_module_id=rule.module_id
             and ((mapping.match_kind='compatible' and lower(trim(both '"' from trim(mapping.match_value)))=$2)
               or (mapping.match_kind='node-type' and lower(trim(mapping.match_value))=$3)))) as replaces
     from public.module_recognition_rules rule
     join public.parameter_modules module on module.id=rule.module_id and module.organization_id=rule.organization_id
     where rule.organization_id=$1 order by (module.kind='driver-group') desc,rule.module_id`,
    [input.organizationId, compatible, nodeType, currentCompatible, currentNodeType],
  );
  const matches = rules.rows.filter((rule) => rule.matches);
  if (matches.length > 1) throw new ApiError("CONFLICT", "Recognition selectors match multiple modules", {
    reason: "ambiguous-module-recognition", moduleIds: matches.map((rule) => rule.module_id),
  });
  return { moduleId: matches[0]?.module_id ?? null,
    replacesLegacyMatch: rules.rows.some((rule) => rule.replaces) };
}

/**
 * Resolve the durable attribution module for a binding write.
 * Priority: compatible mapping → node-type mapping → deterministic
 * org-scoped "未分类" module. Never returns null/undefined.
 */
export async function resolveModuleIdForBinding(
  db: Queryable,
  input: {
    organizationId: string;
    driverModule: string | null;
    compatible: string | null;
    nodeType: string | null;
  },
): Promise<string> {
  const override = await findModuleRecognitionOverride(db, input);
  if (override.moduleId) return override.moduleId;
  const candidates: Array<{ kind: ModuleBindingMatchKind; value: string | null }> = [
    { kind: "compatible", value: normalizeMatchValue(input.compatible) },
    { kind: "node-type", value: normalizeMatchValue(input.nodeType) },
  ];

  for (const candidate of candidates) {
    if (candidate.value === null) continue;
    const moduleId = await findMappedModuleId(db, {
      organizationId: input.organizationId,
      matchKind: candidate.kind,
      matchValue: candidate.value,
    });
    if (moduleId) return moduleId;
  }

  return ensureUnclassifiedModule(db, input.organizationId);
}
