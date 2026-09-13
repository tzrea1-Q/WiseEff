/**
 * Production vendor import: listed YAML → typed CatalogChange[] + CP-03 successor.
 *
 * New official IDs are opaque allocations. Natural-key mapping reuses published
 * IDs. Runtime does not parse ID strings to infer identity.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseId,
  CatalogReleaseVersion,
  parseCanonicalCompatibleSelector,
  parseCanonicalNodeName,
  parseCanonicalPropertyKey,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import type {
  CatalogReleaseAliasDocument,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseDocument,
  CatalogReleaseNode,
  CatalogReleaseSubjectDocument,
} from "../../catalog-kernel/compiler/types";
import { classifyImpact } from "../authorization/classify";
import type { ImpactFacts } from "../authorization/types";
import {
  canonicalDigest,
  parseBundleBytes,
  revisionContentModel,
  targetReleaseOf,
} from "../builder/bundleCodec";
import { validateSupportedDefinitionContent } from "../builder/capabilities";
import { buildCompleteSuccessor } from "../builder/completeSuccessor";
import type {
  BuildCompleteSuccessorError,
  BuildCompleteSuccessorValue,
  BuilderPersistRequest,
  CatalogChange,
  CreateDefinitionChange,
  CreateSubjectWithDefinitionsChange,
  DriverCardinality,
  DriverNature,
  FrozenDefinitionAllocation,
  FrozenPublicationIdentity,
  FrozenSubjectAllocation,
  NestedDefinitionDraft,
  PredecessorArtifactInput,
  ReviseDefinitionChange,
  SupportedDefinitionContent,
} from "../builder/types";
import {
  persistArtifact as storePersistArtifact,
  persistCandidate as storePersistCandidate,
} from "../persistence/store";
import type { JsonObject } from "../persistence/types";
import {
  inventoryVendorCatalog,
  isExcludedSchemaBasename,
  parseVendorYamlFile,
  POWER_MANAGEMENT_BASENAME,
  vendorPropertyShape,
  vendorValueSchemaFor,
  type VendorCatalogInventory,
  type VendorFileInventory,
  type VendorInventoryError,
  type VendorPropertyYaml,
  type VendorYamlDocument,
} from "./vendorYaml";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const DOCUMENT_FIELD_KEYS = new Set([
  "$id",
  "title",
  "source",
  "lifecycle",
  "version",
  "schemaNamespace",
  "compatible",
  "nodename",
  "properties",
  "documentation",
  "childNodes",
]);
const PROPERTY_FIELD_KEYS = new Set([
  "valueShape",
  "units",
  "documentation",
  "constraints",
  "exampleValue",
  "default",
]);
const M1_SHAPES = new Set(["integer", "number", "string"]);

export type VendorIdKind = "ccand" | "cart" | "crel" | "csub" | "pdef" | "drev";

export type VendorIdentityOptions = {
  readonly publishedAt?: string;
  readonly releaseVersion?: string;
  readonly candidateId?: string;
  readonly artifactId?: string;
  readonly releaseId?: string;
  readonly allocateId?: (kind: VendorIdKind) => string;
};

export type ClaimedVendorIdentity = {
  readonly canonicalKey: string;
  readonly subjectId?: string;
  readonly propertyKey?: string;
  readonly definitionId?: string;
};

export type VendorDispositionKind =
  | "mapped"
  | "unchanged"
  | "structural-non-param"
  | "excluded"
  | "unsupported"
  | "conflict"
  | "extra-not-imported"
  | "listed-missing";

export type VendorDisposition = {
  readonly path: string;
  readonly kind: VendorDispositionKind;
  readonly detail: string;
  readonly sourceFields: readonly string[];
};

export type VendorIdentityMapEntry = {
  readonly canonicalKey: string;
  readonly propertyKey?: string;
  readonly publishedId: string;
  readonly action: "reuse" | "allocate" | "revise" | "conflict";
};

export type VendorAppliedDriverDefault = {
  readonly canonicalKey: string;
  readonly nature: "physical-device";
  readonly cardinality: "multiple";
  readonly reason: "new-driver-compiler-default";
};

export type VendorConversionReport = {
  readonly inventory: VendorCatalogInventory;
  readonly dispositions: readonly VendorDisposition[];
  readonly identityMap: readonly VendorIdentityMapEntry[];
  readonly blocking: readonly VendorDisposition[];
  readonly appliedDefaults: readonly VendorAppliedDriverDefault[];
};

export type VendorImportError =
  | VendorInventoryError
  | {
      readonly kind: "import-blocked";
      readonly reason: string;
      readonly report: VendorConversionReport;
    }
  | { readonly kind: "artifact-missing" }
  | {
      readonly kind: "artifact-digest-mismatch";
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly kind: "predecessor-incomplete";
      readonly cause: { readonly detail: string };
    }
  | BuildCompleteSuccessorError;

export type VendorImportSuccessor = {
  readonly kind: "successor";
  readonly changeSet: readonly CatalogChange[];
  readonly frozenIdentity: FrozenPublicationIdentity;
  readonly impactFacts: ImpactFacts;
  readonly report: VendorConversionReport;
  readonly built: BuildCompleteSuccessorValue;
};

export type VendorImportUnchanged = {
  readonly kind: "unchanged";
  readonly changeSet: readonly [];
  readonly report: VendorConversionReport;
  readonly predecessor: { readonly releaseId: string; readonly digest: string };
};

export type VendorImportValue = VendorImportSuccessor | VendorImportUnchanged;

export type ImportVendorCatalogInput = {
  readonly predecessorArtifact: PredecessorArtifactInput;
  readonly schemasRoot: string;
  readonly identity?: VendorIdentityOptions;
  readonly claimedIdentities?: readonly ClaimedVendorIdentity[];
  readonly authorPrincipalId?: string;
  readonly authorOrganizationId?: string;
  readonly persist?: BuilderPersistRequest;
};

const ok = <T>(value: T): { readonly ok: true; readonly value: T } => ({ ok: true, value });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const extraKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] =>
  Object.keys(value).filter((key) => !allowed.has(key)).sort();

const mintToken = (): string => randomUUID().replace(/-/g, "").slice(0, 16);

export const allocateOpaqueId = (kind: VendorIdKind): string => `${kind}_${mintToken()}`;

const canonicalUtcSeconds = (date = new Date()): string =>
  date.toISOString().replace(/\.\d{3}Z$/u, "Z");

const bumpReleaseVersion = (version: string): string => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return `${version}.1`;
  return `${match[1]}.${Number(match[2]) + 1}.0`;
};

const naturalKey = (subjectId: string, propertyKey: string): string =>
  `${subjectId}\0${propertyKey}`;

const contentFingerprint = (content: SupportedDefinitionContent): string =>
  serializeContract({
    "/displayName": content.displayName,
    "/documentation": content.documentation,
    "/unit": content.unit ?? null,
    "/valueSchema": content.valueSchema,
    ...(content.examples !== undefined ? { "/examples": content.examples } : {}),
  } as unknown as ContractJsonValue);

const predecessorContent = (
  revision: CatalogReleaseDefinitionDocument["content"]["revision"],
): SupportedDefinitionContent | null => {
  const validated = validateSupportedDefinitionContent(
    {
      displayName: revision.displayName,
      documentation: revision.documentation,
      ...(revision.unit !== undefined ? { unit: revision.unit } : {}),
      valueSchema: revision.valueSchema,
      ...(revision.examples !== undefined ? { examples: revision.examples } : {}),
    },
    "predecessor.content",
  );
  return validated.ok ? validated.value : null;
};

type PredecessorIndex = {
  readonly target: CatalogReleaseNode;
  readonly digest: string;
  readonly bundleBytes: Uint8Array;
  readonly subjectsByCanonicalKey: Map<string, CatalogReleaseSubjectDocument>;
  readonly subjectsById: Map<string, CatalogReleaseSubjectDocument>;
  readonly subjectsBySelector: Map<string, CatalogReleaseSubjectDocument>;
  readonly aliasesBySelector: Map<string, CatalogReleaseAliasDocument>;
  readonly definitionsByNaturalKey: Map<string, CatalogReleaseDefinitionDocument>;
  readonly definitionsById: Map<string, CatalogReleaseDefinitionDocument>;
};

const indexPredecessor = (target: CatalogReleaseNode): Omit<
  PredecessorIndex,
  "target" | "digest" | "bundleBytes"
> => {
  const subjectsByCanonicalKey = new Map<string, CatalogReleaseSubjectDocument>();
  const subjectsById = new Map<string, CatalogReleaseSubjectDocument>();
  const subjectsBySelector = new Map<string, CatalogReleaseSubjectDocument>();
  const aliasesBySelector = new Map<string, CatalogReleaseAliasDocument>();
  const definitionsByNaturalKey = new Map<string, CatalogReleaseDefinitionDocument>();
  const definitionsById = new Map<string, CatalogReleaseDefinitionDocument>();
  for (const document of target.documents) {
    if (document.kind === "subject") {
      subjectsByCanonicalKey.set(document.content.canonicalKey, document);
      subjectsById.set(document.content.id, document);
      subjectsBySelector.set(document.content.selector.value, document);
    } else if (document.kind === "alias") {
      aliasesBySelector.set(document.content.normalizedSelector, document);
    } else if (document.kind === "definition") {
      definitionsByNaturalKey.set(
        naturalKey(document.content.subjectId, document.content.propertyKey),
        document,
      );
      definitionsById.set(document.content.id, document);
    }
  }
  return {
    subjectsByCanonicalKey,
    subjectsById,
    subjectsBySelector,
    aliasesBySelector,
    definitionsByNaturalKey,
    definitionsById,
  };
};

const loadPredecessor = (
  input: PredecessorArtifactInput,
):
  | { readonly ok: true; readonly index: PredecessorIndex }
  | { readonly ok: false; readonly error: VendorImportError } => {
  const digest = input.digest;
  if (!SHA256_DIGEST.test(digest)) {
    return { ok: false, error: { kind: "invalid-input", reason: "predecessor digest must be sha256:<64 lowercase hex>" } };
  }
  if (!("bytes" in input) || input.bytes === undefined) {
    return { ok: false, error: { kind: "artifact-missing" } };
  }
  if (input.bytes.byteLength === 0) {
    return { ok: false, error: { kind: "artifact-missing" } };
  }
  const parsed = parseBundleBytes(input.bytes);
  if (!parsed.ok) {
    return { ok: false, error: { kind: "predecessor-incomplete", cause: { detail: parsed.detail } } };
  }
  const compiled = compileCatalogRelease(parsed.bundle);
  if (!compiled.ok) {
    return {
      ok: false,
      error: { kind: "predecessor-incomplete", cause: { detail: compiled.error.kind } },
    };
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
  const target = targetReleaseOf(parsed.bundle);
  if (!target) {
    return {
      ok: false,
      error: { kind: "predecessor-incomplete", cause: { detail: "predecessor-target-missing" } },
    };
  }
  return {
    ok: true,
    index: {
      target,
      digest,
      bundleBytes: input.bytes,
      ...indexPredecessor(target),
    },
  };
};

const disposition = (
  path: string,
  kind: VendorDispositionKind,
  detail: string,
  sourceFields: readonly string[] = [],
): VendorDisposition => ({ path, kind, detail, sourceFields });

const DEFAULT_NEW_DRIVER_NATURE = "physical-device" as const satisfies DriverNature;
const DEFAULT_NEW_DRIVER_CARDINALITY = "multiple" as const satisfies DriverCardinality;

type PreparedSubject = {
  readonly relativePath: string;
  readonly canonicalKey: string;
  readonly kind: "driver" | "node-type";
  readonly selectorKind: "driver-compatible" | "node-type-name";
  readonly selectorValue: string;
  readonly extraSelectors: readonly string[];
  readonly existing: CatalogReleaseSubjectDocument | null;
  readonly subjectId: string;
  readonly allocated: boolean;
  readonly nature?: DriverNature;
  readonly cardinality?: DriverCardinality;
  readonly definitions: NestedDefinitionDraft[];
};

const mapProductionValueSchema = (
  shape: string,
):
  | { readonly ok: true; readonly value: Record<string, ContractJsonValue> }
  | { readonly ok: false; readonly detail: string } => {
  if (M1_SHAPES.has(shape)) {
    return { ok: true, value: { type: shape } };
  }
  try {
    return { ok: true, value: vendorValueSchemaFor(shape) };
  } catch {
    return { ok: false, detail: `unsupported-value-shape:${shape}` };
  }
};

const foldConstraints = (
  schema: Record<string, ContractJsonValue>,
  constraints: unknown,
  propertyPath: string,
):
  | { readonly ok: true; readonly value: Record<string, ContractJsonValue> }
  | { readonly ok: false; readonly detail: string; readonly path: string } => {
  if (constraints === undefined) {
    return { ok: true, value: schema };
  }
  if (!isRecord(constraints)) {
    return { ok: false, detail: "constraints-not-object", path: `${propertyPath}.constraints` };
  }
  const keys = Object.keys(constraints);
  if (keys.length === 0) {
    return { ok: true, value: schema };
  }
  const allowed = new Set(["minimum", "maximum"]);
  const extras = keys.filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    return {
      ok: false,
      detail: `unhandled-constraint:${extras.sort().join(",")}`,
      path: `${propertyPath}.constraints.${extras.sort()[0]}`,
    };
  }
  if (schema.type !== "integer" && schema.type !== "number") {
    return {
      ok: false,
      detail: "numeric-constraints-require-integer-or-number",
      path: `${propertyPath}.constraints`,
    };
  }
  const next = { ...schema };
  if (constraints.minimum !== undefined) {
    if (typeof constraints.minimum !== "number") {
      return { ok: false, detail: "invalid-numeric-bound", path: `${propertyPath}.constraints.minimum` };
    }
    next.minimum = constraints.minimum;
  }
  if (constraints.maximum !== undefined) {
    if (typeof constraints.maximum !== "number") {
      return { ok: false, detail: "invalid-numeric-bound", path: `${propertyPath}.constraints.maximum` };
    }
    next.maximum = constraints.maximum;
  }
  return { ok: true, value: next };
};

const fileFieldDispositions = (
  relativePath: string,
  document: VendorYamlDocument,
): VendorDisposition[] => {
  const rows: VendorDisposition[] = [];
  const record = document as Record<string, unknown>;
  for (const field of extraKeys(record, DOCUMENT_FIELD_KEYS)) {
    rows.push(
      disposition(
        `${relativePath}.${field}`,
        "unsupported",
        `unknown-document-field:${field}`,
        [field],
      ),
    );
  }
  for (const field of ["$id", "title", "source", "version", "schemaNamespace"] as const) {
    if (record[field] !== undefined) {
      rows.push(
        disposition(`${relativePath}.${field}`, "structural-non-param", "vendor document identity metadata", [
          field,
        ]),
      );
    }
  }
  if (document.documentation !== undefined) {
    rows.push(
      disposition(`${relativePath}.documentation`, "structural-non-param", "file-level docs; property docs are mapped", [
        "documentation",
      ]),
    );
  }
  if (document.childNodes !== undefined) {
    rows.push(
      disposition(`${relativePath}.childNodes`, "structural-non-param", "DTS child topology is not a parameter", [
        "childNodes",
      ]),
    );
  }
  if (document.compatible !== undefined) {
    rows.push(
      disposition(`${relativePath}.compatible`, "mapped", "driver selector source", ["compatible"]),
    );
  }
  if (document.nodename !== undefined) {
    rows.push(
      disposition(`${relativePath}.nodename`, "mapped", "node-type selector source", ["nodename"]),
    );
  }
  if (document.lifecycle !== undefined) {
    rows.push(
      disposition(
        `${relativePath}.lifecycle`,
        document.lifecycle === "active" ? "structural-non-param" : "excluded",
        document.lifecycle === "active" ? "active vendor document" : `lifecycle:${document.lifecycle}`,
        ["lifecycle"],
      ),
    );
  }
  return rows;
};

const claimedFor = (
  claimed: readonly ClaimedVendorIdentity[],
  canonicalKey: string,
  propertyKey?: string,
): ClaimedVendorIdentity | undefined =>
  claimed.find(
    (entry) =>
      entry.canonicalKey === canonicalKey &&
      (propertyKey === undefined ? entry.propertyKey === undefined : entry.propertyKey === propertyKey),
  ) ?? claimed.find((entry) => entry.canonicalKey === canonicalKey && entry.propertyKey === undefined);

export function vendorImpactFacts(
  authorPrincipalId: string,
  changeSet: readonly CatalogChange[],
): ImpactFacts {
  const operations = changeSet.map((change) =>
    change.op === "create-definition"
      ? { op: "create-definition" as const, supported: true }
      : change.op === "revise-definition"
        ? { op: "revise-definition" as const, class: change.class }
        : { op: "create-subject-with-definitions" as const },
  );
  const introducesNewSubject = changeSet.some((change) => change.op === "create-subject-with-definitions");
  const changesUnitOrSemantic = changeSet.some(
    (change) => change.op === "revise-definition" && change.class === "semantic",
  );
  return {
    authorPrincipalId,
    operations,
    introducesNewSubject,
    changesSelector: introducesNewSubject,
    changesAlias: false,
    changesFallback: introducesNewSubject,
    tightensExistingContract: false,
    changesUnitOrSemantic,
    retiresIdentity: false,
    unknownImpact: false,
    sourceKind: "vendor-yaml",
  };
}

const inventoryFileDispositions = (files: readonly VendorFileInventory[]): VendorDisposition[] =>
  files.map((file) => {
    if (file.disposition === "input") {
      return disposition(file.relativePath, "mapped", file.detail, ["schemaPaths"]);
    }
    if (file.disposition === "excluded" || file.disposition === "extra-not-imported") {
      return disposition(
        file.relativePath,
        file.listed ? "excluded" : "extra-not-imported",
        file.detail,
        ["schemaPaths"],
      );
    }
    if (file.disposition === "listed-missing") {
      return disposition(file.relativePath, "listed-missing", file.detail, ["schemaPaths"]);
    }
    return disposition(file.relativePath, "unsupported", file.detail, ["schemaPaths"]);
  });

export async function importVendorCatalog(
  input: ImportVendorCatalogInput,
): Promise<{ readonly ok: true; readonly value: VendorImportValue } | { readonly ok: false; readonly error: VendorImportError }> {
  const authorPrincipalId = input.authorPrincipalId?.trim() ?? "";
  if (authorPrincipalId.length === 0) {
    return { ok: false, error: { kind: "invalid-input", reason: "authorPrincipalId is required" } };
  }
  const inventoried = inventoryVendorCatalog(input.schemasRoot);
  if (!inventoried.ok) {
    return { ok: false, error: inventoried.error };
  }
  const inventory = inventoried.value;
  const predecessor = loadPredecessor(input.predecessorArtifact);
  if (!predecessor.ok) {
    return predecessor;
  }
  const index = predecessor.index;
  const dispositions: VendorDisposition[] = [
    ...inventory.catalogFields.map((field) =>
      disposition(`catalog.json.${field.field}`, "structural-non-param", field.detail, [field.field]),
    ),
    ...inventoryFileDispositions(inventory.files),
  ];
  const identityMap: VendorIdentityMapEntry[] = [];
  const appliedDefaults: VendorAppliedDriverDefault[] = [];
  const allocate = input.identity?.allocateId ?? allocateOpaqueId;
  const claimed = input.claimedIdentities ?? [];
  const preparedSubjects: PreparedSubject[] = [];
  const createOnExisting: CreateDefinitionChange[] = [];
  const revises: ReviseDefinitionChange[] = [];
  const definitionAllocations: FrozenDefinitionAllocation[] = [];
  const subjectAllocations: FrozenSubjectAllocation[] = [];
  const usedDefinitionIds = new Set(index.definitionsById.keys());
  const usedSubjectIds = new Set(index.subjectsById.keys());

  for (const file of inventory.files) {
    if (!file.listed || !file.excluded || !file.onDisk) continue;
    const parsed = parseVendorYamlFile(path.join(input.schemasRoot, file.relativePath));
    if ("error" in parsed) continue;
    for (const propertyKey of Object.keys(parsed.properties ?? {})) {
      dispositions.push(
        disposition(`${file.relativePath}#${propertyKey}`, "excluded", "listed excluded fixture property", [
          "properties",
        ]),
      );
    }
  }

  const inputFiles = inventory.files.filter((file) => file.disposition === "input");
  for (const file of inputFiles) {
    if (file.basename === POWER_MANAGEMENT_BASENAME || isExcludedSchemaBasename(file.basename)) {
      continue;
    }
    const absolute = path.join(input.schemasRoot, file.relativePath);
    const parsed = parseVendorYamlFile(absolute);
    if ("error" in parsed) {
      dispositions.push(
        disposition(file.relativePath, "unsupported", `unreadable:${parsed.error}`, ["source"]),
      );
      continue;
    }
    dispositions.push(...fileFieldDispositions(file.relativePath, parsed));
    if (parsed.lifecycle && parsed.lifecycle !== "active") {
      continue;
    }
    const compatibles = parsed.compatible ?? [];
    const nodenames = parsed.nodename ?? [];
    if (compatibles.length > 0 && nodenames.length > 0) {
      dispositions.push(
        disposition(file.relativePath, "unsupported", "mixed-selectors", ["compatible", "nodename"]),
      );
      continue;
    }
    if (compatibles.length === 0 && nodenames.length === 0) {
      dispositions.push(
        disposition(file.relativePath, "unsupported", "missing-selector", ["compatible", "nodename"]),
      );
      continue;
    }
    const isDriver = compatibles.length > 0;
    const selectors = isDriver ? compatibles : nodenames;
    const canonical = selectors[0]!;
    const parsedSelector = isDriver
      ? parseCanonicalCompatibleSelector(canonical)
      : parseCanonicalNodeName(canonical);
    if (!parsedSelector.ok) {
      dispositions.push(
        disposition(
          file.relativePath,
          "unsupported",
          `invalid-selector:${parsedSelector.error}`,
          [isDriver ? "compatible" : "nodename"],
        ),
      );
      continue;
    }
    const canonicalKey = isDriver ? `driver:${parsedSelector.value}` : `node-type:${parsedSelector.value}`;
    const selectorKind = isDriver ? ("driver-compatible" as const) : ("node-type-name" as const);
    const extraSelectors: string[] = [];
    for (const extra of selectors.slice(1)) {
      if (extra === canonical) continue;
      const extraParsed = isDriver
        ? parseCanonicalCompatibleSelector(extra)
        : parseCanonicalNodeName(extra);
      if (!extraParsed.ok) {
        dispositions.push(
          disposition(
            `${file.relativePath}#alias:${extra}`,
            "unsupported",
            `invalid-alias:${extraParsed.error}`,
            [isDriver ? "compatible" : "nodename"],
          ),
        );
        continue;
      }
      extraSelectors.push(extraParsed.value);
    }

    const existingByKey = index.subjectsByCanonicalKey.get(canonicalKey) ?? null;
    const existingBySelector = index.subjectsBySelector.get(parsedSelector.value) ?? null;
    const aliasOwner = index.aliasesBySelector.get(parsedSelector.value) ?? null;
    if (aliasOwner) {
      const owner = index.subjectsById.get(aliasOwner.content.subjectId);
      if (!owner || owner.content.canonicalKey !== canonicalKey) {
        dispositions.push(
          disposition(
            file.relativePath,
            "conflict",
            "alias-owner-change",
            [isDriver ? "compatible" : "nodename"],
          ),
        );
        identityMap.push({
          canonicalKey,
          publishedId: aliasOwner.content.subjectId,
          action: "conflict",
        });
        continue;
      }
    }
    if (existingBySelector && existingBySelector.content.canonicalKey !== canonicalKey) {
      dispositions.push(
        disposition(file.relativePath, "conflict", "selector-owned-by-different-subject", [
          isDriver ? "compatible" : "nodename",
        ]),
      );
      identityMap.push({
        canonicalKey,
        publishedId: existingBySelector.content.id,
        action: "conflict",
      });
      continue;
    }

    const claimedSubject = claimedFor(claimed, canonicalKey);
    let existing = existingByKey;
    if (claimedSubject?.subjectId) {
      const published = existingByKey;
      if (published && published.content.id !== claimedSubject.subjectId) {
        dispositions.push(
          disposition(file.relativePath, "conflict", "natural-key-id-mismatch", ["canonicalKey"]),
        );
        identityMap.push({
          canonicalKey,
          publishedId: published.content.id,
          action: "conflict",
        });
        continue;
      }
      const sameId = index.subjectsById.get(claimedSubject.subjectId);
      if (sameId && sameId.content.canonicalKey !== canonicalKey) {
        dispositions.push(
          disposition(file.relativePath, "conflict", "same-id-different-content", ["subjectId"]),
        );
        identityMap.push({
          canonicalKey,
          publishedId: sameId.content.id,
          action: "conflict",
        });
        continue;
      }
    }

    let subjectId: string;
    let allocated = false;
    let nature: DriverNature | undefined;
    let cardinality: DriverCardinality | undefined;
    if (existing) {
      subjectId = existing.content.id;
      identityMap.push({ canonicalKey, publishedId: subjectId, action: "reuse" });
    } else {
      subjectId = claimedSubject?.subjectId ?? allocate("csub");
      if (usedSubjectIds.has(subjectId)) {
        dispositions.push(
          disposition(file.relativePath, "conflict", "same-id-different-content", ["subjectId"]),
        );
        identityMap.push({ canonicalKey, publishedId: subjectId, action: "conflict" });
        continue;
      }
      allocated = true;
      usedSubjectIds.add(subjectId);
      identityMap.push({ canonicalKey, publishedId: subjectId, action: "allocate" });
      subjectAllocations.push({ canonicalKey, subjectId });
      if (isDriver) {
        nature = DEFAULT_NEW_DRIVER_NATURE;
        cardinality = DEFAULT_NEW_DRIVER_CARDINALITY;
        appliedDefaults.push({
          canonicalKey,
          nature,
          cardinality,
          reason: "new-driver-compiler-default",
        });
        dispositions.push(
          disposition(
            file.relativePath,
            "mapped",
            "applied-driver-defaults:nature=physical-device,cardinality=multiple",
            ["nature", "cardinality"],
          ),
        );
      }
    }

    for (const extra of extraSelectors) {
      const existingAlias = index.aliasesBySelector.get(extra);
      const existingSubjectSelector = index.subjectsBySelector.get(extra);
      if (existingSubjectSelector && existingSubjectSelector.content.id !== subjectId) {
        dispositions.push(
          disposition(`${file.relativePath}#alias:${extra}`, "conflict", "alias-owner-change", [
            isDriver ? "compatible" : "nodename",
          ]),
        );
        continue;
      }
      if (existingAlias && existingAlias.content.subjectId !== subjectId) {
        dispositions.push(
          disposition(`${file.relativePath}#alias:${extra}`, "conflict", "alias-owner-change", [
            isDriver ? "compatible" : "nodename",
          ]),
        );
        continue;
      }
      if (existingAlias && existingAlias.content.subjectId === subjectId) {
        dispositions.push(
          disposition(`${file.relativePath}#alias:${extra}`, "unchanged", "published alias retained", [
            isDriver ? "compatible" : "nodename",
          ]),
        );
        continue;
      }
      dispositions.push(
        disposition(
          `${file.relativePath}#alias:${extra}`,
          "unsupported",
          "alias-add-not-in-product-path",
          [isDriver ? "compatible" : "nodename"],
        ),
      );
    }

    const nested: NestedDefinitionDraft[] = [];
    const properties = parsed.properties ?? {};
    for (const [propertyKey, property] of Object.entries(properties)) {
      const propertyPath = `${file.relativePath}#${propertyKey}`;
      const propertyRecord = property as Record<string, unknown>;
      const unknownPropertyFields = extraKeys(propertyRecord, PROPERTY_FIELD_KEYS);
      if (unknownPropertyFields.length > 0) {
        dispositions.push(
          disposition(
            `${propertyPath}.${unknownPropertyFields[0]}`,
            "unsupported",
            `unknown-property-field:${unknownPropertyFields[0]}`,
            unknownPropertyFields,
          ),
        );
        continue;
      }
      const parsedKey = parseCanonicalPropertyKey(propertyKey);
      if (!parsedKey.ok) {
        dispositions.push(
          disposition(
            propertyPath,
            parsedKey.error === "structural-property" ? "structural-non-param" : "unsupported",
            `property-key:${parsedKey.error}`,
            ["properties"],
          ),
        );
        continue;
      }
      if (property.exampleValue !== undefined) {
        dispositions.push(
          disposition(`${propertyPath}.exampleValue`, "structural-non-param", "DTS exampleValue is not M1 examples", [
            "exampleValue",
          ]),
        );
      }
      if (property.default !== undefined) {
        dispositions.push(
          disposition(`${propertyPath}.default`, "unsupported", "default-cannot-be-dropped", ["default"]),
        );
        continue;
      }
      if (property.constraints !== undefined && !isRecord(property.constraints)) {
        dispositions.push(
          disposition(`${propertyPath}.constraints`, "unsupported", "constraints-not-object", ["constraints"]),
        );
        continue;
      }
      if (isRecord(property.constraints) && Object.keys(property.constraints).length === 0) {
        dispositions.push(
          disposition(`${propertyPath}.constraints`, "structural-non-param", "empty constraints object", [
            "constraints",
          ]),
        );
      }
      const shape = vendorPropertyShape(property);
      const mappedSchema = mapProductionValueSchema(shape);
      if (!mappedSchema.ok) {
        dispositions.push(
          disposition(`${propertyPath}.valueShape`, "unsupported", mappedSchema.detail, ["valueShape"]),
        );
        continue;
      }
      const withConstraints = foldConstraints(mappedSchema.value, property.constraints, propertyPath);
      if (!withConstraints.ok) {
        dispositions.push(
          disposition(withConstraints.path, "unsupported", withConstraints.detail, ["constraints"]),
        );
        continue;
      }
      const documentation =
        property.documentation ??
        `${parsed.title ?? canonical} property ${parsedKey.value}`;
      const contentInput = {
        displayName: parsedKey.value,
        documentation,
        ...(property.units !== undefined ? { unit: property.units } : {}),
        valueSchema: withConstraints.value,
      };
      const validated = validateSupportedDefinitionContent(contentInput, `${propertyPath}.content`);
      if (!validated.ok) {
        dispositions.push(
          disposition(
            propertyPath,
            "unsupported",
            validated.error.kind === "unsupported-catalog-capability"
              ? `${validated.error.detail}:${validated.error.path}`
              : validated.error.kind,
            ["valueShape", "units", "documentation"].filter((field) => field in propertyRecord),
          ),
        );
        continue;
      }
      const content = validated.value;
      const existingDefinition = existing
        ? index.definitionsByNaturalKey.get(naturalKey(existing.content.id, parsedKey.value))
        : undefined;
      const claimedDef = claimed.find(
        (entry) => entry.canonicalKey === canonicalKey && entry.propertyKey === parsedKey.value,
      );
      if (claimedDef?.definitionId && existingDefinition) {
        if (claimedDef.definitionId !== existingDefinition.content.id) {
          dispositions.push(
            disposition(propertyPath, "conflict", "natural-key-id-mismatch", ["propertyKey"]),
          );
          identityMap.push({
            canonicalKey,
            propertyKey: parsedKey.value,
            publishedId: existingDefinition.content.id,
            action: "conflict",
          });
          continue;
        }
      }
      if (claimedDef?.definitionId) {
        const other = index.definitionsById.get(claimedDef.definitionId);
        if (
          other &&
          (other.content.subjectId !== (existing?.content.id ?? subjectId) ||
            other.content.propertyKey !== parsedKey.value)
        ) {
          dispositions.push(
            disposition(propertyPath, "conflict", "same-id-different-content", ["definitionId"]),
          );
          identityMap.push({
            canonicalKey,
            propertyKey: parsedKey.value,
            publishedId: other.content.id,
            action: "conflict",
          });
          continue;
        }
      }
      if (existingDefinition) {
        const previous = predecessorContent(existingDefinition.content.revision);
        const previousFingerprint = previous
          ? contentFingerprint(previous)
          : canonicalDigest(revisionContentModel(existingDefinition.content.revision));
        const nextFingerprint = contentFingerprint(content);
        if (previous && previousFingerprint === nextFingerprint) {
          dispositions.push(
            disposition(propertyPath, "unchanged", "published definition retained", [
              "valueShape",
              "documentation",
              "units",
            ]),
          );
          identityMap.push({
            canonicalKey,
            propertyKey: parsedKey.value,
            publishedId: existingDefinition.content.id,
            action: "reuse",
          });
          continue;
        }
        const previousSemantic = previous
          ? serializeContract({
              "/unit": previous.unit ?? null,
              "/valueSchema": previous.valueSchema,
            } as unknown as ContractJsonValue)
          : "";
        const nextSemantic = serializeContract({
          "/unit": content.unit ?? null,
          "/valueSchema": content.valueSchema,
        } as unknown as ContractJsonValue);
        const reviseClass = previousSemantic === nextSemantic ? "documentation" : "semantic";
        const revisionId = allocate("drev");
        revises.push({
          op: "revise-definition",
          definitionId: existingDefinition.content.id,
          class: reviseClass,
          content,
        });
        definitionAllocations.push({
          subjectId: existingDefinition.content.subjectId,
          propertyKey: parsedKey.value,
          definitionId: existingDefinition.content.id,
          revisionId,
        });
        dispositions.push(
          disposition(propertyPath, "mapped", `revise-${reviseClass}`, ["documentation", "valueShape", "units"]),
        );
        identityMap.push({
          canonicalKey,
          propertyKey: parsedKey.value,
          publishedId: existingDefinition.content.id,
          action: "revise",
        });
        continue;
      }

      const definitionId = claimedDef?.definitionId ?? allocate("pdef");
      if (usedDefinitionIds.has(definitionId)) {
        dispositions.push(
          disposition(propertyPath, "conflict", "same-id-different-content", ["definitionId"]),
        );
        identityMap.push({
          canonicalKey,
          propertyKey: parsedKey.value,
          publishedId: definitionId,
          action: "conflict",
        });
        continue;
      }
      usedDefinitionIds.add(definitionId);
      const revisionId = allocate("drev");
      const draft: NestedDefinitionDraft = { propertyKey: parsedKey.value, content };
      definitionAllocations.push({
        subjectId,
        propertyKey: parsedKey.value,
        definitionId,
        revisionId,
      });
      identityMap.push({
        canonicalKey,
        propertyKey: parsedKey.value,
        publishedId: definitionId,
        action: "allocate",
      });
      dispositions.push(
        disposition(propertyPath, "mapped", allocated ? "new-subject-definition" : "create-definition", [
          "valueShape",
          "documentation",
          "units",
        ]),
      );
      if (allocated) {
        nested.push(draft);
      } else {
        createOnExisting.push({
          op: "create-definition",
          subjectId,
          propertyKey: parsedKey.value,
          content,
        });
      }
    }

    preparedSubjects.push({
      relativePath: file.relativePath,
      canonicalKey,
      kind: isDriver ? "driver" : "node-type",
      selectorKind,
      selectorValue: parsedSelector.value,
      extraSelectors,
      existing,
      subjectId,
      allocated,
      ...(nature ? { nature } : {}),
      ...(cardinality ? { cardinality } : {}),
      definitions: nested,
    });
  }

  const blocking = dispositions.filter(
    (row) => row.kind === "unsupported" || row.kind === "conflict" || row.kind === "listed-missing",
  );
  const report: VendorConversionReport = {
    inventory,
    dispositions,
    identityMap,
    blocking,
    appliedDefaults,
  };
  if (blocking.length > 0) {
    return {
      ok: false,
      error: {
        kind: "import-blocked",
        reason: blocking[0]!.detail,
        report,
      },
    };
  }

  const subjectChanges: CreateSubjectWithDefinitionsChange[] = preparedSubjects
    .filter((subject) => subject.allocated)
    .map((subject) => ({
      op: "create-subject-with-definitions" as const,
      kind: subject.kind,
      canonicalKey: subject.canonicalKey,
      selector: { kind: subject.selectorKind, value: subject.selectorValue },
      ...(subject.kind === "driver" && subject.nature && subject.cardinality
        ? { nature: subject.nature, cardinality: subject.cardinality }
        : {}),
      definitions: subject.definitions,
    }));
  const changeSet: CatalogChange[] = [...subjectChanges, ...createOnExisting, ...revises];
  if (changeSet.length === 0) {
    return ok({
      kind: "unchanged",
      changeSet: [],
      report,
      predecessor: {
        releaseId: index.target.manifest.release.id,
        digest: index.digest,
      },
    });
  }

  const toolchain = index.target.manifest.toolchain;
  const frozenIdentity: FrozenPublicationIdentity = {
    candidateId: CatalogCandidateId(input.identity?.candidateId ?? allocate("ccand")),
    artifactId: CatalogArtifactId(input.identity?.artifactId ?? allocate("cart")),
    releaseId: CatalogReleaseId(input.identity?.releaseId ?? allocate("crel")),
    releaseVersion: CatalogReleaseVersion(
      input.identity?.releaseVersion ?? bumpReleaseVersion(index.target.manifest.release.version),
    ),
    publishedAt: input.identity?.publishedAt ?? canonicalUtcSeconds(),
    toolchain: {
      compiler: toolchain.compiler,
      jsonSchemaDialect: toolchain.jsonSchemaDialect,
      sourceFormat: toolchain.sourceFormat,
    },
    definitions: definitionAllocations,
    subjects: subjectAllocations,
  };
  const facts = vendorImpactFacts(authorPrincipalId, changeSet);
  const classified = classifyImpact(facts);
  if (!classified.ok) {
    return {
      ok: false,
      error: {
        kind: "import-blocked",
        reason: classified.error.reason,
        report,
      },
    };
  }

  const persist: BuilderPersistRequest | undefined = input.persist
    ? {
        db: input.persist.db,
        ports: {
          persistArtifact: async (db, artifactInput) => {
            const persistFn = input.persist?.ports?.persistArtifact ?? storePersistArtifact;
            return persistFn(db, { ...artifactInput, sourceKind: "vendor-yaml" });
          },
          persistCandidate: async (db, candidateInput) => {
            const persistFn = input.persist?.ports?.persistCandidate;
            const identityAllocation = {
              ...candidateInput.identityAllocation,
              authorPrincipalId,
              ...(input.authorOrganizationId
                ? { authorOrganizationId: input.authorOrganizationId }
                : {}),
              impactFacts: facts as unknown as JsonObject,
              impactSummary: candidateInput.identityAllocation.impactSummary,
              vendorEvidence: {
                listedInputHash: inventory.listedInputHash,
                vendorContentHash: inventory.vendorContentHash,
                sourceKind: "vendor-yaml",
              } as unknown as JsonObject,
            };
            const persistCandidateFn = persistFn ?? storePersistCandidate;
            return persistCandidateFn(db, { ...candidateInput, identityAllocation });
          },
          getArtifactByDigest: input.persist.ports?.getArtifactByDigest,
        },
      }
    : undefined;

  const built = await buildCompleteSuccessor({
    predecessorArtifact: { digest: index.digest, bytes: index.bundleBytes },
    changeSet,
    frozenIdentity,
    productPath: "m2-core",
    persist,
  });
  if (!built.ok) {
    return { ok: false, error: built.error };
  }
  return ok({
    kind: "successor",
    changeSet,
    frozenIdentity,
    impactFacts: facts,
    report,
    built: built.value,
  });
}
