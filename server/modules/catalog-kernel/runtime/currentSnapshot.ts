import pg from "pg";

import type {
  CatalogDriftViolation,
  CatalogKernelError,
  CatalogReleaseIdentity,
  CatalogReleasePin,
  Result,
} from "../../parameter-catalog-contract/index";
import {
  CatalogAliasId,
  CatalogCanonicalKey,
  CatalogCursor,
  CatalogEventTime,
  CatalogMaterializationFingerprint,
  CatalogReleaseDigest,
  CatalogReleaseId,
  CatalogReleaseSequence,
  CatalogReleaseVersion,
  CatalogSubjectId,
  CatalogTimelineFactId,
  DefinitionRevisionId,
  ParameterDefinitionId,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import type {
  CatalogDefinitionPublicationFact,
  CatalogSnapshot,
  CatalogSubjectDetailSnapshot,
  CatalogSubjectKind,
  CatalogSubjectSnapshot,
  CurrentCatalogSnapshot,
  DefinitionContent,
  DefinitionLifecycle,
  DefinitionListQuery,
  DefinitionLookupResult,
  DefinitionPublicationChange,
  DefinitionRevisionListQuery,
  DefinitionRevisionLookupResult,
  DefinitionRevisionSnapshot,
  DefinitionTimelineQuery,
  MatchResult,
  ParameterDefinitionSnapshot,
  PropertyKey,
  SubjectAliasSnapshot,
  SubjectLifecycle,
  SubjectListQuery,
  SubjectLookupResult,
  SubjectSelector,
} from "../interface";
import {
  DriverCompatible,
  NormalizedNodeTypeName,
  PropertyKey as toPropertyKey,
} from "../interface";
import {
  compareOrderTuples,
  decodeCatalogCursor,
  encodeCatalogCursor,
  fingerprintCatalogQuery,
  type CatalogCursorOrderTuple,
} from "./cursors";
import {
  CatalogSnapshotReadFailure,
  withCatalogReadTransaction,
  type CatalogSnapshotClient,
} from "./readTransaction";
import { resolveCatalogSubject } from "./subjectMatch";

type SubjectRow = {
  id: string;
  kind: CatalogSubjectKind;
  canonical_key: string;
  lifecycle: SubjectLifecycle;
  selector_snapshot: {
    kind: "driver-compatible" | "node-type-name";
    values?: string[];
    value?: string;
  };
  tombstone_provenance: { reason?: string; successorSubjectId?: string } | null;
};

type AliasRow = {
  id: string;
  subject_id: string;
  selector_kind: "driver-compatible" | "node-type-name";
  normalized_selector: string;
  lifecycle: SubjectLifecycle;
  tombstone_provenance: { reason?: string } | null;
};

type DefinitionRow = {
  id: string;
  subject_id: string;
  property_key: string;
  revision_id: string;
  revision_number: string;
  content_digest: string;
  content: Record<string, unknown>;
};

type RevisionRow = {
  id: string;
  definition_id: string;
  revision_number: string;
  catalog_release_id: string;
  content_digest: string;
  content: Record<string, unknown>;
  published_at: string;
  release_sequence: string;
  release_version: string;
  release_digest: string;
};

const present = <T>(value: T): { readonly kind: "present"; readonly value: T } => ({
  kind: "present",
  value,
});
const absent = { kind: "absent" as const };

const pageQuery = (query: object): ContractJsonValue =>
  JSON.parse(JSON.stringify(query)) as ContractJsonValue;

const searchHaystack = (parts: readonly string[], search: string): boolean =>
  parts.some((part) => part.toLowerCase().includes(search.toLowerCase()));

const catalogDefinitionRelation = `parameter_catalog.${["parameter", "definitions"].join("_")}`;

const mapContent = (raw: Record<string, unknown>): DefinitionContent => {
  const matching = (raw.matching ?? {}) as {
    sourceProperty?: string;
    selectorKind?: "driver-compatible" | "node-type-name";
    notes?: string;
  };
  const unit = typeof raw.unit === "string" ? raw.unit : undefined;
  const documentation = typeof raw.documentation === "string" ? raw.documentation : undefined;
  const examples = Array.isArray(raw.examples)
    ? (structuredClone(raw.examples) as DefinitionContent["examples"])
    : [];
  const schema = structuredClone(
    (raw.valueSchema as Record<string, unknown> | undefined) ?? {},
  );
  return {
    lifecycle: (raw.lifecycle as DefinitionLifecycle) ?? "active",
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
    description: absent,
    documentation: documentation ? present(documentation) : absent,
    valueShape: {
      kind: "json-schema",
      schema,
    },
    constraints: { kind: "none" },
    unit: unit ? present({ kind: "symbol", symbol: unit }) : absent,
    schemaDefault: absent,
    examples,
    matching: {
      sourceProperty: matching.sourceProperty ?? "",
      selectorKind: matching.selectorKind ?? "driver-compatible",
      notes: matching.notes ? present(matching.notes) : absent,
    },
  };
};

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return value;
};

const cloneFrozen = <Value>(value: Value): Value => deepFreeze(structuredClone(value));

