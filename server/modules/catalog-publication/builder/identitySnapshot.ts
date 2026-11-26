import type { Database } from "../../../shared/database/client";
import type { CatalogReleaseBundle, CatalogReleaseNode } from "../../catalog-kernel/compiler/types";
import { subjectRulesProvenance } from "../../catalog-kernel/compiler/subjectIdentity";
import { CATALOG_BASELINE_READER_ROLE, quoteIdent } from "../../catalog-kernel/security/catalogRoleManifest";
import type { SubjectIdentityChange } from "../../contracts/dtoSchemas/catalogSubjectIdentity";
import type { CatalogChange, FrozenPublicationIdentity } from "./types";
import type { PreviewSnapshot } from "../persistence/types";

export type SpellingChange = Extract<SubjectIdentityChange, { op: "rename-subject" | "set-subject-alias" }>;

export function withPreviewBaseline<T>(db: Database, read: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.query(`set local role ${quoteIdent(CATALOG_BASELINE_READER_ROLE)}`);
    return read(tx);
  });
}

// The materialized spelling index records selectors. Only spelling edits need
// proof that this index also covers every historical subject natural key.
const coversSubjectSpellings = (node: CatalogReleaseNode) => node.documents.every(doc =>
  doc.kind !== "subject" || doc.content.canonicalKey === `${doc.content.kind}:${doc.content.selector.value}`);

export function identitySnapshotOf(bundle: CatalogReleaseBundle, target: CatalogReleaseNode): PreviewSnapshot {
  return { target, coversSubjectSpellings: bundle.releases.every(coversSubjectSpellings), ...publicationHistoryCapabilities(bundle) };
}

export function publicationHistoryCapabilities(bundle: CatalogReleaseBundle) {
  return {
    hasSubjectRules: bundle.releases.some(release => release.documents.some(subjectRulesProvenance)),
    hasDtsExamples: bundle.releases.some(release => release.documents.some(doc =>
      doc.kind === "definition" && doc.content.revision.dtsExamples !== undefined)),
  };
}

export const onlyDefinitionEdits = (changes: readonly CatalogChange[]) => changes.length > 0 &&
  changes.every(change => change.op === "create-definition" || change.op === "revise-definition");

export function appendPreviewSnapshot(base: PreviewSnapshot, target: CatalogReleaseNode): PreviewSnapshot {
  return {
    target,
    coversSubjectSpellings: base.coversSubjectSpellings && coversSubjectSpellings(target),
    hasSubjectRules: base.hasSubjectRules || target.documents.some(subjectRulesProvenance),
    hasDtsExamples: base.hasDtsExamples || target.documents.some(doc =>
      doc.kind === "definition" && doc.content.revision.dtsExamples !== undefined),
  };
}

export async function canAppendPreviewSnapshot(db: Database, snapshot: PreviewSnapshot, spelling: SpellingChange | undefined,
  frozen: FrozenPublicationIdentity, successorDigest: string): Promise<boolean> {
  const target = snapshot.target;
  // Alias memberships can move scopes; every historical alias ID remains in
  // the complete current release. Shared spellings in other scopes require
  // the original lineage check to disambiguate permanent natural-key claims.
  if (spelling) {
    if (!snapshot.coversSubjectSpellings) return false;
    const subject = target.documents.find(doc => doc.kind === "subject" && doc.content.id === spelling.subjectId);
    if (subject?.kind !== "subject") return false;
    const aliasName = spelling.op === "set-subject-alias" ? spelling.selector : spelling.keepOldAlias ? subject.content.selector.value : undefined;
    if (aliasName && target.documents.some(doc => doc.kind === "alias" &&
      doc.content.selectorKind === subject.content.selector.kind && doc.content.normalizedSelector === aliasName &&
      doc.content.subjectId !== (spelling.op === "set-subject-alias" ? spelling.fromSubjectId ?? spelling.subjectId : spelling.subjectId))) return false;
  }
  // Every predecessor definition and its immutable natural key stay in the
  // target. Revision numbers only increase. Earlier revision IDs are the one
  // definition binding that can disappear from the target; consult their PK.
  return withPreviewBaseline(db, async tx => {
    const { rows } = await tx.query<{ usable: boolean }>(`
      select exists (select from parameter_catalog.catalog_state s
        join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id
        join parameter_catalog.catalog_materializations m on m.release_id=r.id
        where r.id=$1 and r.release_digest=$2)
      and not exists (select from parameter_catalog.catalog_releases where id=$3 or release_version=$4 or release_digest=$7)
      and not exists (select from parameter_catalog.definition_revisions where id = any($8::text[]))
      and ($5::text is null or (
        not exists (select from parameter_catalog.catalog_release_subjects
          where md5(coalesce(selector_snapshot->'values'->>0, selector_snapshot->>'value'))=md5($5)
          and subject_id < $6)
        and not exists (select from parameter_catalog.catalog_release_subjects
          where md5(coalesce(selector_snapshot->'values'->>0, selector_snapshot->>'value'))=md5($5)
          and subject_id > $6))) as usable`,
    [target.manifest.release.id, target.manifest.release.digest, frozen.releaseId, frozen.releaseVersion,
      spelling?.op === "rename-subject" ? spelling.selector : null, spelling?.subjectId ?? null, successorDigest,
      frozen.definitions.map(definition => definition.revisionId)]);
    return rows[0]?.usable === true;
  });
}
