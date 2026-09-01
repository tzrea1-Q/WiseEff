import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  catalogSubjectKinds,
  catalogSubjectSelectorKinds,
  definitionLifecycles,
  serializeContract,
  subjectLifecycles,
  type ContractJsonValue,
} from "../../../server/modules/parameter-catalog-contract/index";

type JsonObject = Record<string, unknown>;

interface ValidateFunction {
  (value: unknown): boolean;
  errors?: unknown;
}

interface AjvInstance {
  addSchema(schema: JsonObject): AjvInstance;
  compile(schema: JsonObject): ValidateFunction;
}

interface StableIdentityRule {
  documentKind: "subject" | "alias" | "definition";
  idPointer: string;
  naturalKeyPointers: string[];
  immutableValuePointers: string[];
}

interface StableIdRules {
  schemaVersion: string;
  idFormat: {
    type: "string";
    minLength: number;
    trimmed: boolean;
    controlFree: boolean;
  };
  closedEnums: {
    catalogSubjectKinds: string[];
    catalogSubjectSelectorKinds: string[];
    definitionLifecycles: string[];
    subjectLifecycles: string[];
  };
  manifestRules: {
    exactDocumentSet: boolean;
    matchPointers: string[];
    documentDigest: {
      algorithm: "sha256";
      canonicalization: "parameter-catalog-contract-serialize";
      contentPointer: string;
    };
  };
  lineageRules: {
    targetReleasePointer: string;
    releaseCollectionPointer: string;
    releaseIdPointer: string;
    releaseDigestPointer: string;
    releaseVersionPointer: string;
    releaseSequencePointer: string;
    predecessorIdPointer: string;
    predecessorDigestPointer: string;
    requireAcyclic: boolean;
    requireConnectedFromTarget: boolean;
    requireGapFreeSequence: boolean;
    requirePredecessorDigestMatch: boolean;
    requireUniqueReleaseVersion: boolean;
    requireUniqueReleaseDigest: boolean;
  };
  identityRules: StableIdentityRule[];
  membershipRules: {
    requirePredecessorSubjects: boolean;
    requirePredecessorAliases: boolean;
    activeAliasRequiresActiveSubject: boolean;
  };
}

interface BundleDocument {
  path: string;
  kind: "subject" | "alias" | "definition";
  digest: string;
  content: JsonObject;
}

interface ReleaseNode {
  manifest: {
    schemaVersion: string;
    release: {
      id: string;
      version: string;
      sequence: number;
      digest: string;
      predecessor: null | { id: string; digest: string };
    };
    toolchain: {
      compiler: string;
      jsonSchemaDialect: string;
      sourceFormat: string;
    };
    files: Array<{
      path: string;
      kind: BundleDocument["kind"];
      digest: string;
      mediaType: "application/json";
    }>;
  };
  documents: BundleDocument[];
}

interface CatalogReleaseBundle {
  schemaVersion: string;
  targetReleaseId: string;
  releases: ReleaseNode[];
}

const localRequire = createRequire(import.meta.url);
const Ajv2020 = localRequire("ajv/dist/2020").default as new (
  options: Record<string, unknown>,
) => AjvInstance;

const readJson = <Value>(relativePath: string): Value =>
  JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as Value;

const catalogReleaseSchema = readJson<JsonObject>("./catalog-release.schema.json");
const manifestSchema = readJson<JsonObject>("./manifest.schema.json");
const stableIdRules = readJson<StableIdRules>("./stable-id-rules.json");
const generatedSchemaBytes = readFileSync(
  resolve("docs/generated/parameter-catalog-bundle.schema.json"),
  "utf8",
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(manifestSchema);
const validateSchema = ajv.compile(catalogReleaseSchema);

const pointerValue = (value: unknown, pointer: string): unknown => {
  if (pointer === "") return value;
  return pointer
    .split("/")
    .slice(1)
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, token) => {
      if (current === null || typeof current !== "object") return undefined;
      return (current as JsonObject)[token];
    }, value);
};

const stableKey = (value: unknown): string =>
  serializeContract(value as ContractJsonValue).trimEnd();