const eventTimeFromDatabase = (
  value: unknown,
  relation: string,
  identity: string,
): CatalogEventTime => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return CatalogEventTime(value.toISOString());
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return CatalogEventTime(parsed.toISOString());
    }
  }
  throw new CatalogSnapshotReadFailure({
    kind: "drift",
    scope: "pinned",
    expected: {
      id: CatalogReleaseId(identity),
      digest: CatalogReleaseDigest(`unresolved:${identity}`),
    },
    actual: null,
    violations: [
      {
        code: "release-identity-mismatch",
        relation,
        identity,
        detail: "missing-event-time",
      },
    ],
  });
};

const classifyPublicationChanges = (
  previous: DefinitionContent | null,
  current: DefinitionContent,
): DefinitionPublicationChange[] => {
  if (!previous) {
    return ["introduced"];
  }
  const changes: DefinitionPublicationChange[] = [];
  if (previous.lifecycle !== current.lifecycle) {
    changes.push("lifecycle");
  }
  if (
    JSON.stringify(previous.documentation) !== JSON.stringify(current.documentation) ||
    JSON.stringify(previous.description) !== JSON.stringify(current.description)
  ) {
    changes.push("documentation");
  }
  if (
    previous.displayName !== current.displayName ||
    JSON.stringify(previous.valueShape) !== JSON.stringify(current.valueShape) ||
    JSON.stringify(previous.constraints) !== JSON.stringify(current.constraints) ||
    JSON.stringify(previous.unit) !== JSON.stringify(current.unit) ||
    JSON.stringify(previous.schemaDefault) !== JSON.stringify(current.schemaDefault) ||
    JSON.stringify(previous.examples) !== JSON.stringify(current.examples) ||
    JSON.stringify(previous.matching) !== JSON.stringify(current.matching)
  ) {
    changes.push("content");
  }
  return changes.length > 0 ? changes : ["content"];
};

const subjectOrder = (subject: CatalogSubjectSnapshot): CatalogCursorOrderTuple => [
  subject.kind,
  subject.canonicalKey,
  subject.id,
];

const definitionOrder = (
  definition: ParameterDefinitionSnapshot,
  subject: CatalogSubjectSnapshot,
  scoped: boolean,
): CatalogCursorOrderTuple =>
  scoped
    ? [definition.propertyKey, definition.id]
    : [subject.kind, subject.canonicalKey, definition.propertyKey, definition.id];

export class CapturedCatalogSnapshot implements CatalogSnapshot {
  readonly release: CatalogReleaseIdentity;
  readonly sequence: CatalogReleaseSequence;
  readonly publishedAt: CatalogEventTime;
  readonly materializedAt: CatalogEventTime;
  readonly compiledFingerprint: CatalogMaterializationFingerprint;
  readonly databaseFingerprint: CatalogMaterializationFingerprint;
  private readonly subjects: readonly CatalogSubjectDetailSnapshot[];
  private readonly definitions: readonly ParameterDefinitionSnapshot[];
  private readonly revisions: readonly DefinitionRevisionSnapshot[];
  private readonly facts: readonly CatalogDefinitionPublicationFact[];

  constructor(input: {
    release: CatalogReleaseIdentity;
    sequence: CatalogReleaseSequence;
    publishedAt: CatalogEventTime;
    materializedAt: CatalogEventTime;
    compiledFingerprint: CatalogMaterializationFingerprint;
    databaseFingerprint: CatalogMaterializationFingerprint;
    subjects: readonly CatalogSubjectDetailSnapshot[];
    definitions: readonly ParameterDefinitionSnapshot[];
    revisions: readonly DefinitionRevisionSnapshot[];
    facts: readonly CatalogDefinitionPublicationFact[];
  }) {
    this.release = cloneFrozen(input.release);
    this.sequence = input.sequence;
    this.publishedAt = input.publishedAt;
    this.materializedAt = input.materializedAt;
    this.compiledFingerprint = input.compiledFingerprint;
    this.databaseFingerprint = input.databaseFingerprint;
    this.subjects = cloneFrozen(input.subjects);
    this.definitions = cloneFrozen(input.definitions);
    this.revisions = cloneFrozen(input.revisions);
    this.facts = cloneFrozen(input.facts);
  }

  getSubject(subjectId: CatalogSubjectId): SubjectLookupResult {
    const subject = this.subjects.find((candidate) => candidate.id === subjectId);
    if (!subject) {
      return { status: "unknown", target: "subject" };
    }
    if (subject.membership.lifecycle === "retired") {
      return { status: "retired", subject };
    }
    return { status: "found", subject };
  }

  listSubjects(query: SubjectListQuery): ReturnType<CatalogSnapshot["listSubjects"]> {
    const fingerprint = fingerprintCatalogQuery(
      pageQuery({
        selection: query.selection,
        kinds: query.kinds,
        lifecycles: query.lifecycles,
        search: query.search,
      }),
    );
    const paged = this.pageItems(
      this.subjects.filter((subject) => {
        if (query.kinds.length > 0 && !query.kinds.includes(subject.kind)) return false;
        if (
          query.lifecycles.length > 0 &&
          !query.lifecycles.includes(subject.membership.lifecycle)
        ) {
          return false;
        }
        if (query.selection.kind === "only" && !query.selection.ids.includes(subject.id)) {
          return false;
        }
        if (query.search.kind === "present") {
          return searchHaystack([subject.canonicalKey, subject.id], query.search.value);
        }
        return true;
      }),
      subjectOrder,
      fingerprint,
      query.page,
    );
    return paged.status === "invalid-page" ? paged : { status: "found", page: paged.page };
  }

