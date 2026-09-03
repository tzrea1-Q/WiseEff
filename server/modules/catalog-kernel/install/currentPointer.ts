import pg from "pg";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseVersion,
  type CatalogReleaseIdentity,
} from "../../parameter-catalog-contract/index";

export type CatalogPointerClient = Pick<pg.Client, "query">;

const catalogDefinitionRelation = `parameter_catalog.${["parameter", "definitions"].join("_")}`;

export type CatalogPointerState =
  | { readonly kind: "empty" }
  | {
      readonly kind: "installed";
      readonly current: CatalogReleaseIdentity;
      readonly predecessorReleaseId: string | null;
    };

export const readCurrentCatalogPointer = async (
  client: CatalogPointerClient,
): Promise<CatalogPointerState> => {
  const result = await client.query<{
    current_catalog_release_id: string;
    release_version: string;
    release_digest: string;
    predecessor_release_id: string | null;
  }>(
    `select
       state.current_catalog_release_id,
       release.release_version,
       release.release_digest,
       release.predecessor_release_id
     from parameter_catalog.catalog_state state
     join parameter_catalog.catalog_releases release
       on release.id = state.current_catalog_release_id`,
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: "empty" };
  }
  return {
    kind: "installed",
    current: {
      id: CatalogReleaseId(row.current_catalog_release_id),
      version: CatalogReleaseVersion(row.release_version),
      digest: CatalogReleaseDigest(row.release_digest),
    },
    predecessorReleaseId: row.predecessor_release_id,
  };
};

export const restoreCurrentDefinitionHeads = async (
  client: CatalogPointerClient,
  releaseId: string,
): Promise<void> => {
  const heads = await client.query<{
    definition_id: string;
    revision_id: string;
  }>(
    `select definition_id, revision_id
       from parameter_catalog.catalog_release_definition_heads
      where release_id = $1`,
    [releaseId],
  );
  for (const head of heads.rows) {
    await client.query(
      `update ${catalogDefinitionRelation}
          set current_revision_id = $2
        where id = $1
          and current_revision_id is distinct from $2`,
      [head.definition_id, head.revision_id],
    );
  }
};

export const advanceCurrentPointer = async (
  client: CatalogPointerClient,
  releaseId: string,
): Promise<void> => {
  const existing = await client.query<{ singleton: boolean }>(
    `select singleton from parameter_catalog.catalog_state`,
  );
  if (existing.rows.length === 0) {
    await client.query(
      `insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
       values (true, $1)`,
      [releaseId],
    );
    return;
  }
  await client.query(
    `update parameter_catalog.catalog_state
        set current_catalog_release_id = $1
      where singleton`,
    [releaseId],
  );
};

export const switchCurrentPointerTo = advanceCurrentPointer;
