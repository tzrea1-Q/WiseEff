import pg from "pg";

import {
  CatalogReleaseDigest,
  type CatalogKernelError,
} from "../../parameter-catalog-contract/index";
import type {
  CatalogReleaseAliasDocument,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseDocument,
  CatalogReleaseSubjectDocument,
  CompiledCatalogRelease,
} from "../compiler/types";

export type CatalogMaterializeClient = Pick<pg.Client, "query">;

export type CatalogMaterializationStage =
  | "before-write"
  | "releases"
  | "subjects"
  | "aliases"
  | "definitions"
  | "revisions"
  | "heads"
  | "pointer"
  | "evidence";

export class CatalogMaterializationInjectedFailure extends Error {
  readonly stage: CatalogMaterializationStage;

  constructor(stage: CatalogMaterializationStage) {
    super(`injected catalog materialization failure after ${stage}`);
    this.name = "CatalogMaterializationInjectedFailure";
    this.stage = stage;
  }
}

export type MaterializeReleaseOptions = {
  readonly failAfter?: CatalogMaterializationStage;
};

export type MaterializeReleaseOutcome =
  | { readonly status: "staged" }
  | { readonly status: "already-present" };

const catalogDefinitionRelation = `parameter_catalog.${["parameter", "definitions"].join("_")}`;

class CatalogKernelFailure extends Error {
  readonly kernelError: CatalogKernelError;

  constructor(kernelError: CatalogKernelError) {
    super(kernelError.kind);
    this.name = "CatalogKernelFailure";
    this.kernelError = kernelError;
  }
}

const targetDocuments = (
  compiled: CompiledCatalogRelease,
): readonly CatalogReleaseDocument[] => {
  const target = compiled.model.releases.find(
    (release) => release.release.id === compiled.release.id,
  );
  if (!target) {
    throw new CatalogKernelFailure({
      kind: "invalid-release",
      phase: "install-preflight",
      violations: [
        {
          code: "schema-invalid",
          location: { kind: "present", value: "targetRelease" },
          subjectId: { kind: "absent" },
          detail: "compiled-target-release-missing",
        },
      ],
    });
  }
  return target.documents;
};

const maybeFail = (
  options: MaterializeReleaseOptions | undefined,
  stage: CatalogMaterializationStage,
): void => {
  if (options?.failAfter === stage) {
    throw new CatalogMaterializationInjectedFailure(stage);
  }
};

const canonicalSubjectKey = (subject: CatalogReleaseSubjectDocument): string =>
  subject.content.selector.value;

const selectorSnapshot = (subject: CatalogReleaseSubjectDocument): string =>
  JSON.stringify(
    subject.content.selector.kind === "driver-compatible"
      ? {
          kind: "driver-compatible",
          values: [subject.content.selector.value],
        }
      : {
          kind: "node-type-name",
          value: subject.content.selector.value,
        },
  );

const selectorProvenance = (source: string): string =>
  JSON.stringify({ source });

const tombstoneProvenance = (
  tombstone: CatalogReleaseSubjectDocument["content"]["tombstone"],
): string | null => {
  if (!tombstone) return null;
  return JSON.stringify({
    reason: tombstone.reason,
    successorSubjectId: tombstone.successorId,
  });
};

const loadExistingIds = async (
  client: CatalogMaterializeClient,
): Promise<{
  releases: Map<string, { digest: string; fingerprint: string | null }>;
  subjects: Set<string>;
  aliases: Set<string>;
  definitions: Set<string>;
  revisions: Set<string>;
}> => {
  const releases = await client.query<{
    id: string;
    release_digest: string;
    compiled_fingerprint: string | null;
  }>(
    `select
       release.id,
       release.release_digest,
       materialization.compiled_fingerprint
     from parameter_catalog.catalog_releases release
     left join parameter_catalog.catalog_materializations materialization
       on materialization.release_id = release.id`,
  );
  const subjects = await client.query<{ id: string }>(
    `select id from parameter_catalog.catalog_subjects`,
  );
  const aliases = await client.query<{ id: string }>(
    `select id from parameter_catalog.catalog_subject_aliases`,
  );
  const definitions = await client.query<{ id: string }>(
    `select id from ${catalogDefinitionRelation}`,
  );
  const revisions = await client.query<{ id: string }>(
    `select id from parameter_catalog.definition_revisions`,
  );
  return {
    releases: new Map(
      releases.rows.map((row) => [
        row.id,
        { digest: row.release_digest, fingerprint: row.compiled_fingerprint },
      ]),
    ),
    subjects: new Set(subjects.rows.map((row) => row.id)),
    aliases: new Set(aliases.rows.map((row) => row.id)),
    definitions: new Set(definitions.rows.map((row) => row.id)),
    revisions: new Set(revisions.rows.map((row) => row.id)),
  };
};