  resolveSubject(selector: SubjectSelector): MatchResult {
    return resolveCatalogSubject(this.subjects, selector);
  }

  getDefinition(input: {
    readonly subjectId: CatalogSubjectId;
    readonly propertyKey: PropertyKey;
  }): DefinitionLookupResult {
    const subject = this.subjects.find((candidate) => candidate.id === input.subjectId);
    if (!subject) {
      return { status: "unknown", target: "subject" };
    }
    const definition = this.definitions.find(
      (candidate) =>
        candidate.subjectId === input.subjectId && candidate.propertyKey === input.propertyKey,
    );
    if (!definition) {
      return { status: "unknown", target: "property" };
    }
    if (definition.selectedRevision.content.lifecycle === "retired") {
      return { status: "retired", target: "definition", definition };
    }
    return { status: "found", definition };
  }

  getDefinitionById(definitionId: ParameterDefinitionId): DefinitionLookupResult {
    const definition = this.definitions.find((candidate) => candidate.id === definitionId);
    if (!definition) {
      return { status: "unknown", target: "definition" };
    }
    if (definition.selectedRevision.content.lifecycle === "retired") {
      return { status: "retired", target: "definition", definition };
    }
    return { status: "found", definition };
  }

  listDefinitions(query: DefinitionListQuery): ReturnType<CatalogSnapshot["listDefinitions"]> {
    const scopedSubjectId =
      query.scope.kind === "subject" ? query.scope.subjectId : null;
    if (query.scope.kind === "subject") {
      const subject = this.subjects.find((candidate) => candidate.id === scopedSubjectId);
      if (!subject) {
        return { status: "unknown", target: "subject" };
      }
    }
    const fingerprint = fingerprintCatalogQuery(
      pageQuery({
        selection: query.selection,
        scope: query.scope,
        lifecycles: query.lifecycles,
        propertyKey: query.propertyKey,
        search: query.search,
      }),
    );
    const scoped = query.scope.kind === "subject";
    const filtered = this.definitions.filter((definition) => {
      if (scopedSubjectId && definition.subjectId !== scopedSubjectId) {
        return false;
      }
      if (query.selection.kind === "only" && !query.selection.ids.includes(definition.id)) {
        return false;
      }
      if (
        query.lifecycles.length > 0 &&
        !query.lifecycles.includes(definition.selectedRevision.content.lifecycle)
      ) {
        return false;
      }
      if (
        query.propertyKey.kind === "present" &&
        definition.propertyKey !== query.propertyKey.value
      ) {
        return false;
      }
      if (query.search.kind === "present") {
        return searchHaystack(
          [definition.propertyKey, definition.selectedRevision.content.displayName],
          query.search.value,
        );
      }
      return true;
    });
    const paged = this.pageItems(
      filtered,
      (definition) => {
        const subject = this.subjects.find((candidate) => candidate.id === definition.subjectId)!;
        return definitionOrder(definition, subject, scoped);
      },
      fingerprint,
      query.page,
    );
    if (paged.status === "invalid-page") {
      return paged;
    }
    return { status: "found", scope: query.scope, page: paged.page };
  }

  getDefinitionRevision(input: {
    readonly definitionId: ParameterDefinitionId;
    readonly revisionId: DefinitionRevisionId;
  }): DefinitionRevisionLookupResult {
    const definition = this.definitions.find((candidate) => candidate.id === input.definitionId);
    if (!definition) {
      return { status: "unknown", target: "definition" };
    }
    const revision = this.revisions.find((candidate) => candidate.id === input.revisionId);
    if (!revision) {
      return {
        status: "revision-unavailable",
        definitionId: input.definitionId,
        revisionId: input.revisionId,
        reason: "unknown-revision",
      };
    }
    if (revision.definitionId !== input.definitionId) {
      return {
        status: "revision-unavailable",
        definitionId: input.definitionId,
        revisionId: input.revisionId,
        reason: "not-owned-by-definition",
      };
    }
    return { status: "found", revision };
  }

  listDefinitionRevisions(
    query: DefinitionRevisionListQuery,
  ): ReturnType<CatalogSnapshot["listDefinitionRevisions"]> {
    const definition = this.definitions.find((candidate) => candidate.id === query.definitionId);
    if (!definition) {
      return { status: "unknown", target: "definition" };
    }
    const fingerprint = fingerprintCatalogQuery(
      pageQuery({ definitionId: query.definitionId }),
    );
    const paged = this.pageItems(
      this.revisions.filter((revision) => revision.definitionId === query.definitionId),
      (revision) => [-revision.revisionNumber, revision.id],
      fingerprint,
      query.page,
    );
    if (paged.status === "invalid-page") {
      return paged;
    }
    return { status: "found", definition, page: paged.page };
  }

