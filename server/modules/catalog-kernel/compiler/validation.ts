import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { parseAllDocuments } from "yaml";

import {
  CatalogSubjectId,
  catalogReleaseViolationCodes,
  parseCanonicalCompatibleSelector,
  parseCanonicalNodeName,
  parseCanonicalPropertyKey,
  serializeContract,
  type CatalogReleaseViolation,
  type CatalogReleaseViolationCode,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";

import type {
  CatalogReleaseBundle,
  CatalogReleaseDocument,
  CatalogReleaseNode,
} from "./types";
import {
  catalogManifestSchema,
  catalogReleaseSchema,
  stableCatalogRules,
} from "./contractArtifacts";
import { validateJsonSchema } from "./jsonSchema";

export type CompilerValidationPhase = "source" | "compile" | "lineage";

export interface CompilerValidation {
  readonly source: readonly CatalogReleaseViolation[];
  readonly compile: readonly CatalogReleaseViolation[];
  readonly lineage: readonly CatalogReleaseViolation[];
}

const absent = { kind: "absent" } as const;

const violation = (input: {
  readonly code: CatalogReleaseViolationCode;
  readonly detail: string;
  readonly location?: string;
  readonly subjectId?: string;
}): CatalogReleaseViolation => ({
  code: input.code,
  location:
    input.location === undefined
      ? absent
      : { kind: "present", value: input.location },
  subjectId:
    input.subjectId === undefined
      ? absent
      : { kind: "present", value: CatalogSubjectId(input.subjectId) },
  detail: input.detail,
});

const safeRelativePath =
  /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u;

const sourceLocation = (releaseId: string, path: string): string =>
  `release:${releaseId}/source:${path}`;

const schemaRegistry = new Map([
  ["https://wiseeff.dev/schemas/dts/catalog-release/manifest.schema.json", catalogManifestSchema],
]);

interface AjvLike {
  compile(schema: unknown): unknown;
}

type AjvConstructor = new (options: {
  readonly allErrors: boolean;
  readonly strict: boolean;
}) => AjvLike;

const localRequire = createRequire(import.meta.url);
const Ajv2020 = (
  localRequire("ajv/dist/2020") as { readonly default: AjvConstructor }
).default;

export const isCatalogReleaseBundle = (value: unknown): value is CatalogReleaseBundle =>
  validateJsonSchema(value, catalogReleaseSchema, catalogReleaseSchema, schemaRegistry);

const countBy = <Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): Map<string, { readonly count: number; readonly value: Value }> => {
  const result = new Map<
    string,
    { readonly count: number; readonly value: Value }
  >();
  for (const value of values) {
    const entryKey = key(value);
    const previous = result.get(entryKey);
    result.set(entryKey, {
      count: (previous?.count ?? 0) + 1,
      value: previous?.value ?? value,
    });
  }
  return result;
};