const stageRelease = async (
  client: CatalogMaterializeClient,
  compiled: CompiledCatalogRelease,
): Promise<void> => {
  const target = compiled.model.releases.find(
    (release) => release.release.id === compiled.release.id,
  );
  if (!target) {
    throw new CatalogKernelFailure({
      kind: "invalid-release",
      phase: "install-preflight",
      violations: [
        {
          code: "schema-invalid",
          location: { kind: "present", value: "targetRelease" },
          subjectId: { kind: "absent" },
          detail: "compiled-target-release-missing",
        },
      ],
    });
  }
  await client.query(
    `insert into parameter_catalog.catalog_releases (
       id, release_sequence, release_version, release_digest,
       predecessor_release_id, compiled_model_digest, toolchain_digest, published_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)`,
    [
      target.release.id,
      target.release.sequence,
      target.release.version,
      target.release.digest,
      target.release.predecessor?.id ?? null,
      compiled.compiledReleaseDigest,
      compiled.toolchainDigest,
      target.release.publishedAt,
    ],
  );
};

const stageSubjects = async (
  client: CatalogMaterializeClient,
  compiled: CompiledCatalogRelease,
  documents: readonly CatalogReleaseDocument[],
  existingSubjects: Set<string>,
): Promise<void> => {
  const subjects = documents.filter(
    (document): document is CatalogReleaseSubjectDocument =>
      document.kind === "subject",
  );
  for (const subject of subjects) {
    if (!existingSubjects.has(subject.content.id)) {
      await client.query(
        `insert into parameter_catalog.catalog_subjects (
           id, introduced_release_id, kind, canonical_key
         ) values ($1,$2,$3,$4)`,
        [
          subject.content.id,
          compiled.release.id,
          subject.content.kind,
          canonicalSubjectKey(subject),
        ],
      );
      if (subject.content.kind === "driver") {
        const subtype = subject.content.subtype as {
          nature: string;
          cardinality: { kind: string };
        };
        await client.query(
          `insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
           values ($1,$2,$3)`,
          [subject.content.id, subtype.nature, subtype.cardinality.kind],
        );
      } else {
        await client.query(
          `insert into parameter_catalog.catalog_node_types (subject_id) values ($1)`,
          [subject.content.id],
        );
      }
      existingSubjects.add(subject.content.id);
    }
    await client.query(
      `insert into parameter_catalog.catalog_release_subjects (
         release_id, subject_id, lifecycle, selector_snapshot, selector_provenance, tombstone_provenance
       ) values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
      [
        compiled.release.id,
        subject.content.id,
        subject.content.lifecycle,
        selectorSnapshot(subject),
        selectorProvenance(subject.content.selector.provenance.source),
        tombstoneProvenance(subject.content.tombstone),
      ],
    );
  }
};

const stageAliases = async (
  client: CatalogMaterializeClient,
  compiled: CompiledCatalogRelease,
  documents: readonly CatalogReleaseDocument[],
  existingAliases: Set<string>,
): Promise<void> => {
  const aliases = documents.filter(
    (document): document is CatalogReleaseAliasDocument => document.kind === "alias",
  );
  for (const alias of aliases) {
    if (!existingAliases.has(alias.content.id)) {
      await client.query(
        `insert into parameter_catalog.catalog_subject_aliases (
           id, introduced_release_id, subject_id, selector_kind, normalized_selector
         ) values ($1,$2,$3,$4,$5)`,
        [
          alias.content.id,
          compiled.release.id,
          alias.content.subjectId,
          alias.content.selectorKind,
          alias.content.normalizedSelector,
        ],
      );
      existingAliases.add(alias.content.id);
    }
    await client.query(
      `insert into parameter_catalog.catalog_release_subject_aliases (
         release_id, subject_id, alias_id, lifecycle, selector_provenance, tombstone_provenance
       ) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [
        compiled.release.id,
        alias.content.subjectId,
        alias.content.id,
        alias.content.lifecycle,
        selectorProvenance(alias.content.selectorProvenance.source),
        tombstoneProvenance(alias.content.tombstone),
      ],
    );
  }
};

const stageDefinitions = async (
  client: CatalogMaterializeClient,
  compiled: CompiledCatalogRelease,
  documents: readonly CatalogReleaseDocument[],
  existing: {
    definitions: Set<string>;
    revisions: Set<string>;
  },
): Promise<void> => {
  const definitions = documents.filter(
    (document): document is CatalogReleaseDefinitionDocument =>
      document.kind === "definition",
  );
  for (const definition of definitions) {
    if (!existing.definitions.has(definition.content.id)) {
      await client.query(
        `insert into ${catalogDefinitionRelation} (
           id, introduced_release_id, subject_id, property_key, current_revision_id
         ) values ($1,$2,$3,$4,$5)`,
        [
          definition.content.id,
          compiled.release.id,
          definition.content.subjectId,
          definition.content.propertyKey,
          definition.content.revision.id,
        ],
      );
      existing.definitions.add(definition.content.id);
    }
  }
};

