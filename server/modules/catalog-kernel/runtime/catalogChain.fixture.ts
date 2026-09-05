import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import pg from "pg";
import { stringify } from "yaml";

import {
  serializeContract,
  type CatalogReleasePin,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../compiler/index";
import {
  refreshReleaseAggregateDigest,
  validCatalogReleaseBundle,
} from "../compiler/__fixtures__/catalogReleaseBundle";
import type {
  CatalogReleaseBundle,
  CatalogReleaseNode,
  CompiledCatalogRelease,
} from "../compiler/types";
import { jsonCatalogReleaseSource } from "../interface";
import { createCatalogInstaller } from "../install/installer";

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

const mutable = <Value>(value: Value): DeepMutable<Value> => value as DeepMutable<Value>;

export const SUBJECT_ID = "csub_acme_power";
export const X_DEFINITION_ID = "pdef_acme_power_iin_max";
export const Y_DEFINITION_ID = "pdef_acme_power_iin_min";
export const X_REVISION_1 = "drev_acme_power_iin_max_1";
export const X_REVISION_2 = "drev_acme_power_iin_max_2";
export const Y_REVISION_1 = "drev_acme_power_iin_min_1";
export const A_RELEASE_ID = "crel_acme_1";
export const B_RELEASE_ID = "crel_acme_2";
export const C_RELEASE_ID = "crel_acme_3";
export const A_PUBLISHED_AT = "2026-09-01T00:00:00.000Z";
export const B_PUBLISHED_AT = "2026-09-02T00:00:00.000Z";
export const C_PUBLISHED_AT = "2026-09-03T00:00:00.000Z";
export const ZERO_FINGERPRINT = `sha256:${"0".repeat(64)}`;

const sha256 = (bytes: string | Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const refreshReleaseSource = (release: DeepMutable<CatalogReleaseNode>): void => {
  for (const document of release.documents) {
    if (document.kind === "definition") {
      const revision = document.content.revision;
      const model: Record<string, ContractJsonValue> = {
        "/lifecycle": revision.lifecycle,
        "/displayName": revision.displayName,
        "/documentation": revision.documentation,
        "/valueSchema": revision.valueSchema,
        "/matching": revision.matching,
      };
      if (revision.unit !== undefined) model["/unit"] = revision.unit;
      document.content.revision.contentDigest = sha256(serializeContract(model));
    }
    document.normalizedDigest = sha256(
      serializeContract(document.content as unknown as ContractJsonValue),
    );
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
  const path = release.manifest.files[0]?.path ?? "schemas/dts/vendor/acme-power.yaml";
  release.sources = [
    {
      path,
      mediaType: "application/yaml",
      encoding: "base64",
      bytes: bytes.toString("base64"),
    },
  ];
  release.manifest.files = [{ path, mediaType: "application/yaml", digest }];
  for (const document of release.documents) {
    document.source = { path, mediaType: "application/yaml", digest };
  }
  release.manifest.documents = release.documents.map((document) => ({
    sourcePath: document.source.path,
    kind: document.kind,
    documentId: document.content.id,
    normalizedDigest: document.normalizedDigest,
  }));
  refreshReleaseAggregateDigest(release);
};

export const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

export const extraDefinitionSuccessorBundle = (): CatalogReleaseBundle => {
  const bundle = mutable(validCatalogReleaseBundle());
  const target = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!target) throw new Error("successor target missing");
  const definition = target.documents.find((document) => document.kind === "definition");
  if (!definition || definition.kind !== "definition") {
    throw new Error("successor definition missing");
  }
  const extra = structuredClone(definition);
  extra.content.id = Y_DEFINITION_ID;
  extra.content.propertyKey = "iin_min";
  extra.content.revision = {
    ...extra.content.revision,
    id: Y_REVISION_1,
    displayName: "Input current minimum",
    documentation: "Minimum accepted input current.",
    matching: {
      ...extra.content.revision.matching,
      sourceProperty: "iin_min",
    },
  };
  target.documents.push(extra);
  refreshReleaseSource(target);
  return bundle;
};

export const documentationOnlySuccessorBundle = (): CatalogReleaseBundle => {
  const bundle = mutable(extraDefinitionSuccessorBundle());
  const predecessor = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!predecessor) throw new Error("B successor missing");
  const next = structuredClone(predecessor);
  next.manifest.release.id = C_RELEASE_ID;
  next.manifest.release.version = "1.2.0";
  next.manifest.release.sequence = 3;
  next.manifest.release.publishedAt = "2026-09-03T00:00:00Z";
  next.manifest.release.predecessor = {
    id: predecessor.manifest.release.id,
    digest: predecessor.manifest.release.digest,
  };
  const definition = next.documents.find(
    (document) => document.kind === "definition" && document.content.id === X_DEFINITION_ID,
  );
  if (!definition || definition.kind !== "definition") {
    throw new Error("X definition missing on C");
  }
  definition.content.revision = {
    ...definition.content.revision,
    id: X_REVISION_2,
    number: 2,
    documentation: "Documented maximum accepted input current.",
  };
  refreshReleaseSource(next);
  return {
    schemaVersion: bundle.schemaVersion,
    targetReleaseId: next.manifest.release.id,
    releases: [...bundle.releases, next],
  };
};

export const compileOrThrow = (bundle: CatalogReleaseBundle): CompiledCatalogRelease => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(`fixture failed to compile: ${compiled.error.kind}`);
  }
  return compiled.value;
};

