import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { applyMigrations } from "../../../shared/database/migrations";
import { makeTestAuthContext } from "../../../testing/authContext";
import { seedCoreGraph } from "../../../testing/fixtures";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../../testing/upgradeComponents";
import { createParameterModule } from "../../parameters/parameterModuleRepository";
import { registerOrClaimDriver } from "../../parameter-modules/service";
import { upsertMatchedDriverSchema, upsertMatchedPropertySpec } from "../../parameter-specs/repository";
import { captureComparisonP0Graph } from "../../catalog-cutover/comparisonRules";
import { classifyFrozenP0Graph, fingerprintP0Graph, type FrozenP0Graph } from "../../catalog-cutover/classifier";
import { planCutover } from "../../catalog-cutover/orchestrator";
import { acquireObservedManagementClient } from "../../catalog-cutover/retirement/managementCheckout";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { refreshReleaseAggregateDigest, validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle, CatalogReleaseDefinitionDocument } from "../../catalog-kernel/compiler/types";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract/index";
import { readComparisonSourceInventory } from "./planInventory";
import { COMPARISON_FAMILIES } from "./corpusContributionSchema";
import {
  captureConversionSourceInventory,
  captureConversionSourceSnapshot,
  inspectConversionManifest,
  type ConversionManifest,
  type ConversionSourceSnapshot,
} from "../../catalog-cutover/conversionManifest";

if (process.env.UPG_COMPONENT_PROFILE !== "selfhost-postgres16-alpine-v1") throw new Error("comparison-multihead-owned-profile-required");

type DeepMutable<Value> = Value extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: DeepMutable<Value[Key]> }
    : Value;

const mutable = <Value>(value: Value): DeepMutable<Value> => value as DeepMutable<Value>;

const syntheticTarget = {
  subjectId: "csub_acme_power",
  aliasId: "cali_acme_power_v1",
  definitions: {
    iin_max: { id: "pdef_acme_power_iin_max", revisionId: "drev_acme_power_iin_max_1" },
    enabled: { id: "pdef_acme_power_enabled", revisionId: "drev_acme_power_enabled_1" },
  },
} as const;

type SyntheticProperty = keyof typeof syntheticTarget.definitions;
type SyntheticTargetKind = "catalog-subject" | "parameter-definition" | "definition-revision";
type SourceTargetDeclaration = {
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly targetKind: SyntheticTargetKind;
  readonly targetId: string;
};

const syntheticDigest = (value: ContractJsonValue): string =>
  `sha256:${createHash("sha256").update(serializeContract(value)).digest("hex")}`;

const syntheticBytesDigest = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const syntheticRevisionModel = (
  document: Extract<CatalogReleaseDefinitionDocument, { kind: "definition" }>,
): ContractJsonValue => {
  const { revision } = document.content;
  const model: Record<string, ContractJsonValue> = {
    "/lifecycle": revision.lifecycle,
    "/displayName": revision.displayName,
    "/documentation": revision.documentation,
    "/valueSchema": revision.valueSchema,
    "/matching": revision.matching,
  };
  if (revision.successorDefinitionId !== undefined) model["/successorDefinitionId"] = revision.successorDefinitionId;
  if (revision.unit !== undefined) model["/unit"] = revision.unit;
  if (revision.examples !== undefined) model["/examples"] = revision.examples;
  return model;
};