const validateSources = (
  releases: readonly CatalogReleaseNode[],
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  for (const node of releases) {
    const releaseId = node.manifest.release.id;
    const files = countBy(node.manifest.files, (entry) => entry.path);
    const sources = countBy(node.sources, (entry) => entry.path);
    const documentPaths = new Set(
      node.documents.map((document) => document.source.path),
    );
    const listedDocuments = countBy(
      node.manifest.documents,
      (entry) => `${entry.kind}:${entry.documentId}`,
    );
    const bundledDocuments = countBy(
      node.documents,
      (entry) => `${entry.kind}:${entry.content.id}`,
    );

    const parsedPublicationTime = Date.parse(node.manifest.release.publishedAt);
    if (
      Number.isNaN(parsedPublicationTime) ||
      new Date(parsedPublicationTime)
        .toISOString()
        .replace(/\.000Z$/u, "Z") !== node.manifest.release.publishedAt
    ) {
      violations.push(
        violation({
          code: "manifest-unreadable",
          location: `release:${releaseId}`,
          detail: "release-published-at-noncanonical",
        }),
      );
    }

    for (const [key, descriptorEntry] of listedDocuments) {
      const documentEntry = bundledDocuments.get(key);
      const descriptor = descriptorEntry.value;
      const location = `release:${releaseId}/${descriptor.kind}:${descriptor.documentId}`;
      if (!documentEntry) {
        violations.push(
          violation({
            code: "entry-missing",
            location,
            detail: "manifest-document-content-missing",
          }),
        );
        continue;
      }
      if (descriptorEntry.count !== documentEntry.count) {
        violations.push(
          violation({
            code: "schema-invalid",
            location,
            subjectId: documentSubjectId(documentEntry.value),
            detail: "manifest-document-identity-must-be-unique",
          }),
        );
        continue;
      }
      const document = documentEntry.value;
      if (
        descriptor.sourcePath !== document.source.path ||
        descriptor.kind !== document.kind ||
        descriptor.documentId !== document.content.id ||
        descriptor.normalizedDigest !== document.normalizedDigest
      ) {
        violations.push(
          violation({
            code: "schema-invalid",
            location,
            subjectId: documentSubjectId(document),
            detail: "manifest-document-reference-mismatch",
          }),
        );
      }
    }
    for (const [key, documentEntry] of bundledDocuments) {
      if (listedDocuments.has(key)) continue;
      const document = documentEntry.value;
      violations.push(
        violation({
          code: "entry-unlisted",
          location: `release:${releaseId}/${document.kind}:${document.content.id}`,
          subjectId: documentSubjectId(document),
          detail: "document-entry-not-listed-by-manifest",
        }),
      );
    }

    for (const path of new Set([
      ...files.keys(),
      ...sources.keys(),
      ...documentPaths,
    ])) {
      if (!safeRelativePath.test(path)) {
        violations.push(
          violation({
            code: "unsafe-entry-path",
            location: sourceLocation(releaseId, path),
            detail: "source-path-is-not-a-safe-relative-path",
          }),
        );
      }
    }

    for (const [path, fileEntry] of files) {
      const sourceEntry = sources.get(path);
      if (!sourceEntry) {
        violations.push(
          violation({
            code: "entry-missing",
            location: sourceLocation(releaseId, path),
            detail: "manifest-source-entry-missing",
          }),
        );
        continue;
      }
      if (fileEntry.count !== 1 || sourceEntry.count !== 1) {
        violations.push(
          violation({
            code: "schema-invalid",
            location: sourceLocation(releaseId, path),
            detail: "source-path-must-be-unique",
          }),
        );
        continue;
      }
      const source = sourceEntry.value;
      const file = fileEntry.value;
      const bytes = Buffer.from(source.bytes, "base64");
      if (bytes.toString("base64") !== source.bytes) {
        violations.push(
          violation({
            code: "schema-invalid",
            location: sourceLocation(releaseId, path),
            detail: "source-bytes-must-use-canonical-padded-base64",
          }),
        );
        continue;
      }
      const actualDigest = `sha256:${createHash("sha256")
        .update(bytes)
        .digest("hex")}`;
      if (actualDigest !== file.digest) {
        violations.push(
          violation({
            code: "file-digest-mismatch",
            location: sourceLocation(releaseId, path),
            detail: "exact-source-bytes-digest-mismatch",
          }),
        );
      }
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const parsed = parseAllDocuments(text, { prettyErrors: false });
        if (parsed.length === 0 || parsed.some((document) => document.errors.length > 0)) {
          throw new TypeError("YAML parse failed");
        }
      } catch {
        violations.push(
          violation({
            code: "manifest-unreadable",
            location: sourceLocation(releaseId, path),
            detail: "source-yaml-unreadable",
          }),
        );
      }
      if (
        source.mediaType !== file.mediaType ||
        source.mediaType !== "application/yaml" ||
        source.encoding !== "base64"
      ) {
        violations.push(
          violation({
            code: "schema-invalid",
            location: sourceLocation(releaseId, path),
            detail: "source-entry-contract-mismatch",
          }),
        );
      }
    }

    for (const path of sources.keys()) {
      if (!files.has(path)) {
        violations.push(
          violation({
            code: "entry-unlisted",
            location: sourceLocation(releaseId, path),
            detail: "source-entry-not-listed-by-manifest",
          }),
        );
      }
    }
    for (const path of files.keys()) {
      if (!documentPaths.has(path)) {
        violations.push(
          violation({
            code: "entry-unlisted",
            location: sourceLocation(releaseId, path),
            detail: "manifest-source-has-no-document",
          }),
        );
      }
    }
    for (const path of documentPaths) {
      if (!files.has(path)) {
        violations.push(
          violation({
            code: "entry-unlisted",
            location: sourceLocation(releaseId, path),
            detail: "document-source-not-listed-by-manifest",
          }),
        );
      }
    }

    for (const document of node.documents) {
      const file = files.get(document.source.path)?.value;
      if (
        file &&
        (file.mediaType !== document.source.mediaType ||
          file.digest !== document.source.digest)
      ) {
        violations.push(
          violation({
            code: "file-digest-mismatch",
            location: sourceLocation(releaseId, document.source.path),
            subjectId: documentSubjectId(document),
            detail: "document-source-reference-mismatch",
          }),
        );
      }
    }
  }
  return violations;
};

const violationOrder = new Map(
  catalogReleaseViolationCodes.map((code, index) => [code, index]),
);

