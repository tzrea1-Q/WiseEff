import { createHash } from "node:crypto";
import type pg from "pg";

import { ParameterBindingId, serializeContract } from "../../parameter-catalog-contract/index";
import { asValueClient, dtsValueToPayload } from "../catalogProjectValueSync";
import type { Queryable } from "../../../shared/database/client";
import type { ObjectStore } from "../../logs/objectStore";
import {
  proveExactDtsProperty,
  type ExactDtsSourceIdentity,
} from "../../parameter-topology/sourcePropertyProof";
import { lockExactSourceRevisionsForProof } from "../../parameter-files/sourceVersion";

import type { CatalogSnapshot } from "../../catalog-kernel/interface";
import type {
  DefinitionRevisionId,
  ParameterDefinitionId,
  SubjectRegistrationId,
} from "../../parameter-catalog-contract/index";

import { writeCanonicalBinding } from "./service";
import type { BindingConflict, BindingResult, Result } from "./types";
import { appendProjectValue } from "../values/service";
import type { ProjectValuePayload } from "../values/types";
import { digestProjectValuePayload } from "../values/repositories";
import { deriveDtsSourceRef } from "../../dts/sourceRef";

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
  /** Exact source proof captured by the owning source importer. */
  readonly source?: LegacyBindingSourceProof;
};

export type LegacyBindingSourceProof = {
  readonly sourceOccurrenceId: string;
  readonly sourceRef: string;
  readonly configRevisionId: string;
  readonly payload: ProjectValuePayload;
  readonly pin: {
    readonly id: string;
    readonly fileId: string;
    readonly fileVersionId: string;
    readonly format: "dts" | "json";
    readonly propertyOccurrenceId: string | null;
    readonly locator: Record<string, unknown>;
    readonly locatorDigest: string;
  };
};

export type LegacyBindingReader = {
  query: pg.PoolClient["query"] | pg.Pool["query"];
};

const fail = (error: BindingConflict): Result<never, BindingConflict> => ({
  ok: false,
  error,
});

