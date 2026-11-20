import { subjectIdentityChangeSchema, type SubjectIdentityChange } from "../../contracts/dtoSchemas/catalogSubjectIdentity";
import {
  parseCatalogSelector,
  SUBJECT_IDENTITY_CORRECTION,
} from "../../catalog-kernel/compiler/subjectIdentity";
import type {
  CatalogReleaseAliasDocument,
  CatalogReleaseDocument,
  CatalogReleaseSubjectDocument,
} from "../../catalog-kernel/compiler/types";
import { sha256Digest } from "./bundleCodec";
import type { BuildCompleteSuccessorError } from "./types";

export function applySubjectIdentityChange(
  input: SubjectIdentityChange,
  documents: CatalogReleaseDocument[],
  releaseId: string,
): BuildCompleteSuccessorError | undefined {
  const parsed = subjectIdentityChangeSchema.safeParse(input);
  if (!parsed.success) return { kind: "invalid-input", reason: "invalid subject identity correction" };
  const change = parsed.data;
  const subjects = documents.filter((doc): doc is CatalogReleaseSubjectDocument => doc.kind === "subject");
  const aliases = documents.filter((doc): doc is CatalogReleaseAliasDocument => doc.kind === "alias");
  const subject = subjects.find(doc => doc.content.id === change.subjectId);
  if (!subject) return { kind: "subject-not-found", subjectId: change.subjectId };
  if (subject.content.lifecycle !== "active") return { kind: "subject-not-active", subjectId: change.subjectId };
  const { kind: selectorKind, value: oldSelector } = subject.content.selector;
  const selector = parseCatalogSelector(selectorKind, change.selector);
  if (!selector.ok) return { kind: "invalid-input", reason: `subject selector: ${selector.error}` };
  const scopeOf = (subjectId: string) => subjects.find(doc => doc.content.id === subjectId)?.content.ownerSubjectId;
  const scope = scopeOf(change.subjectId);
  const conflict = (reason: "duplicate-alias" | "duplicate-selector"): BuildCompleteSuccessorError =>
    ({ kind: "conflict", reason, subjectId: change.subjectId, selector: selector.value });
  const occupiedPrimary = subjects.some(doc => doc.content.selector.kind === selectorKind &&
    doc.content.selector.value === selector.value && doc.content.ownerSubjectId === scope);
  const occupiedAlias = aliases.find(doc => doc.content.selectorKind === selectorKind &&
    doc.content.normalizedSelector === selector.value && scopeOf(doc.content.subjectId) === scope);
  const provenance = { source: SUBJECT_IDENTITY_CORRECTION, reviewReference: releaseId };
  const newAlias = (value: string): CatalogReleaseAliasDocument => ({
    kind: "alias",
    source: subject.source,
    normalizedDigest: subject.normalizedDigest,
    content: {
      id: `cali_${sha256Digest(JSON.stringify([subject.content.id, selectorKind, value])).slice(7, 39)}`,
      subjectId: subject.content.id, selectorKind, normalizedSelector: value,
      lifecycle: "active", selectorProvenance: { ...provenance }, tombstone: null,
    },
  });
  if (occupiedPrimary) return conflict("duplicate-selector");

  if (change.op === "rename-subject") {
    if (occupiedAlias) return conflict("duplicate-alias");
    documents[documents.indexOf(subject)] = { ...subject, content: { ...subject.content,
      canonicalKey: `${subject.content.kind}:${selector.value}`,
      selector: { kind: selectorKind, value: selector.value, provenance },
    } };
    if (change.keepOldAlias) documents.push(newAlias(oldSelector));
    return;
  }

  const from = change.fromSubjectId;
  const existing = from === undefined ? occupiedAlias : aliases.find(doc => doc.content.subjectId === from &&
    doc.content.selectorKind === selectorKind && doc.content.normalizedSelector === selector.value);
  if (from !== undefined && (!existing || from === change.subjectId || !change.active)) {
    return { kind: "invalid-input", reason: "alias transfer requires an existing alias and a different active target" };
  }
  if ((occupiedAlias && occupiedAlias !== existing) || (from === undefined && existing && existing.content.subjectId !== change.subjectId)) {
    return conflict("duplicate-alias");
  }
  if (!existing) {
    if (!change.active) return { kind: "invalid-input", reason: "alias does not exist" };
    const alias = newAlias(selector.value);
    if (aliases.some(doc => doc.content.id === alias.content.id)) return conflict("duplicate-alias");
    documents.push(alias);
    return;
  }
  if (from === undefined && change.active === (existing.content.lifecycle === "active")) {
    return { kind: "invalid-input", reason: "alias state is unchanged" };
  }
  documents[documents.indexOf(existing)] = { ...existing, content: { ...existing.content,
    subjectId: subject.content.id, selectorProvenance: provenance,
    lifecycle: change.active ? "active" : "retired",
    tombstone: change.active ? null : {
      reason: "alias-disabled", withdrawnByReleaseId: releaseId, previousSelector: selector.value,
    },
  } };
}