export const orderViolations = (
  violations: readonly CatalogReleaseViolation[],
): readonly CatalogReleaseViolation[] =>
  [...violations].sort((left, right) => {
    const codeOrder =
      (violationOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
      (violationOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER);
    if (codeOrder !== 0) return codeOrder;
    const leftLocation =
      left.location.kind === "present" ? left.location.value : "";
    const rightLocation =
      right.location.kind === "present" ? right.location.value : "";
    if (leftLocation !== rightLocation) {
      return leftLocation < rightLocation ? -1 : 1;
    }
    const leftSubject =
      left.subjectId.kind === "present" ? left.subjectId.value : "";
    const rightSubject =
      right.subjectId.kind === "present" ? right.subjectId.value : "";
    if (leftSubject !== rightSubject) return leftSubject < rightSubject ? -1 : 1;
    return left.detail < right.detail ? -1 : left.detail > right.detail ? 1 : 0;
  });

const identityKey = (document: CatalogReleaseDocument): string => {
  switch (document.kind) {
    case "subject":
      return serializeContract([
        document.content.kind,
        document.content.canonicalKey,
      ]).trimEnd();
    case "alias":
      return serializeContract([
        document.content.selectorKind,
        document.content.normalizedSelector,
      ]).trimEnd();
    case "definition":
      return serializeContract([
        document.content.subjectId,
        document.content.propertyKey,
      ]).trimEnd();
  }
};

const documentSubjectId = (
  document: CatalogReleaseDocument,
): string | undefined =>
  document.kind === "subject" ? document.content.id : document.content.subjectId;

const validateDuplicateIdentities = (
  releases: readonly CatalogReleaseNode[],
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  for (const release of releases) {
    for (const kind of ["subject", "alias", "definition"] as const) {
      const ids = new Set<string>();
      const naturalKeys = new Set<string>();
      for (const document of release.documents.filter(
        (candidate): candidate is Extract<CatalogReleaseDocument, { kind: typeof kind }> =>
          candidate.kind === kind,
      )) {
        const id = document.content.id;
        const naturalKey = identityKey(document);
        const duplicateId = ids.has(id);
        const duplicateNaturalKey = naturalKeys.has(naturalKey);
        if (duplicateId || duplicateNaturalKey) {
          violations.push(
            violation({
              code: "duplicate-stable-identity",
              location: `release:${release.manifest.release.id}/${kind}:${id}`,
              subjectId: documentSubjectId(document),
              detail: duplicateId
                ? `${kind}-id-duplicate-in-release`
                : `${kind}-natural-key-duplicate-in-release`,
            }),
          );
        }
        ids.add(id);
        naturalKeys.add(naturalKey);
      }
    }
  }
  return violations;
};

const digestContract = (value: ContractJsonValue): string =>
  `sha256:${createHash("sha256")
    .update(serializeContract(value))
    .digest("hex")}`;

const canonicalKey = (value: ContractJsonValue): string =>
  serializeContract(value).trimEnd();

const contractCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortContractArray = <Value>(
  values: readonly Value[],
  key: (value: Value) => ContractJsonValue,
): Value[] =>
  [...values].sort((left, right) =>
    contractCompare(
      serializeContract(key(left)).trimEnd(),
      serializeContract(key(right)).trimEnd(),
    ),
  );

const aggregateModel = (node: CatalogReleaseNode): ContractJsonValue => ({
  "/manifest/schemaVersion": node.manifest.schemaVersion,
  "/manifest/release/id": node.manifest.release.id,
  "/manifest/release/version": node.manifest.release.version,
  "/manifest/release/sequence": node.manifest.release.sequence,
  "/manifest/release/publishedAt": node.manifest.release.publishedAt,
  "/manifest/release/predecessor": node.manifest.release.predecessor,
  "/manifest/toolchain": node.manifest.toolchain,
  "/manifest/files": sortContractArray(node.manifest.files, (file) => [
    file.path,
  ]),
  "/manifest/documents": sortContractArray(
    node.manifest.documents,
    (document) => [document.kind, document.documentId],
  ),
  "/sources": sortContractArray(node.sources, (source) => [source.path]),
  "/documents": sortContractArray(node.documents, (document) => [
    document.kind,
    document.content.id,
  ]),
}) as unknown as ContractJsonValue;

const revisionContentModel = (
  document: Extract<CatalogReleaseDocument, { kind: "definition" }>,
): ContractJsonValue => {
  const { revision } = document.content;
  const content: Record<string, ContractJsonValue> = {
    "/lifecycle": revision.lifecycle,
    "/displayName": revision.displayName,
    "/documentation": revision.documentation,
    "/valueSchema": revision.valueSchema,
    "/matching": revision.matching,
  };
  if (revision.successorDefinitionId !== undefined) {
    content["/successorDefinitionId"] = revision.successorDefinitionId;
  }
  if (revision.unit !== undefined) content["/unit"] = revision.unit;
  if (revision.examples !== undefined) content["/examples"] = revision.examples;
  return content;
};

const validateCanonicalIdentities = (
  node: CatalogReleaseNode,
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  const releaseId = node.manifest.release.id;
  for (const document of node.documents) {
    if (document.kind === "subject") {
      const parsed =
        document.content.selector.kind === "driver-compatible"
          ? parseCanonicalCompatibleSelector(document.content.selector.value)
          : parseCanonicalNodeName(document.content.selector.value);
      if (!parsed.ok) {
        violations.push(
          violation({
            code: "schema-invalid",
            location: `release:${releaseId}/subject:${document.content.id}/selector`,
            subjectId: document.content.id,
            detail: `subject-selector-${parsed.error}`,
          }),
        );
      }
    } else if (document.kind === "alias") {
      const parsed =
        document.content.selectorKind === "driver-compatible"
          ? parseCanonicalCompatibleSelector(document.content.normalizedSelector)
          : parseCanonicalNodeName(document.content.normalizedSelector);
      if (!parsed.ok) {
        violations.push(
          violation({
            code: "schema-invalid",
            location: `release:${releaseId}/alias:${document.content.id}/selector`,
            subjectId: document.content.subjectId,
            detail: `alias-selector-${parsed.error}`,
          }),
        );
      }
    } else {
      const parsed = parseCanonicalPropertyKey(document.content.propertyKey);
      if (!parsed.ok) {
        violations.push(
          violation({
            code: "schema-invalid",
            location: `release:${releaseId}/definition:${document.content.id}/propertyKey`,
            subjectId: document.content.subjectId,
            detail: `definition-property-key-${parsed.error}`,
          }),
        );
      }
    }
  }
  return violations;
};

const validateContentDigests = (
  node: CatalogReleaseNode,
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  const releaseId = node.manifest.release.id;
  for (const document of node.documents) {
    const location = `release:${releaseId}/${document.kind}:${document.content.id}`;
    if (
      document.normalizedDigest !==
      digestContract(document.content as unknown as ContractJsonValue)
    ) {
      violations.push(
        violation({
          code: "normalization-nondeterministic",
          location,
          subjectId: documentSubjectId(document),
          detail: "document-normalized-digest-mismatch",
        }),
      );
    }
    if (
      document.kind === "definition" &&
      document.content.revision.contentDigest !==
        digestContract(revisionContentModel(document))
    ) {
      violations.push(
        violation({
          code: "revision-derivation-invalid",
          location,
          subjectId: document.content.subjectId,
          detail: "definition-revision-content-digest-mismatch",
        }),
      );
    }
  }
  if (node.manifest.release.digest !== digestContract(aggregateModel(node))) {
    violations.push(
      violation({
        code: "aggregate-digest-mismatch",
        location: `release:${releaseId}`,
        detail: "release-aggregate-digest-mismatch",
      }),
    );
  }
  return violations;
};

const inspectValueSchema = (
  value: Readonly<Record<string, ContractJsonValue>>,
): "valid" | "complexity" | "reference" | "schema" => {
  const rules = stableCatalogRules.valueSchemaRules;
  const stack: Array<{ readonly depth: number; readonly value: unknown }> = [
    { depth: rules.traversal.rootDepth, value },
  ];
  const forbidden = new Set(rules.forbiddenReferenceKeywords);
  let containerNodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.value === null || typeof current.value !== "object") {
      continue;
    }
    containerNodes += 1;
    if (
      current.depth > rules.traversal.maxDepth ||
      containerNodes > rules.traversal.maxContainerNodes
    ) {
      return "complexity";
    }
    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        stack.push({ depth: current.depth + 1, value: entry });
      }
      continue;
    }
    for (const [key, entry] of Object.entries(current.value)) {
      if (forbidden.has(key)) return "reference";
      stack.push({ depth: current.depth + 1, value: entry });
    }
  }

  if (
    value.$schema !== undefined &&
    value.$schema !== stableCatalogRules.valueSchemaRules.dialect
  ) {
    return "schema";
  }
  if (rules.requireValidSchema) {
    try {
      new Ajv2020({ allErrors: true, strict: true }).compile(value);
    } catch {
      return "schema";
    }
  }
  return "valid";
};

