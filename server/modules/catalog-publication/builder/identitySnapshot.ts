import type { Database } from "../../../shared/database/client";
import type { CatalogReleaseBundle, CatalogReleaseNode } from "../../catalog-kernel/compiler/types";
import { subjectRulesProvenance } from "../../catalog-kernel/compiler/subjectIdentity";
import { CATALOG_BASELINE_READER_ROLE, quoteIdent } from "../../catalog-kernel/security/catalogRoleManifest";
import type { SubjectIdentityChange } from "../../contracts/dtoSchemas/catalogSubjectIdentity";
import type { FrozenPublicationIdentity } from "./types";
import type { PreviewSnapshot } from "../persistence/types";

export type SpellingChange = Extract<SubjectIdentityChange, { op: "rename-subject" | "set-subject-alias" }>;

export function withPreviewBaseline<T>(db: Database, read: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.query(`set local role ${quoteIdent(CATALOG_BASELINE_READER_ROLE)}`);
    return read(tx);
  });
}

/** Materialization records selector spellings. Legacy divergent natural keys require the full compiler. */
export function identitySnapshotOf(bundle: CatalogReleaseBundle, target: CatalogReleaseNode): PreviewSnapshot | undefined {
  if (bundle.releases.some(release => release.documents.some(doc => doc.kind === "subject" &&
    doc.content.canonicalKey !== `${doc.content.kind}:${doc.content.selector.value}`))) return undefined;
  return { target, ...publicationHistoryCapabilities(bundle) };
}

export function publicationHistoryCapabilities(bundle: CatalogReleaseBundle) {
  return {
    hasSubjectRules: bundle.releases.some(release => release.documents.some(subjectRulesProvenance)),
    hasDtsExamples: bundle.releases.some(release => release.documents.some(doc =>
      doc.kind === "definition" && doc.content.revision.dtsExamples !== undefined)),
  };
}

export async function canAppendIdentitySnapshot(db: Database, snapshot: PreviewSnapshot, change: SpellingChange,
  frozen: FrozenPublicationIdentity, successorDigest: string): Promise<boolean> {
  const target = snapshot.target;
  const subject = target.documents.find(doc => doc.kind === "subject" && doc.content.id === change.subjectId);
  if (subject?.kind !== "subject") return false;
  // Alias memberships can move scopes; every historical alias ID remains in
  // the complete current release. Shared spellings in other scopes require
  // the original lineage check to disambiguate permanent natural-key claims.
  const aliasName = change.op === "set-subject-alias" ? change.selector : change.keepOldAlias ? subject.content.selector.value : undefined;
  if (aliasName && target.documents.some(doc => doc.kind === "alias" &&
    doc.content.selectorKind === subject.content.selector.kind && doc.content.normalizedSelector === aliasName &&
    doc.content.subjectId !== (change.op === "set-subject-alias" ? change.fromSubjectId ?? change.subjectId : change.subjectId))) return false;
  return withPreviewBaseline(db, async tx => {
    const { rows } = await tx.query<{ usable: boolean }>(`
      select exists (select from parameter_catalog.catalog_state s
        join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id
        join parameter_catalog.catalog_materializations m on m.release_id=r.id
        where r.id=$1 and r.release_digest=$2)
      and not exists (select from parameter_catalog.catalog_releases where id=$3 or release_version=$4 or release_digest=$7)
      and ($5::text is null or (
        not exists (select from parameter_catalog.catalog_release_subjects
          where md5(coalesce(selector_snapshot->'values'->>0, selector_snapshot->>'value'))=md5($5)
          and subject_id < $6)
        and not exists (select from parameter_catalog.catalog_release_subjects
          where md5(coalesce(selector_snapshot->'values'->>0, selector_snapshot->>'value'))=md5($5)
          and subject_id > $6))) as usable`,
    [target.manifest.release.id, target.manifest.release.digest, frozen.releaseId, frozen.releaseVersion,
      change.op === "rename-subject" ? change.selector : null, change.subjectId, successorDigest]);
    return rows[0]?.usable === true;
  });
}
