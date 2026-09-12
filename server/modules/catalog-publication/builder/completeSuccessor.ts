import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  DefinitionRevisionId,
  ParameterDefinitionId,
  parseCanonicalCompatibleSelector,
  parseCanonicalNodeName,
  parseCanonicalPropertyKey,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import type {
  CatalogReleaseBundle,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseDocument,
  CatalogReleaseNode,
  CatalogReleaseSubjectDocument,
} from "../../catalog-kernel/compiler/types";
import { CATALOG_PUBLICATION_COORDINATOR_ROLE, quoteIdent } from "../../catalog-kernel/security/catalogRoleManifest";
import type { Queryable } from "../../../shared/database/client";
import {
  getArtifactByDigest as loadArtifactByDigest,
  persistArtifact as storePersistArtifact,
  persistCandidate as storePersistCandidate,
  sha256DigestOfBytes,
} from "../persistence/store";
import type { JsonObject, PersistArtifactInput, PersistCandidateInput } from "../persistence/types";
import {
  CATALOG_CAPABILITY_ALLOW_LIST,
  CATALOG_CAPABILITY_CONTRACT_REVISION,
  validateSupportedDefinitionContent,
} from "./capabilities";
import {
  canonicalDigest,
  encodeBundleBytes,
  parseBundleBytes,
  refreshSuccessorSource,
  revisionContentModel,
  sortDocuments,
  targetReleaseOf,
} from "./bundleCodec";
import type {
  BuildCompleteSuccessorError,
  BuildCompleteSuccessorInput,
  BuildCompleteSuccessorResult,
  BuilderPersistRequest,
  CapabilityContract,
  CatalogImpactReport,
  ChangedDefinitionImpactEntry,
  CreateDefinitionChange,
  CreateSubjectWithDefinitionsChange,
  DefinitionImpactEntry,
  FrozenDefinitionAllocation,
  FrozenPublicationIdentity,
  ReviseDefinitionChange,
  SuccessorBuildValue,
  SupportedDefinitionContent,
} from "./types";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const CREATE_DEFINITION_KEYS = new Set(["op", "subjectId", "propertyKey", "content"]);
const CREATE_SUBJECT_KEYS = new Set(["op", "kind", "canonicalKey", "selector", "definitions"]);
const REVISE_KEYS = new Set(["op", "definitionId", "class", "content"]);
const SELECTOR_KEYS = new Set(["kind", "value"]);
const NESTED_DEFINITION_KEYS = new Set(["propertyKey", "content"]);

const ok = <T>(value: T): { readonly ok: true; readonly value: T } => ({ ok: true, value });
const fail = (error: BuildCompleteSuccessorError): BuildCompleteSuccessorResult => ({
  ok: false,
  error,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const extraKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] =>
  Object.keys(value).filter((key) => !allowed.has(key)).sort();

const naturalKey = (subjectId: string, propertyKey: string): string =>
  `${subjectId}\0${propertyKey}`;

const asJsonObject = (value: unknown): JsonObject => {
  if (!isRecord(value)) {
    throw new TypeError("expected json object");
  }
  return value as JsonObject;
};

const capabilityContract = (): CapabilityContract => {
  const identity = CATALOG_CAPABILITY_ALLOW_LIST;
  return {
    revision: CATALOG_CAPABILITY_CONTRACT_REVISION,
    allowListId: identity.id,
    allowListDigest: canonicalDigest(identity as unknown as ContractJsonValue),
    valueTypes: [...identity.valueTypes],
    units: [...identity.units],
  };
};

const canonicalPublishedAt = (value: string): boolean => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  return new Date(parsed).toISOString().replace(/\.000Z$/u, "Z") === value;
};

const loadPredecessor = async (
  input: BuildCompleteSuccessorInput,
): Promise<
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly bundle: CatalogReleaseBundle;
      readonly digest: string;
    }
  | { readonly ok: false; readonly error: BuildCompleteSuccessorError }