const validateDefinitionSemantics = (
  node: CatalogReleaseNode,
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  const releaseId = node.manifest.release.id;
  const definitions = new Map(
    node.documents
      .filter(
        (document): document is Extract<CatalogReleaseDocument, { kind: "definition" }> =>
          document.kind === "definition",
      )
      .map((document) => [document.content.id, document] as const),
  );

  for (const definition of definitions.values()) {
    const location = `release:${releaseId}/definition:${definition.content.id}`;
    const schemaOutcome = inspectValueSchema(
      definition.content.revision.valueSchema,
    );
    if (schemaOutcome !== "valid") {
      const detail =
        schemaOutcome === "complexity"
          ? stableCatalogRules.valueSchemaRules.traversal.limitViolation
          : schemaOutcome === "reference"
            ? "definition-value-schema-ref-forbidden"
            : "definition-value-schema-invalid";
      violations.push(
        violation({
          code: "definition-snapshot-incomplete",
          location,
          subjectId: definition.content.subjectId,
          detail,
        }),
      );
    }

    if (definition.content.revision.lifecycle !== "deprecated") continue;
    const successorId = definition.content.revision.successorDefinitionId;
    if (successorId === definition.content.id) {
      violations.push(
        violation({
          code: "definition-snapshot-incomplete",
          location,
          subjectId: definition.content.subjectId,
          detail: "definition-successor-invalid",
        }),
      );
    } else if (successorId === undefined || !definitions.has(successorId)) {
      violations.push(
        violation({
          code: "definition-snapshot-incomplete",
          location,
          subjectId: definition.content.subjectId,
          detail: "definition-successor-missing",
        }),
      );
    }
  }

  const outcomes = new Map<
    string,
    "active-terminal" | "cycle" | "missing" | "terminal-invalid"
  >();
  for (const definition of definitions.values()) {
    if (definition.content.revision.lifecycle !== "deprecated") continue;
    if (outcomes.has(definition.content.id)) continue;
    const path: string[] = [];
    const pathIndexes = new Set<string>();
    let definitionId: string | undefined = definition.content.id;
    let outcome: "active-terminal" | "cycle" | "missing" | "terminal-invalid";
    while (true) {
      if (definitionId === undefined) {
        outcome = "missing";
        break;
      }
      const known = outcomes.get(definitionId);
      if (known) {
        outcome = known;
        break;
      }
      if (pathIndexes.has(definitionId)) {
        outcome = "cycle";
        break;
      }
      const current = definitions.get(definitionId);
      if (!current) {
        outcome = "missing";
        break;
      }
      if (current.content.revision.lifecycle !== "deprecated") {
        outcome =
          current.content.revision.lifecycle === "active"
            ? "active-terminal"
            : "terminal-invalid";
        break;
      }
      pathIndexes.add(definitionId);
      path.push(definitionId);
      definitionId = current.content.revision.successorDefinitionId;
    }
    for (const pathDefinitionId of path) outcomes.set(pathDefinitionId, outcome);
    if (outcome !== "cycle" && outcome !== "terminal-invalid") continue;
    violations.push(
      violation({
        code: "definition-snapshot-incomplete",
        location: `release:${releaseId}/definition:${definition.content.id}`,
        subjectId: definition.content.subjectId,
        detail:
          outcome === "cycle"
            ? "definition-successor-cycle"
            : "definition-successor-terminal-invalid",
      }),
    );
  }
  return violations;
};