const syntheticDefinition = (
  source: CatalogReleaseDefinitionDocument["source"],
  subjectId: string,
  propertyKey: SyntheticProperty,
  ids: { readonly id: string; readonly revisionId: string },
): CatalogReleaseDefinitionDocument => {
  const revisionContent = {
    lifecycle: "active" as const,
    displayName: propertyKey === "iin_max" ? "Input current limit" : "Enabled",
    documentation: propertyKey === "iin_max" ? "Maximum accepted input current." : "Whether the parameter is enabled.",
    ...(propertyKey === "iin_max" ? { unit: "mA" } : {}),
    valueSchema: propertyKey === "iin_max" ? { type: "integer", minimum: 0 } : { type: "boolean" },
    matching: { sourceProperty: propertyKey, selectorKind: "driver-compatible" as const },
  };
  const content = {
    id: ids.id,
    subjectId,
    propertyKey,
    revision: {
      id: ids.revisionId,
      number: 1,
      contentDigest: "",
      ...revisionContent,
    },
  } as unknown as CatalogReleaseDefinitionDocument["content"];
  content.revision.contentDigest = syntheticDigest(syntheticRevisionModel({
    source,
    kind: "definition",
    normalizedDigest: "",
    content,
  }));
  return {
    source,
    kind: "definition",
    normalizedDigest: syntheticDigest(content as unknown as ContractJsonValue),
    content,
  };
};

const refreshSyntheticRelease = (release: DeepMutable<CatalogReleaseBundle["releases"][number]>): void => {
  for (const document of release.documents) {
    if (document.kind === "definition") {
      document.content.revision.contentDigest = syntheticDigest(syntheticRevisionModel(document));
    }
    document.normalizedDigest = syntheticDigest(document.content as unknown as ContractJsonValue);
  }
  const sourcePath = release.documents[0]!.source.path;
  const mediaType = release.documents[0]!.source.mediaType;
  const bytes = Buffer.from(stringify({
    schemaVersion: "1.0.0",
    documents: release.documents.map((document) => ({ kind: document.kind, content: document.content })),
  }, { lineWidth: 0 }), "utf8");
  const digest = syntheticBytesDigest(bytes);
  const source = { path: sourcePath, mediaType, digest } as const;
  release.sources = [{ path: sourcePath, mediaType, encoding: "base64", bytes: bytes.toString("base64") }];
  release.manifest.files = [{ path: sourcePath, mediaType, digest }];
  for (const document of release.documents) document.source = source;
  release.manifest.documents = release.documents.map((document) => ({
    sourcePath: document.source.path,
    kind: document.kind,
    documentId: document.content.id,
    normalizedDigest: document.normalizedDigest,
  }));
  refreshReleaseAggregateDigest(release);
};

const deepFreeze = <Value>(value: Value): Value => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

const reviewedSyntheticBundle = (): CatalogReleaseBundle => {
  const bundle = mutable(structuredClone(validCatalogReleaseBundle()));
  const target = bundle.releases.find((release) => release.manifest.release.id === bundle.targetReleaseId);
  if (!target) throw new Error("comparison-multihead-reviewed-bundle-target-missing");
  const subject = target.documents.find((document) => document.kind === "subject");
  const definition = target.documents.find((document) => document.kind === "definition");
  if (!subject || subject.kind !== "subject" || !definition || definition.kind !== "definition") {
    throw new Error("comparison-multihead-reviewed-bundle-base-invalid");
  }
  target.documents.push(syntheticDefinition(definition.source, subject.content.id, "enabled", syntheticTarget.definitions.enabled));
  refreshSyntheticRelease(target);
  return deepFreeze(bundle);
};

const sourceIdentityId = (graph: FrozenP0Graph, sourceKind: string, sourceId: string): string => {
  const matches = graph.identities.filter((identity) => identity.sourceKind === sourceKind && identity.sourceId === sourceId);
  if (matches.length !== 1) throw new Error(`comparison-multihead-explicit-source-identity-${sourceKind}-${sourceId}`);
  return matches[0]!.id;
};

