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
      id, organization_id, parent_id, name, path, depth, sort_order, description, scope
    ) values ($1, $2, null, $3, $1, 1, 999, '', '')
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
    order by mm.priority desc
    limit 1
    `,
    [input.organizationId, input.matchKind, input.matchValue],
  );
  return result.rows[0]?.parameter_module_id ?? null;
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
