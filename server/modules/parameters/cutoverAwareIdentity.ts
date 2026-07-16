/**
 * Cutover-aware identity helpers. After parameter identity cutover, active
 * workflow tables no longer join renamed legacy PPV/definition tables.
 */
import type { Queryable } from "../../shared/database/client";

let cachedCutoverComplete: boolean | null = null;

export function resetParameterIdentityCutoverCache(): void {
  cachedCutoverComplete = null;
}

export async function isParameterIdentityCutoverComplete(db: Queryable): Promise<boolean> {
  if (cachedCutoverComplete !== null) return cachedCutoverComplete;
  try {
    const result = await db.query<{ c: string }>(
      `select count(*)::text as c from parameter_identity_cutovers`
    );
    cachedCutoverComplete = Number(result.rows[0]?.c ?? 0) > 0;
  } catch {
    cachedCutoverComplete = false;
  }
  return cachedCutoverComplete;
}

/** True when flat parameter_definitions / project_parameter_values are retired. */
export async function legacyParameterIdentityTablesRetired(db: Queryable): Promise<boolean> {
  if (await isParameterIdentityCutoverComplete(db)) return true;
  const result = await db.query<{ c: string }>(
    `
    select count(*)::text as c
    from information_schema.tables
    where table_schema = 'public' and table_name = 'parameter_definitions'
    `
  );
  return Number(result.rows[0]?.c ?? 0) === 0;
}
