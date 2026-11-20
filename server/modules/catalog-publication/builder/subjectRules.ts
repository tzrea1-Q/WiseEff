import type { SubjectRulesChange } from "../../contracts/dtoSchemas/catalogSubjectIdentity";
import { parseCatalogSelector, SUBJECT_RULES_CORRECTION } from "../../catalog-kernel/compiler/subjectIdentity";
import type { CatalogReleaseDocument, CatalogReleaseSubjectDocument } from "../../catalog-kernel/compiler/types";
import { sha256Digest } from "./bundleCodec";
import type { BuildCompleteSuccessorError } from "./types";

export function applySubjectRulesChange(
  change: SubjectRulesChange, documents: CatalogReleaseDocument[], releaseId: string,
): BuildCompleteSuccessorError | undefined {
  const subjects = documents.filter(document => document.kind === "subject");
  const subject = subjects.find(document => document.content.id === change.subjectId);
  if (!subject) return { kind: "subject-not-found", subjectId: change.subjectId };
  const invalid = (reason: string): BuildCompleteSuccessorError => ({ kind: "invalid-input", reason });
  const previous = subject.content;
  const provenance = { source: SUBJECT_RULES_CORRECTION, reviewReference: releaseId };
  const replace = (doc: CatalogReleaseSubjectDocument, content: CatalogReleaseSubjectDocument["content"]) => {
    documents[documents.indexOf(doc)] = { ...doc, content: { ...content, selector: { ...content.selector, provenance: { ...provenance } } } };
  };
  const find = (id: string | undefined) => subjects.find(doc => doc.content.id === id)?.content;
  const moveChild = (child: CatalogReleaseSubjectDocument, ownerSubjectId: string | undefined): BuildCompleteSuccessorError | undefined => {
    const aliases = documents.filter(document => document.kind === "alias" && document.content.selectorKind === "node-type-name");
    const selectors = new Set([child.content.selector.value,
      ...aliases.filter(alias => alias.content.subjectId === child.content.id).map(alias => alias.content.normalizedSelector)]);
    const taken = documents.find(document => document.kind === "subject" && document.content.kind === "node-type" &&
      document.content.id !== child.content.id && document.content.ownerSubjectId === ownerSubjectId &&
      (selectors.has(document.content.selector.value) || aliases.some(alias =>
        alias.content.subjectId === document.content.id && selectors.has(alias.content.normalizedSelector))));
    if (taken) return { kind: "conflict", reason: "duplicate-selector", subjectId: child.content.id };
    const { ownerSubjectId: _previousOwner, ...content } = child.content;
    replace(child, { ...content, ...(ownerSubjectId ? { ownerSubjectId } : {}) });
  };
  if (change.op === "restore-subject") {
    if (previous.lifecycle !== "retired") return invalid("subject-already-active");
    if (previous.ownerSubjectId && find(previous.ownerSubjectId)?.lifecycle !== "active") return invalid("subject-owner-not-active");
    if (previous.tombstone?.reason === "subject-kind-replaced" &&
        find(previous.tombstone.successorId)?.lifecycle === "active") return invalid("replacement-subject-still-active");
    replace(subject, { ...previous, lifecycle: "active", tombstone: null });
    for (const [index, alias] of documents.entries()) {
      if (alias.kind !== "alias" || alias.content.subjectId !== previous.id ||
          alias.content.tombstone?.reason !== "subject-retired" ||
          alias.content.tombstone.withdrawnByReleaseId !== previous.tombstone?.withdrawnByReleaseId) continue;
      documents[index] = { ...alias, content: { ...alias.content, lifecycle: "active", tombstone: null } };
    }
    return;
  }
  if (previous.lifecycle !== "active") return { kind: "subject-not-active", subjectId: change.subjectId };

  if (change.op === "set-driver-defaults") {
    if (previous.kind !== "driver" || !("nature" in previous.subtype)) return invalid("subject-is-not-driver");
    if (previous.subtype.nature === change.nature && previous.subtype.cardinality.kind === change.cardinality) {
      return invalid("subject-defaults-unchanged");
    }
    replace(subject, { ...previous, subtype: { nature: change.nature, cardinality: { kind: change.cardinality } } });
    return;
  }
  if (change.op === "change-subject-owner") {
    const owner = find(change.ownerSubjectId ?? undefined);
    if (previous.kind !== "node-type" ||
      (change.ownerSubjectId !== null && (owner?.kind !== "driver" || owner.lifecycle !== "active"))) {
      return invalid("subject-owner-must-be-active-driver");
    }
    if ((previous.ownerSubjectId ?? null) === change.ownerSubjectId) return invalid("subject-owner-unchanged");
    return moveChild(subject, owner?.id);
  }

  let successorId: string | undefined;
  if (change.op === "retire-subject" && change.successorSubjectId) {
    const successor = find(change.successorSubjectId);
    if (!successor || successor.id === previous.id || successor.kind !== previous.kind || successor.lifecycle !== "active") {
      return invalid("subject-successor-must-be-different-active-same-kind");
    }
    successorId = successor.id;
  }
  if (change.op === "replace-subject-kind") {
    const next = change.replacement;
    if (previous.kind === next.kind) return invalid("replacement-subject-kind-unchanged");
    // A conversion between source shapes creates a new root. Existing child
    // identities remain attached to their original driver.
    const selectorKind = next.kind === "driver" ? "driver-compatible" : next.kind === "node-type"
      ? "node-type-name" : "configuration-schema-id";
    const selector = parseCatalogSelector(selectorKind, next.selector);
    if (!selector.ok) return invalid(`subject selector: ${selector.error}`);
    successorId = `csub_${sha256Digest(JSON.stringify([releaseId, previous.id])).slice(7, 39)}`;
    documents.push({ ...subject, content: {
      id: successorId, kind: next.kind, canonicalKey: `${next.kind}:${selector.value}`,
      selector: { kind: selectorKind, value: selector.value, provenance },
      subtype: next.kind === "driver" ? { nature: next.nature, cardinality: { kind: next.cardinality } } : {},
      lifecycle: "active", tombstone: null,
    } });
  }
  if (change.op === "retire-subject" && successorId) {
    const successor = find(successorId);
    if (successor?.ownerSubjectId && find(successor.ownerSubjectId)?.lifecycle !== "active") {
      return invalid("subject-successor-owner-not-active");
    }
  }
  if (change.op === "retire-subject" && change.inheritChildren) {
    if (previous.kind !== "driver" || !successorId) return invalid("child-inheritance-requires-driver-successor");
    for (const child of subjects) {
      if (child.content.ownerSubjectId === previous.id && child.content.lifecycle === "active") {
        const conflict = moveChild(child, successorId);
        if (conflict) return conflict;
      }
    }
  }

  replace(subject, { ...previous, lifecycle: "retired", tombstone: {
    reason: change.op === "replace-subject-kind" ? "subject-kind-replaced" : "subject-retired",
    previousSelector: previous.selector.value, withdrawnByReleaseId: releaseId,
    ...(successorId ? { successorId } : {}),
  } });
  for (const [index, alias] of documents.entries()) {
    if (alias.kind !== "alias" || alias.content.subjectId !== previous.id || alias.content.lifecycle !== "active") continue;
    documents[index] = { ...alias, content: { ...alias.content, lifecycle: "retired", tombstone: {
      reason: "subject-retired", previousSelector: alias.content.normalizedSelector, withdrawnByReleaseId: releaseId,
    } } };
  }
}
