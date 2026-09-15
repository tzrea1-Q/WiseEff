import {
  parseCanonicalCompatibleSelector,
  parseCanonicalConfigurationSchemaId,
  parseCanonicalNodeName,
} from "../../parameter-catalog-contract/index";
import type {
  CatalogSubjectDetailSnapshot,
  CatalogSubjectKind,
  CatalogSubjectSnapshot,
  MatchResult,
  SubjectAliasSnapshot,
  SubjectSelector,
} from "../interface";
import { compareOrderTuples } from "./cursors";

type SubjectHit = {
  readonly subject: CatalogSubjectDetailSnapshot;
  readonly live: boolean;
  readonly matchedBy: "canonical-selector" | "alias";
  readonly alias: SubjectAliasSnapshot | null;
};

type SelectorKind =
  | "driver-compatible"
  | "node-type-name"
  | "configuration-schema-id";

/**
 * Three-way kind mapping. An unrecognised kind yields `null` (no match) rather than
 * defaulting into the node-type namespace.
 */
const aliasSelectorKind = (kind: CatalogSubjectKind): SelectorKind | null => {
  if (kind === "driver") return "driver-compatible";
  if (kind === "node-type") return "node-type-name";
  if (kind === "configuration-schema") return "configuration-schema-id";
  return null;
};

const canonicalSelectorValues = (
  subject: CatalogSubjectDetailSnapshot,
  kind: CatalogSubjectKind,
): readonly string[] => {
  if (subject.kind !== kind) return [];
  const selector = subject.membership.selector;
  if (kind === "driver") {
    return selector.kind === "driver-compatible" ? selector.values : [];
  }
  if (kind === "node-type") {
    return selector.kind === "node-type-name" ? [selector.value] : [];
  }
  if (kind === "configuration-schema") {
    return selector.kind === "configuration-schema-id" ? [selector.value] : [];
  }
  return [];
};

const compareAliasId = (left: SubjectAliasSnapshot, right: SubjectAliasSnapshot): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const compareSubjectHit = (left: SubjectHit, right: SubjectHit): number =>
  compareOrderTuples(
    [left.subject.kind, left.subject.canonicalKey, left.subject.id],
    [right.subject.kind, right.subject.canonicalKey, right.subject.id],
  );

const parsedDriverCompatibles = (values: readonly string[]): readonly string[] => {
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const result = parseCanonicalCompatibleSelector(value);
    if (!result.ok || seen.has(result.value)) continue;
    seen.add(result.value);
    parsed.push(result.value);
  }
  return parsed;
};

const parsedNodeTypeName = (value: string): string | null => {
  const result = parseCanonicalNodeName(value);
  return result.ok ? result.value : null;
};

const parsedConfigurationSchemaIds = (
  values: readonly string[],
): readonly string[] => {
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const result = parseCanonicalConfigurationSchemaId(value);
    if (!result.ok || seen.has(result.value)) continue;
    seen.add(result.value);
    parsed.push(result.value);
  }
  return parsed;
};

const foldSubjectHit = (
  subject: CatalogSubjectDetailSnapshot,
  kind: CatalogSubjectKind,
  inputValues: ReadonlySet<string>,
): SubjectHit | null => {
  if (subject.kind !== kind) return null;
  const canonicalHit = canonicalSelectorValues(subject, kind).some((value) =>
    inputValues.has(value),
  );
  const expectedAliasKind = aliasSelectorKind(kind);
  const aliasHits =
    expectedAliasKind === null
      ? []
      : subject.aliases.filter(
          (alias) =>
            alias.selector.kind === expectedAliasKind &&
            inputValues.has(alias.selector.value),
        );
  if (!canonicalHit && aliasHits.length === 0) return null;

  const subjectActive = subject.membership.lifecycle === "active";
  const liveAliases = aliasHits
    .filter((alias) => alias.membership.lifecycle === "active")
    .sort(compareAliasId);
  const retiredAliases = aliasHits
    .filter((alias) => alias.membership.lifecycle === "retired")
    .sort(compareAliasId);

  if (subjectActive && canonicalHit) {
    return {
      subject,
      live: true,
      matchedBy: "canonical-selector",
      alias: null,
    };
  }
  if (subjectActive && liveAliases.length > 0) {
    return {
      subject,
      live: true,
      matchedBy: "alias",
      alias: liveAliases[0]!,
    };
  }
  return {
    subject,
    live: false,
    matchedBy: canonicalHit ? "canonical-selector" : "alias",
    alias: retiredAliases[0] ?? aliasHits[0] ?? null,
  };
};

