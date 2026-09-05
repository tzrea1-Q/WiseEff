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
export const POWER_ALIAS_ID = "cali_acme_power_v1";
export const POWER_DRIVER_COMPATIBLE = "acme,power";
export const POWER_DRIVER_ALIAS = "acme,power-v1";
export const SENSOR_SUBJECT_ID = "csub_acme_sensor";
export const SENSOR_DRIVER_COMPATIBLE = "acme,sensor";
export const CHARGER_SUBJECT_ID = "csub_acme_charger";
export const CHARGER_ALIAS_ID = "cali_acme_charger_v1";
export const CHARGER_NODE_TYPE = "charger";
export const CHARGER_NODE_TYPE_ALIAS = "charger-v1";
export const X_DEFINITION_ID = "pdef_acme_power_iin_max";
export const Y_DEFINITION_ID = "pdef_acme_power_iin_min";
export const X_REVISION_1 = "drev_acme_power_iin_max_1";
export const X_REVISION_2 = "drev_acme_power_iin_max_2";
export const Y_REVISION_1 = "drev_acme_power_iin_min_1";
export const A_RELEASE_ID = "crel_acme_1";
export const B_RELEASE_ID = "crel_acme_2";
export const C_RELEASE_ID = "crel_acme_3";
export const D_RELEASE_ID = "crel_acme_4";
export const E_RELEASE_ID = "crel_acme_5";
export const F_RELEASE_ID = "crel_acme_6";
export const A_PUBLISHED_AT = "2026-09-01T00:00:00.000Z";
export const B_PUBLISHED_AT = "2026-09-02T00:00:00.000Z";
export const C_PUBLISHED_AT = "2026-09-03T00:00:00.000Z";
export const D_PUBLISHED_AT = "2026-09-04T00:00:00.000Z";
export const E_PUBLISHED_AT = "2026-09-05T00:00:00.000Z";
export const F_PUBLISHED_AT = "2026-09-06T00:00:00.000Z";
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

const cloneSuccessorRelease = (
  predecessor: CatalogReleaseNode,
  id: string,
  version: string,
  sequence: number,
  publishedAt: string,
): DeepMutable<CatalogReleaseNode> => {
  const next = mutable(structuredClone(predecessor));
  next.manifest.release.id = id;
  next.manifest.release.version = version;
  next.manifest.release.sequence = sequence;
  next.manifest.release.publishedAt = publishedAt;
  next.manifest.release.predecessor = {
    id: predecessor.manifest.release.id,
    digest: predecessor.manifest.release.digest,
  };
  return next;
};

const appendSuccessor = (
  bundle: CatalogReleaseBundle,
  next: DeepMutable<CatalogReleaseNode>,
): CatalogReleaseBundle => {
  refreshReleaseSource(next);
  return {
    schemaVersion: bundle.schemaVersion,
    targetReleaseId: next.manifest.release.id,
    releases: [...bundle.releases, next],
  };
};

const placeholderSource = (
  release: DeepMutable<CatalogReleaseNode>,
): CatalogReleaseNode["documents"][number]["source"] =>
  release.documents[0]?.source ?? {
    path: "schemas/dts/vendor/acme-power.yaml",
    mediaType: "application/yaml",
    digest: ZERO_FINGERPRINT,
  };

export const nodeTypeAndSecondDriverSuccessorBundle = (): CatalogReleaseBundle => {
  const bundle = mutable(documentationOnlySuccessorBundle());
  const predecessor = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!predecessor) throw new Error("C successor missing");
  const next = cloneSuccessorRelease(
    predecessor,
    D_RELEASE_ID,
    "1.3.0",
    4,
    "2026-09-04T00:00:00Z",
  );
  const source = placeholderSource(next);
  next.documents.push(
    {
      source,
      kind: "subject",
      normalizedDigest: ZERO_FINGERPRINT,
      content: {
        id: SENSOR_SUBJECT_ID,
        kind: "driver",
        canonicalKey: "driver:acme,sensor",
        lifecycle: "active",
        selector: {
          kind: "driver-compatible",
          value: SENSOR_DRIVER_COMPATIBLE,
          provenance: { source: source.path },
        },
        subtype: {
          nature: "physical-device",
          cardinality: { kind: "multiple" },
        },
        tombstone: null,
      },
    },
    {
      source,
      kind: "subject",
      normalizedDigest: ZERO_FINGERPRINT,
      content: {
        id: CHARGER_SUBJECT_ID,
        kind: "node-type",
        canonicalKey: "node-type:charger",
        lifecycle: "active",
        selector: {
          kind: "node-type-name",
          value: CHARGER_NODE_TYPE,
          provenance: { source: source.path },
        },
        subtype: {},
        tombstone: null,
      },
    },
    {
      source,
      kind: "alias",
      normalizedDigest: ZERO_FINGERPRINT,
      content: {
        id: CHARGER_ALIAS_ID,
        subjectId: CHARGER_SUBJECT_ID,
        selectorKind: "node-type-name",
        normalizedSelector: CHARGER_NODE_TYPE_ALIAS,
        lifecycle: "active",
        selectorProvenance: { source: "catalog-review" },
        tombstone: null,
      },
    },
  );
  return appendSuccessor(bundle, next);
};