const validateStableRules = (bundle: CatalogReleaseBundle): string[] => {
  const violations: string[] = [];
  const lineage = stableIdRules.lineageRules;
  const releases = pointerValue(bundle, lineage.releaseCollectionPointer) as ReleaseNode[];
  const targetReleaseId = pointerValue(bundle, lineage.targetReleasePointer);
  const releasesById = new Map<string, ReleaseNode>();
  const releaseVersions = new Map<string, string>();
  const releaseDigests = new Map<string, string>();

  for (const node of releases) {
    const releaseId = pointerValue(node, lineage.releaseIdPointer) as string;
    const releaseVersion = pointerValue(node, lineage.releaseVersionPointer) as string;
    const releaseDigest = pointerValue(node, lineage.releaseDigestPointer) as string;
    if (releasesById.has(releaseId)) violations.push("release-id-unique");
    if (
      lineage.requireUniqueReleaseVersion &&
      releaseVersions.has(releaseVersion) &&
      releaseVersions.get(releaseVersion) !== releaseId
    ) {
      violations.push("release-version-unique");
    }
    if (
      lineage.requireUniqueReleaseDigest &&
      releaseDigests.has(releaseDigest) &&
      releaseDigests.get(releaseDigest) !== releaseId
    ) {
      violations.push("release-digest-unique");
    }
    releasesById.set(releaseId, node);
    releaseVersions.set(releaseVersion, releaseId);
    releaseDigests.set(releaseDigest, releaseId);

    if (stableIdRules.manifestRules.exactDocumentSet) {
      const listed = new Map(
        node.manifest.files.map((file) => [file.path, file] as const),
      );
      const bundled = new Map(node.documents.map((document) => [document.path, document] as const));
      if (
        listed.size !== node.manifest.files.length ||
        bundled.size !== node.documents.length ||
        listed.size !== bundled.size
      ) {
        violations.push("manifest-content-exact");
      } else {
        for (const [path, file] of listed) {
          const document = bundled.get(path);
          if (
            document === undefined ||
            stableIdRules.manifestRules.matchPointers.some(
              (pointer) => pointerValue(file, pointer) !== pointerValue(document, pointer),
            )
          ) {
            violations.push("manifest-content-exact");
            break;
          }
        }
      }
    }

    const digestRule = stableIdRules.manifestRules.documentDigest;
    for (const document of node.documents) {
      const canonicalContent = serializeContract(
        pointerValue(document, digestRule.contentPointer) as ContractJsonValue,
      );
      const actualDigest = `sha256:${createHash("sha256")
        .update(canonicalContent)
        .digest("hex")}`;
      if (document.digest !== actualDigest) {
        violations.push("document-digest-mismatch");
      }
    }
  }

  if (typeof targetReleaseId !== "string" || !releasesById.has(targetReleaseId)) {
    violations.push("target-release-present");
  }

  if (lineage.requireAcyclic) {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (releaseId: string): void => {
      if (visiting.has(releaseId)) {
        violations.push("release-lineage-acyclic");
        return;
      }
      if (visited.has(releaseId)) return;
      const node = releasesById.get(releaseId);
      if (node === undefined) return;
      visiting.add(releaseId);
      const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
      if (typeof predecessorId === "string") visit(predecessorId);
      visiting.delete(releaseId);
      visited.add(releaseId);
    };
    for (const releaseId of releasesById.keys()) visit(releaseId);
  }

  const targetAncestors = new Set<string>();
  let cursor = typeof targetReleaseId === "string" ? targetReleaseId : undefined;
  while (cursor !== undefined && !targetAncestors.has(cursor)) {
    targetAncestors.add(cursor);
    const node = releasesById.get(cursor);
    if (node === undefined) {
      violations.push("release-lineage-connected");
      break;
    }
    const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
    if (predecessorId === undefined) break;
    if (typeof predecessorId !== "string") {
      violations.push("release-lineage-connected");
      break;
    }
    const predecessor = releasesById.get(predecessorId);
    if (predecessor === undefined) {
      violations.push("release-lineage-connected");
      break;
    }
    if (lineage.requireGapFreeSequence) {
      const sequence = pointerValue(node, lineage.releaseSequencePointer) as number;
      const predecessorSequence = pointerValue(
        predecessor,
        lineage.releaseSequencePointer,
      ) as number;
      if (predecessorSequence + 1 !== sequence) violations.push("release-sequence-gap");
    }
    if (
      lineage.requirePredecessorDigestMatch &&
      pointerValue(node, lineage.predecessorDigestPointer) !==
        pointerValue(predecessor, lineage.releaseDigestPointer)
    ) {
      violations.push("predecessor-digest-mismatch");
    }
    cursor = predecessorId;
  }
  if (
    lineage.requireConnectedFromTarget &&
    targetAncestors.size !== releasesById.size
  ) {
    violations.push("release-lineage-connected");
  }

  for (const identityRule of stableIdRules.identityRules) {
    const idToBinding = new Map<string, string>();
    const bindingToId = new Map<string, string>();
    for (const node of releases) {
      for (const document of node.documents.filter(
        (candidate) => candidate.kind === identityRule.documentKind,
      )) {
        const id = pointerValue(document, identityRule.idPointer);
        const naturalKey = stableKey(
          identityRule.naturalKeyPointers.map((pointer) => pointerValue(document, pointer)),
        );
        const immutableValue = stableKey(
          identityRule.immutableValuePointers.map((pointer) => pointerValue(document, pointer)),
        );
        if (typeof id !== "string") continue;
        const binding = `${naturalKey}\n${immutableValue}`;
        if (idToBinding.has(id) && idToBinding.get(id) !== binding) {
          violations.push(`${identityRule.documentKind}-id-reassigned`);
        }
        if (bindingToId.has(naturalKey) && bindingToId.get(naturalKey) !== id) {
          violations.push(`${identityRule.documentKind}-natural-key-reassigned`);
        }
        idToBinding.set(id, binding);
        bindingToId.set(naturalKey, id);
      }
    }
  }

  for (const node of releases) {
    const predecessorId = pointerValue(node, lineage.predecessorIdPointer);
    if (typeof predecessorId !== "string") continue;
    const predecessor = releasesById.get(predecessorId);
    if (predecessor === undefined) continue;
    for (const [kind, required] of [
      ["subject", stableIdRules.membershipRules.requirePredecessorSubjects],
      ["alias", stableIdRules.membershipRules.requirePredecessorAliases],
    ] as const) {
      if (!required) continue;
      const predecessorIds = new Set(
        predecessor.documents
          .filter((document) => document.kind === kind)
          .map((document) => document.content.id),
      );
      const currentIds = new Set(
        node.documents
          .filter((document) => document.kind === kind)
          .map((document) => document.content.id),
      );
      if ([...predecessorIds].some((id) => !currentIds.has(id))) {
        violations.push(`predecessor-${kind}-membership-complete`);
      }
    }

    if (stableIdRules.membershipRules.activeAliasRequiresActiveSubject) {
      const subjectLifecycle = new Map(
        node.documents
          .filter((document) => document.kind === "subject")
          .map((document) => [document.content.id, document.content.lifecycle]),
      );
      if (
        node.documents
          .filter((document) => document.kind === "alias")
          .some(
            (document) =>
              document.content.lifecycle === "active" &&
              subjectLifecycle.get(document.content.subjectId) !== "active",
          )
      ) {
        violations.push("active-alias-requires-active-subject");
      }
    }
  }

  return [...new Set(violations)].sort();
};