const stageRevisions = async (
  client: CatalogMaterializeClient,
  compiled: CompiledCatalogRelease,
  documents: readonly CatalogReleaseDocument[],
  existingRevisions: Set<string>,
): Promise<void> => {
  const definitions = documents.filter(
    (document): document is CatalogReleaseDefinitionDocument =>
      document.kind === "definition",
  );
  for (const definition of definitions) {
    if (existingRevisions.has(definition.content.revision.id)) {
      continue;
    }
    await client.query(
      `insert into parameter_catalog.definition_revisions (
         id, definition_id, revision_number, catalog_release_id, content_digest, content
       ) values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        definition.content.revision.id,
        definition.content.id,
        definition.content.revision.number,
        compiled.release.id,
        definition.content.revision.contentDigest,
        JSON.stringify(definition.content.revision),
      ],
    );
    existingRevisions.add(definition.content.revision.id);
  }
};

const stageHeads = async (
  client: CatalogMaterializeClient,
  compiled: CompiledCatalogRelease,
  documents: readonly CatalogReleaseDocument[],
): Promise<void> => {
  const definitions = documents.filter(
    (document): document is CatalogReleaseDefinitionDocument =>
      document.kind === "definition",
  );
  for (const definition of definitions) {
    await client.query(
      `insert into parameter_catalog.catalog_release_definition_heads (
         release_id, definition_id, revision_id
       ) values ($1,$2,$3)`,
      [
        compiled.release.id,
        definition.content.id,
        definition.content.revision.id,
      ],
    );
  }
};

const stageEvidence = async (
  client: CatalogMaterializeClient,
  compiled: CompiledCatalogRelease,
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.catalog_materializations (
       release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
     ) values ($1,$2,$2,$3,$4)`,
    [
      compiled.release.id,
      compiled.materializationFingerprint,
      `install:${compiled.release.id}`,
      `catalog-install:${compiled.release.id}:${compiled.release.digest}`,
    ],
  );
};

export const materializeCompiledRelease = async (
  client: CatalogMaterializeClient,
  compiled: CompiledCatalogRelease,
  options?: MaterializeReleaseOptions,
): Promise<MaterializeReleaseOutcome> => {
  const existing = await loadExistingIds(client);
  const recorded = existing.releases.get(compiled.release.id);
  if (recorded) {
    if (recorded.digest !== compiled.release.digest) {
      throw new CatalogKernelFailure({
        kind: "digest-conflict",
        releaseId: compiled.release.id,
        expected: compiled.release.digest,
        actual: CatalogReleaseDigest(recorded.digest),
      });
    }
    if (
      recorded.fingerprint !== null &&
      recorded.fingerprint !== compiled.materializationFingerprint
    ) {
      throw new CatalogKernelFailure({
        kind: "drift",
        scope: "candidate-install",
        expected: { id: compiled.release.id, digest: compiled.release.digest },
        actual: {
          id: compiled.release.id,
          version: compiled.release.version,
          digest: CatalogReleaseDigest(recorded.digest),
        },
        violations: [
          {
            code: "materialization-fingerprint-mismatch",
            relation: "catalog_materializations",
            identity: compiled.release.id,
            detail: "installed-fingerprint-disagrees-with-compiler",
          },
        ],
      });
    }
    maybeFail(options, "before-write");
    return { status: "already-present" };
  }

  const documents = targetDocuments(compiled);
  maybeFail(options, "before-write");
  await stageRelease(client, compiled);
  maybeFail(options, "releases");
  await stageSubjects(client, compiled, documents, existing.subjects);
  maybeFail(options, "subjects");
  await stageAliases(client, compiled, documents, existing.aliases);
  maybeFail(options, "aliases");
  await stageDefinitions(client, compiled, documents, existing);
  maybeFail(options, "definitions");
  await stageRevisions(client, compiled, documents, existing.revisions);
  maybeFail(options, "revisions");
  await stageHeads(client, compiled, documents);
  maybeFail(options, "heads");
  await stageEvidence(client, compiled);
  maybeFail(options, "evidence");
  return { status: "staged" };
};

export const unwrapMaterializationKernelError = (
  error: unknown,
): CatalogKernelError | null => {
  if (error instanceof CatalogKernelFailure) {
    return error.kernelError;
  }
  return null;
};