> => {
  const digest = input.predecessorArtifact.digest;
  if (!SHA256_DIGEST.test(digest)) {
    return { ok: false, error: { kind: "invalid-input", reason: "predecessor digest must be sha256:<64 lowercase hex>" } };
  }
  let bytes: Uint8Array | undefined =
    "bytes" in input.predecessorArtifact ? input.predecessorArtifact.bytes : undefined;
  if (bytes === undefined) {
    const db = input.persist?.db;
    const loader = input.persist?.ports?.getArtifactByDigest ?? loadArtifactByDigest;
    if (!db) {
      return { ok: false, error: { kind: "artifact-missing" } };
    }
    const loaded = await loader(db, digest);
    if (!loaded.ok) {
      return { ok: false, error: { kind: "artifact-missing" } };
    }
    if (loaded.value.artifactDigest !== digest) {
      return {
        ok: false,
        error: {
          kind: "artifact-digest-mismatch",
          expected: digest,
          actual: loaded.value.artifactDigest,
        },
      };
    }
    bytes = loaded.value.artifactBytes;
  }
  if (bytes.byteLength === 0) {
    return { ok: false, error: { kind: "artifact-missing" } };
  }
  const parsed = parseBundleBytes(bytes);
  if (!parsed.ok) {
    return {
      ok: false,
      error: { kind: "predecessor-incomplete", cause: { detail: parsed.detail } },
    };
  }
  const compiled = compileCatalogRelease(parsed.bundle);
  if (!compiled.ok) {
    return { ok: false, error: { kind: "predecessor-incomplete", cause: compiled.error } };
  }
  if (compiled.value.aggregateDigest !== digest) {
    return {
      ok: false,
      error: {
        kind: "artifact-digest-mismatch",
        expected: digest,
        actual: compiled.value.aggregateDigest,
      },
    };
  }
  return { ok: true, bytes, bundle: parsed.bundle, digest };
};

const definitionDocuments = (
  node: CatalogReleaseNode,
): CatalogReleaseDefinitionDocument[] =>
  node.documents.filter(
    (document): document is CatalogReleaseDefinitionDocument => document.kind === "definition",
  );

const subjectDocuments = (
  node: CatalogReleaseNode,
): CatalogReleaseSubjectDocument[] =>
  node.documents.filter(
    (document): document is CatalogReleaseSubjectDocument => document.kind === "subject",
  );

const contentClassOf = (
  previous: CatalogReleaseDefinitionDocument["content"]["revision"],
  next: CatalogReleaseDefinitionDocument["content"]["revision"],
): "documentation" | "semantic" => {
  const previousSemantic = serializeContract({
    "/unit": previous.unit ?? null,
    "/valueSchema": previous.valueSchema,
    "/matching": previous.matching,
    "/lifecycle": previous.lifecycle,
  });
  const nextSemantic = serializeContract({
    "/unit": next.unit ?? null,
    "/valueSchema": next.valueSchema,
    "/matching": next.matching,
    "/lifecycle": next.lifecycle,
  });
  return previousSemantic === nextSemantic ? "documentation" : "semantic";
};

const tighterConstraint = (
  previous: CatalogReleaseDefinitionDocument["content"]["revision"]["valueSchema"],
  next: CatalogReleaseDefinitionDocument["content"]["revision"]["valueSchema"],
): boolean => {
  const prevMin = typeof previous.minimum === "number" ? previous.minimum : undefined;
  const nextMin = typeof next.minimum === "number" ? next.minimum : undefined;
  const prevMax = typeof previous.maximum === "number" ? previous.maximum : undefined;
  const nextMax = typeof next.maximum === "number" ? next.maximum : undefined;
  if (nextMin !== undefined && (prevMin === undefined || nextMin > prevMin)) return true;
  if (nextMax !== undefined && (prevMax === undefined || nextMax < prevMax)) return true;
  return false;
};

