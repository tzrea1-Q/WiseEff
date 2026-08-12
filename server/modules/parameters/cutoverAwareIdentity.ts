/**
 * Cutover-aware identity helpers. After parameter identity cutover, dashboard/hotspot
 * and activity workflow tables must not join renamed legacy PPV/definition tables.
 *
 * Transitional file: the mode cache now lives in `parameterIdentityMode.ts`
 * (resolved once at wiring). These re-exports keep probe-style callers
 * (local post-cutover boot, integration tests) compiling until C3 completes.
 */
export { mustUseSemanticParameterIdentity } from "./semanticParameterReads";
import type { Queryable } from "../../shared/database/client";
import {
  probeCutoverComplete,
  probeLegacyTablesRetired,
  setParameterIdentityMode
} from "./parameterIdentityMode";

export function resetParameterIdentityCutoverCache(): void {
  setParameterIdentityMode(null);
}

export async function isParameterIdentityCutoverComplete(db: Queryable): Promise<boolean> {
  return probeCutoverComplete(db);
}

/** True when flat parameter definition/value tables are retired (renamed at cutover). */
export async function legacyParameterIdentityTablesRetired(db: Queryable): Promise<boolean> {
  if (await probeCutoverComplete(db)) return true;
  return probeLegacyTablesRetired(db);
}
