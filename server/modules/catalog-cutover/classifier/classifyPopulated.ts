import type pg from "pg";

import type { Result } from "../../parameter-catalog-contract/index";
import { classifyFrozenP0Graph, fingerprintP0Graph } from "./classify";
import { CLASSIFIER_VERSION } from "./rules";
import type {
  ClassificationFailure,
  ClassificationResult,
  FrozenP0Graph,
} from "./types";

export type ClassifierQueryable = Pick<pg.Client, "query">;

const identityInventorySql = `
select
  id,
  source_kind,
  source_id,
  owner_scope_kind,
  owner_scope_id
from parameter_catalog.legacy_identities
order by id
`;

const conservationCountSql = `
select count(*)::bigint as n
from parameter_catalog.legacy_identities
`;

type StoredIdentity = {
  id: string;
  source_kind: string;
  source_id: string;
  owner_scope_kind: string;
  owner_scope_id: string;
};

const persistBlockedRows = async (
  client: ClassifierQueryable,
  cutoverRunId: string,
  result: ClassificationResult,
): Promise<void> => {
  for (const blocker of result.blockers) {
    await client.query(
      `
      insert into parameter_catalog.parameter_catalog_classification_ledger (
        cutover_run_id, legacy_identity_id, r_class, classifier_version,
        graph_fingerprint, disposition, mapping_version_id
      ) values ($1, $2, $3, $4, $5, 'blocked', null)
      `,
      [
        cutoverRunId,
        blocker.identityId,
        blocker.rClass,
        CLASSIFIER_VERSION,
        result.graphFingerprint,
      ],
    );
  }
};

export const classifyPopulatedP0Graph = async (input: {
  client: ClassifierQueryable;
  graph: FrozenP0Graph;
  cutoverRunId?: string;
}): Promise<Result<ClassificationResult, ClassificationFailure>> => {
  const stored = await input.client.query<StoredIdentity>(identityInventorySql);
  const graphIds = input.graph.identities.map((identity) => identity.id);
  const storedIds = stored.rows.map((row) => row.id);
  const graphIdSet = new Set(graphIds);
  const storedIdSet = new Set(storedIds);
  const missingFromStore = graphIds.filter((id) => !storedIdSet.has(id));
  const extraInStore = storedIds.filter((id) => !graphIdSet.has(id));
  if (
    graphIdSet.size !== graphIds.length ||
    storedIdSet.size !== storedIds.length ||
    missingFromStore.length > 0 ||
    extraInStore.length > 0
  ) {
    return {
      ok: false,
      error: {
        code: "PCAT-CLASS-SOURCE-CONSERVATION",
        detail: `P0 graph identities must equal stored identities; sampling is forbidden (graph=${graphIds.length} stored=${storedIds.length} missing=${missingFromStore.join(",")} extra=${extraInStore.join(",")})`,
      },
    };
  }

  for (const identity of input.graph.identities) {
    const row = stored.rows.find((candidate) => candidate.id === identity.id);
    if (
      !row ||
      row.source_kind !== identity.sourceKind ||
      row.source_id !== identity.sourceId ||
      row.owner_scope_kind !== identity.ownerScopeKind ||
      row.owner_scope_id !== identity.ownerScopeId
    ) {
      return {
        ok: false,
        error: {
          code: "PCAT-CLASS-SOURCE-CONSERVATION",
          detail: `Stored identity ${identity.id} does not match the frozen P0 graph`,
        },
      };
    }
  }

  const classified = classifyFrozenP0Graph(input.graph);
  if (!classified.ok) return classified;

  const counted = await input.client.query<{ n: string }>(conservationCountSql);
  const inputCount = Number(counted.rows[0]?.n ?? 0);
  if (inputCount !== classified.value.conservation.classifiedCount) {
    return {
      ok: false,
      error: {
        code: "PCAT-CLASS-SOURCE-CONSERVATION",
        detail: `SQL conservation failed: count(in)=${inputCount} count(classified)=${classified.value.conservation.classifiedCount}`,
      },
    };
  }

  if (fingerprintP0Graph(input.graph) !== classified.value.graphFingerprint) {
    return {
      ok: false,
      error: {
        code: "PCAT-CLASS-GRAPH-INVALID",
        detail: "Graph fingerprint drifted during classification",
      },
    };
  }

  if (input.cutoverRunId) {
    await persistBlockedRows(input.client, input.cutoverRunId, classified.value);
  }

  return classified;
};