const validateBundle = (bundle: CatalogReleaseBundle): string[] => {
  if (!validateSchema(bundle)) return ["schema-invalid"];
  return validateStableRules(bundle);
};

const sha256 = (marker: string): string => `sha256:${marker.repeat(64)}`;

const releaseDocuments = (): BundleDocument[] => {
  const documents: BundleDocument[] = [
    {
      path: "subjects/sc8562.json",
      kind: "subject",
      digest: sha256("1"),
      content: {
        id: "csub_01KSC8562",
        kind: "driver",
        canonicalKey: "driver:sc8562",
        lifecycle: "active",
        selector: {
          kind: "driver-compatible",
          value: "southchip,sc8562",
          provenance: { source: "schemas/dts/vendor/wiseeff/sc8562.yaml" },
        },
        tombstone: null,
      },
    },
    {
      path: "aliases/sc8551.json",
      kind: "alias",
      digest: sha256("2"),
      content: {
        id: "cali_01KSC8551",
        subjectId: "csub_01KSC8562",
        selectorKind: "driver-compatible",
        normalizedSelector: "southchip,sc8551",
        lifecycle: "active",
        selectorProvenance: { source: "catalog-review" },
        tombstone: null,
      },
    },
    {
      path: "definitions/sc8562/input-voltage-limit.json",
      kind: "definition",
      digest: sha256("3"),
      content: {
        id: "pdef_01KVIN",
        subjectId: "csub_01KSC8562",
        propertyKey: "input_voltage_limit",
        revision: {
          id: "drev_01KVIN3",
          number: 1,
          contentDigest: sha256("4"),
          lifecycle: "active",
          displayName: "Input voltage limit",
          documentation: "Maximum accepted input voltage.",
          valueSchema: { type: "integer", minimum: 0 },
          matching: { sourceProperty: "input-voltage-limit" },
        },
      },
    },
  ];

  return documents.map((document) => ({
    ...document,
    digest: `sha256:${createHash("sha256")
      .update(serializeContract(document.content as ContractJsonValue))
      .digest("hex")}`,
  }));
};

