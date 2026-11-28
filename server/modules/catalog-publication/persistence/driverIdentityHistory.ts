import type { Queryable } from "../../../shared/database/client";
import { SUBJECT_IDENTITY_CORRECTION } from "../../catalog-kernel/compiler/subjectIdentity";

/**
 * Before driver spelling history was certified, a driver could have an introduction
 * key that differed from its selector. With no identity corrections, membership
 * retention guarantees every prior driver key and selector is still in the target.
 * Require a verified relational projection for every release back to genesis.
 */
export async function hasUnrenamedDriverHistory(db: Queryable, baseReleaseId: string, expectedReleaseCount?: number): Promise<boolean> {
  const { rows } = await db.query<{ usable: boolean }>(`with recursive lineage(id, parent) as (
    select id, predecessor_release_id from parameter_catalog.catalog_releases where id=$1
    union
    select r.id, r.predecessor_release_id from parameter_catalog.catalog_releases r join lineage l on r.id=l.parent
  ) select exists (select from lineage where parent is null)
      and ($2::bigint is null or (select count(*) from lineage)=$2)
      and not exists (select from lineage l left join parameter_catalog.catalog_materializations m on m.release_id=l.id
        where m.release_id is null or m.database_fingerprint<>m.compiled_fingerprint)
      and not exists (select from lineage l join parameter_catalog.catalog_release_subjects rs on rs.release_id=l.id
        join parameter_catalog.catalog_subjects s on s.id=rs.subject_id
        where s.kind='driver' and rs.selector_provenance->>'source'=$3) as usable`,
  [baseReleaseId, expectedReleaseCount ?? null, SUBJECT_IDENTITY_CORRECTION]);
  return rows[0]?.usable === true;
}
