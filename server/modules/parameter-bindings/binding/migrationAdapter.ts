import type pg from "pg";

import { ParameterBindingId } from "../../parameter-catalog-contract/index";

import type { CatalogSnapshot } from "../../catalog-kernel/interface";
import type {
  DefinitionRevisionId,
  ParameterDefinitionId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

import { writeCanonicalBinding } from "./service";
import type { BindingConflict, BindingResult, Result } from "./types";

export type LegacyBindingIdentity = {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly logicalNodeId: string | null;
  readonly moduleId: string;
  readonly parameterSpecId: string;
};

export type MapLegacyBindingCommand = {
  readonly snapshot: CatalogSnapshot;
  readonly legacy: LegacyBindingIdentity;
  readonly registrationId: SubjectRegistrationId;
  readonly definitionId: ParameterDefinitionId;
  readonly effectiveRevisionId: DefinitionRevisionId;
};

export type LegacyBindingReader = {
  query: pg.PoolClient["query"] | pg.Pool["query"];
};

const fail = (error: BindingConflict): Result<never, BindingConflict> => ({
  ok: false,
  error,
});

export const loadLegacyBindingIdentity = async (
  client: LegacyBindingReader,
  bindingId: string,
): Promise<LegacyBindingIdentity | null> => {
  const result = await client.query<LegacyBindingIdentity>(
    `select id, organization_id as "organizationId", project_id as "projectId",
            logical_node_id as "logicalNodeId", module_id as "moduleId",
            parameter_spec_id as "parameterSpecId"
       from public.project_parameter_bindings
      where id = $1`,
    [bindingId],
  );
  return result.rows[0] ?? null;
};

export const mapLegacyBinding = async (
  pool: pg.Pool,
  command: MapLegacyBindingCommand,
): Promise<Result<BindingResult, BindingConflict>> => {
  const { legacy } = command;
  if (!legacy.logicalNodeId) {
    return fail({ kind: "agreement-conflict", reason: "module-identity" });
  }

  try {
    return await writeCanonicalBinding(
      pool,
      {
        snapshot: command.snapshot,
        organizationId: legacy.organizationId,
        projectId: legacy.projectId,
        logicalNodeId: legacy.logicalNodeId,
        registrationId: command.registrationId,
        definitionId: command.definitionId,
        effectiveRevisionId: command.effectiveRevisionId,
        expectedEffectiveRevisionId: null,
      },
      { preservedBindingId: ParameterBindingId(legacy.id) },
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
    }
    throw error;
  }
};
