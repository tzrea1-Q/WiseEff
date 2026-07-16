/**
 * Cutover-aware identity helpers. After parameter identity cutover, active
 * workflow tables no longer join renamed legacy PPV/definition tables.
 */
import type { Queryable } from "../../shared/database/client";
import { LEGACY_IDENTITY_SQL } from "./legacyParameterIdentityNames";

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

/** True when flat parameter definition/value tables are retired (renamed at cutover). */
export async function legacyParameterIdentityTablesRetired(db: Queryable): Promise<boolean> {
  if (await isParameterIdentityCutoverComplete(db)) return true;
  try {
    const result = await db.query<{ c: string }>(
      `
      select count(*)::text as c
      from information_schema.tables
      where table_schema = 'public' and table_name = '${LEGACY_IDENTITY_SQL.definitionsTable}'
      `
    );
    // Stub/unit-test adapters often return empty/unrelated rows — treat as "tables still present".
    const countCell = result.rows[0]?.c;
    if (typeof countCell === "undefined" || countCell === null) return false;
    return Number(countCell) === 0;
  } catch {
    return false;
  }
}