const validateCompileContent = (
  releases: readonly CatalogReleaseNode[],
): CatalogReleaseViolation[] =>
  releases.flatMap((node) => [
    ...validateDuplicateIdentities([node]),
    ...validateCanonicalIdentities(node),
    ...validateContentDigests(node),
    ...validateOwnershipAndLifecycle(node),
    ...validateDefinitionSemantics(node),
  ]);

const orderedReleaseNodes = (
  releases: readonly CatalogReleaseNode[],
): CatalogReleaseNode[] =>
  [...releases].sort((left, right) => {
    const difference =
      left.manifest.release.sequence - right.manifest.release.sequence;
    return difference !== 0
      ? difference
      : contractCompare(left.manifest.release.id, right.manifest.release.id);
  });

const stableBinding = (
  document: CatalogReleaseDocument,
): { readonly id: string; readonly naturalKey: string; readonly immutable: string } => {
  switch (document.kind) {
    case "subject":
      return {
        id: document.content.id,
        naturalKey: canonicalKey([
          document.content.kind,
          document.content.canonicalKey,
        ]),
        immutable: canonicalKey([
          document.content.kind,
          document.content.canonicalKey,
          document.content.subtype as unknown as ContractJsonValue,
        ]),
      };
    case "alias":
      return {
        id: document.content.id,
        naturalKey: canonicalKey([
          document.content.selectorKind,
          document.content.normalizedSelector,
        ]),
        immutable: canonicalKey([document.content.subjectId]),
      };
    case "definition":
      return {
        id: document.content.id,
        naturalKey: canonicalKey([
          document.content.subjectId,
          document.content.propertyKey,
        ]),
        immutable: canonicalKey([
          document.content.subjectId,
          document.content.propertyKey,
        ]),
      };
  }
};

const validateStableIdentityLineage = (
  releases: readonly CatalogReleaseNode[],
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  for (const kind of ["subject", "alias", "definition"] as const) {
    const byId = new Map<
      string,
      { readonly naturalKey: string; readonly immutable: string }
    >();
    const byNaturalKey = new Map<string, string>();
    for (const release of orderedReleaseNodes(releases)) {
      for (const document of release.documents.filter(
        (candidate): candidate is Extract<CatalogReleaseDocument, { kind: typeof kind }> =>
          candidate.kind === kind,
      )) {
        const binding = stableBinding(document);
        const previous = byId.get(binding.id);
        if (
          previous !== undefined &&
          (previous.naturalKey !== binding.naturalKey ||
            previous.immutable !== binding.immutable)
        ) {
          violations.push(
            violation({
              code: "stable-key-reassigned",
              location: `release:${release.manifest.release.id}/${kind}:${binding.id}`,
              subjectId: documentSubjectId(document),
              detail: `${kind}-id-reassigned`,
            }),
          );
        }
        const previousId = byNaturalKey.get(binding.naturalKey);
        if (previousId !== undefined && previousId !== binding.id) {
          violations.push(
            violation({
              code: "stable-key-reassigned",
              location: `release:${release.manifest.release.id}/${kind}:${binding.id}`,
              subjectId: documentSubjectId(document),
              detail: `${kind}-natural-key-reassigned`,
            }),
          );
        }
        byId.set(binding.id, {
          naturalKey: binding.naturalKey,
          immutable: binding.immutable,
        });
        byNaturalKey.set(binding.naturalKey, binding.id);
      }
    }
  }
  return violations;
};

