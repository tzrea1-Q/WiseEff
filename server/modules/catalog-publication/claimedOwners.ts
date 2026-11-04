import type { CatalogReleaseNode } from "../catalog-kernel/compiler/types";
import type { Queryable } from "../../shared/database/client";
import type { DeclareSubjectOwnerChange } from "./builder/types";
import { CATALOG_CAPABILITY_ALLOW_LIST } from "./builder/capabilities";

export type OwnerDeclaration = {
  subjectId: string;
  subjectName: string;
  ownerSubjectId: string;
  ownerName: string;
};

/** Only publish permanent claims already made by the maintenance workflow.
 * The immutable predecessor artifact, not the live projection, tells us which
 * claims have yet to be published. No caller-supplied owner IDs are accepted.
 */
export async function planClaimedOwners(db: Queryable, predecessor: CatalogReleaseNode): Promise<
  { ok: true; changes: DeclareSubjectOwnerChange[] } | { ok: false }
> {
  const subjects = predecessor.documents.flatMap(document => document.kind === "subject" ? [document.content] : []);
  const identities = await db.query<{ id: string; owner_subject_id: string | null }>(
    `select id, owner_subject_id from parameter_catalog.catalog_subjects where id=any($1::text[])`,
    [subjects.map(subject => subject.id)],
  );
  const owners = new Map(identities.rows.map(row => [row.id, row.owner_subject_id]));
  const changes: DeclareSubjectOwnerChange[] = [];
  for (const subject of subjects) {
    if (!owners.has(subject.id)) return { ok: false };
    const ownerId = owners.get(subject.id);
    if (subject.ownerSubjectId) {
      if (subject.ownerSubjectId !== ownerId) return { ok: false };
      continue;
    }
    if (!ownerId) continue;
    const owner = subjects.find(candidate => candidate.id === ownerId);
    if (subject.kind !== "node-type" || owner?.kind !== "driver" || owner.lifecycle !== "active") return { ok: false };
    changes.push({ op: "declare-subject-owner", subjectId: subject.id, ownerSubjectId: ownerId });
  }
  // One reviewed batch; never silently omit claims beyond the builder budget.
  if (changes.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxChangeSetOps) return { ok: false };
  return { ok: true, changes: changes.sort((left, right) => left.subjectId.localeCompare(right.subjectId)) };
}
