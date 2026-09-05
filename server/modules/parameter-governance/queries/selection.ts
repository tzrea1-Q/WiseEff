import { createHash } from "node:crypto";

import type { CatalogIdSelection } from "../../catalog-kernel/interface";
import {
  serializeContract,
  type CatalogSubjectId,
  type ContractJsonValue,
  type ParameterDefinitionId,
} from "../../parameter-catalog-contract/index";

export const fingerprintIdSelection = (ids: readonly string[]): string => {
  const ordered = [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return `sha256:${createHash("sha256").update(serializeContract(ordered as ContractJsonValue)).digest("hex")}`;
};

export const onlySelection = <Id extends string>(ids: readonly Id[]): CatalogIdSelection<Id> => ({
  kind: "only",
  ids,
  fingerprint: fingerprintIdSelection(ids),
});

export const allSelection = <Id extends string>(): CatalogIdSelection<Id> => ({ kind: "all" });

export type RegisteredSubjectRow = {
  subject_id: string;
  status: string;
};

export const selectSubjectIdsFromRows = (
  rows: readonly RegisteredSubjectRow[],
  registration: "active" | "retired" | "unregistered" | undefined,
  catalogSubjectIds: readonly CatalogSubjectId[] | undefined,
): CatalogIdSelection<CatalogSubjectId> => {
  if (registration === undefined) {
    return allSelection<CatalogSubjectId>();
  }
  if (registration === "unregistered") {
    const universe = catalogSubjectIds ?? [];
    const registered = new Set(rows.map((row) => row.subject_id));
    const ids = universe.filter((id) => !registered.has(id));
    return onlySelection(ids);
  }
  const ids = rows
    .filter((row) => row.status === registration)
    .map((row) => row.subject_id as CatalogSubjectId);
  return onlySelection(ids);
};

export const expandDefinitionSelection = (
  subjectSelection: CatalogIdSelection<CatalogSubjectId>,
  catalogDefinitions: readonly { id: ParameterDefinitionId; subjectId: CatalogSubjectId }[],
): CatalogIdSelection<ParameterDefinitionId> => {
  if (subjectSelection.kind === "all") {
    return allSelection<ParameterDefinitionId>();
  }
  const allowed = new Set(subjectSelection.ids);
  const ids = catalogDefinitions
    .filter((entry) => allowed.has(entry.subjectId))
    .map((entry) => entry.id);
  return onlySelection(ids);
};