export type InstalledCatalogChain = {
  readonly compiledA: CompiledCatalogRelease;
  readonly compiledB: CompiledCatalogRelease;
  readonly compiledC: CompiledCatalogRelease;
  readonly pinA: CatalogReleasePin;
  readonly pinB: CatalogReleasePin;
  readonly pinC: CatalogReleasePin;
};

const pinOf = (compiled: CompiledCatalogRelease): CatalogReleasePin => ({
  id: compiled.release.id,
  digest: compiled.release.digest,
});

const installOrThrow = async (
  installer: ReturnType<typeof createCatalogInstaller>,
  command: Parameters<ReturnType<typeof createCatalogInstaller>["installPublishedRelease"]>[0],
  label: string,
): Promise<void> => {
  const result = await installer.installPublishedRelease(command);
  if (!result.ok) {
    throw new Error(`${label} install failed: ${result.error.kind}`);
  }
};

export const installPublishedCatalogChain = async (
  pool: pg.Pool,
): Promise<InstalledCatalogChain> => {
  const installer = createCatalogInstaller(pool);
  const aBundle = firstReleaseBundle();
  const bBundle = extraDefinitionSuccessorBundle();
  const cBundle = documentationOnlySuccessorBundle();
  const compiledA = compileOrThrow(aBundle);
  const compiledB = compileOrThrow(bBundle);
  const compiledC = compileOrThrow(cBundle);

  await installOrThrow(
    installer,
    {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(aBundle),
      expectedTargetDigest: compiledA.aggregateDigest,
    },
    "A",
  );
  await installOrThrow(
    installer,
    {
      mode: "advance",
      source: jsonCatalogReleaseSource(bBundle),
      expectedCurrent: pinOf(compiledA),
      expectedTargetDigest: compiledB.aggregateDigest,
    },
    "B",
  );
  await installOrThrow(
    installer,
    {
      mode: "advance",
      source: jsonCatalogReleaseSource(cBundle),
      expectedCurrent: pinOf(compiledB),
      expectedTargetDigest: compiledC.aggregateDigest,
    },
    "C",
  );

  return {
    compiledA,
    compiledB,
    compiledC,
    pinA: pinOf(compiledA),
    pinB: pinOf(compiledB),
    pinC: pinOf(compiledC),
  };
};

export const installPublishedReleaseA = async (
  pool: pg.Pool,
): Promise<{ compiledA: CompiledCatalogRelease; pinA: CatalogReleasePin }> => {
  const installer = createCatalogInstaller(pool);
  const aBundle = firstReleaseBundle();
  const compiledA = compileOrThrow(aBundle);
  await installOrThrow(
    installer,
    {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(aBundle),
      expectedTargetDigest: compiledA.aggregateDigest,
    },
    "A",
  );
  return { compiledA, pinA: pinOf(compiledA) };
};
