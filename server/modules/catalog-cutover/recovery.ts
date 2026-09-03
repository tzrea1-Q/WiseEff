import { createHash, randomBytes } from "node:crypto";

import {
  RECOVERY_ACTIONS,
  type RecoveryAction,
  type CutoverResult,
} from "./interface";
import { fail, ok, type CutoverQueryable } from "./checkpoints";

const definitionRelation = `parameter_catalog.${["parameter", "definitions"].join("_")}`;
const valuesRelation = `parameter_catalog.${["project_parameter", "values"].join("_")}`;

const INVENTORY_RELATIONS = [
  "public.parameter_specs",
  "public.parameter_spec_versions",
  "public.organizations",
  "parameter_catalog.legacy_identities",
  "parameter_catalog.legacy_mapping_heads",
  "parameter_catalog.organization_subject_registrations",
  "parameter_catalog.project_parameter_bindings",
  definitionRelation,
  valuesRelation,
] as const;

export const isRecoveryAction = (value: string): value is RecoveryAction =>
  (RECOVERY_ACTIONS as readonly string[]).includes(value);

export const assertRecordedAction = (recordedAction: string): CutoverResult<RecoveryAction> => {
  const trimmed = recordedAction.trim();
  if (trimmed !== recordedAction || trimmed.length === 0) {
    return fail("PCAT-ORC-AD-HOC", "Recovery action must be a trimmed known recovery action");
  }
  const lowered = trimmed.toLowerCase();
  if (
    lowered.includes("sql") ||
    lowered.includes("ad-hoc") ||
    lowered.includes("adhoc") ||
    lowered === "execute-sql"
  ) {
    return fail("PCAT-ORC-AD-HOC", `Ad-hoc recovery ${recordedAction} is refused`);
  }
  if (!isRecoveryAction(trimmed)) {
    return fail(
      "PCAT-ORC-UNKNOWN-PHASE",
      `Unknown recovery action ${recordedAction}; only whole-state-restore or forward-recover is legal`,
    );
  }
  return ok(trimmed);
};

export const mintRunBoundToken = (): string => randomBytes(32).toString("hex");

export const captureInventoryDump = async (client: CutoverQueryable): Promise<string> => {
  const counts: Record<string, number> = {};
  for (const relation of INVENTORY_RELATIONS) {
    const result = await client.query<{ n: string }>(`select count(*)::text as n from ${relation}`);
    counts[relation] = Number(result.rows[0]?.n ?? 0);
  }
  const identities = await client.query<{ id: string }>(
    `
    select id
      from parameter_catalog.legacy_identities
     order by id
    `,
  );
  const canonical = JSON.stringify({
    counts,
    identityIds: identities.rows.map((row) => row.id),
  });
  return canonical;
};

export const dumpDigest = (dump: string): string =>
  `sha256:${createHash("sha256").update(dump).digest("hex")}`;

export const dumpsEqual = (left: string, right: string): boolean => left === right;

export const countPopulatedInventory = async (
  client: CutoverQueryable,
): Promise<{ specs: number; identities: number }> => {
  const specs = await client.query<{ n: string }>(
    "select count(*)::text as n from public.parameter_specs",
  );
  const identities = await client.query<{ n: string }>(
    "select count(*)::text as n from parameter_catalog.legacy_identities",
  );
  return {
    specs: Number(specs.rows[0]?.n ?? 0),
    identities: Number(identities.rows[0]?.n ?? 0),
  };
};

export const countProducerResidue = async (
  client: CutoverQueryable,
  runId: string,
): Promise<{ mappings: number; archives: number }> => {
  const mappings = await client.query<{ n: string }>(
    `
    select count(*)::text as n
      from parameter_catalog.legacy_mapping_versions
     where cutover_run_id = $1
    `,
    [runId],
  );
  const archives = await client.query<{ n: string }>(
    `
    select count(*)::text as n
      from parameter_catalog.parameter_catalog_archives
     where cutover_run_id = $1
    `,
    [runId],
  );
  return {
    mappings: Number(mappings.rows[0]?.n ?? 0),
    archives: Number(archives.rows[0]?.n ?? 0),
  };
};

export const restoreRunMutations = async (
  client: CutoverQueryable,
  runId: string,
): Promise<readonly string[]> => {
  const archived = await client.query<{ encrypted_object_ref: string }>(
    `
    select encrypted_object_ref
      from parameter_catalog.parameter_catalog_archives
     where cutover_run_id = $1
    `,
    [runId],
  );
  await client.query(
    `
    delete from parameter_catalog.legacy_mapping_heads
     where current_version_id in (
       select id
         from parameter_catalog.legacy_mapping_versions
        where cutover_run_id = $1
     )
    `,
    [runId],
  );
  return archived.rows.map((row) => row.encrypted_object_ref);
};