const releaseNode = (
  id: string,
  version: string,
  sequence: number,
  digestMarker: string,
  predecessor: null | { id: string; digest: string },
): ReleaseNode => {
  const documents = releaseDocuments();
  return {
    manifest: {
      schemaVersion: "1.0.0",
      release: {
        id,
        version,
        sequence,
        digest: sha256(digestMarker),
        predecessor,
      },
      toolchain: {
        compiler: "wiseeff-catalog-compiler@1",
        jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
        sourceFormat: "wiseeff-catalog-release@1",
      },
      files: documents.map(({ path, kind, digest }) => ({
        path,
        kind,
        digest,
        mediaType: "application/json",
      })),
    },
    documents,
  };
};

const validBundle = (): CatalogReleaseBundle => {
  const first = releaseNode("crel_01", "1.0.0", 1, "a", null);
  const second = releaseNode("crel_02", "1.1.0", 2, "b", {
    id: first.manifest.release.id,
    digest: first.manifest.release.digest,
  });
  return {
    schemaVersion: "1.0.0",
    targetReleaseId: second.manifest.release.id,
    releases: [first, second],
  };
};

const bundledConsumerSchema = (): JsonObject => {
  const manifestDefinition = structuredClone(manifestSchema);
  delete manifestDefinition.$schema;

  const replaceManifestReference = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replaceManifestReference);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, entry]) => [
        key,
        key === "$ref" && entry === manifestSchema.$id
          ? "#/$defs/manifest"
          : replaceManifestReference(entry),
      ]),
    );
  };

  const bundled = replaceManifestReference(catalogReleaseSchema) as JsonObject;
  bundled.$defs = {
    ...(bundled.$defs as JsonObject),
    manifest: manifestDefinition,
    stableIdRules: {
      const: stableIdRules,
      description: "Normative pre-compile stable identity and lineage rules.",
    },
  };
  return bundled;
};