function validateOwnershipAndLifecycle(
  node: CatalogReleaseNode,
): CatalogReleaseViolation[] {
  const violations: CatalogReleaseViolation[] = [];
  const releaseId = node.manifest.release.id;
  const subjects = new Map(
    node.documents
      .filter(
        (document): document is Extract<CatalogReleaseDocument, { kind: "subject" }> =>
          document.kind === "subject",
      )
      .map((document) => [document.content.id, document] as const),
  );

  const canonicalSelectors = new Map<string, string>();
  for (const subject of subjects.values()) {
    canonicalSelectors.set(
      canonicalKey([
        subject.content.selector.kind,
        subject.content.selector.value,
      ]),
      subject.content.id,
    );
    const hasTombstone = subject.content.tombstone !== null;
    if (
      (subject.content.lifecycle === "active" && hasTombstone) ||
      (subject.content.lifecycle === "retired" && !hasTombstone)
    ) {
      violations.push(
        violation({
          code: "lifecycle-tombstone-mismatch",
          location: `release:${releaseId}/subject:${subject.content.id}`,
          subjectId: subject.content.id,
          detail:
            subject.content.lifecycle === "active"
              ? "active-subject-has-tombstone"
              : "retired-subject-missing-tombstone",
        }),
      );
    }
  }

  for (const document of node.documents) {
    if (document.kind === "subject") continue;
    const subject = subjects.get(document.content.subjectId);
    if (!subject) {
      violations.push(
        violation({
          code:
            document.kind === "alias"
              ? "alias-owner-mismatch"
              : "definition-snapshot-incomplete",
          location: `release:${releaseId}/${document.kind}:${document.content.id}`,
          subjectId: document.content.subjectId,
          detail: `${document.kind}-subject-missing`,
        }),
      );
      continue;
    }
    const expectedSelectorKind =
      subject.content.kind === "driver"
        ? "driver-compatible"
        : "node-type-name";
    const actualSelectorKind =
      document.kind === "alias"
        ? document.content.selectorKind
        : document.content.revision.matching.selectorKind;
    if (actualSelectorKind !== expectedSelectorKind) {
      violations.push(
        violation({
          code:
            document.kind === "alias"
              ? "alias-owner-mismatch"
              : "definition-snapshot-incomplete",
          location: `release:${releaseId}/${document.kind}:${document.content.id}`,
          subjectId: document.content.subjectId,
          detail: "owned-selector-kind-mismatch",
        }),
      );
    }

    if (document.kind === "alias") {
      const hasTombstone = document.content.tombstone !== null;
      if (
        (document.content.lifecycle === "active" && hasTombstone) ||
        (document.content.lifecycle === "retired" && !hasTombstone)
      ) {
        violations.push(
          violation({
            code: "lifecycle-tombstone-mismatch",
            location: `release:${releaseId}/alias:${document.content.id}`,
            subjectId: document.content.subjectId,
            detail:
              document.content.lifecycle === "active"
                ? "active-alias-has-tombstone"
                : "retired-alias-missing-tombstone",
          }),
        );
      }
      if (
        document.content.lifecycle === "active" &&
        subject.content.lifecycle !== "active"
      ) {
        violations.push(
          violation({
            code: "alias-owner-mismatch",
            location: `release:${releaseId}/alias:${document.content.id}`,
            subjectId: document.content.subjectId,
            detail: "active-alias-owner-is-not-active",
          }),
        );
      }
      const selectorKey = canonicalKey([
        document.content.selectorKind,
        document.content.normalizedSelector,
      ]);
      if (canonicalSelectors.has(selectorKey)) {
        violations.push(
          violation({
            code: "alias-collision",
            location: `release:${releaseId}/alias:${document.content.id}`,
            subjectId: document.content.subjectId,
            detail: "alias-canonical-selector-collision",
          }),
        );
      }
    }
  }
  return violations;
}

const validatePermanentSelectorOwnership = (
  releases: readonly CatalogReleaseNode[],
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  const canonicalOwners = new Map<string, string>();
  const aliasOwners = new Map<string, string>();
  for (const release of orderedReleaseNodes(releases)) {
    for (const document of release.documents) {
      if (document.kind === "subject") {
        const key = canonicalKey([
          document.content.selector.kind,
          document.content.selector.value,
        ]);
        const owner = canonicalOwners.get(key);
        if (owner !== undefined && owner !== document.content.id) {
          violations.push(
            violation({
              code: "stable-key-reassigned",
              location: `release:${release.manifest.release.id}/subject:${document.content.id}`,
              subjectId: document.content.id,
              detail: "canonical-selector-owner-reassigned",
            }),
          );
        }
        canonicalOwners.set(key, document.content.id);
      } else if (document.kind === "alias") {
        const key = canonicalKey([
          document.content.selectorKind,
          document.content.normalizedSelector,
        ]);
        const owner = aliasOwners.get(key);
        if (owner !== undefined && owner !== document.content.subjectId) {
          violations.push(
            violation({
              code: "alias-owner-mismatch",
              location: `release:${release.manifest.release.id}/alias:${document.content.id}`,
              subjectId: document.content.subjectId,
              detail: "alias-selector-owner-reassigned",
            }),
          );
        }
        aliasOwners.set(key, document.content.subjectId);
      }
    }
  }
  return violations;
};