const buildImpact = (
  predecessor: CatalogReleaseNode,
  successor: CatalogReleaseNode,
): CatalogImpactReport => {
  const predDefs = new Map(
    definitionDocuments(predecessor).map((document) => [document.content.id, document]),
  );
  const succDefs = new Map(
    definitionDocuments(successor).map((document) => [document.content.id, document]),
  );
  const added: DefinitionImpactEntry[] = [];
  const changed: ChangedDefinitionImpactEntry[] = [];
  const unchanged: DefinitionImpactEntry[] = [];
  let existingContractsTighten = false;
  const newMatchableProperties: CatalogImpactReport["matcher"]["newMatchableProperties"][number][] = [];
  let existingMatchRulesChanged = false;

  for (const [id, current] of [...succDefs.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const previous = predDefs.get(id);
    const entry = {
      definitionId: current.content.id,
      subjectId: current.content.subjectId,
      propertyKey: current.content.propertyKey,
      revisionId: current.content.revision.id,
    };
    if (!previous) {
      added.push(entry);
      newMatchableProperties.push({
        subjectId: current.content.subjectId,
        propertyKey: current.content.propertyKey,
        sourceProperty: current.content.revision.matching.sourceProperty,
        selectorKind: current.content.revision.matching.selectorKind,
      });
      continue;
    }
    if (previous.content.revision.id === current.content.revision.id) {
      unchanged.push(entry);
      if (
        serializeContract(previous.content.revision.matching as unknown as ContractJsonValue) !==
        serializeContract(current.content.revision.matching as unknown as ContractJsonValue)
      ) {
        existingMatchRulesChanged = true;
      }
      continue;
    }
    changed.push({
      ...entry,
      previousRevisionId: previous.content.revision.id,
      contentClass: contentClassOf(previous.content.revision, current.content.revision),
    });
    if (tighterConstraint(previous.content.revision.valueSchema, current.content.revision.valueSchema)) {
      existingContractsTighten = true;
    }
    if (
      serializeContract(previous.content.revision.matching as unknown as ContractJsonValue) !==
      serializeContract(current.content.revision.matching as unknown as ContractJsonValue)
    ) {
      existingMatchRulesChanged = true;
    }
  }

  const collectIds = (node: CatalogReleaseNode, kind: CatalogReleaseDocument["kind"]): string[] =>
    node.documents
      .filter((document) => document.kind === kind)
      .map((document) => document.content.id)
      .sort();

  const delta = (previous: readonly string[], current: readonly string[]) => {
    const prev = new Set(previous);
    const next = new Set(current);
    return {
      added: current.filter((id) => !prev.has(id)),
      unchanged: current.filter((id) => prev.has(id)),
      removed: previous.filter((id) => !next.has(id)),
    };
  };

  const subjects = delta(collectIds(predecessor, "subject"), collectIds(successor, "subject"));
  const aliases = delta(collectIds(predecessor, "alias"), collectIds(successor, "alias"));
  const predSelectors = predecessor.documents.flatMap((document) => {
    if (document.kind === "subject") return [document.content.selector.value];
    if (document.kind === "alias") return [document.content.normalizedSelector];
    return [];
  });
  const succSelectors = successor.documents.flatMap((document) => {
    if (document.kind === "subject") return [document.content.selector.value];
    if (document.kind === "alias") return [document.content.normalizedSelector];
    return [];
  });
  const selectorDelta = delta([...new Set(predSelectors)].sort(), [...new Set(succSelectors)].sort());
  const newNodeType = successor.documents.some(
    (document) =>
      document.kind === "subject" &&
      document.content.kind === "node-type" &&
      !predecessor.documents.some(
        (previous) => previous.kind === "subject" && previous.content.id === document.content.id,
      ),
  );

  return {
    schemaVersion: "catalog-impact/v1",
    predecessor: {
      releaseId: predecessor.manifest.release.id,
      digest: predecessor.manifest.release.digest,
    },
    successor: {
      releaseId: successor.manifest.release.id,
      digest: successor.manifest.release.digest,
    },
    definitions: { added, changed, unchanged },
    subjects: {
      added: subjects.added,
      changed: [],
      unchanged: subjects.unchanged,
    },
    aliases: {
      added: aliases.added,
      changed: [],
      unchanged: aliases.unchanged,
    },
    selectors: {
      added: selectorDelta.added,
      changed: [],
      removed: selectorDelta.removed,
    },
    matcher: {
      existingMatchRulesChanged,
      fallbackImpact: newNodeType || selectorDelta.added.length > 0 || selectorDelta.removed.length > 0,
      newMatchableProperties,
    },
    existingContractsTighten,
    capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
  };
};

const allocationMap = (
  allocations: readonly FrozenDefinitionAllocation[],
): Map<string, FrozenDefinitionAllocation> => {
  const map = new Map<string, FrozenDefinitionAllocation>();
  for (const allocation of allocations) {
    map.set(naturalKey(allocation.subjectId, allocation.propertyKey), allocation);
  }
  return map;
};

const buildDefinitionDocument = (
  subject: CatalogReleaseSubjectDocument,
  propertyKey: string,
  content: SupportedDefinitionContent,
  allocation: FrozenDefinitionAllocation,
): CatalogReleaseDefinitionDocument => {
  const revision = {
    id: allocation.revisionId,
    number: 1,
    lifecycle: "active" as const,
    displayName: content.displayName,
    documentation: content.documentation,
    ...(content.unit !== undefined ? { unit: content.unit } : {}),
    valueSchema: content.valueSchema,
    matching: {
      sourceProperty: propertyKey,
      selectorKind: subject.content.selector.kind,
    },
    ...(content.examples !== undefined ? { examples: content.examples } : {}),
    contentDigest: "sha256:" + "0".repeat(64),
  };
  revision.contentDigest = canonicalDigest(revisionContentModel(revision));
  const definitionContent = {
    id: allocation.definitionId,
    subjectId: subject.content.id,
    propertyKey,
    revision,
  };
  return {
    source: {
      path: "schemas/dts/catalog-release/typed-changeset.yaml",
      mediaType: "application/yaml",
      digest: "sha256:" + "0".repeat(64),
    },
    kind: "definition",
    normalizedDigest: canonicalDigest(definitionContent as unknown as ContractJsonValue),
    content: definitionContent,
  };
};

const applyCreateDefinition = (
  change: CreateDefinitionChange,
  path: string,
  predecessorTarget: CatalogReleaseNode,
  documents: CatalogReleaseDocument[],
  allocations: Map<string, FrozenDefinitionAllocation>,
  claimedNaturalKeys: Set<string>,
): BuildCompleteSuccessorError | CatalogReleaseDefinitionDocument => {
  const extra = extraKeys(change as unknown as Record<string, unknown>, CREATE_DEFINITION_KEYS);
  if (extra.length > 0) {
    return { kind: "unsupported-catalog-capability", detail: "unknown-field", path: `${path}.${extra[0]}` };
  }
  const parsed = parseCanonicalPropertyKey(change.propertyKey);
  if (!parsed.ok) {
    return {
      kind: "invalid-property-key",
      propertyKey: typeof change.propertyKey === "string" ? change.propertyKey : "",
      reason: parsed.error,
    };
  }
  const content = validateSupportedDefinitionContent(change.content, `${path}.content`);
  if (!content.ok) return content.error;
  const subject = subjectDocuments(predecessorTarget).find(
    (document) => document.content.id === change.subjectId,
  ) ?? documents.find(
    (document): document is CatalogReleaseSubjectDocument =>
      document.kind === "subject" && document.content.id === change.subjectId,
  );
  if (!subject) {
    return { kind: "subject-not-found", subjectId: change.subjectId };
  }
  if (subject.content.lifecycle !== "active") {
    return { kind: "subject-not-active", subjectId: change.subjectId };
  }
  const key = naturalKey(subject.content.id, parsed.value);
  if (claimedNaturalKeys.has(key)) {
    return {
      kind: "conflict",
      reason: "duplicate-natural-key",
      subjectId: subject.content.id,
      propertyKey: parsed.value,
    };
  }
  const allocation = allocations.get(key);
  if (!allocation) {
    return { kind: "identity-allocation-missing", naturalKey: key };
  }
  claimedNaturalKeys.add(key);
  return buildDefinitionDocument(subject, parsed.value, content.value, allocation);
};

const applyReviseDefinition = (
  change: ReviseDefinitionChange,
  path: string,
  documents: CatalogReleaseDocument[],
  allocations: Map<string, FrozenDefinitionAllocation>,
):
  | BuildCompleteSuccessorError
  | { readonly kind: "noop"; readonly document: CatalogReleaseDefinitionDocument }
  | CatalogReleaseDefinitionDocument => {
  const extra = extraKeys(change as unknown as Record<string, unknown>, REVISE_KEYS);
  if (extra.length > 0) {
    return { kind: "unsupported-catalog-capability", detail: "unknown-field", path: `${path}.${extra[0]}` };
  }
  if (change.class !== "documentation" && change.class !== "semantic") {
    return { kind: "invalid-input", reason: "revise class must be documentation or semantic" };
  }
  const content = validateSupportedDefinitionContent(change.content, `${path}.content`);
  if (!content.ok) return content.error;
  const current = documents.find(
    (document): document is CatalogReleaseDefinitionDocument =>
      document.kind === "definition" && document.content.id === change.definitionId,
  );
  if (!current) {
    return { kind: "invalid-input", reason: `definition not found:${change.definitionId}` };
  }
  const nextRevisionFields = {
    ...current.content.revision,
    displayName: content.value.displayName,
    documentation: content.value.documentation,
    ...(content.value.unit !== undefined
      ? { unit: content.value.unit }
      : current.content.revision.unit !== undefined
        ? { unit: current.content.revision.unit }
        : {}),
    valueSchema: content.value.valueSchema,
    ...(content.value.examples !== undefined
      ? { examples: content.value.examples }
      : current.content.revision.examples !== undefined
        ? { examples: current.content.revision.examples }
        : {}),
  };
  const previousDigest = canonicalDigest(revisionContentModel(current.content.revision));
  const nextDigest = canonicalDigest(revisionContentModel(nextRevisionFields));
  if (previousDigest === nextDigest) {
    return { kind: "noop", document: current };
  }
  const allocation = allocations.get(
    naturalKey(current.content.subjectId, current.content.propertyKey),
  );
  if (!allocation) {
    return {
      kind: "identity-allocation-missing",
      naturalKey: naturalKey(current.content.subjectId, current.content.propertyKey),
    };
  }
  const revision = {
    ...nextRevisionFields,
    id: allocation.revisionId,
    number: current.content.revision.number + 1,
    contentDigest: nextDigest,
  };
  const definitionContent = { ...current.content, revision };
  return {
    ...current,
    content: definitionContent,
    normalizedDigest: canonicalDigest(definitionContent as unknown as ContractJsonValue),
  };
};

const persistSuccessor = async (
  persist: BuilderPersistRequest,
  artifactInput: PersistArtifactInput,
  candidateInput: PersistCandidateInput,
): Promise<
  | SuccessorBuildValue["persistence"]
  | { readonly ok: false; readonly error: BuildCompleteSuccessorError }
> => {
  const persistArtifactFn = persist.ports?.persistArtifact ?? storePersistArtifact;
  const persistCandidateFn = persist.ports?.persistCandidate ?? storePersistCandidate;
  const db: Queryable = persist.db;
  await db.query("begin");
  try {
    await db.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
    const artifact = await persistArtifactFn(db, artifactInput);
    if (!artifact.ok) {
      await db.query("rollback");
      return {
        ok: false,
        error: { kind: "persist-failed", stage: "artifact", cause: artifact.error },
      };
    }
    const candidate = await persistCandidateFn(db, candidateInput);
    if (!candidate.ok) {
      await db.query("rollback");
      return {
        ok: false,
        error: { kind: "persist-failed", stage: "candidate", cause: candidate.error },
      };
    }
    await db.query("commit");
    return {
      kind: "persisted",
      artifact: artifact.value,
      candidate: candidate.value,
    };
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    return {
      ok: false,
      error: {
        kind: "persist-failed",
        stage: "transaction",
        cause: { detail: error instanceof Error ? error.message : "persist-transaction-failed" },
      },
    };
  } finally {
    await db.query("reset role").catch(() => undefined);
  }
};

export async function buildCompleteSuccessor(
  input: BuildCompleteSuccessorInput,
): Promise<BuildCompleteSuccessorResult> {
  const productPath = input.productPath ?? "m1";
  const predecessor = await loadPredecessor(input);
  if (!predecessor.ok) return fail(predecessor.error);

  const predecessorTarget = targetReleaseOf(predecessor.bundle);
  if (!predecessorTarget) {
    return fail({
      kind: "predecessor-incomplete",
      cause: { detail: "predecessor-target-missing" },
    });
  }

  const frozen: FrozenPublicationIdentity = input.frozenIdentity;
  if (!canonicalPublishedAt(frozen.publishedAt)) {
    return fail({ kind: "invalid-input", reason: "publishedAt must be canonical rfc3339 UTC seconds" });
  }
  if (input.changeSet.length === 0) {
    return fail({ kind: "invalid-input", reason: "changeSet must not be empty" });
  }
  if (input.changeSet.length > CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxChangeSetOps) {
    return fail({
      kind: "unsupported-catalog-capability",
      detail: "resource-budget-exceeded",
      path: "changeSet",
    });
  }

  const allocations = allocationMap(frozen.definitions);
  const claimedNaturalKeys = new Set(
    definitionDocuments(predecessorTarget).map((document) =>
      naturalKey(document.content.subjectId, document.content.propertyKey),
    ),
  );
  const documents: CatalogReleaseDocument[] = predecessorTarget.documents.map((document) =>
    structuredClone(document),
  );

  const sortedChanges = [...input.changeSet].sort((left, right) => {
    const leftKey =
      left.op === "create-definition"
        ? `create\0${left.subjectId}\0${left.propertyKey}`
        : left.op === "revise-definition"
          ? `revise\0${left.definitionId}`
          : `subject\0${left.canonicalKey}`;
    const rightKey =
      right.op === "create-definition"
        ? `create\0${right.subjectId}\0${right.propertyKey}`
        : right.op === "revise-definition"
          ? `revise\0${right.definitionId}`
          : `subject\0${right.canonicalKey}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  let noopRevise: CatalogReleaseDefinitionDocument | null = null;

  for (const [index, change] of sortedChanges.entries()) {
    const path = `changeSet[${index}]`;
    if (!isRecord(change) || typeof change.op !== "string") {
      return fail({ kind: "invalid-input", reason: "change op must be a tagged union member" });
    }
    if (productPath === "m1" && change.op !== "create-definition") {
      return fail({ kind: "unsupported-change-op", op: change.op });
    }
    if (change.op === "create-definition") {
      const created = applyCreateDefinition(
        change,
        path,
        predecessorTarget,
        documents,
        allocations,
        claimedNaturalKeys,
      );
      if ("kind" in created && created.kind !== "definition") {
        return fail(created);
      }
      documents.push(created as CatalogReleaseDefinitionDocument);
      continue;
    }
    if (change.op === "revise-definition") {
      const revised = applyReviseDefinition(change, path, documents, allocations);
      if ("kind" in revised && revised.kind !== "definition" && revised.kind !== "noop") {
        return fail(revised as BuildCompleteSuccessorError);
      }
      if ("kind" in revised && revised.kind === "noop") {
        noopRevise = revised.document;
        continue;
      }
      const next = revised as CatalogReleaseDefinitionDocument;
      const position = documents.findIndex(
        (document) => document.kind === "definition" && document.content.id === next.content.id,
      );
      if (position >= 0) documents[position] = next;
      continue;
    }
    if (change.op === "create-subject-with-definitions") {
      const extra = extraKeys(change as unknown as Record<string, unknown>, CREATE_SUBJECT_KEYS);
      if (extra.length > 0) {
        return fail({
          kind: "unsupported-catalog-capability",
          detail: "unknown-field",
          path: `${path}.${extra[0]}`,
        });
      }
      const subjectChange = change as CreateSubjectWithDefinitionsChange;
      if (subjectChange.kind !== "driver" && subjectChange.kind !== "node-type") {
        return fail({ kind: "invalid-input", reason: "subject kind must be driver or node-type" });
      }
      if (!isRecord(subjectChange.selector) || extraKeys(subjectChange.selector, SELECTOR_KEYS).length > 0) {
        return fail({
          kind: "unsupported-catalog-capability",
          detail: "unknown-field",
          path: `${path}.selector`,
        });
      }
      const selectorParsed =
        subjectChange.selector.kind === "driver-compatible"
          ? parseCanonicalCompatibleSelector(subjectChange.selector.value)
          : subjectChange.selector.kind === "node-type-name"
            ? parseCanonicalNodeName(subjectChange.selector.value)
            : { ok: false as const, error: "invalid-syntax" as const };
      if (!selectorParsed.ok) {
        return fail({ kind: "invalid-input", reason: `selector-${selectorParsed.error}` });
      }
      const subjectAllocation = (frozen.subjects ?? []).find(
        (entry) => entry.canonicalKey === subjectChange.canonicalKey,
      );
      if (!subjectAllocation) {
        return fail({
          kind: "identity-allocation-missing",
          naturalKey: subjectChange.canonicalKey,
        });
      }
      const subjectContent = {
        id: subjectAllocation.subjectId,
        kind: subjectChange.kind,
        canonicalKey: subjectChange.canonicalKey,
        lifecycle: "active" as const,
        selector: {
          kind: subjectChange.selector.kind,
          value: selectorParsed.value,
          provenance: { source: "typed-changeset" },
        },
        subtype:
          subjectChange.kind === "driver"
            ? {
                nature: "physical-device" as const,
                cardinality: { kind: "multiple" as const },
              }
            : {},
        tombstone: null,
      };
      const subjectDocument: CatalogReleaseSubjectDocument = {
        source: {
          path: "schemas/dts/catalog-release/typed-changeset.yaml",
          mediaType: "application/yaml",
          digest: "sha256:" + "0".repeat(64),
        },
        kind: "subject",
        normalizedDigest: canonicalDigest(subjectContent as unknown as ContractJsonValue),
        content: subjectContent,
      };
      documents.push(subjectDocument);
      if (!Array.isArray(subjectChange.definitions)) {
        return fail({ kind: "invalid-input", reason: "nested definitions must be an array" });
      }
      for (const [nestedIndex, nested] of subjectChange.definitions.entries()) {
        if (!isRecord(nested) || extraKeys(nested, NESTED_DEFINITION_KEYS).length > 0) {
          return fail({
            kind: "unsupported-catalog-capability",
            detail: "unknown-field",
            path: `${path}.definitions[${nestedIndex}]`,
          });
        }
        const nestedChange: CreateDefinitionChange = {
          op: "create-definition",
          subjectId: subjectAllocation.subjectId,
          propertyKey: String(nested.propertyKey),
          content: nested.content as SupportedDefinitionContent,
        };
        const created = applyCreateDefinition(
          nestedChange,
          `${path}.definitions[${nestedIndex}]`,
          predecessorTarget,
          documents,
          allocations,
          claimedNaturalKeys,
        );
        if ("kind" in created && created.kind !== "definition") {
          return fail(created);
        }
        documents.push(created as CatalogReleaseDefinitionDocument);
      }
      continue;
    }
    return fail({
      kind: "unsupported-change-op",
      op: typeof (change as { readonly op?: unknown }).op === "string"
        ? (change as { readonly op: string }).op
        : "unknown",
    });
  }

  if (noopRevise && input.changeSet.length === 1) {
    return ok({
      kind: "noop-revise",
      definitionId: ParameterDefinitionId(noopRevise.content.id),
      revisionId: DefinitionRevisionId(noopRevise.content.revision.id),
      predecessor: {
        releaseId: CatalogReleaseId(predecessorTarget.manifest.release.id),
        digest: predecessor.digest,
      },
    });
  }

  const successorDraft: CatalogReleaseNode = {
    manifest: {
      schemaVersion: "1.0.0",
      release: {
        id: frozen.releaseId,
        version: frozen.releaseVersion,
        sequence: predecessorTarget.manifest.release.sequence + 1,
        publishedAt: frozen.publishedAt,
        digest: "sha256:" + "0".repeat(64),
        predecessor: {
          id: predecessorTarget.manifest.release.id,
          digest: predecessor.digest,
        },
      },
      toolchain: {
        compiler: frozen.toolchain.compiler,
        jsonSchemaDialect: frozen.toolchain.jsonSchemaDialect,
        sourceFormat: frozen.toolchain.sourceFormat,
      },
      files: [],
      documents: [],
    },
    sources: [],
    documents: sortDocuments(documents),
  };
  const successor = refreshSuccessorSource(successorDraft);
  const bundle: CatalogReleaseBundle = {
    schemaVersion: "1.0.0",
    targetReleaseId: successor.manifest.release.id,
    releases: [...predecessor.bundle.releases, successor],
  };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    return fail({
      kind: "invalid-release",
      phase: compiled.error.phase,
      violations: compiled.error.violations,
    });
  }

  const impact = buildImpact(predecessorTarget, successor);
  const impactReportDigest = canonicalDigest(impact as unknown as ContractJsonValue);
  const contract = capabilityContract();
  const artifactBytes = encodeBundleBytes(bundle);
  const toolchain = asJsonObject({
    compiler: frozen.toolchain.compiler,
    jsonSchemaDialect: frozen.toolchain.jsonSchemaDialect,
    sourceFormat: frozen.toolchain.sourceFormat,
  });
  const identityAllocation = asJsonObject({
    candidateId: frozen.candidateId,
    artifactId: frozen.artifactId,
    releaseId: frozen.releaseId,
    releaseVersion: frozen.releaseVersion,
    publishedAt: frozen.publishedAt,
    toolchain,
    definitions: frozen.definitions.map((allocation) => ({
      subjectId: allocation.subjectId,
      propertyKey: allocation.propertyKey,
      definitionId: allocation.definitionId,
      revisionId: allocation.revisionId,
    })),
  });
  const proposal = input.proposal ?? null;
  const artifact = {
    id: frozen.artifactId,
    artifactDigest: compiled.value.aggregateDigest,
    artifactBytes,
    bytesChecksum: sha256DigestOfBytes(artifactBytes),
    sourceKind: "typed-changeset" as const,
    targetReleaseId: CatalogReleaseId(successor.manifest.release.id),
    targetReleaseDigest: CatalogReleaseDigest(compiled.value.aggregateDigest),
    predecessorReleaseId: CatalogReleaseId(predecessorTarget.manifest.release.id),
    predecessorReleaseDigest: CatalogReleaseDigest(predecessor.digest),
    toolchain,
    bundle,
  };
  const candidate = {
    id: frozen.candidateId,
    artifactId: frozen.artifactId,
    artifactDigest: compiled.value.aggregateDigest,
    expectedBaseReleaseId: CatalogReleaseId(predecessorTarget.manifest.release.id),
    expectedBaseReleaseDigest: CatalogReleaseDigest(predecessor.digest),
    proposalId: proposal?.proposalId ?? null,
    proposalRevisionId: proposal?.proposalRevisionId ?? null,
    identityAllocation,
    impactReportDigest,
    capabilityContract: contract,
  };

  let persistence: SuccessorBuildValue["persistence"] = { kind: "not-requested" };
  if (input.persist) {
    const persisted = await persistSuccessor(input.persist, artifact, candidate);
    if ("ok" in persisted && persisted.ok === false) {
      return fail(persisted.error);
    }
    persistence = persisted as Extract<SuccessorBuildValue["persistence"], { kind: "persisted" }>;
  }

  return ok({
    kind: "successor",
    artifact,
    candidate,
    impact,
    capabilityContract: contract,
    persistence,
  });
}