export const retiredPowerAliasSuccessorBundle = (): CatalogReleaseBundle => {
  const bundle = mutable(nodeTypeAndSecondDriverSuccessorBundle());
  const predecessor = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!predecessor) throw new Error("D successor missing");
  const next = cloneSuccessorRelease(
    predecessor,
    E_RELEASE_ID,
    "1.4.0",
    5,
    "2026-09-05T00:00:00Z",
  );
  const alias = next.documents.find(
    (document) => document.kind === "alias" && document.content.id === POWER_ALIAS_ID,
  );
  if (!alias || alias.kind !== "alias") {
    throw new Error("power alias missing on E");
  }
  alias.content.lifecycle = "retired";
  alias.content.tombstone = {
    reason: "withdrawn",
    withdrawnByReleaseId: E_RELEASE_ID,
    previousSelector: alias.content.normalizedSelector,
  };
  return appendSuccessor(bundle, next);
};

export const retiredPowerSubjectSuccessorBundle = (): CatalogReleaseBundle => {
  const bundle = mutable(retiredPowerAliasSuccessorBundle());
  const predecessor = bundle.releases.find(
    (release) => release.manifest.release.id === bundle.targetReleaseId,
  );
  if (!predecessor) throw new Error("E successor missing");
  const next = cloneSuccessorRelease(
    predecessor,
    F_RELEASE_ID,
    "1.5.0",
    6,
    "2026-09-06T00:00:00Z",
  );
  const subject = next.documents.find(
    (document) => document.kind === "subject" && document.content.id === SUBJECT_ID,
  );
  if (!subject || subject.kind !== "subject") {
    throw new Error("power subject missing on F");
  }
  subject.content.lifecycle = "retired";
  subject.content.tombstone = {
    reason: "withdrawn",
    withdrawnByReleaseId: F_RELEASE_ID,
    previousSelector: subject.content.selector.value,
  };
  return appendSuccessor(bundle, next);
};

export const compileOrThrow = (bundle: CatalogReleaseBundle): CompiledCatalogRelease => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    const details = compiled.error.violations.map((violation) => violation.detail).join(", ");
    throw new Error(
      `fixture failed to compile: ${compiled.error.kind}/${compiled.error.phase} ${details}`,
    );
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

export type InstalledCatalogMatchChain = InstalledCatalogChain & {
  readonly compiledD: CompiledCatalogRelease;
  readonly compiledE: CompiledCatalogRelease;
  readonly compiledF: CompiledCatalogRelease;
  readonly pinD: CatalogReleasePin;
  readonly pinE: CatalogReleasePin;
  readonly pinF: CatalogReleasePin;
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

export const installPublishedCatalogMatchChain = async (
  pool: pg.Pool,
): Promise<InstalledCatalogMatchChain> => {
  const base = await installPublishedCatalogChain(pool);
  const installer = createCatalogInstaller(pool);
  const dBundle = nodeTypeAndSecondDriverSuccessorBundle();
  const eBundle = retiredPowerAliasSuccessorBundle();
  const fBundle = retiredPowerSubjectSuccessorBundle();
  const compiledD = compileOrThrow(dBundle);
  const compiledE = compileOrThrow(eBundle);
  const compiledF = compileOrThrow(fBundle);

  await installOrThrow(
    installer,
    {
      mode: "advance",
      source: jsonCatalogReleaseSource(dBundle),
      expectedCurrent: base.pinC,
      expectedTargetDigest: compiledD.aggregateDigest,
    },
    "D",
  );
  await installOrThrow(
    installer,
    {
      mode: "advance",
      source: jsonCatalogReleaseSource(eBundle),
      expectedCurrent: pinOf(compiledD),
      expectedTargetDigest: compiledE.aggregateDigest,
    },
    "E",
  );
  await installOrThrow(
    installer,
    {
      mode: "advance",
      source: jsonCatalogReleaseSource(fBundle),
      expectedCurrent: pinOf(compiledE),
      expectedTargetDigest: compiledF.aggregateDigest,
    },
    "F",
  );

  return {
    ...base,
    compiledD,
    compiledE,
    compiledF,
    pinD: pinOf(compiledD),
    pinE: pinOf(compiledE),
    pinF: pinOf(compiledF),
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