const validateLineageContent = (
  bundle: CatalogReleaseBundle,
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  const releasesById = new Map(
    bundle.releases.map((release) => [release.manifest.release.id, release]),
  );
  const revisionBindingsById = new Map<
    string,
    {
      readonly definitionId: string;
      readonly number: number;
      readonly contentDigest: string;
    }
  >();
  const revisionIdsByNaturalKey = new Map<string, string>();

  for (const release of orderedReleaseNodes(bundle.releases)) {
    const predecessorId = release.manifest.release.predecessor?.id;
    const predecessor = predecessorId
      ? releasesById.get(predecessorId)
      : undefined;
    const currentDefinitions = new Map(
      release.documents
        .filter(
          (document): document is Extract<CatalogReleaseDocument, { kind: "definition" }> =>
            document.kind === "definition",
        )
        .map((document) => [document.content.id, document] as const),
    );

    if (predecessor) {
      for (const kind of ["subject", "alias", "definition"] as const) {
        const currentIds = new Set(
          release.documents
            .filter((document) => document.kind === kind)
            .map((document) => document.content.id),
        );
        for (const predecessorDocument of predecessor.documents.filter(
          (document) => document.kind === kind,
        )) {
          if (!currentIds.has(predecessorDocument.content.id)) {
            violations.push(
              violation({
                code: "membership-omitted",
                location: `release:${release.manifest.release.id}/${kind}:${predecessorDocument.content.id}`,
                subjectId: documentSubjectId(predecessorDocument),
                detail: `predecessor-${kind}-membership-omitted`,
              }),
            );
          }
        }
      }

      const predecessorDefinitions = new Map(
        predecessor.documents
          .filter(
            (document): document is Extract<CatalogReleaseDocument, { kind: "definition" }> =>
              document.kind === "definition",
          )
          .map((document) => [document.content.id, document] as const),
      );
      for (const [definitionId, current] of currentDefinitions) {
        const previous = predecessorDefinitions.get(definitionId);
        if (!previous) continue;
        const changed =
          current.content.revision.contentDigest !==
          previous.content.revision.contentDigest;
        if (!changed) {
          if (
            current.content.revision.id !== previous.content.revision.id ||
            current.content.revision.number !== previous.content.revision.number
          ) {
            violations.push(
              violation({
                code: "revision-derivation-invalid",
                location: `release:${release.manifest.release.id}/definition:${definitionId}`,
                subjectId: current.content.subjectId,
                detail: "definition-revision-created-without-content-change",
              }),
            );
          }
          continue;
        }
        if (current.content.revision.id === previous.content.revision.id) {
          violations.push(
            violation({
              code: "revision-derivation-invalid",
              location: `release:${release.manifest.release.id}/definition:${definitionId}`,
              subjectId: current.content.subjectId,
              detail: "definition-revision-id-reused-for-content-change",
            }),
          );
        }
        if (
          current.content.revision.number !==
          previous.content.revision.number + 1
        ) {
          violations.push(
            violation({
              code: "revision-derivation-invalid",
              location: `release:${release.manifest.release.id}/definition:${definitionId}`,
              subjectId: current.content.subjectId,
              detail: "definition-revision-sequence-gap",
            }),
          );
        }
      }
    }

    for (const [definitionId, definition] of currentDefinitions) {
      const revision = definition.content.revision;
      const previousBinding = revisionBindingsById.get(revision.id);
      if (
        previousBinding !== undefined &&
        (previousBinding.definitionId !== definitionId ||
          previousBinding.number !== revision.number ||
          previousBinding.contentDigest !== revision.contentDigest)
      ) {
        violations.push(
          violation({
            code: "stable-key-reassigned",
            location: `release:${release.manifest.release.id}/definition:${definitionId}`,
            subjectId: definition.content.subjectId,
            detail: "definition-revision-id-reassigned",
          }),
        );
      }
      const naturalKey = canonicalKey([definitionId, revision.number]);
      const previousRevisionId = revisionIdsByNaturalKey.get(naturalKey);
      if (previousRevisionId !== undefined && previousRevisionId !== revision.id) {
        violations.push(
          violation({
            code: "stable-key-reassigned",
            location: `release:${release.manifest.release.id}/definition:${definitionId}`,
            subjectId: definition.content.subjectId,
            detail: "definition-revision-number-reassigned",
          }),
        );
      }
      revisionBindingsById.set(revision.id, {
        definitionId,
        number: revision.number,
        contentDigest: revision.contentDigest,
      });
      revisionIdsByNaturalKey.set(naturalKey, revision.id);
    }
  }
  return violations;
};

const retirementSelector = (
  document: Extract<CatalogReleaseDocument, { kind: "subject" | "alias" }>,
): string =>
  document.kind === "subject"
    ? document.content.selector.value
    : document.content.normalizedSelector;

const retirementSemanticKind = (
  document: Extract<CatalogReleaseDocument, { kind: "subject" | "alias" }>,
): string =>
  document.kind === "subject"
    ? document.content.kind
    : document.content.selectorKind;

const validateRetirementLineage = (
  bundle: CatalogReleaseBundle,
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  const releasesById = new Map(
    bundle.releases.map((release) => [release.manifest.release.id, release]),
  );

  for (const release of orderedReleaseNodes(bundle.releases)) {
    const predecessorId = release.manifest.release.predecessor?.id;
    const predecessor = predecessorId
      ? releasesById.get(predecessorId)
      : undefined;
    for (const document of release.documents.filter(
      (
        candidate,
      ): candidate is Extract<CatalogReleaseDocument, { kind: "subject" | "alias" }> =>
        (candidate.kind === "subject" || candidate.kind === "alias") &&
        candidate.content.lifecycle === "retired",
    )) {
      const location = `release:${release.manifest.release.id}/${document.kind}:${document.content.id}`;
      const tombstone = document.content.tombstone;
      if (tombstone === null) continue;
      const predecessorDocument = predecessor?.documents.find(
        (candidate) =>
          candidate.kind === document.kind &&
          candidate.content.id === document.content.id,
      ) as
        | Extract<CatalogReleaseDocument, { kind: "subject" | "alias" }>
        | undefined;
      if (!predecessorDocument) {
        violations.push(
          violation({
            code: "lifecycle-tombstone-mismatch",
            location,
            subjectId: documentSubjectId(document),
            detail: "retirement-predecessor-missing",
          }),
        );
        continue;
      }
      const predecessorTombstone = predecessorDocument.content.tombstone;
      const predecessorWasRetired =
        predecessorDocument.content.lifecycle === "retired" &&
        predecessorTombstone !== null;
      const expectedReleaseId = predecessorWasRetired
        ? predecessorTombstone.withdrawnByReleaseId
        : release.manifest.release.id;
      const expectedSelector = predecessorWasRetired
        ? predecessorTombstone.previousSelector
        : retirementSelector(predecessorDocument);
      if (tombstone.withdrawnByReleaseId !== expectedReleaseId) {
        violations.push(
          violation({
            code: "lifecycle-tombstone-mismatch",
            location,
            subjectId: documentSubjectId(document),
            detail: "retirement-release-mismatch",
          }),
        );
      }
      if (tombstone.previousSelector !== expectedSelector) {
        violations.push(
          violation({
            code: "lifecycle-tombstone-mismatch",
            location,
            subjectId: documentSubjectId(document),
            detail: "retirement-previous-selector-mismatch",
          }),
        );
      }
      if (tombstone.successorId === undefined) continue;
      const candidates = release.documents.filter(
        (candidate) => candidate.content.id === tombstone.successorId,
      );
      if (candidates.length === 0) {
        violations.push(
          violation({
            code: "lifecycle-tombstone-mismatch",
            location,
            subjectId: documentSubjectId(document),
            detail: "retirement-successor-missing",
          }),
        );
        continue;
      }
      const successor = candidates.find(
        (
          candidate,
        ): candidate is Extract<CatalogReleaseDocument, { kind: "subject" | "alias" }> =>
          (candidate.kind === "subject" || candidate.kind === "alias") &&
          candidate.kind === document.kind &&
          retirementSemanticKind(candidate) === retirementSemanticKind(document),
      );
      if (!successor) {
        violations.push(
          violation({
            code: "lifecycle-tombstone-mismatch",
            location,
            subjectId: documentSubjectId(document),
            detail: "retirement-successor-kind-mismatch",
          }),
        );
      } else if (
        successor.content.id === document.content.id ||
        successor.content.lifecycle !== "active"
      ) {
        violations.push(
          violation({
            code: "lifecycle-tombstone-mismatch",
            location,
            subjectId: documentSubjectId(document),
            detail: "retirement-successor-invalid",
          }),
        );
      }
    }
  }
  return violations;
};

