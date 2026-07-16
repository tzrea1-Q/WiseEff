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
    const countCell = result.rows[0]?.c;
    // Unit-test stubs often return unrelated queued rows without a `c` column.
    if (typeof countCell === "undefined" || countCell === null) {
      cachedCutoverComplete = false;
    } else {
      cachedCutoverComplete = Number(countCell) > 0;
    }
  } catch {
    cachedCutoverComplete = false;
  }
  return cachedCutoverComplete;
}

/** True when flat parameter_definitions / project_parameter_values are retired. */
export async function legacyParameterIdentityTablesRetired(db: Queryable): Promise<boolean> {
  if (await isParameterIdentityCutoverComplete(db)) return true;
  try {
    const result = await db.query<{ c: string }>(
      `
      select count(*)::text as c
      from information_schema.tables
      where table_schema = 'public' and table_name = 'parameter_definitions'
      `
    );
    // Stub/unit-test adapters often return empty rows — treat as "tables still present".
    if (!result.rows[0]) return false;
    return Number(result.rows[0].c ?? 0) === 0;
  } catch {
    return false;
  }
}