describe("immutable Catalog Release bundle contract", () => {
  it("accepts a closed, complete bundle through the public schema and stable-rule seam", () => {
    const bundle = validBundle();

    expect(validateBundle(bundle), JSON.stringify(validateSchema.errors)).toEqual([]);
    expect(stableIdRules.closedEnums).toEqual({
      catalogSubjectKinds: [...catalogSubjectKinds],
      catalogSubjectSelectorKinds: [...catalogSubjectSelectorKinds],
      definitionLifecycles: [...definitionLifecycles],
      subjectLifecycles: [...subjectLifecycles],
    });
  });

  it("rejects malformed lifecycle/tombstone pairs and invented fields before compile", () => {
    const malformed = validBundle();
    const subject = malformed.releases[1].documents[0].content;
    subject.lifecycle = "retired";
    subject.tombstone = null;
    subject.inventedCurrentFlag = true;

    expect(validateBundle(malformed)).toEqual(["schema-invalid"]);
  });

  it("rejects missing and unlisted bundle content before compile", () => {
    const missing = validBundle();
    missing.releases[1].documents.pop();
    expect(validateBundle(missing)).toContain("manifest-content-exact");

    const unlisted = validBundle();
    unlisted.releases[1].documents.push({
      ...structuredClone(unlisted.releases[1].documents[0]),
      path: "subjects/unlisted.json",
    });
    expect(validateBundle(unlisted)).toContain("manifest-content-exact");
  });

  it("rejects document content whose declared digest no longer matches canonical bytes", () => {
    const tampered = validBundle();
    tampered.releases[1].documents[0].content.canonicalKey = "driver:tampered";

    expect(validateBundle(tampered)).toContain("document-digest-mismatch");
  });

  it("rejects stable-ID and natural-key reassignment across release lineage", () => {
    const reassignedId = validBundle();
    reassignedId.releases[1].documents[0].content.canonicalKey = "driver:other";
    expect(validateBundle(reassignedId)).toContain("subject-id-reassigned");

    const reassignedNaturalKey = validBundle();
    reassignedNaturalKey.releases[1].documents[0].content.id = "csub_other";
    expect(validateBundle(reassignedNaturalKey)).toContain(
      "subject-natural-key-reassigned",
    );
  });

  it("rejects release version or digest reuse by a different release identity", () => {
    const reusedVersion = validBundle();
    reusedVersion.releases[1].manifest.release.version =
      reusedVersion.releases[0].manifest.release.version;
    expect(validateBundle(reusedVersion)).toContain("release-version-unique");

    const reusedDigest = validBundle();
    reusedDigest.releases[1].manifest.release.digest =
      reusedDigest.releases[0].manifest.release.digest;
    expect(validateBundle(reusedDigest)).toContain("release-digest-unique");
  });

  it("rejects cycles and gaps in the exact predecessor lineage", () => {
    const cyclic = validBundle();
    cyclic.releases[0].manifest.release.predecessor = {
      id: cyclic.releases[1].manifest.release.id,
      digest: cyclic.releases[1].manifest.release.digest,
    };
    expect(validateBundle(cyclic)).toContain("release-lineage-acyclic");

    const missingPredecessor = validBundle();
    missingPredecessor.releases[1].manifest.release.predecessor = {
      id: "crel_missing",
      digest: sha256("f"),
    };
    expect(validateBundle(missingPredecessor)).toContain("release-lineage-connected");
  });

  it("requires complete predecessor subject/alias membership and valid alias owners", () => {
    const omittedSubject = validBundle();
    const predecessorOnlySubject = structuredClone(
      omittedSubject.releases[0].documents[0],
    );
    predecessorOnlySubject.path = "subjects/predecessor-only.json";
    predecessorOnlySubject.digest = sha256("5");
    predecessorOnlySubject.content.id = "csub_predecessor_only";
    predecessorOnlySubject.content.canonicalKey = "driver:predecessor-only";
    predecessorOnlySubject.content.selector = {
      kind: "driver-compatible",
      value: "wiseeff,predecessor-only",
      provenance: { source: "catalog-review" },
    };
    omittedSubject.releases[0].documents.push(predecessorOnlySubject);
    omittedSubject.releases[0].manifest.files.push({
      path: predecessorOnlySubject.path,
      kind: predecessorOnlySubject.kind,
      digest: predecessorOnlySubject.digest,
      mediaType: "application/json",
    });
    expect(validateBundle(omittedSubject)).toContain(
      "predecessor-subject-membership-complete",
    );

    const retiredOwner = validBundle();
    retiredOwner.releases[1].documents[0].content.lifecycle = "retired";
    retiredOwner.releases[1].documents[0].content.tombstone = {
      reason: "superseded",
      withdrawnByReleaseId: "crel_02",
      previousSelector: "southchip,sc8562",
    };
    expect(validateBundle(retiredOwner)).toContain(
      "active-alias-requires-active-subject",
    );
  });

  it("generates one byte-stable standalone consumer schema and pins its digest", () => {
    const expectedBytes = serializeContract(
      bundledConsumerSchema() as ContractJsonValue,
    );

    expect(generatedSchemaBytes).toBe(expectedBytes);
    expect(createHash("sha256").update(expectedBytes).digest("hex")).toBe(
      "b2634591014d5d408683fd8cc5dca854b3927e15367e6c99602898f263afa356",
    );

    const standaloneSchema = JSON.parse(generatedSchemaBytes) as JsonObject;
    const standaloneAjv = new Ajv2020({ allErrors: true, strict: true });
    const validateStandalone = standaloneAjv.compile(standaloneSchema);
    expect(validateStandalone(validBundle()), JSON.stringify(validateStandalone.errors)).toBe(
      true,
    );
  });
});