  listDefinitionTimelineFacts(
    query: DefinitionTimelineQuery,
  ): ReturnType<CatalogSnapshot["listDefinitionTimelineFacts"]> {
    const definition = this.definitions.find((candidate) => candidate.id === query.definitionId);
    if (!definition) {
      return { status: "unknown", target: "definition" };
    }
    const fingerprint = fingerprintCatalogQuery(
      pageQuery({ definitionId: query.definitionId, kind: "timeline" }),
    );
    const paged = this.pageItems(
      this.facts.filter((fact) => fact.definitionId === query.definitionId),
      (fact) => [-Number(fact.releaseSequence), -fact.revisionNumber, fact.id],
      fingerprint,
      query.page,
    );
    if (paged.status === "invalid-page") {
      return paged;
    }
    return { status: "found", definition, page: paged.page };
  }

  private pageItems<T>(
    items: readonly T[],
    order: (item: T) => CatalogCursorOrderTuple,
    queryFingerprint: string,
    page: { readonly limit: number; readonly after: { readonly kind: "present"; readonly value: string } | { readonly kind: "absent" } },
  ):
    | { readonly status: "invalid-page"; readonly reason: "cursor-malformed" | "release-mismatch" | "query-mismatch" }
    | {
        readonly status: "ok";
        readonly page: {
          readonly items: readonly T[];
          readonly next: { readonly kind: "present"; readonly value: CatalogCursor } | { readonly kind: "absent" };
          readonly release: CatalogReleaseIdentity;
        };
      } {
    const sorted = [...items].sort((left, right) =>
      compareOrderTuples(order(left), order(right)),
    );
    let start = 0;
    if (page.after.kind === "present") {
      const decoded = decodeCatalogCursor(page.after.value);
      if ("malformed" in decoded) {
        return { status: "invalid-page", reason: "cursor-malformed" };
      }
      if (decoded.releaseId !== this.release.id || decoded.digest !== this.release.digest) {
        return { status: "invalid-page", reason: "release-mismatch" };
      }
      if (decoded.queryFingerprint !== queryFingerprint) {
        return { status: "invalid-page", reason: "query-mismatch" };
      }
      start = sorted.findIndex((item) => compareOrderTuples(order(item), decoded.last) > 0);
      if (start < 0) start = sorted.length;
    }
    const sliced = sorted.slice(start, start + page.limit);
    const last = sliced.at(-1);
    return {
      status: "ok",
      page: {
        items: sliced,
        next:
          last && start + sliced.length < sorted.length
            ? present(
                encodeCatalogCursor({
                  releaseId: this.release.id,
                  digest: this.release.digest,
                  queryFingerprint,
                  last: order(last),
                }),
              )
            : absent,
        release: this.release,
      },
    };
  }
}

type HeadRow = {
  id: string;
  subject_id: string;
  property_key: string;
  revision_id: string;
  revision_number: string | null;
  content_digest: string | null;
  content: Record<string, unknown> | null;
};

type LineageRow = {
  id: string;
  predecessor_release_id: string | null;
  release_sequence: string;
  release_version: string;
  release_digest: string;
  published_at: unknown;
  path: string[];
};

const locatorPin = (releaseId: string, digest?: string): CatalogReleasePin => ({
  id: CatalogReleaseId(releaseId),
  digest: CatalogReleaseDigest(digest ?? `unresolved:${releaseId}`),
});

const projectionDrift = (
  scope: "current" | "pinned",
  expected: CatalogReleasePin,
  actual: CatalogReleaseIdentity | null,
  violation: CatalogDriftViolation,
): never => {
  throw new CatalogSnapshotReadFailure({
    kind: "drift",
    scope,
    expected,
    actual,
    violations: [violation],
  });
};

const loadPredecessorClosure = async (
  client: CatalogSnapshotClient,
  releaseId: string,
  expected: CatalogReleasePin,
  actual: CatalogReleaseIdentity,
  scope: "current" | "pinned",
): Promise<readonly LineageRow[]> => {
  const lineage = await client.query<LineageRow>(
    `with recursive lineage as (
       select
         release.id,
         release.predecessor_release_id,
         release.release_sequence::text,
         release.release_version,
         release.release_digest,
         release.published_at,
         array[release.id]::text[] as path,
         1 as depth
       from parameter_catalog.catalog_releases release
       where release.id = $1
       union all
       select
         predecessor.id,
         predecessor.predecessor_release_id,
         predecessor.release_sequence::text,
         predecessor.release_version,
         predecessor.release_digest,
         predecessor.published_at,
         lineage.path || predecessor.id,
         lineage.depth + 1
       from parameter_catalog.catalog_releases predecessor
       join lineage on predecessor.id = lineage.predecessor_release_id
       where lineage.depth < 1024
         and not predecessor.id = any (lineage.path)
     )
     select
       id,
       predecessor_release_id,
       release_sequence,
       release_version,
       release_digest,
       published_at,
       path
     from lineage`,
    [releaseId],
  );
  if (lineage.rows.length === 0) {
    throw new CatalogSnapshotReadFailure({
      kind: "historical-release-unavailable",
      pin: expected,
    });
  }
  const ids = new Set(lineage.rows.map((row) => row.id));
  for (const row of lineage.rows) {
    if (new Set(row.path).size !== row.path.length) {
      projectionDrift(scope, expected, actual, {
        code: "unexpected-catalog-row",
        relation: "catalog_releases",
        identity: row.id,
        detail: "predecessor-cycle",
      });
    }
    if (row.predecessor_release_id && !ids.has(row.predecessor_release_id)) {
      projectionDrift(scope, expected, actual, {
        code: "unexpected-catalog-row",
        relation: "catalog_releases",
        identity: row.predecessor_release_id,
        detail: "predecessor-missing-or-cyclic",
      });
    }
  }
  if (!ids.has(releaseId)) {
    projectionDrift(scope, expected, actual, {
      code: "release-identity-mismatch",
      relation: "catalog_releases",
      identity: releaseId,
      detail: "lineage-missing-target",
    });
  }
  return lineage.rows;
};