const collectHits = (
  subjects: readonly CatalogSubjectDetailSnapshot[],
  kind: CatalogSubjectKind,
  inputValues: readonly string[],
): readonly SubjectHit[] => {
  if (inputValues.length === 0) return [];
  const values = new Set(inputValues);
  const hits: SubjectHit[] = [];
  for (const subject of subjects) {
    const hit = foldSubjectHit(subject, kind, values);
    if (hit) hits.push(hit);
  }
  return hits;
};

const uniqueSubjects = (hits: readonly SubjectHit[]): CatalogSubjectSnapshot[] => {
  const seen = new Set<string>();
  const subjects: CatalogSubjectSnapshot[] = [];
  for (const hit of [...hits].sort(compareSubjectHit)) {
    if (seen.has(hit.subject.id)) continue;
    seen.add(hit.subject.id);
    subjects.push(hit.subject);
  }
  return subjects;
};

const decideHits = (
  hits: readonly SubjectHit[],
): { readonly kind: "empty" } | { readonly kind: "result"; readonly result: MatchResult } => {
  if (hits.length === 0) return { kind: "empty" };
  const live = hits.filter((hit) => hit.live);
  const liveIds = new Set(live.map((hit) => hit.subject.id));
  const retiredOnly = hits.filter((hit) => !hit.live && !liveIds.has(hit.subject.id));

  // Distinct live + retired Subjects stay ambiguous; do not drop either side.
  if (live.length === 1 && retiredOnly.length === 0) {
    const hit = live[0]!;
    return {
      kind: "result",
      result: {
        status: "matched",
        subject: hit.subject,
        matchedBy: hit.matchedBy,
        alias: hit.alias,
      },
    };
  }
  if (live.length > 0) {
    return {
      kind: "result",
      result: { status: "ambiguous", candidates: uniqueSubjects([...live, ...retiredOnly]) },
    };
  }
  if (retiredOnly.length === 1) {
    const hit = retiredOnly[0]!;
    return {
      kind: "result",
      result: { status: "retired", subject: hit.subject, alias: hit.alias },
    };
  }
  return {
    kind: "result",
    result: { status: "ambiguous", candidates: uniqueSubjects(retiredOnly) },
  };
};

export const resolveCatalogSubject = (
  subjects: readonly CatalogSubjectDetailSnapshot[],
  selector: SubjectSelector,
): MatchResult => {
  const driverDecision = decideHits(
    collectHits(subjects, "driver", parsedDriverCompatibles(selector.driverCompatibles)),
  );
  if (driverDecision.kind === "result") {
    return driverDecision.result;
  }
  // Software configuration matches only an explicit governed model identifier. It
  // never inherits the driver compatible namespace and never consumes the node-type
  // fallback, which stays authoritative for device nodes.
  const configurationSchemaIds = parsedConfigurationSchemaIds(
    selector.configurationSchemaIds ?? [],
  );
  if (configurationSchemaIds.length > 0) {
    const configurationDecision = decideHits(
      collectHits(subjects, "configuration-schema", configurationSchemaIds),
    );
    if (configurationDecision.kind === "result") {
      return configurationDecision.result;
    }
  }

  if (selector.nodeTypeFallback.kind !== "present") {
    return { status: "unknown", reason: "no-candidate" };
  }
  const nodeTypeName = parsedNodeTypeName(selector.nodeTypeFallback.name);
  if (nodeTypeName === null) {
    return { status: "unknown", reason: "no-candidate" };
  }
  const nodeDecision = decideHits(collectHits(subjects, "node-type", [nodeTypeName]));
  return nodeDecision.kind === "result"
    ? nodeDecision.result
    : { status: "unknown", reason: "no-candidate" };
};
