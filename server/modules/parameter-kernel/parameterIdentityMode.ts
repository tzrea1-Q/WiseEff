/**
 * Single seam for the semantic-vs-legacy parameter identity model.
 *
 * The mode is resolved once at wiring time (API boot, worker boot, seed
 * scripts, integration-test setup) by probing the database, then read
 * synchronously everywhere else. Repository functions must not probe the
 * database per call: they dispatch on `parameterIdentityMode()` and keep one
 * query per function, with the legacy variants concentrated in
 * `legacyParameterIdentityAdapter.ts` so post-TD-042 deletion is one file.
 *
 * Unresolved mode defaults to "legacy": unit-test stubs never resolve, which
 * matches the pre-C3 behaviour where fake databases answered the cutover
 * probe with "not cut over". Production entrypoints always resolve at boot.
 */
import type { Queryable } from "../../shared/database/client";
import { LEGACY_IDENTITY_SQL } from "./legacyParameterIdentityNames";

export type ParameterIdentityMode = "semantic" | "legacy";

let activeMode: ParameterIdentityMode | null = null;

export function parameterIdentityMode(): ParameterIdentityMode {
  return activeMode ?? "legacy";
}

/** Test seam: force a mode (or null to fall back to the legacy default). */
export function setParameterIdentityMode(mode: ParameterIdentityMode | null): void {
  activeMode = mode;
}

/** True when the cutover marker table has rows. */
export async function probeCutoverComplete(db: Queryable): Promise<boolean> {
  try {
    const result = await db.query<{ c: string }>(
      `select count(*)::text as c from parameter_identity_cutovers`
    );
    const countCell = result.rows[0]?.c;
    if (countCell === undefined || countCell === null) return false;
    return Number(countCell) > 0;
  } catch {
    return false;
  }
}

/** True when flat parameter definition/value tables are retired (renamed at cutover). */
export async function probeLegacyTablesRetired(db: Queryable): Promise<boolean> {
  try {
    const result = await db.query<{ c: string }>(
      `
      select count(*)::text as c
      from information_schema.tables
      where table_schema = 'public' and table_name = '${LEGACY_IDENTITY_SQL.definitionsTable}'
      `
    );
    const countCell = result.rows[0]?.c;
    if (countCell === undefined || countCell === null) return false;
    return Number(countCell) === 0;
  } catch {
    return false;
  }
}

export async function probeCanonicalSeedReady(db: Queryable): Promise<boolean> {
  const result = await db.query<{ ready: boolean }>(`select
    not exists (select 1 from public.parameter_specs) and
    not exists (select 1 from public.project_parameter_bindings) and
    exists (select 1 from parameter_catalog.current_project_parameter_bindings) and
    not exists (
      select 1 from parameter_catalog.current_project_parameter_bindings binding
      left join parameter_catalog.project_value_source_pins pin
        on pin.binding_id = binding.id and pin.project_value_id = binding.current_value_id
      left join public.project_parameter_files file on file.id = pin.file_id
      where pin.id is null or file.current_version_id is distinct from pin.file_version_id
    ) as ready`);
  return result.rows[0]?.ready === true;
}

/**
 * Probe the database once and pin the mode for this process. Returns the
 * resolved mode so callers can log it.
 */
export async function resolveParameterIdentityMode(db: Queryable): Promise<ParameterIdentityMode> {
  const semantic = (await probeCutoverComplete(db)) || (await probeLegacyTablesRetired(db)) || (await probeCanonicalSeedReady(db));
  activeMode = semantic ? "semantic" : "legacy";
  return activeMode;
}