const reviewedSyntheticArtifacts = (input: {
  readonly graph: FrozenP0Graph;
  readonly sourceSnapshot: ConversionSourceSnapshot;
  readonly driverSchemaId: string;
  readonly driverRootParameterSpecId: string;
  readonly driverRootParameterVersionId: string;
  readonly properties: readonly { readonly propertyKey: SyntheticProperty; readonly parameterSpecId: string; readonly parameterSpecVersionId: string }[];
}): { readonly bundle: CatalogReleaseBundle; readonly manifest: ConversionManifest; readonly targetCatalogReleaseDigest: string; readonly declarations: readonly SourceTargetDeclaration[] } => {
  const schema = input.graph.driverSchemas.find((row) => row.id === input.driverSchemaId);
  const rootSpec = input.graph.specs.find((row) => row.id === input.driverRootParameterSpecId);
  const rootVersion = input.graph.specVersions.find((row) => row.id === input.driverRootParameterVersionId);
  if (!schema || !rootSpec || !rootVersion || schema.parameterSpecId !== rootSpec.id || rootVersion.parameterSpecId !== rootSpec.id) {
    throw new Error("comparison-multihead-explicit-driver-root-missing");
  }
  const declarations: SourceTargetDeclaration[] = [
    { sourceKind: "parameter-spec", sourceId: rootSpec.id, targetKind: "catalog-subject", targetId: syntheticTarget.subjectId },
    { sourceKind: "parameter-spec-version", sourceId: rootVersion.id, targetKind: "catalog-subject", targetId: syntheticTarget.subjectId },
    { sourceKind: "driver-schema", sourceId: schema.id, targetKind: "catalog-subject", targetId: syntheticTarget.subjectId },
  ];
  for (const property of input.properties) {
    const ids = syntheticTarget.definitions[property.propertyKey];
    declarations.push(
      { sourceKind: "parameter-spec", sourceId: property.parameterSpecId, targetKind: "parameter-definition", targetId: ids.id },
      { sourceKind: "parameter-spec-version", sourceId: property.parameterSpecVersionId, targetKind: "definition-revision", targetId: ids.revisionId },
    );
  }
  const bundle = reviewedSyntheticBundle();
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error(`comparison-multihead-reviewed-bundle-${compiled.error.kind}`);
  const target = bundle.releases.find((release) => release.manifest.release.id === bundle.targetReleaseId);
  if (!target) throw new Error("comparison-multihead-reviewed-bundle-target-missing");
  const mappings = declarations.map((declaration) => {
    const identityId = sourceIdentityId(input.graph, declaration.sourceKind, declaration.sourceId);
    const document = target.documents.find((candidate) => declaration.targetKind === "catalog-subject"
      ? candidate.kind === "subject" && candidate.content.id === declaration.targetId
      : candidate.kind === "definition" && (declaration.targetKind === "parameter-definition"
        ? candidate.content.id === declaration.targetId
        : candidate.content.revision.id === declaration.targetId));
    if (!document) throw new Error(`comparison-multihead-explicit-target-${declaration.targetId}`);
    return {
      legacyIdentityId: identityId,
      targetKind: declaration.targetKind,
      targetId: declaration.targetId,
      targetSourceDigest: document.source.digest,
    };
  });
  const classified = classifyFrozenP0Graph(input.graph);
  if (!classified.ok) throw new Error("comparison-multihead-reviewed-classification-missing");
  const expectedMapped = classified.value.assignments.filter((assignment) => assignment.disposition === "mapped");
  if (new Set(expectedMapped.map((assignment) => assignment.identityId)).size !== mappings.length ||
    expectedMapped.some((assignment) => !mappings.some((mapping) => mapping.legacyIdentityId === assignment.identityId))) {
    throw new Error("comparison-multihead-explicit-mapping-conservation");
  }
  const manifest = deepFreeze<ConversionManifest>({
    version: "pcat-conversion-manifest-v1",
    sourceSnapshotFingerprint: fingerprintP0Graph(input.graph),
    sourceInventoryFingerprint: input.sourceSnapshot.sourceInventoryFingerprint,
    targetCatalogReleaseDigest: compiled.value.release.digest,
    mappings: mappings.sort((left, right) => left.legacyIdentityId.localeCompare(right.legacyIdentityId)),
  });
  return {
    bundle,
    manifest,
    targetCatalogReleaseDigest: compiled.value.release.digest,
    declarations,
  };
};

/** Start with real legacy domain commands, then capture every installed source
 * kind. A failure before P0 is a source/plan failure, not comparison evidence.
 * The fixture never inserts a mapping, rule, checkpoint or passing report. */