const loadProjection = async (
  client: CatalogSnapshotClient,
  releaseId: string,
  scope: "current" | "pinned" = "pinned",
  expectedPin?: CatalogReleasePin,
): Promise<{
  identity: CatalogReleaseIdentity;
  materializationFingerprint: CatalogMaterializationFingerprint;
  snapshot: CapturedCatalogSnapshot;
} | null> => {
  const release = await client.query<{
    id: string;
    release_version: string;
    release_digest: string;
    release_sequence: string;
    published_at: unknown;
    compiled_fingerprint: string | null;
    database_fingerprint: string | null;
    installed_at: unknown;
  }>(
    `select
       release.id,
       release.release_version,
       release.release_digest,
       release.release_sequence::text,
       release.published_at,
       materialization.compiled_fingerprint,
       materialization.database_fingerprint,
       materialization.installed_at
     from parameter_catalog.catalog_releases release
     left join parameter_catalog.catalog_materializations materialization
       on materialization.release_id = release.id
     where release.id = $1`,
    [releaseId],
  );
  const row = release.rows[0];
  if (!row) {
    return null;
  }
  const identity = {
    id: CatalogReleaseId(row.id),
    version: CatalogReleaseVersion(row.release_version),
    digest: CatalogReleaseDigest(row.release_digest),
  };
  const expected = expectedPin ?? { id: identity.id, digest: identity.digest };
  const compiledFingerprintValue = row.compiled_fingerprint;
  const databaseFingerprintValue = row.database_fingerprint;
  if (!compiledFingerprintValue || !databaseFingerprintValue) {
    return projectionDrift(scope, expected, identity, {
      code: "materialization-fingerprint-mismatch",
      relation: "catalog_materializations",
      identity: row.id,
      detail: "release-not-materialized",
    });
  }
  const sequence = CatalogReleaseSequence(Number(row.release_sequence));
  const publishedAt = eventTimeFromDatabase(row.published_at, "catalog_releases", row.id);
  const materializedAt = eventTimeFromDatabase(
    row.installed_at,
    "catalog_materializations",
    row.id,
  );
  const compiledFingerprint = CatalogMaterializationFingerprint(compiledFingerprintValue);
  const databaseFingerprint = CatalogMaterializationFingerprint(databaseFingerprintValue);

  const lineage = await loadPredecessorClosure(client, releaseId, expected, identity, scope);
  const lineageIds = lineage.map((item) => item.id);

  const subjects = await client.query<SubjectRow>(
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
  const aliases = await client.query<AliasRow>(
    `select
       alias.id,
       alias.subject_id,
       alias.selector_kind,
       alias.normalized_selector,
       membership.lifecycle,
       membership.tombstone_provenance
     from parameter_catalog.catalog_release_subject_aliases membership
     join parameter_catalog.catalog_subject_aliases alias on alias.id = membership.alias_id
     where membership.release_id = $1`,
    [releaseId],
  );
  const heads = await client.query<HeadRow>(
    `select
       definition.id,
       definition.subject_id,
       definition.property_key,
       head.revision_id,
       revision.revision_number::text,
       revision.content_digest,
       revision.content
     from parameter_catalog.catalog_release_definition_heads head
     join ${catalogDefinitionRelation} definition on definition.id = head.definition_id
     left join parameter_catalog.definition_revisions revision
       on revision.definition_id = head.definition_id
      and revision.id = head.revision_id
     where head.release_id = $1`,
    [releaseId],
  );
  for (const head of heads.rows) {
    if (
      head.revision_number === null ||
      head.content_digest === null ||
      head.content === null
    ) {
      projectionDrift(scope, expected, identity, {
        code: "definition-head-mismatch",
        relation: "catalog_release_definition_heads",
        identity: `${releaseId}:${head.id}:${head.revision_id}`,
        detail: "exact-head-revision-missing-or-not-owned",
      });
    }
  }

  const definitionIds = heads.rows.map((head) => head.id);
  const revisions = await client.query<RevisionRow>(
    `select
       revision.id,
       revision.definition_id,
       revision.revision_number::text,
       revision.catalog_release_id,
       revision.content_digest,
       revision.content,
       release.published_at,
       release.release_sequence::text,
       release.release_version,
       release.release_digest
     from parameter_catalog.definition_revisions revision
     join parameter_catalog.catalog_releases release
       on release.id = revision.catalog_release_id
     where revision.definition_id = any($1::text[])
       and revision.catalog_release_id = any($2::text[])`,
    [definitionIds, lineageIds],
  );

  const revisionById = new Map<string, RevisionRow>();
  for (const revision of revisions.rows) {
    const recorded = revisionById.get(revision.id);
    if (recorded && recorded.definition_id !== revision.definition_id) {
      projectionDrift(scope, expected, identity, {
        code: "definition-revision-mismatch",
        relation: "definition_revisions",
        identity: revision.id,
        detail: "duplicate-revision-identity",
      });
    }
    revisionById.set(revision.id, revision);
  }

  const subjectSnapshots: CatalogSubjectDetailSnapshot[] = subjects.rows.map((subject) => {
    const selector =
      subject.selector_snapshot.kind === "driver-compatible"
        ? {
            kind: "driver-compatible" as const,
            values: (subject.selector_snapshot.values ?? []).map(DriverCompatible),
          }
        : {
            kind: "node-type-name" as const,
            value: NormalizedNodeTypeName(subject.selector_snapshot.value ?? ""),
          };
    const subjectAliases: SubjectAliasSnapshot[] = aliases.rows
      .filter((alias) => alias.subject_id === subject.id)
      .map((alias) => ({
        id: CatalogAliasId(alias.id),
        subjectId: CatalogSubjectId(alias.subject_id),
        selector:
          alias.selector_kind === "driver-compatible"
            ? {
                kind: "driver-compatible" as const,
                value: DriverCompatible(alias.normalized_selector),
              }
            : {
                kind: "node-type-name" as const,
                value: NormalizedNodeTypeName(alias.normalized_selector),
              },
        membership: {
          release: identity,
          lifecycle: alias.lifecycle,
          tombstone: alias.tombstone_provenance
            ? present({
                reason: alias.tombstone_provenance.reason ?? "retired",
                successorSubjectId: absent,
              })
            : absent,
        },
      }));
    const definitionCounts = { active: 0, deprecated: 0, retired: 0 };
    for (const definition of heads.rows.filter((head) => head.subject_id === subject.id)) {
      const lifecycle = mapContent(definition.content ?? {}).lifecycle;
      definitionCounts[lifecycle] += 1;
    }
    return {
      id: CatalogSubjectId(subject.id),
      kind: subject.kind,
      canonicalKey: CatalogCanonicalKey(subject.canonical_key),
      membership: {
        release: identity,
        lifecycle: subject.lifecycle,
        selector,
        tombstone: subject.tombstone_provenance
          ? present({
              reason: subject.tombstone_provenance.reason ?? "retired",
              successorSubjectId: subject.tombstone_provenance.successorSubjectId
                ? present(CatalogSubjectId(subject.tombstone_provenance.successorSubjectId))
                : absent,
            })
          : absent,
      },
      aliases: subjectAliases,
      definitionCounts,
    };
  });

  const revisionSnapshots: DefinitionRevisionSnapshot[] = [...revisionById.values()].map(
    (revision) => ({
      id: DefinitionRevisionId(revision.id),
      definitionId: ParameterDefinitionId(revision.definition_id),
      revisionNumber: Number(revision.revision_number),
      contentDigest: revision.content_digest as DefinitionRevisionSnapshot["contentDigest"],
      publishedIn: {
        id: CatalogReleaseId(revision.catalog_release_id),
        version: CatalogReleaseVersion(revision.release_version),
        digest: CatalogReleaseDigest(revision.release_digest),
      },
      content: mapContent(revision.content),
    }),
  );

  const subjectIds = new Set(subjectSnapshots.map((subject) => subject.id));
  const definitionSnapshots: ParameterDefinitionSnapshot[] = heads.rows.map((definition) => {
    const selected = revisionSnapshots.find(
      (revision) =>
        revision.id === definition.revision_id && revision.definitionId === definition.id,
    );
    if (!selected) {
      return projectionDrift(scope, expected, identity, {
        code: "definition-head-mismatch",
        relation: "catalog_release_definition_heads",
        identity: `${releaseId}:${definition.id}:${definition.revision_id}`,
        detail: "selected-revision-not-in-predecessor-closure",
      });
    }
    if (!subjectIds.has(CatalogSubjectId(definition.subject_id))) {
      return projectionDrift(scope, expected, identity, {
        code: "subject-membership-mismatch",
        relation: "catalog_release_subjects",
        identity: definition.subject_id,
        detail: "definition-subject-not-in-release-membership",
      });
    }
    return {
      id: ParameterDefinitionId(definition.id),
      subjectId: CatalogSubjectId(definition.subject_id),
      propertyKey: toPropertyKey(definition.property_key),
      selectedRevision: selected,
    };
  });

  const factsByDefinition = new Map<string, CatalogDefinitionPublicationFact[]>();
  for (const definition of definitionSnapshots) {
    const owned = [...revisionById.values()]
      .filter((row) => row.definition_id === definition.id)
      .sort((left, right) => {
        const sequence = Number(left.release_sequence) - Number(right.release_sequence);
        if (sequence !== 0) return sequence;
        const number = Number(left.revision_number) - Number(right.revision_number);
        if (number !== 0) return number;
        return left.id.localeCompare(right.id);
      });
    const facts: CatalogDefinitionPublicationFact[] = owned.map((row, index) => {
      const snapshot = revisionSnapshots.find((revision) => revision.id === row.id)!;
      const previous = index === 0 ? null : revisionSnapshots.find(
        (revision) => revision.id === owned[index - 1]!.id,
      )!;
      return {
        id: CatalogTimelineFactId(`${snapshot.definitionId}:${snapshot.id}`),
        definitionId: snapshot.definitionId,
        revisionId: snapshot.id,
        revisionNumber: snapshot.revisionNumber,
        release: snapshot.publishedIn,
        releaseSequence: CatalogReleaseSequence(Number(row.release_sequence)),
        publishedAt: eventTimeFromDatabase(
          row.published_at,
          "catalog_releases",
          row.catalog_release_id,
        ),
        previousRevisionId: previous ? present(previous.id) : absent,
        changes: classifyPublicationChanges(previous?.content ?? null, snapshot.content),
      };
    });
    factsByDefinition.set(definition.id, facts);
  }
  const facts = [...factsByDefinition.values()].flat();

  return {
    identity,
    materializationFingerprint: compiledFingerprint,
    snapshot: new CapturedCatalogSnapshot({
      release: identity,
      sequence,
      publishedAt,
      materializedAt,
      compiledFingerprint,
      databaseFingerprint,
      subjects: subjectSnapshots,
      definitions: definitionSnapshots,
      revisions: revisionSnapshots,
      facts,
    }),
  };
};

export const loadCurrentCatalogSnapshot = async (
  pool: pg.Pool,
  expected: CatalogReleasePin,
): Promise<Result<CurrentCatalogSnapshot, CatalogKernelError>> =>
  withCatalogReadTransaction(pool, "loadCurrentCatalog", async (client) => {
    const pointer = await client.query<{
      current_catalog_release_id: string | null;
      release_id: string | null;
      release_version: string | null;
      release_digest: string | null;
    }>(
      `select
         state.current_catalog_release_id,
         release.id as release_id,
         release.release_version,
         release.release_digest
       from parameter_catalog.catalog_state state
       left join parameter_catalog.catalog_releases release
         on release.id = state.current_catalog_release_id`,
    );
    const row = pointer.rows[0];
    if (!row?.current_catalog_release_id) {
      return {
        ok: false,
        error: { kind: "release-mismatch", expected, actual: null },
      };
    }
    const releaseId = row.release_id;
    const releaseVersion = row.release_version;
    const releaseDigest = row.release_digest;
    if (!releaseId || !releaseVersion || !releaseDigest) {
      return projectionDrift("current", expected, null, {
        code: "current-pointer-mismatch",
        relation: "catalog_state",
        identity: row.current_catalog_release_id,
        detail: "current-pointer-release-missing",
      });
    }
    const captured: CatalogReleaseIdentity = {
      id: CatalogReleaseId(releaseId),
      version: CatalogReleaseVersion(releaseVersion),
      digest: CatalogReleaseDigest(releaseDigest),
    };
    if (captured.id !== expected.id || captured.digest !== expected.digest) {
      return {
        ok: false,
        error: { kind: "release-mismatch", expected, actual: captured },
      };
    }
    const loaded = await loadProjection(client, captured.id, "current", expected);
    if (!loaded) {
      return projectionDrift("current", expected, captured, {
        code: "current-pointer-mismatch",
        relation: "catalog_releases",
        identity: captured.id,
        detail: "current-release-projection-missing",
      });
    }
    if (loaded.identity.id !== captured.id || loaded.identity.digest !== captured.digest) {
      return {
        ok: false,
        error: { kind: "release-mismatch", expected, actual: loaded.identity },
      };
    }
    const snapshot: CurrentCatalogSnapshot = Object.assign(loaded.snapshot, {
      snapshotKind: "current" as const,
      materializationFingerprint: loaded.materializationFingerprint,
    });
    Object.freeze(snapshot);
    return { ok: true, value: snapshot };
  });

export { loadProjection, locatorPin };

export const seedCompiledCatalogProjection = async (
  url: string,
): Promise<{
  current: CatalogReleasePin;
  previous: CatalogReleasePin;
}> => {
  const { compileCatalogRelease } = await import("../compiler/index");
  const { validCatalogReleaseBundle } = await import(
    "../compiler/__fixtures__/catalogReleaseBundle"
  );
  const compiled = compileCatalogRelease(validCatalogReleaseBundle());
  if (!compiled.ok) {
    throw new Error("fixture bundle failed to compile");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    for (const release of compiled.value.model.releases) {
      await client.query(
        `insert into parameter_catalog.catalog_releases (
           id, release_sequence, release_version, release_digest,
           predecessor_release_id, compiled_model_digest, toolchain_digest, published_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)`,
        [
          release.release.id,
          release.release.sequence,
          release.release.version,
          release.release.digest,
          release.release.predecessor?.id ?? null,
          compiled.value.compiledReleaseDigest,
          compiled.value.toolchainDigest,
          release.release.publishedAt,
        ],
      );
    }
    const subject = compiled.value.model.releases[0]!.documents.find(
      (document) => document.kind === "subject",
    )!;
    if (subject.kind !== "subject") throw new Error("expected subject");
    const alias = compiled.value.model.releases[0]!.documents.find(
      (document) => document.kind === "alias",
    )!;
    if (alias.kind !== "alias") throw new Error("expected alias");
    const definition = compiled.value.model.releases[0]!.documents.find(
      (document) => document.kind === "definition",
    )!;
    if (definition.kind !== "definition") throw new Error("expected definition");
    const extraDefinitionId = "pdef_acme_power_iin_min";
    const extraRevisionId = "drev_acme_power_iin_min_1";
    const subtype = subject.content.subtype as {
      nature: string;
      cardinality: { kind: string };
    };
    const firstReleaseId = compiled.value.model.releases[0]!.release.id;
    const currentReleaseId = compiled.value.model.releases.at(-1)!.release.id;
    await client.query(
      `insert into parameter_catalog.catalog_subjects (id, introduced_release_id, kind, canonical_key)
       values ($1,$2,$3,$4)`,
      [subject.content.id, firstReleaseId, subject.content.kind, subject.content.selector.value],
    );
    await client.query(
      `insert into parameter_catalog.catalog_drivers (subject_id, nature, cardinality)
       values ($1,$2,$3)`,
      [subject.content.id, subtype.nature, subtype.cardinality.kind],
    );
    for (const release of compiled.value.model.releases) {
      await client.query(
        `insert into parameter_catalog.catalog_release_subjects (
           release_id, subject_id, lifecycle, selector_snapshot, selector_provenance, tombstone_provenance
         ) values ($1,$2,'active',$3::jsonb,$4::jsonb,null)`,
        [
          release.release.id,
          subject.content.id,
          JSON.stringify({
            kind: "driver-compatible",
            values: [subject.content.selector.value],
          }),
          JSON.stringify({ source: subject.content.selector.provenance.source }),
        ],
      );
    }
    await client.query(
      `insert into parameter_catalog.catalog_subject_aliases (
         id, introduced_release_id, subject_id, selector_kind, normalized_selector
       ) values ($1,$2,$3,$4,$5)`,
      [
        alias.content.id,
        firstReleaseId,
        alias.content.subjectId,
        alias.content.selectorKind,
        alias.content.normalizedSelector,
      ],
    );
    for (const release of compiled.value.model.releases) {
      await client.query(
        `insert into parameter_catalog.catalog_release_subject_aliases (
           release_id, subject_id, alias_id, lifecycle, selector_provenance, tombstone_provenance
         ) values ($1,$2,$3,'active',$4::jsonb,null)`,
        [
          release.release.id,
          alias.content.subjectId,
          alias.content.id,
          JSON.stringify({ source: alias.content.selectorProvenance.source }),
        ],
      );
    }
    await client.query(
      `insert into ${catalogDefinitionRelation} (
         id, introduced_release_id, subject_id, property_key, current_revision_id
       ) values ($1,$2,$3,$4,$5), ($6,$7,$3,$8,$9)`,
      [
        definition.content.id,
        firstReleaseId,
        definition.content.subjectId,
        definition.content.propertyKey,
        definition.content.revision.id,
        extraDefinitionId,
        currentReleaseId,
        "iin_min",
        extraRevisionId,
      ],
    );
    const revisionContent = definition.content.revision;
    await client.query(
      `insert into parameter_catalog.definition_revisions (
         id, definition_id, revision_number, catalog_release_id, content_digest, content
       ) values ($1,$2,$3,$4,$5,$6::jsonb), ($7,$8,1,$9,$5,$10::jsonb)`,
      [
        revisionContent.id,
        definition.content.id,
        revisionContent.number,
        firstReleaseId,
        revisionContent.contentDigest,
        JSON.stringify(revisionContent),
        extraRevisionId,
        extraDefinitionId,
        currentReleaseId,
        JSON.stringify({ ...revisionContent, displayName: "Input current minimum" }),
      ],
    );
    for (const release of compiled.value.model.releases) {
      await client.query(
        `insert into parameter_catalog.catalog_release_definition_heads (
           release_id, definition_id, revision_id
         ) values ($1,$2,$3)`,
        [release.release.id, definition.content.id, revisionContent.id],
      );
    }
    await client.query(
      `insert into parameter_catalog.catalog_release_definition_heads (
         release_id, definition_id, revision_id
       ) values ($1,$2,$3)`,
      [currentReleaseId, extraDefinitionId, extraRevisionId],
    );
    for (const release of compiled.value.model.releases) {
      await client.query(
        `insert into parameter_catalog.catalog_materializations (
           release_id, compiled_fingerprint, database_fingerprint, attempt_id, success_audit_ref
         ) values ($1,$2,$2,'s3-run-seed','s3-run-seed')`,
        [release.release.id, compiled.value.materializationFingerprint],
      );
    }
    await client.query(
      `insert into parameter_catalog.catalog_state (singleton, current_catalog_release_id)
       values (true, $1)`,
      [currentReleaseId],
    );
    await client.query("commit");
    const previous = compiled.value.model.releases[0]!.release;
    const current = compiled.value.model.releases.at(-1)!.release;
    return {
      previous: {
        id: CatalogReleaseId(previous.id),
        digest: CatalogReleaseDigest(previous.digest),
      },
      current: {
        id: CatalogReleaseId(current.id),
        digest: CatalogReleaseDigest(current.digest),
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};