const validateLineage = (
  bundle: CatalogReleaseBundle,
): CatalogReleaseViolation[] => {
  const violations: CatalogReleaseViolation[] = [];
  const releasesById = new Map<string, CatalogReleaseNode>();
  const versions = new Map<string, string>();
  const digests = new Map<string, string>();

  for (const node of bundle.releases) {
    const { id, version, digest } = node.manifest.release;
    if (releasesById.has(id)) {
      violations.push(
        violation({
          code: "duplicate-stable-identity",
          location: `release:${id}`,
          detail: "release-id-duplicate",
        }),
      );
    }
    const versionOwner = versions.get(version);
    if (versionOwner !== undefined && versionOwner !== id) {
      violations.push(
        violation({
          code: "stable-key-reassigned",
          location: `release:${id}`,
          detail: "release-version-reassigned",
        }),
      );
    }
    const digestOwner = digests.get(digest);
    if (digestOwner !== undefined && digestOwner !== id) {
      violations.push(
        violation({
          code: "stable-key-reassigned",
          location: `release:${id}`,
          detail: "release-digest-reassigned",
        }),
      );
    }
    releasesById.set(id, node);
    versions.set(version, id);
    digests.set(digest, id);
  }

  const target = releasesById.get(bundle.targetReleaseId);
  if (!target) {
    violations.push(
      violation({
        code: "predecessor-mismatch",
        location: `release:${bundle.targetReleaseId}`,
        detail: "target-release-missing",
      }),
    );
    return violations;
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  let current: CatalogReleaseNode | undefined = target;
  while (current !== undefined) {
    const releaseId = current.manifest.release.id;
    if (active.has(releaseId)) {
      violations.push(
        violation({
          code: "predecessor-mismatch",
          location: `release:${releaseId}`,
          detail: "release-lineage-cycle",
        }),
      );
      break;
    }
    if (visited.has(releaseId)) break;
    visited.add(releaseId);
    active.add(releaseId);

    const predecessorPin = current.manifest.release.predecessor;
    if (predecessorPin === null) break;
    const predecessor = releasesById.get(predecessorPin.id);
    if (!predecessor) {
      violations.push(
        violation({
          code: "predecessor-mismatch",
          location: `release:${releaseId}`,
          detail: "predecessor-release-missing",
        }),
      );
      break;
    }
    if (predecessor.manifest.release.digest !== predecessorPin.digest) {
      violations.push(
        violation({
          code: "predecessor-mismatch",
          location: `release:${releaseId}`,
          detail: "predecessor-digest-mismatch",
        }),
      );
    }
    if (
      predecessor.manifest.release.sequence + 1 !==
      current.manifest.release.sequence
    ) {
      violations.push(
        violation({
          code: "predecessor-mismatch",
          location: `release:${releaseId}`,
          detail: "release-sequence-gap",
        }),
      );
    }
    current = predecessor;
  }

  if (visited.size !== releasesById.size) {
    const disconnected = [...releasesById.keys()]
      .filter((id) => !visited.has(id))
      .sort();
    for (const id of disconnected) {
      violations.push(
        violation({
          code: "predecessor-mismatch",
          location: `release:${id}`,
          detail: "release-lineage-disconnected",
        }),
      );
    }
  }

  return violations;
};

export const validateForCompilation = (
  bundle: CatalogReleaseBundle,
): CompilerValidation => ({
  source: orderViolations(validateSources(bundle.releases)),
  compile: orderViolations([
    ...validateCompileContent(bundle.releases),
    ...validateStableIdentityLineage(bundle.releases),
    ...validatePermanentSelectorOwnership(bundle.releases),
  ]),
  lineage: orderViolations([
    ...validateLineage(bundle),
    ...validateLineageContent(bundle),
    ...validateRetirementLineage(bundle),
  ]),
});

export const firstFailedPhase = (
  validation: CompilerValidation,
): CompilerValidationPhase | null => {
  for (const phase of ["source", "compile", "lineage"] as const) {
    if (validation[phase].length > 0) return phase;
  }
  return null;
};