describe("complete legacy source to multi-head comparison", () => {
  let owned: ParameterCatalogDatabase | undefined;
  let database: RootDatabase | undefined;
  let directory: string | undefined;
  const organizationId = `multihead-${randomUUID()}`, userId = `multihead-${randomUUID()}`;
  let driverSchemaId: string | undefined;
  let driverRootParameterSpecId: string | undefined;
  let driverRootParameterVersionId: string | undefined;
  const created: Array<{ propertyKey: SyntheticProperty; parameterSpecId: string; parameterSpecVersionId: string }> = [];
  beforeAll(async () => {
    owned = await createCheckedEmptyDatabase("comparisonmultihead");
    directory = await mkdtemp(path.join(await realpath(os.tmpdir()), "comparison-multihead-"));
    const migrations = path.join(directory, "source-migrations"); await mkdir(migrations);
    const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
    const files = execFileSync("git", ["--no-replace-objects", "ls-tree", "--name-only", `${sourceSha}:server/migrations`], { encoding: "utf8" })
      .trim().split("\n").filter(file => file.endsWith(".sql"));
    for (const file of files) await writeFile(path.join(migrations, file),
      execFileSync("git", ["--no-replace-objects", "show", `${sourceSha}:server/migrations/${file}`]));
    database = createPostgresDatabase(owned.url);
    await applyMigrations(database, migrations);
    await seedCoreGraph(database, { organization: { id: organizationId }, users: [{ id: userId }] });
    const auth = makeTestAuthContext({ organizationId, userId,
      permissions: ["parameter:view", "parameter:edit", "admin:access"] });
    const business = await createParameterModule(database, { organizationId, name: "Power" });
    await registerOrClaimDriver(database, auth, { displayName: "Power driver", businessCategoryId: business.id, compatibles: ["acme,power"] });
    const namespace = `org/${organizationId}/acme,power`, driverId = `${namespace}:v1`;
    // These are explicit synthetic source-document inputs to the existing
    // materialization owner, not post-hoc graph or mapping declarations.
    await database.transaction(async transaction => {
      const driver = await upsertMatchedDriverSchema(transaction, { id: driverId, compatible: "acme,power", compatiblePatterns: ["acme,power"],
        nodenamePatterns: [], source: "manual", scope: "organization", schemaNamespace: namespace, version: 1,
        lifecycle: "active", propertyIds: ["iin_max", "enabled"], commonRefs: [] });
      driverSchemaId = driver.driverSchemaId;
      driverRootParameterSpecId = `pspec:driver:${namespace}`;
      driverRootParameterVersionId = `psv:driver:${namespace}:v1`;
      for (const propertyKey of ["iin_max", "enabled"] as const) created.push({ propertyKey, ...await upsertMatchedPropertySpec(transaction, {
        id: `propspec:${namespace}:${propertyKey}`, parameterSpecId: `pspec:${namespace}:${propertyKey}`, driverSchemaId: driverId,
        propertyKey, schemaNamespace: namespace, source: "manual", scope: "organization", lifecycle: "active", version: 1,
        valueShape: propertyKey === "enabled" ? { kind: "bool" } : { kind: "u32-array" },
        constraints: {}, documentation: "Explicit synthetic comparison source.", exampleValue: propertyKey === "enabled" ? true : [43],
      }) });
    });
    await applyMigrations(database, path.resolve("server/migrations"));
  });
  afterAll(async () => {
    const results = await Promise.allSettled([database?.close()]);
    try { await owned?.close(); } catch { throw new Error("comparison-multihead-owned-cleanup-failed"); }
    if (results.some(result => result.status === "rejected")) throw new Error("comparison-multihead-root-cleanup-failed");
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it("plans the complete actual graph without discarding version, registration or placement identities", async () => {
    if (!database || created.length !== 2) throw new Error("comparison-multihead-source-unavailable");
    const client = await acquireObservedManagementClient(getRootPostgresPool(database)!, () => undefined);
    const captured = await (async () => {
      try {
        await client.query("begin isolation level repeatable read read only");
        const observed = new Proxy(client, { get(target, property) {
          if (property !== "query") return Reflect.get(target, property);
          return async (sql: string, values?: unknown[]) => {
            try { return await target.query(sql, values); }
            catch (error) {
              const code = error && typeof error === "object" ? Reflect.get(error, "code") : undefined;
              console.info(JSON.stringify({ stage: "source-query-refused",
                relation: /from (public\.[a-z_]+)\b/.exec(sql)?.[1] ?? "owner-query",
                sqlState: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unclassified" }));
              throw error;
            }
          };
        } });
        const graph = await captureComparisonP0Graph(observed, "wiseeff-v1");
        const snapshot = await captureConversionSourceSnapshot(observed);
        expect(snapshot.sourceInventoryFingerprint).toBe(await captureConversionSourceInventory(observed));
        for (const source of created) {
          const version = snapshot.records.find(record => record.sourceKind === "parameter-spec-version" && record.sourceId === source.parameterSpecVersionId);
          expect(version?.payload.parameter_spec_id).toBe(source.parameterSpecId);
          expect(version?.sqlNullColumns).not.toContain("example_value");
          expect(version?.payload.example_value).toEqual(source.parameterSpecId.endsWith(":enabled") ? true : [43]);
        }
        return { graph, snapshot };
      } finally {
        try { await client.query("rollback"); } finally { client.release(); }
      }
    })();
    const graph = captured.graph;
    const snapshot = captured.snapshot;
    if (!driverSchemaId || !driverRootParameterSpecId || !driverRootParameterVersionId) throw new Error("comparison-multihead-driver-schema-source-unavailable");
    for (const source of created) {
      expect(graph.identities.filter(identity => identity.sourceKind === "parameter-spec" && identity.sourceId === source.parameterSpecId)).toHaveLength(1);
      expect(graph.identities.filter(identity => identity.sourceKind === "parameter-spec-version" && identity.sourceId === source.parameterSpecVersionId)).toHaveLength(1);
    }
    expect(graph.identities.some(identity => identity.sourceKind === "parameter-subject")).toBe(true);
    expect(graph.driverRegistrations.length).toBeGreaterThan(0);
    expect(graph.placements.length).toBeGreaterThan(0);
    const classified = classifyFrozenP0Graph(graph);
    expect(classified.ok).toBe(true);
    const inventory = await readComparisonSourceInventory(database,
      graph.identities.map(({ id, ...identity }) => ({ legacyIdentityId: id, ...identity })));
    expect(Object.keys(inventory).sort()).toEqual([...COMPARISON_FAMILIES].sort());
    console.info(JSON.stringify({ stage: "full-source-inventory", families: COMPARISON_FAMILIES.map(family => ({ family,
      count: inventory[family].length })), comparisonRulesProduced: false }));
    const artifacts = reviewedSyntheticArtifacts({ graph, sourceSnapshot: snapshot, driverSchemaId,
      driverRootParameterSpecId, driverRootParameterVersionId, properties: created });
    expect(inspectConversionManifest({
      graph,
      bundle: artifacts.bundle,
      manifest: artifacts.manifest,
      targetCatalogReleaseDigest: artifacts.targetCatalogReleaseDigest,
    })).toBeNull();
    const planned = await planCutover({ graph, targetArtifactSha: "e".repeat(40),
      targetCatalogReleaseDigest: artifacts.targetCatalogReleaseDigest,
      catalogReleaseSource: jsonCatalogReleaseSource(artifacts.bundle), conversionManifest: artifacts.manifest });
    console.info(JSON.stringify({ stage: "full-source-plan", sourceIdentityCount: graph.identities.length,
      sourceKinds: [...new Set(graph.identities.map(identity => identity.sourceKind))].sort(),
      classifications: classified.ok ? [...new Set(classified.value.assignments.map(assignment => assignment.rClass))].sort() : [],
      planned: planned.ok, failure: planned.ok ? null : planned.error, comparisonExecuted: false }));
    expect(planned).toMatchObject({ ok: true });
  });
});