const controlFree = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const sameLocator = (actual: Record<string, unknown>, expected: Record<string, unknown>): boolean =>
  JSON.stringify(Object.fromEntries(Object.entries(actual).sort(([left], [right]) => left.localeCompare(right)))) ===
  JSON.stringify(Object.fromEntries(Object.entries(expected).sort(([left], [right]) => left.localeCompare(right))));

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
  tx: Queryable,
  objectStore: ObjectStore,
  command: MapLegacyBindingCommand,
): Promise<Result<BindingResult, BindingConflict>> => {
  const { legacy } = command;
  if (!legacy.logicalNodeId) {
    return fail({ kind: "agreement-conflict", reason: "module-identity" });
  }
  const source = command.source;
  if (
    !source ||
    !controlFree(source.sourceOccurrenceId) ||
    !controlFree(source.sourceRef) ||
    !controlFree(source.configRevisionId) ||
    !controlFree(source.pin.id) ||
    !controlFree(source.pin.fileId) ||
    !controlFree(source.pin.fileVersionId) ||
    !controlFree(source.pin.locatorDigest)
  ) {
    return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
  }
  if (
    (source.pin.format === "dts" && source.pin.propertyOccurrenceId === null) ||
    (source.pin.format === "json" && source.pin.propertyOccurrenceId !== null)
  ) {
    return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
  }

  const persistedSource = await tx.query<{
    source_occurrence_id: string;
    config_set_id: string;
    config_revision_id: string;
    logical_node_id: string;
    file_id: string;
    file_version_id: string;
    property_occurrence_id: string;
    node_occurrence_id: string;
    property_name: string;
  }>(
    `select source_occurrence.id as source_occurrence_id,
            source_occurrence.config_set_id,
            revision.config_revision_id,
            source_occurrence.logical_node_id,
            member.file_id,
            member.file_version_id,
            property.id as property_occurrence_id,
            property.node_occurrence_id,
            property.property_name
       from parameter_catalog.project_parameter_source_occurrences source_occurrence
       join public.dts_logical_node_revisions revision
         on revision.logical_node_id = source_occurrence.logical_node_id
        and revision.config_revision_id = $2
       join public.dts_config_revisions config_revision
         on config_revision.id = revision.config_revision_id
        and config_revision.config_set_id = source_occurrence.config_set_id
       join public.dts_property_occurrences property
         on property.id = $3
        and property.config_revision_id = revision.config_revision_id
       join public.dts_config_revision_members member
         on member.config_revision_id = revision.config_revision_id
        and member.file_id = $4
        and member.file_version_id = property.file_version_id
      where source_occurrence.id = $1
        and source_occurrence.organization_id = $5
        and source_occurrence.project_id = $6
        and source_occurrence.occurrence_kind = 'dts'`,
    [
      source.sourceOccurrenceId,
      source.configRevisionId,
      source.pin.propertyOccurrenceId,
      source.pin.fileId,
      legacy.organizationId,
      legacy.projectId,
    ],
  );
  if (persistedSource.rows.length !== 1) {
    return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
  }
  const sourceRow = persistedSource.rows[0]!;
  if (
    sourceRow.source_occurrence_id !== source.sourceOccurrenceId ||
    sourceRow.config_revision_id !== source.configRevisionId ||
    sourceRow.logical_node_id !== legacy.logicalNodeId ||
    sourceRow.file_id !== source.pin.fileId ||
    sourceRow.file_version_id !== source.pin.fileVersionId ||
    sourceRow.property_occurrence_id !== source.pin.propertyOccurrenceId
  ) {
    return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
  }

  const sourceIdentity: ExactDtsSourceIdentity = {
    organizationId: legacy.organizationId,
    projectId: legacy.projectId,
    configSetId: sourceRow.config_set_id,
    configRevisionId: sourceRow.config_revision_id,
    logicalNodeId: sourceRow.logical_node_id,
    fileId: sourceRow.file_id,
    fileVersionId: sourceRow.file_version_id,
    propertyOccurrenceId: sourceRow.property_occurrence_id,
    nodeOccurrenceId: sourceRow.node_occurrence_id,
    propertyName: sourceRow.property_name,
  };
  await lockExactSourceRevisionsForProof(tx, [sourceIdentity]);

  let persistedLegacy: { readonly rows: readonly LegacyBindingIdentity[] };
  try {
    persistedLegacy = await tx.query<LegacyBindingIdentity>(
      `select id, organization_id as "organizationId", project_id as "projectId",
              logical_node_id as "logicalNodeId", module_id as "moduleId",
              parameter_spec_id as "parameterSpecId"
         from public.project_parameter_bindings
        where id = $1
        for update nowait`,
      [legacy.id],
    );
  } catch (error) {
    if ((error as { readonly code?: string }).code === "55P03") {
      return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
    }
    throw error;
  }
  const storedLegacy = persistedLegacy.rows[0];
  if (
    !storedLegacy ||
    storedLegacy.organizationId !== legacy.organizationId ||
    storedLegacy.projectId !== legacy.projectId ||
    storedLegacy.logicalNodeId !== legacy.logicalNodeId ||
    storedLegacy.moduleId !== legacy.moduleId ||
    storedLegacy.parameterSpecId !== legacy.parameterSpecId
  ) {
    return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
  }
  if (source.pin.format !== "dts") {
    return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
  }
  let proof;
  try {
    proof = await proveExactDtsProperty(tx, objectStore, sourceIdentity);
  } catch {
    return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
  }
    const locator = {
      kind: "dts-property",
      propertyOccurrenceId: proof.propertyOccurrenceId,
      nodeOccurrenceId: proof.nodeOccurrenceId,
      fileVersionId: proof.fileVersionId,
      propertyName: proof.propertyName,
    };
    const locatorDigest = `sha256:${createHash("sha256").update(serializeContract(locator)).digest("hex")}`;
    if (
      source.pin.fileId !== proof.fileId ||
      source.pin.fileVersionId !== proof.fileVersionId ||
      source.pin.propertyOccurrenceId !== proof.propertyOccurrenceId ||
      source.pin.locatorDigest !== locatorDigest ||
      !sameLocator(source.pin.locator, locator) ||
      source.sourceRef !== deriveDtsSourceRef({ fileName: proof.sourceName, nodeLocator: proof.nodeLocator }) ||
      digestProjectValuePayload(dtsValueToPayload(proof.value)) !== digestProjectValuePayload(source.payload)
    ) {
      return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
    }
    const mapped = await writeCanonicalBinding(asValueClient(tx), {
        snapshot: command.snapshot,
        organizationId: legacy.organizationId,
        projectId: legacy.projectId,
        logicalNodeId: legacy.logicalNodeId,
        sourceOccurrenceId: source.sourceOccurrenceId,
        registrationId: command.registrationId,
        definitionId: command.definitionId,
        effectiveRevisionId: command.effectiveRevisionId,
        expectedEffectiveRevisionId: null,
      }, { preservedBindingId: ParameterBindingId(legacy.id) });
    if (!mapped.ok) {
      return mapped;
    }

    if (mapped.value.outcome === "committed") {
      const appended = await appendProjectValue(asValueClient(tx), {
        snapshot: command.snapshot,
        binding: mapped.value.binding,
        definitionRevisionId: command.effectiveRevisionId,
        source: {
          sourceRef: deriveDtsSourceRef({ fileName: proof.sourceName, nodeLocator: proof.nodeLocator }),
          configRevisionId: proof.configRevisionId,
        },
        payload: dtsValueToPayload(proof.value),
        expectedTip: mapped.value.binding.currentValueId,
      });
      if (!appended.ok) {
        return fail({ kind: "agreement-conflict", reason: "legacy-unproven" });
      }
      await tx.query(
        `insert into parameter_catalog.project_value_source_pins (
           id, project_value_id, binding_id, definition_id, organization_id, project_id,
           source_occurrence_id, config_revision_id, file_id, file_version_id, format,
           property_occurrence_id, locator, locator_digest
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
        [
          source.pin.id,
          appended.value.value.id,
          mapped.value.binding.id,
          command.definitionId,
          legacy.organizationId,
          legacy.projectId,
          source.sourceOccurrenceId,
          source.configRevisionId,
          source.pin.fileId,
          source.pin.fileVersionId,
          source.pin.format,
          source.pin.propertyOccurrenceId,
          JSON.stringify(source.pin.locator),
          source.pin.locatorDigest,
        ],
      );
      return {
        ok: true,
        value: {
          outcome: "committed",
          binding: { ...mapped.value.binding, currentValueId: appended.value.currentTip },
        },
      };
    }

    return mapped;
};
