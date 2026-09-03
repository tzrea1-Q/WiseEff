import pg from "pg";

import {
  CatalogEventTime,
  catalogVerificationCheckCodes,
  type CatalogDriftViolation,
  type CatalogKernelError,
  type CatalogReleaseIdentity,
  type CatalogReleasePin,
  type Result,
  type VerificationResult,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../compiler/index";
import type {
  CatalogReleaseAliasDocument,
  CatalogReleaseBundle,
  CatalogReleaseDefinitionDocument,
  CatalogReleaseDocument,
  CatalogReleaseSubjectDocument,
  CompiledCatalogRelease,
} from "../compiler/types";
import type {
  CatalogReleaseSource,
  VerifyCurrentMaterializationCommand,
} from "../interface";
import { loadCurrentCatalogSnapshot } from "../runtime/currentSnapshot";
import { loadPinnedCatalogSnapshot } from "../runtime/pinnedSnapshot";
import {
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
} from "../security/catalogRoleManifest";

export type ThreatMatrixRow = {
  readonly id: number;
  readonly name: string;
  readonly initialState: string;
  readonly action: string;
  readonly expected: string;
  readonly leftover: string;
};

const freezeRow = (row: ThreatMatrixRow): ThreatMatrixRow => Object.freeze(row);

export const THREAT_MATRIX: readonly ThreatMatrixRow[] = Object.freeze([
  freezeRow({
    id: 1,
    name: "success-matching-pin",
    initialState: "installed current projection matches packaged pin and fingerprint",
    action: "verifyCurrentMaterialization with matching source and expected pin",
    expected: "status=verified with every CatalogVerificationCheck passed",
    leftover: "zero catalog writes; fingerprint and counts unchanged",
  }),
  freezeRow({
    id: 2,
    name: "stale-pointer",
    initialState: "catalog_state current pin differs from expected pin",
    action: "verifyCurrentMaterialization against the packaged expected pin",
    expected: "release-mismatch or drift current-pointer-mismatch",
    leftover: "pointer, heads, and materialization rows unchanged",
  }),
  freezeRow({
    id: 3,
    name: "poisoned-fingerprint",
    initialState: "catalog_materializations compiled_fingerprint bytes were tampered",
    action: "verifyCurrentMaterialization then cache rebuild from the database",
    expected: "drift materialization-fingerprint-mismatch; rebuild uses verified DB bytes",
    leftover: "verifier performed no repair write",
  }),
  freezeRow({
    id: 4,
    name: "partial-projection",
    initialState: "membership, alias, revision, head, or identity row disagrees with compiled artifact",
    action: "verifyCurrentMaterialization independent comparison",
    expected: "drift with exact CatalogDriftViolation codes",
    leftover: "no INSERT/UPDATE from the verifier",
  }),
  freezeRow({
    id: 5,
    name: "writer-credential",
    initialState: "caller pool is catalog_synchronizer_role or another writer",
    action: "verifyCurrentMaterialization",
    expected: "permission-denied, or a read-only transaction proof with zero writes",
    leftover: "catalog rows unchanged",
  }),
  freezeRow({
    id: 6,
    name: "cache-rebuild-from-db",
    initialState: "verified current projection exists; cache missing or poisoned",
    action: "rebuildCatalogCache",
    expected: "deterministic payload from verified DB only; no YAML or network",
    leftover: "database unchanged; cache namespaces remain isolated",
  }),
  freezeRow({
    id: 7,
    name: "current-pinned-isolation",
    initialState: "successor is current; predecessor projection is retained",
    action: "verify current pin and rebuild current versus pinned cache keys",
    expected: "current verify accepts only the current pin; cache namespaces never cross",
    leftover: "pinned predecessor bytes cannot satisfy a current lookup",
  }),
]);

const WRITER_ROLES = new Set<string>([
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
]);

const catalogDefinitionRelation = `parameter_catalog.${["parameter", "definitions"].join("_")}`;

const STRUCTURAL_RELATIONS = Object.freeze([
  "catalog_releases",
  "catalog_subjects",
  "catalog_drivers",
  "catalog_node_types",
  "catalog_release_subjects",
  "catalog_subject_aliases",
  "catalog_release_subject_aliases",
  ["parameter", "definitions"].join("_"),
  "definition_revisions",
  "catalog_release_definition_heads",
  "catalog_materializations",
  "catalog_state",
]);

const absent = { kind: "absent" as const };

const ok = <T>(value: T): Result<T, CatalogKernelError> => ({
  ok: true,
  value,
});

const fail = <T>(error: CatalogKernelError): Result<T, CatalogKernelError> => ({
  ok: false,
  error,
});

class CatalogKernelFailure extends Error {
  readonly kernelError: CatalogKernelError;

  constructor(kernelError: CatalogKernelError) {
    super(kernelError.kind);
    this.name = "CatalogKernelFailure";
    this.kernelError = kernelError;
  }
}

const parseBundle = async (
  source: CatalogReleaseSource,
): Promise<CatalogReleaseBundle> => {
  const manifest = new TextDecoder().decode(await source.readManifest());
  return JSON.parse(manifest) as CatalogReleaseBundle;
};

const compilePublishedRelease = async (
  source: CatalogReleaseSource,
): Promise<Result<CompiledCatalogRelease, CatalogKernelError>> => {
  try {
    const bundle = await parseBundle(source);
    return compileCatalogRelease(bundle);
  } catch (error) {
    return fail({
      kind: "invalid-release",
      phase: "source",
      violations: [
        {
          code: "manifest-unreadable",
          location: { kind: "present", value: "manifest" },
          subjectId: absent,
          detail:
            error instanceof Error ? error.message : "catalog-release-source-unreadable",
        },
      ],
    });
  }
};

const identityFromCompiled = (
  compiled: CompiledCatalogRelease,
): CatalogReleaseIdentity => ({
  id: compiled.release.id,
  version: compiled.release.version,
  digest: compiled.release.digest,
});

const mapReadError = (error: unknown): CatalogKernelError => {
  if (error instanceof CatalogKernelFailure) {
    return error.kernelError;
  }
  if (
    error instanceof pg.DatabaseError &&
    (error.code === "25006" || error.code === "42501")
  ) {
    return {
      kind: "permission-denied",
      operation: "verifyCurrentMaterialization",
    };
  }
  return {
    kind: "storage-failure",
    operation: "verifyCurrentMaterialization",
    retryable: true,
  };
};

const targetDocuments = (
  compiled: CompiledCatalogRelease,
): readonly CatalogReleaseDocument[] => {
  const target = compiled.model.releases.find(
    (release) => release.release.id === compiled.release.id,
  );
  if (!target) {
    throw new CatalogKernelFailure({
      kind: "invalid-release",
      phase: "compile",
      violations: [
        {
          code: "schema-invalid",
          location: { kind: "present", value: "targetRelease" },
          subjectId: absent,
          detail: "compiled-target-release-missing",
        },
      ],
    });
  }
  return target.documents;
};

const canonicalSubjectKey = (subject: CatalogReleaseSubjectDocument): string =>
  subject.content.selector.value;

const expectedSelectorSnapshot = (
  subject: CatalogReleaseSubjectDocument,
): unknown =>
  subject.content.selector.kind === "driver-compatible"
    ? {
        kind: "driver-compatible",
        values: [subject.content.selector.value],
      }
    : {
        kind: "node-type-name",
        value: subject.content.selector.value,
      };

const jsonEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const violation = (
  code: CatalogDriftViolation["code"],
  relation: string,
  identity: string,
  detail: string,
): CatalogDriftViolation => ({
  code,
  relation,
  identity,
  detail,
});

const loadLineageIds = async (
  client: pg.PoolClient,
  releaseId: string,
): Promise<Set<string>> => {
  const ids = new Set<string>();
  let current: string | null = releaseId;
  while (current && !ids.has(current)) {
    ids.add(current);
    const row = await client.query<{ predecessor_release_id: string | null }>(
      `select predecessor_release_id
         from parameter_catalog.catalog_releases
        where id = $1`,
      [current],
    );
    current = row.rows[0]?.predecessor_release_id ?? null;
  }
  return ids;
};

type SubjectRow = {
  id: string;
  kind: string;
  canonical_key: string;
  lifecycle: string;
  selector_snapshot: unknown;
  tombstone_provenance: unknown;
};

type AliasRow = {
  id: string;
  root_subject_id: string;
  membership_subject_id: string;
  selector_kind: string;
  normalized_selector: string;
  lifecycle: string;
  tombstone_provenance: unknown;
};

type DefinitionRow = {
  id: string;
  subject_id: string;
  property_key: string;
};

type RevisionRow = {
  id: string;
  definition_id: string;
  revision_number: string;
  catalog_release_id: string;
  content_digest: string;
};

type HeadRow = {
  definition_id: string;
  revision_id: string;
  catalog_release_id: string;
};

const compareProjection = async (
  client: pg.PoolClient,
  compiled: CompiledCatalogRelease,
  expected: CatalogReleasePin,
): Promise<CatalogDriftViolation[]> => {
  const documents = targetDocuments(compiled);
  const subjects = documents.filter(
    (document): document is CatalogReleaseSubjectDocument =>
      document.kind === "subject",
  );
  const aliases = documents.filter(
    (document): document is CatalogReleaseAliasDocument => document.kind === "alias",
  );
  const definitions = documents.filter(
    (document): document is CatalogReleaseDefinitionDocument =>
      document.kind === "definition",
  );
  const violations: CatalogDriftViolation[] = [];
  const releaseId = compiled.release.id;

  const release = await client.query<{
    id: string;
    release_version: string;
    release_digest: string;
    predecessor_release_id: string | null;
  }>(
    `select id, release_version, release_digest, predecessor_release_id
       from parameter_catalog.catalog_releases
      where id = $1`,
    [releaseId],
  );
  const releaseRow = release.rows[0];
  if (!releaseRow) {
    violations.push(
      violation(
        "release-identity-mismatch",
        "catalog_releases",
        releaseId,
        "compiled-release-row-missing",
      ),
    );
  } else if (
    releaseRow.id !== compiled.release.id ||
    releaseRow.release_version !== compiled.release.version ||
    releaseRow.release_digest !== compiled.release.digest
  ) {
    violations.push(
      violation(
        "release-identity-mismatch",
        "catalog_releases",
        releaseId,
        "compiled-release-identity-disagrees-with-database",
      ),
    );
  }
  const expectedPredecessor = compiled.predecessor?.id ?? null;
  if ((releaseRow?.predecessor_release_id ?? null) !== expectedPredecessor) {
    violations.push(
      violation(
        "release-identity-mismatch",
        "catalog_releases",
        releaseId,
        "compiled-predecessor-disagrees-with-database",
      ),
    );
  }

  const pointer = await client.query<{ current_catalog_release_id: string | null }>(
    `select current_catalog_release_id from parameter_catalog.catalog_state`,
  );
  const currentId = pointer.rows[0]?.current_catalog_release_id ?? null;
  if (currentId !== expected.id) {
    violations.push(
      violation(
        "current-pointer-mismatch",
        "catalog_state",
        currentId ?? "null",
        "current-pointer-disagrees-with-expected-pin",
      ),
    );
  }

  const materialization = await client.query<{ compiled_fingerprint: string }>(
    `select compiled_fingerprint
       from parameter_catalog.catalog_materializations
      where release_id = $1`,
    [releaseId],
  );
  const fingerprint = materialization.rows[0]?.compiled_fingerprint;
  if (fingerprint !== compiled.materializationFingerprint) {
    violations.push(
      violation(
        "materialization-fingerprint-mismatch",
        "catalog_materializations",
        releaseId,
        "compiled-fingerprint-disagrees-with-database",
      ),
    );
  }

  const subjectRows = await client.query<SubjectRow>(
    `select
       subject.id,
       subject.kind,
       subject.canonical_key,
       membership.lifecycle,
       membership.selector_snapshot,
       membership.tombstone_provenance
     from parameter_catalog.catalog_release_subjects membership
     join parameter_catalog.catalog_subjects subject on subject.id = membership.subject_id
     where membership.release_id = $1`,
    [releaseId],
  );
  const subjectsById = new Map(subjectRows.rows.map((row) => [row.id, row]));
  for (const subject of subjects) {
    const row = subjectsById.get(subject.content.id);
    if (!row) {
      violations.push(
        violation(
          "subject-membership-mismatch",
          "catalog_release_subjects",
          subject.content.id,
          "compiled-subject-membership-missing",
        ),
      );
      continue;
    }
    if (row.kind !== subject.content.kind || row.canonical_key !== canonicalSubjectKey(subject)) {
      violations.push(
        violation(
          "subject-root-mismatch",
          "catalog_subjects",
          subject.content.id,
          "compiled-subject-root-disagrees-with-database",
        ),
      );
    }
    const expectedTombstone = subject.content.tombstone
      ? {
          reason: subject.content.tombstone.reason,
          successorSubjectId: subject.content.tombstone.successorId,
        }
      : null;
    if (
      row.lifecycle !== subject.content.lifecycle ||
      !jsonEqual(row.selector_snapshot, expectedSelectorSnapshot(subject)) ||
      !jsonEqual(row.tombstone_provenance, expectedTombstone)
    ) {
      violations.push(
        violation(
          "subject-membership-mismatch",
          "catalog_release_subjects",
          subject.content.id,
          "compiled-subject-membership-disagrees-with-database",
        ),
      );
    }
  }
  for (const row of subjectRows.rows) {
    if (!subjects.some((subject) => subject.content.id === row.id)) {
      violations.push(
        violation(
          "unexpected-catalog-row",
          "catalog_release_subjects",
          row.id,
          "database-subject-membership-not-in-compiled-release",
        ),
      );
    }
  }

  const aliasRows = await client.query<AliasRow>(
    `select
       alias.id,
       alias.subject_id as root_subject_id,
       membership.subject_id as membership_subject_id,
       alias.selector_kind,
       alias.normalized_selector,
       membership.lifecycle,
       membership.tombstone_provenance
     from parameter_catalog.catalog_release_subject_aliases membership
     join parameter_catalog.catalog_subject_aliases alias on alias.id = membership.alias_id
     where membership.release_id = $1`,
    [releaseId],
  );
  const aliasesById = new Map(aliasRows.rows.map((row) => [row.id, row]));
  for (const alias of aliases) {
    const row = aliasesById.get(alias.content.id);
    if (!row) {
      violations.push(
        violation(
          "alias-membership-mismatch",
          "catalog_release_subject_aliases",
          alias.content.id,
          "compiled-alias-membership-missing",
        ),
      );
      continue;
    }
    if (
      row.root_subject_id !== alias.content.subjectId ||
      row.membership_subject_id !== alias.content.subjectId
    ) {
      violations.push(
        violation(
          "alias-owner-mismatch",
          "catalog_subject_aliases",
          alias.content.id,
          "compiled-alias-owner-disagrees-with-database",
        ),
      );
    }
    const expectedTombstone = alias.content.tombstone
      ? {
          reason: alias.content.tombstone.reason,
          successorSubjectId: alias.content.tombstone.successorId,
        }
      : null;
    if (
      row.selector_kind !== alias.content.selectorKind ||
      row.normalized_selector !== alias.content.normalizedSelector ||
      row.lifecycle !== alias.content.lifecycle ||
      !jsonEqual(row.tombstone_provenance, expectedTombstone)
    ) {
      violations.push(
        violation(
          "alias-membership-mismatch",
          "catalog_release_subject_aliases",
          alias.content.id,
          "compiled-alias-membership-disagrees-with-database",
        ),
      );
    }
  }
  for (const row of aliasRows.rows) {
    if (!aliases.some((alias) => alias.content.id === row.id)) {
      violations.push(
        violation(
          "unexpected-catalog-row",
          "catalog_release_subject_aliases",
          row.id,
          "database-alias-membership-not-in-compiled-release",
        ),
      );
    }
  }

  const definitionRows = await client.query<DefinitionRow>(
    `select definition.id, definition.subject_id, definition.property_key
       from ${catalogDefinitionRelation} definition
       join parameter_catalog.catalog_release_definition_heads head
         on head.definition_id = definition.id
      where head.release_id = $1`,
    [releaseId],
  );
  const definitionsById = new Map(definitionRows.rows.map((row) => [row.id, row]));
  for (const definition of definitions) {
    const row = definitionsById.get(definition.content.id);
    if (!row) {
      violations.push(
        violation(
          "definition-identity-mismatch",
          catalogDefinitionRelation.split(".")[1] ?? "definitions",
          definition.content.id,
          "compiled-definition-missing-from-release-heads",
        ),
      );
      continue;
    }
    if (
      row.subject_id !== definition.content.subjectId ||
      row.property_key !== definition.content.propertyKey
    ) {
      violations.push(
        violation(
          "definition-identity-mismatch",
          catalogDefinitionRelation.split(".")[1] ?? "definitions",
          definition.content.id,
          "compiled-definition-identity-disagrees-with-database",
        ),
      );
    }
  }
  for (const row of definitionRows.rows) {
    if (!definitions.some((definition) => definition.content.id === row.id)) {
      violations.push(
        violation(
          "unexpected-catalog-row",
          catalogDefinitionRelation.split(".")[1] ?? "definitions",
          row.id,
          "database-definition-not-in-compiled-release",
        ),
      );
    }
  }

  const revisionRows = await client.query<RevisionRow>(
    `select
       revision.id,
       revision.definition_id,
       revision.revision_number::text,
       revision.catalog_release_id,
       revision.content_digest
     from parameter_catalog.definition_revisions revision
     join parameter_catalog.catalog_release_definition_heads head
       on head.definition_id = revision.definition_id
      and head.revision_id = revision.id
     where head.release_id = $1`,
    [releaseId],
  );
  const revisionsByDefinition = new Map(
    revisionRows.rows.map((row) => [row.definition_id, row]),
  );
  for (const definition of definitions) {
    const row = revisionsByDefinition.get(definition.content.id);
    if (!row) {
      violations.push(
        violation(
          "definition-revision-mismatch",
          "definition_revisions",
          definition.content.revision.id,
          "compiled-definition-revision-missing",
        ),
      );
      continue;
    }
    if (
      row.id !== definition.content.revision.id ||
      Number(row.revision_number) !== definition.content.revision.number ||
      row.content_digest !== definition.content.revision.contentDigest
    ) {
      violations.push(
        violation(
          "definition-revision-mismatch",
          "definition_revisions",
          definition.content.revision.id,
          "compiled-definition-revision-disagrees-with-database",
        ),
      );
    }
  }

  const lineage = await loadLineageIds(client, releaseId);
  const headRows = await client.query<HeadRow>(
    `select
       head.definition_id,
       head.revision_id,
       revision.catalog_release_id
     from parameter_catalog.catalog_release_definition_heads head
     join parameter_catalog.definition_revisions revision
       on revision.definition_id = head.definition_id
      and revision.id = head.revision_id
     where head.release_id = $1`,
    [releaseId],
  );
  const headsByDefinition = new Map(
    headRows.rows.map((row) => [row.definition_id, row]),
  );
  for (const definition of definitions) {
    const row = headsByDefinition.get(definition.content.id);
    if (!row || row.revision_id !== definition.content.revision.id) {
      violations.push(
        violation(
          "definition-head-mismatch",
          "catalog_release_definition_heads",
          definition.content.id,
          "compiled-definition-head-disagrees-with-database",
        ),
      );
      continue;
    }
    if (!lineage.has(row.catalog_release_id)) {
      violations.push(
        violation(
          "release-head-provenance-mismatch",
          "catalog_release_definition_heads",
          definition.content.id,
          "definition-head-revision-outside-release-lineage",
        ),
      );
    }
  }
  for (const row of headRows.rows) {
    if (!definitions.some((definition) => definition.content.id === row.definition_id)) {
      violations.push(
        violation(
          "unexpected-catalog-row",
          "catalog_release_definition_heads",
          row.definition_id,
          "database-definition-head-not-in-compiled-release",
        ),
      );
    }
  }

  const ownedColumns = await client.query<{ relation: string }>(
    `select class.relname as relation
       from pg_catalog.pg_attribute attribute
       join pg_catalog.pg_class class on class.oid = attribute.attrelid
       join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'parameter_catalog'
        and class.relname = any($1::text[])
        and attribute.attname = 'organization_id'
        and attribute.attnum > 0
        and not attribute.attisdropped`,
    [STRUCTURAL_RELATIONS],
  );
  for (const row of ownedColumns.rows) {
    violations.push(
      violation(
        "organization-owned-catalog-row",
        row.relation,
        "organization_id",
        "catalog-structural-relation-has-organization-identity",
      ),
    );
  }

  return violations;
};

const withVerifierSession = async <T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<Result<T, CatalogKernelError>> => {
  const client = await pool.connect();
  try {
    const role = await client.query<{ current_user: string }>("select current_user");
    if (WRITER_ROLES.has(role.rows[0]?.current_user ?? "")) {
      return fail({
        kind: "permission-denied",
        operation: "verifyCurrentMaterialization",
      });
    }
    await client.query("begin read only");
    const readOnly = await client.query<{ transaction_read_only: string }>(
      "select current_setting('transaction_read_only') as transaction_read_only",
    );
    if (readOnly.rows[0]?.transaction_read_only !== "on") {
      await client.query("rollback").catch(() => undefined);
      return fail({
        kind: "permission-denied",
        operation: "verifyCurrentMaterialization",
      });
    }
    try {
      const value = await work(client);
      await client.query("rollback");
      return ok(value);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return fail(mapReadError(error));
    }
  } catch (error) {
    return fail(mapReadError(error));
  } finally {
    client.release();
  }
};

export const verifyCurrentMaterialization = async (
  pool: pg.Pool,
  command: VerifyCurrentMaterializationCommand,
): Promise<Result<VerificationResult, CatalogKernelError>> => {
  const compiled = await compilePublishedRelease(command.source);
  if (!compiled.ok) {
    return compiled;
  }
  if (
    compiled.value.release.id !== command.expected.id ||
    compiled.value.release.digest !== command.expected.digest
  ) {
    return fail({
      kind: "release-mismatch",
      expected: command.expected,
      actual: identityFromCompiled(compiled.value),
    });
  }

  return withVerifierSession(pool, async (client) => {
    const current = await loadCurrentCatalogSnapshot(pool, command.expected);
    if (!current.ok) {
      throw new CatalogKernelFailure(current.error);
    }
    const pinned = await loadPinnedCatalogSnapshot(pool, command.expected);
    if (!pinned.ok) {
      throw new CatalogKernelFailure(pinned.error);
    }

    const violations = await compareProjection(client, compiled.value, command.expected);
    if (violations.length > 0) {
      throw new CatalogKernelFailure({
        kind: "drift",
        scope: "current",
        expected: command.expected,
        actual: current.value.release,
        violations,
      });
    }

    return {
      status: "verified",
      release: identityFromCompiled(compiled.value),
      materializationFingerprint: compiled.value.materializationFingerprint,
      verifiedAt: CatalogEventTime(new Date().toISOString()),
      checks: catalogVerificationCheckCodes.map((code) => ({
        code,
        status: "passed" as const,
      })),
      counts: compiled.value.counts,
    } satisfies VerificationResult;
  });
};

export type CatalogVerifierAdapter = {
  verifyCurrentMaterialization(
    command: VerifyCurrentMaterializationCommand,
  ): Promise<Result<VerificationResult, CatalogKernelError>>;
};

export const createCatalogVerifier = (pool: pg.Pool): CatalogVerifierAdapter => ({
  verifyCurrentMaterialization: (command) => verifyCurrentMaterialization(pool, command),
});
