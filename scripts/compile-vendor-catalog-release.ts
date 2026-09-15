/**
 * Compile schemas/dts/catalog.json (minus retired/ambiguous fixtures) into a
 * Catalog Release successor of the bootstrap fixture crel_acme_1.
 *
 * Frozen publication policy:
 * - Input is catalog.json schemaPaths only; power-management.json is not merged.
 * - Exclude common-status.yaml and test-ambiguous-*.yaml.
 * - Predecessor identities from crel_acme_1 stay in the successor snapshot.
 * - Opaque ids are deterministic slugs; collisions fail closed.
 *
 * D1-only: do not extend this slug rule to later official IDs. Production
 * vendor reuse is `server/modules/catalog-publication/import/`.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify } from "yaml";

import {
  serializeContract,
  parseCanonicalCompatibleSelector,
  parseCanonicalNodeName,
  parseCanonicalPropertyKey,
  type ContractJsonValue,
} from "../server/modules/parameter-catalog-contract/index";
import { compileCatalogRelease } from "../server/modules/catalog-kernel/compiler/index";
import {
  validCatalogReleaseBundle,
  refreshReleaseAggregateDigest,
} from "../server/modules/catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type {
  CatalogReleaseBundle,
  CatalogReleaseDocument,
  CatalogReleaseNode,
} from "../server/modules/catalog-kernel/compiler/types";
import {
  EXCLUDED_SCHEMA_BASENAMES,
  vendorDirectoryHash,
  vendorValueSchemaFor,
  type VendorYamlDocument,
} from "../server/modules/catalog-publication/import/vendorYaml";

export const VENDOR_SUCCESSOR_RELEASE_ID = "crel_vendor_catalog_1";
export const VENDOR_SUCCESSOR_VERSION = "1.1.0";
export const VENDOR_SUCCESSOR_PUBLISHED_AT = "2026-09-12T00:00:00Z";
export const VENDOR_SUCCESSOR_SOURCE_PATH = "schemas/dts/catalog-release/vendor-catalog-1.yaml";
export const FIRST_ACME_RELEASE_ID = "crel_acme_1";
export const FIRST_ACME_RELEASE_DIGEST =
  "sha256:365305492cf3fddb973b65268d1c7b8c60715240e9fd2dac05aa9091f0c38044";
export const VENDOR_SUCCESSOR_AGGREGATE_DIGEST =
  "sha256:efc5336e625f0eb6f994223a5f67a57b119e92bda2edb5c209fc901284f126c7";

export { EXCLUDED_SCHEMA_BASENAMES };

const EXCLUDED = new Set<string>(EXCLUDED_SCHEMA_BASENAMES);

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

const mutable = <Value>(value: Value): DeepMutable<Value> => value as DeepMutable<Value>;

const sha256 = (bytes: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const canonicalDigest = (value: ContractJsonValue): string => sha256(serializeContract(value));

const slug = (value: string): string => {
  if (value === "/") return "root";
  const normalized = value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!normalized) throw new Error(`catalog-vendor-empty-slug:${value}`);
  return normalized;
};

const revisionModel = (document: Extract<CatalogReleaseDocument, { kind: "definition" }>): ContractJsonValue => {
  const { revision } = document.content;
  const model: Record<string, ContractJsonValue> = {
    "/lifecycle": revision.lifecycle,
    "/displayName": revision.displayName,
    "/documentation": revision.documentation,
    "/valueSchema": revision.valueSchema,
    "/matching": revision.matching,
  };
  if (revision.unit !== undefined) model["/unit"] = revision.unit;
  return model;
};

const refreshSuccessorSource = (release: DeepMutable<CatalogReleaseNode>): void => {
  for (const document of release.documents) {
    if (document.kind === "definition") {
      document.content.revision.contentDigest = canonicalDigest(
        revisionModel(document as Extract<CatalogReleaseDocument, { kind: "definition" }>),
      );
    }
    document.normalizedDigest = canonicalDigest(document.content as unknown as ContractJsonValue);
  }
  const bytes = Buffer.from(
    stringify(
      {
        schemaVersion: "1.0.0",
        documents: release.documents.map((document) => ({
          kind: document.kind,
          content: document.content,
        })),
      },
      { lineWidth: 0 },
    ),
    "utf8",
  );
  const digest = sha256(bytes);
  release.sources = [
    {
      path: VENDOR_SUCCESSOR_SOURCE_PATH,
      mediaType: "application/yaml",
      encoding: "base64",
      bytes: bytes.toString("base64"),
    },
  ];
  release.manifest.files = [
    { path: VENDOR_SUCCESSOR_SOURCE_PATH, mediaType: "application/yaml", digest },
  ];
  for (const document of release.documents) {
    document.source = {
      path: VENDOR_SUCCESSOR_SOURCE_PATH,
      mediaType: "application/yaml",
      digest,
    };
  }
  release.manifest.documents = release.documents.map((document) => ({
    sourcePath: document.source.path,
    kind: document.kind,
    documentId: document.content.id,
    normalizedDigest: document.normalizedDigest,
  }));
  refreshReleaseAggregateDigest(release);
};

const firstAcmeRelease = (): CatalogReleaseNode => {
  const fixture = validCatalogReleaseBundle();
  return structuredClone(fixture.releases[0]!);
};

const claimId = (used: Set<string>, id: string, label: string): string => {
  if (used.has(id)) throw new Error(`catalog-vendor-id-collision:${label}:${id}`);
  used.add(id);
  return id;
};

const vendorDocuments = (schemasRoot: string): CatalogReleaseDocument[] => {
  const catalogPath = path.join(schemasRoot, "catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as {
    vendorContentHash: string;
    schemaPaths: string[];
  };
  const vendorDir = path.join(schemasRoot, "vendor/wiseeff");
  const observedHash = vendorDirectoryHash(vendorDir);
  if (observedHash !== catalog.vendorContentHash) {
    throw new Error(
      `catalog-vendor-hash-mismatch:catalog=${catalog.vendorContentHash}:disk=${observedHash}`,
    );
  }

  const usedIds = new Set<string>();
  const documents: CatalogReleaseDocument[] = [];
  const placeholderSource = {
    path: VENDOR_SUCCESSOR_SOURCE_PATH,
    mediaType: "application/yaml" as const,
    digest: `sha256:${"0".repeat(64)}`,
  };

  for (const relativePath of catalog.schemaPaths) {
    const basename = path.basename(relativePath);
    if (EXCLUDED.has(basename)) continue;
    const absolute = path.join(schemasRoot, relativePath);
    const loaded = parseYaml(readFileSync(absolute, "utf8"));
    if (!loaded || typeof loaded !== "object") {
      throw new Error(`catalog-vendor-schema-unreadable:${relativePath}`);
    }
    const document = loaded as VendorYamlDocument;
    if (document.lifecycle && document.lifecycle !== "active") continue;

    const compatibles = document.compatible ?? [];
    const nodenames = document.nodename ?? [];
    if (compatibles.length > 0 && nodenames.length > 0) {
      throw new Error(`catalog-vendor-mixed-selectors:${relativePath}`);
    }
    if (compatibles.length === 0 && nodenames.length === 0) {
      throw new Error(`catalog-vendor-missing-selector:${relativePath}`);
    }

    const isDriver = compatibles.length > 0;
    const selectors = isDriver ? compatibles : nodenames;
    const canonical = selectors[0]!;
    const parsed = isDriver
      ? parseCanonicalCompatibleSelector(canonical)
      : parseCanonicalNodeName(canonical);
    if (!parsed.ok) {
      throw new Error(`catalog-vendor-invalid-selector:${relativePath}:${parsed.error}`);
    }

    const kind = isDriver ? ("driver" as const) : ("node-type" as const);
    const selectorKind = isDriver
      ? ("driver-compatible" as const)
      : ("node-type-name" as const);
    const subjectSlug = `${isDriver ? "drv" : "nt"}_${slug(canonical)}`;
    const subjectId = claimId(usedIds, `csub_${subjectSlug}`, "subject");
    const subjectContent = {
      id: subjectId,
      kind,
      canonicalKey: isDriver ? `driver:${canonical}` : `node-type:${canonical}`,
      lifecycle: "active" as const,
      selector: {
        kind: selectorKind,
        value: canonical,
        provenance: { source: relativePath },
      },
      subtype: isDriver
        ? {
            nature: "physical-device" as const,
            cardinality: { kind: "multiple" as const },
          }
        : ({} as Record<never, never>),
      tombstone: null,
    };
    documents.push({
      source: placeholderSource,
      kind: "subject",
      normalizedDigest: canonicalDigest(subjectContent as unknown as ContractJsonValue),
      content: subjectContent,
    });

    for (const [index, extra] of selectors.slice(1).entries()) {
      const extraParsed = isDriver
        ? parseCanonicalCompatibleSelector(extra)
        : parseCanonicalNodeName(extra);
      if (!extraParsed.ok) {
        throw new Error(`catalog-vendor-invalid-alias:${relativePath}:${extraParsed.error}`);
      }
      if (extra === canonical) continue;
      const aliasContent = {
        id: claimId(usedIds, `cali_${subjectSlug}_${index + 1}`, "alias"),
        subjectId,
        selectorKind,
        normalizedSelector: extra,
        lifecycle: "active" as const,
        selectorProvenance: { source: relativePath },
        tombstone: null,
      };
      documents.push({
        source: placeholderSource,
        kind: "alias",
        normalizedDigest: canonicalDigest(aliasContent as unknown as ContractJsonValue),
        content: aliasContent,
      });
    }

    for (const [propertyKey, property] of Object.entries(document.properties ?? {})) {
      const key = parseCanonicalPropertyKey(propertyKey);
      if (!key.ok) continue;
      const shapeValue = property.valueShape;
      const shape =
        typeof shapeValue === "string" ? shapeValue : shapeValue?.kind ?? "unknown";
      const valueSchema = vendorValueSchemaFor(shape);
      const definitionId = claimId(
        usedIds,
        `pdef_${subjectSlug}_${slug(propertyKey)}`,
        "definition",
      );
      const revisionId = claimId(usedIds, `drev_${subjectSlug}_${slug(propertyKey)}_1`, "revision");
      const revisionContent = {
        lifecycle: "active" as const,
        displayName: propertyKey,
        documentation: property.documentation ?? `${document.title ?? canonical} property ${propertyKey}`,
        ...(property.units ? { unit: property.units } : {}),
        valueSchema,
        matching: {
          sourceProperty: propertyKey,
          selectorKind,
        },
      };
      const definitionContent = {
        id: definitionId,
        subjectId,
        propertyKey,
        revision: {
          id: revisionId,
          number: 1,
          contentDigest: canonicalDigest({
            "/lifecycle": revisionContent.lifecycle,
            "/displayName": revisionContent.displayName,
            "/documentation": revisionContent.documentation,
            "/valueSchema": revisionContent.valueSchema,
            "/matching": revisionContent.matching,
            ...(revisionContent.unit ? { "/unit": revisionContent.unit } : {}),
          }),
          ...revisionContent,
        },
      };
      documents.push({
        source: placeholderSource,
        kind: "definition",
        normalizedDigest: canonicalDigest(definitionContent as unknown as ContractJsonValue),
        content: definitionContent,
      });
    }
  }

  return documents;
};

export const compileVendorCatalogSuccessor = (repoRoot = process.cwd()) => {
  const predecessor = firstAcmeRelease();
  const firstBundle: CatalogReleaseBundle = {
    schemaVersion: "1.0.0",
    targetReleaseId: predecessor.manifest.release.id,
    releases: [predecessor],
  };
  const firstCompiled = compileCatalogRelease(firstBundle);
  if (!firstCompiled.ok) {
    throw new Error(`catalog-vendor-predecessor-uncompilable:${firstCompiled.error.kind}`);
  }
  if (
    firstCompiled.value.release.id !== FIRST_ACME_RELEASE_ID ||
    firstCompiled.value.release.digest !== FIRST_ACME_RELEASE_DIGEST
  ) {
    throw new Error(
      `catalog-vendor-predecessor-digest-drift:expected=${FIRST_ACME_RELEASE_ID}/${FIRST_ACME_RELEASE_DIGEST}:actual=${firstCompiled.value.release.id}/${firstCompiled.value.release.digest}`,
    );
  }

  const schemasRoot = path.join(repoRoot, "schemas/dts");
  const added = vendorDocuments(schemasRoot);
  const successor = mutable(structuredClone(predecessor));
  successor.manifest.release.id = VENDOR_SUCCESSOR_RELEASE_ID;
  successor.manifest.release.version = VENDOR_SUCCESSOR_VERSION;
  successor.manifest.release.sequence = 2;
  successor.manifest.release.publishedAt = VENDOR_SUCCESSOR_PUBLISHED_AT;
  successor.manifest.release.predecessor = {
    id: predecessor.manifest.release.id,
    digest: firstCompiled.value.release.digest,
  };
  successor.documents = [
    ...structuredClone(predecessor.documents),
    ...added,
  ] as DeepMutable<CatalogReleaseDocument>[];
  refreshSuccessorSource(successor);

  const bundle: CatalogReleaseBundle = {
    schemaVersion: "1.0.0",
    targetReleaseId: VENDOR_SUCCESSOR_RELEASE_ID,
    releases: [predecessor, successor],
  };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(
      `catalog-vendor-successor-invalid:${compiled.error.kind}:${JSON.stringify(compiled.error.violations)}`,
    );
  }
  if (compiled.value.aggregateDigest !== VENDOR_SUCCESSOR_AGGREGATE_DIGEST) {
    throw new Error(
      `catalog-vendor-digest-drift:expected=${VENDOR_SUCCESSOR_AGGREGATE_DIGEST}:actual=${compiled.value.aggregateDigest}`,
    );
  }
  return {
    bundle,
    compiled: compiled.value,
    predecessor: firstCompiled.value.release,
    excluded: [...EXCLUDED_SCHEMA_BASENAMES],
  };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outFlag = process.argv.indexOf("--out");
  const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : undefined;
  try {
    const result = compileVendorCatalogSuccessor();
    if (outPath) {
      writeFileSync(outPath, `${JSON.stringify(result.bundle)}\n`);
    }
    console.log(
      JSON.stringify({
        releaseId: result.compiled.release.id,
        version: result.compiled.release.version,
        digest: result.compiled.aggregateDigest,
        predecessor: result.predecessor,
        counts: result.compiled.counts,
        excluded: result.excluded,
        out: outPath ?? null,
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "catalog-vendor-compile-failed");
    process.exitCode = 1;
  }
}
