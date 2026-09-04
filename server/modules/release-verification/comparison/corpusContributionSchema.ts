import { createHash } from "node:crypto";

import { corpusRefusal } from "./errors";

export const COMPARISON_CONTRIBUTION_CONTRACT_VERSION = "pcat-comparison-contribution/v1";
export const COMPARISON_CORPUS_CONTRACT_VERSION = "pcat-comparison-corpus/v1";
export const COMPARISON_REPORT_CONTRACT_VERSION = "pcat-comparison-report/v1";

export const COMPARISON_FAMILIES = [
  "CGH",
  "TOP",
  "PRJ",
  "FIL",
  "AGT",
  "LOG",
  "DBG",
  "DTS",
  "KNW",
  "MOD",
  "OPS",
] as const;

export type ComparisonFamily = (typeof COMPARISON_FAMILIES)[number];

export const COMPARISON_IDS = [
  "PCAT-CMP-D01-DEFINITION-SEMANTICS",
  "PCAT-CMP-D02-SUBJECT-IDENTITY",
  "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
  "PCAT-CMP-D04-BINDING-HISTORY",
  "PCAT-CMP-D05-PROJECT-VALUE-PIN",
  "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
  "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
  "PCAT-CMP-D08-SOURCE-WRITEBACK",
  "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME",
] as const;

export type ComparisonId = (typeof COMPARISON_IDS)[number];

export const FAMILY_COMPARISON_IDS = {
  CGH: [
    "PCAT-CMP-D01-DEFINITION-SEMANTICS",
    "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
    "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
    "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME",
  ],
  TOP: [
    "PCAT-CMP-D02-SUBJECT-IDENTITY",
    "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
    "PCAT-CMP-D04-BINDING-HISTORY",
    "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
  ],
  PRJ: ["PCAT-CMP-D04-BINDING-HISTORY", "PCAT-CMP-D05-PROJECT-VALUE-PIN"],
  FIL: ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE", "PCAT-CMP-D08-SOURCE-WRITEBACK"],
  AGT: ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE", "PCAT-CMP-D08-SOURCE-WRITEBACK"],
  LOG: ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE"],
  DBG: ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE"],
  DTS: ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE", "PCAT-CMP-D08-SOURCE-WRITEBACK"],
  KNW: ["PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE"],
  MOD: ["PCAT-CMP-D02-SUBJECT-IDENTITY", "PCAT-CMP-D03-REGISTRATION-PLACEMENT"],
  OPS: ["PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME"],
} as const satisfies Record<ComparisonFamily, readonly ComparisonId[]>;

export type ComparisonPhase = "pre-activation" | "post-p13";
export type InventoryMode = "fresh" | "populated";

export const COMPARISON_RESULT_CLASSES = [
  "exact-equivalent",
  "declared-expected-difference",
  "unexplained-difference",
  "unqueryable/protected-reference-missing",
] as const;

export type ComparisonResultClass = (typeof COMPARISON_RESULT_CLASSES)[number];

export type ProtectedReference = {
  readonly kind: string;
  readonly id: string;
};

export type QueryObservation =
  | {
      readonly status: "value";
      readonly value: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "query-failure";
      readonly code: string;
      readonly detail: string;
    };

export type ExpectedDifference = {
  readonly rClass: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly typedTarget?: { readonly kind: string; readonly id: string };
  readonly Archive?: { readonly id: string };
  readonly ruleId: string;
  readonly planPin: string;
};

export type ComparisonCase = {
  readonly caseId: string;
  readonly comparisonId: ComparisonId;
  readonly protectedReference: ProtectedReference;
  readonly legacyObservation: QueryObservation;
  readonly canonicalObservation: QueryObservation;
  readonly result: ComparisonResultClass;
  readonly expectedDifference: ExpectedDifference | null;
};

export type ComparisonContribution = {
  readonly contractVersion: typeof COMPARISON_CONTRIBUTION_CONTRACT_VERSION;
  readonly family: ComparisonFamily;
  readonly phase: ComparisonPhase;
  readonly inventoryMode: InventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
  readonly sourceInventoryCount: number;
  readonly sourceInventoryChecksum: string;
  readonly cases: readonly ComparisonCase[];
  readonly checksum: string;
};

export type AggregationContext = {
  readonly phase: ComparisonPhase;
  readonly inventoryMode: InventoryMode;
  readonly candidateSha: string;
  readonly planPin: string;
  readonly mappingHeadId: string;
  readonly mappingHeadVersion: number;
  readonly mappingHeadChecksum: string;
  readonly catalogSnapshotChecksum: string;
};

const CONTRIBUTION_KEYS = [
  "contractVersion",
  "family",
  "phase",
  "inventoryMode",
  "candidateSha",
  "planPin",
  "mappingHeadId",
  "mappingHeadVersion",
  "mappingHeadChecksum",
  "catalogSnapshotChecksum",
  "sourceInventoryCount",
  "sourceInventoryChecksum",
  "cases",
  "checksum",
] as const;

const CASE_KEYS = [
  "caseId",
  "comparisonId",
  "protectedReference",
  "legacyObservation",
  "canonicalObservation",
  "result",
  "expectedDifference",
] as const;

const CANDIDATE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/u;
const FORBIDDEN_INPUT_TOKENS = [
  ["parameter-catalog", "allowlist"].join("-"),
  ["scripts", ["parameter-catalog", "allowlist"].join("-"), "shards"].join("/") + "/",
  ["9c803557a55803cc", "ca79c20eadd033f57d4729e0"].join(""),
  ["loadParameterCatalog", "Fixture"].join(""),
] as const;

export const compareText = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, nested]) => [key, sortKeys(nested)]),
    );
  }
  return value;
};

export const serializeCanonical = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(sortKeys(value))}\n`, "utf8");

export const checksumCanonicalBytes = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

export const omitChecksum = <T extends { readonly checksum: string }>(
  value: T,
): Omit<T, "checksum"> => {
  const { checksum: _checksum, ...rest } = value;
  void _checksum;
  return rest;
};

export const serializeComparisonContribution = (
  contribution: Omit<ComparisonContribution, "checksum"> | ComparisonContribution,
): Buffer => serializeCanonical(omitChecksum(contribution as ComparisonContribution));

export const checksumComparisonContribution = (
  contribution: Omit<ComparisonContribution, "checksum"> | ComparisonContribution,
): string => checksumCanonicalBytes(serializeComparisonContribution(contribution));

export const isComparisonFamily = (value: string): value is ComparisonFamily =>
  (COMPARISON_FAMILIES as readonly string[]).includes(value);

export const isComparisonId = (value: string): value is ComparisonId =>
  (COMPARISON_IDS as readonly string[]).includes(value);

export const isComparisonPhase = (value: string): value is ComparisonPhase =>
  value === "pre-activation" || value === "post-p13";

export const isInventoryMode = (value: string): value is InventoryMode =>
  value === "fresh" || value === "populated";

export const isComparisonResultClass = (value: string): value is ComparisonResultClass =>
  (COMPARISON_RESULT_CLASSES as readonly string[]).includes(value);

export const compareComparisonCases = (
  left: {
    readonly family?: string;
    readonly comparisonId: string;
    readonly protectedReference: ProtectedReference;
    readonly caseId: string;
  },
  right: {
    readonly family?: string;
    readonly comparisonId: string;
    readonly protectedReference: ProtectedReference;
    readonly caseId: string;
  },
): number =>
  compareText(left.family ?? "", right.family ?? "") ||
  compareText(left.comparisonId, right.comparisonId) ||
  compareText(left.protectedReference.kind, right.protectedReference.kind) ||
  compareText(left.protectedReference.id, right.protectedReference.id) ||
  compareText(left.caseId, right.caseId);

export const casesAreInCanonicalOrder = (
  cases: readonly ComparisonCase[],
  family: ComparisonFamily,
): boolean => {
  for (let index = 1; index < cases.length; index += 1) {
    const previous = cases[index - 1];
    const current = cases[index];
    if (!previous || !current) {
      return false;
    }
    if (
      compareComparisonCases({ ...previous, family }, { ...current, family }) > 0
    ) {
      return false;
    }
  }
  return true;
};

export const assertExactFamilySet = (families: readonly string[]): ComparisonFamily[] => {
  const unknown = families.filter((family) => !isComparisonFamily(family));
  if (unknown.length > 0) {
    throw corpusRefusal(
      "PCAT-CMP-UNKNOWN-FAMILY",
      `unknown family registration: ${unknown.join(",")}`,
    );
  }
  const counts = new Map<string, number>();
  for (const family of families) {
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([family]) => family);
  if (duplicates.length > 0) {
    throw corpusRefusal(
      "PCAT-CMP-DUPLICATE-FAMILY",
      `duplicate family registration: ${duplicates.join(",")}`,
    );
  }
  const missing = COMPARISON_FAMILIES.filter((family) => !counts.has(family));
  if (missing.length > 0) {
    throw corpusRefusal(
      "PCAT-CMP-MISSING-FAMILY",
      `missing family registration: ${missing.join(",")}`,
    );
  }
  return [...COMPARISON_FAMILIES];
};

const assertClosedKeys = (
  value: object,
  allowed: readonly string[],
  label: string,
): void => {
  const keys = Object.keys(value);
  const extra = keys.filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      `${label} has unknown keys: ${extra.join(",")}`,
    );
  }
  const missing = allowed.filter((key) => !keys.includes(key));
  if (missing.length > 0) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      `${label} is missing keys: ${missing.join(",")}`,
    );
  }
};

const assertNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `${label} must be a nonempty string`);
  }
  return value;
};

const assertFiniteInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isFinite(value)) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `${label} must be a finite integer`);
  }
  return value;
};

const assertNoForbiddenInput = (value: unknown, label: string): void => {
  const encoded = JSON.stringify(value);
  for (const token of FORBIDDEN_INPUT_TOKENS) {
    if (encoded.includes(token)) {
      throw corpusRefusal(
        "PCAT-CMP-REPORT-INTEGRITY",
        `${label} rejected forbidden corpus input token`,
      );
    }
  }
};

const assertProtectedReference = (value: unknown, label: string): ProtectedReference => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => key !== "kind" && key !== "id");
  if (extra.length > 0) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `${label} has unknown keys: ${extra.join(",")}`);
  }
  return {
    kind: assertNonEmptyString(record.kind, `${label}.kind`),
    id: assertNonEmptyString(record.id, `${label}.id`),
  };
};

const assertQueryObservation = (value: unknown, label: string): QueryObservation => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.status === "value") {
    const extra = Object.keys(record).filter((key) => key !== "status" && key !== "value");
    if (extra.length > 0) {
      throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `${label} has unknown keys: ${extra.join(",")}`);
    }
    if (record.value === null || typeof record.value !== "object" || Array.isArray(record.value)) {
      throw corpusRefusal("PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE", `${label}.value must be an object`);
    }
    return { status: "value", value: record.value as Readonly<Record<string, unknown>> };
  }
  if (record.status === "query-failure") {
    const extra = Object.keys(record).filter(
      (key) => key !== "status" && key !== "code" && key !== "detail",
    );
    if (extra.length > 0) {
      throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `${label} has unknown keys: ${extra.join(",")}`);
    }
    return {
      status: "query-failure",
      code: assertNonEmptyString(record.code, `${label}.code`),
      detail: assertNonEmptyString(record.detail, `${label}.detail`),
    };
  }
  throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `${label}.status is not a closed observation`);
};

const assertExpectedDifference = (
  value: unknown,
  contribution: ComparisonContribution,
  comparisonId: ComparisonId,
  label: string,
): ExpectedDifference => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw corpusRefusal(
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      `${label} must be an object for declared-expected-difference`,
    );
  }
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter(
    (key) =>
      key !== "rClass" &&
      key !== "mappingHeadId" &&
      key !== "mappingHeadVersion" &&
      key !== "typedTarget" &&
      key !== "Archive" &&
      key !== "ruleId" &&
      key !== "planPin",
  );
  if (extra.length > 0) {
    throw corpusRefusal(
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      `${label} has unknown keys: ${extra.join(",")}`,
    );
  }
  const rClass = assertNonEmptyString(record.rClass, `${label}.rClass`);
  const mappingHeadId = assertNonEmptyString(record.mappingHeadId, `${label}.mappingHeadId`);
  const mappingHeadVersion = assertFiniteInteger(
    record.mappingHeadVersion,
    `${label}.mappingHeadVersion`,
  );
  const ruleId = assertNonEmptyString(record.ruleId, `${label}.ruleId`);
  const planPin = assertNonEmptyString(record.planPin, `${label}.planPin`);
  if (mappingHeadId !== contribution.mappingHeadId) {
    throw corpusRefusal(
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      `${label}.mappingHeadId is not bound to the contribution mapping head`,
    );
  }
  if (mappingHeadVersion !== contribution.mappingHeadVersion) {
    throw corpusRefusal(
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      `${label}.mappingHeadVersion is not bound to the contribution mapping head`,
    );
  }
  if (planPin !== contribution.planPin) {
    throw corpusRefusal(
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      `${label}.planPin is not bound to the contribution plan pin`,
    );
  }
  if (ruleId !== comparisonId) {
    throw corpusRefusal(
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      `${label}.ruleId must equal comparisonId`,
    );
  }
  const typedTarget =
    record.typedTarget === undefined
      ? undefined
      : assertProtectedReference(record.typedTarget, `${label}.typedTarget`);
  let archive: { readonly id: string } | undefined;
  if (record.Archive !== undefined) {
    if (record.Archive === null || typeof record.Archive !== "object" || Array.isArray(record.Archive)) {
      throw corpusRefusal(
        "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
        `${label}.Archive must be an object`,
      );
    }
    const archiveRecord = record.Archive as Record<string, unknown>;
    archive = { id: assertNonEmptyString(archiveRecord.id, `${label}.Archive.id`) };
  }
  if (typedTarget === undefined && archive === undefined) {
    throw corpusRefusal(
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      `${label} requires typedTarget or Archive`,
    );
  }
  return {
    rClass,
    mappingHeadId,
    mappingHeadVersion,
    ...(typedTarget ? { typedTarget } : {}),
    ...(archive ? { Archive: archive } : {}),
    ruleId,
    planPin,
  };
};

const observationsAreEquivalent = (
  left: QueryObservation,
  right: QueryObservation,
): boolean => {
  if (left.status !== "value" || right.status !== "value") {
    return false;
  }
  return (
    JSON.stringify(sortKeys(left.value)) === JSON.stringify(sortKeys(right.value))
  );
};

const assertComparisonCase = (
  value: unknown,
  contribution: ComparisonContribution,
  index: number,
): ComparisonCase => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `cases[${index}] must be an object`);
  }
  assertClosedKeys(value, CASE_KEYS, `cases[${index}]`);
  const record = value as Record<string, unknown>;
  const caseId = assertNonEmptyString(record.caseId, `cases[${index}].caseId`);
  const comparisonIdRaw = assertNonEmptyString(
    record.comparisonId,
    `cases[${index}].comparisonId`,
  );
  if (!isComparisonId(comparisonIdRaw)) {
    throw corpusRefusal(
      "PCAT-CMP-UNKNOWN-COMPARISON-ID",
      `unknown comparison ID ${comparisonIdRaw}`,
    );
  }
  const allowed = FAMILY_COMPARISON_IDS[contribution.family] as readonly ComparisonId[];
  if (!allowed.includes(comparisonIdRaw)) {
    throw corpusRefusal(
      "PCAT-CMP-UNKNOWN-COMPARISON-ID",
      `comparison ID ${comparisonIdRaw} is not mapped for family ${contribution.family}`,
    );
  }
  const protectedReference = assertProtectedReference(
    record.protectedReference,
    `cases[${index}].protectedReference`,
  );
  const legacyObservation = assertQueryObservation(
    record.legacyObservation,
    `cases[${index}].legacyObservation`,
  );
  const canonicalObservation = assertQueryObservation(
    record.canonicalObservation,
    `cases[${index}].canonicalObservation`,
  );
  const resultRaw = assertNonEmptyString(record.result, `cases[${index}].result`);
  if (!isComparisonResultClass(resultRaw)) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      `cases[${index}].result is not a closed result class`,
    );
  }
  if (resultRaw === "declared-expected-difference") {
    const expectedDifference = assertExpectedDifference(
      record.expectedDifference,
      contribution,
      comparisonIdRaw,
      `cases[${index}].expectedDifference`,
    );
    return {
      caseId,
      comparisonId: comparisonIdRaw,
      protectedReference,
      legacyObservation,
      canonicalObservation,
      result: resultRaw,
      expectedDifference,
    };
  }
  if (record.expectedDifference !== null) {
    throw corpusRefusal(
      "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
      `cases[${index}].expectedDifference must be null for ${resultRaw}`,
    );
  }
  if (resultRaw === "exact-equivalent") {
    if (!observationsAreEquivalent(legacyObservation, canonicalObservation)) {
      throw corpusRefusal(
        "PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE",
        `cases[${index}] exact-equivalent lacks equivalent typed observations`,
      );
    }
  }
  if (resultRaw === "unqueryable/protected-reference-missing") {
    const failureCode =
      (legacyObservation.status === "query-failure" && legacyObservation.code) ||
      (canonicalObservation.status === "query-failure" && canonicalObservation.code);
    if (failureCode !== "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE") {
      throw corpusRefusal(
        "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
        `cases[${index}] unqueryable result must retain PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE`,
      );
    }
  }
  return {
    caseId,
    comparisonId: comparisonIdRaw,
    protectedReference,
    legacyObservation,
    canonicalObservation,
    result: resultRaw,
    expectedDifference: null,
  };
};

export const parseComparisonContribution = (
  value: unknown,
  context: AggregationContext,
): ComparisonContribution => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "contribution must be an object");
  }
  assertNoForbiddenInput(value, "contribution");
  assertClosedKeys(value, CONTRIBUTION_KEYS, "contribution");
  const record = value as Record<string, unknown>;
  const contractVersion = assertNonEmptyString(record.contractVersion, "contractVersion");
  if (contractVersion !== COMPARISON_CONTRIBUTION_CONTRACT_VERSION) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      `unsupported contribution contractVersion ${contractVersion}`,
    );
  }
  const familyRaw = assertNonEmptyString(record.family, "family");
  if (!isComparisonFamily(familyRaw)) {
    throw corpusRefusal("PCAT-CMP-UNKNOWN-FAMILY", `unknown family ${familyRaw}`);
  }
  const phaseRaw = assertNonEmptyString(record.phase, "phase");
  if (!isComparisonPhase(phaseRaw)) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `unsupported phase ${phaseRaw}`);
  }
  if (phaseRaw !== context.phase) {
    throw corpusRefusal(
      "PCAT-CMP-PHASE-REUSE",
      `contribution phase ${phaseRaw} does not match required ${context.phase}`,
    );
  }
  const inventoryModeRaw = assertNonEmptyString(record.inventoryMode, "inventoryMode");
  if (!isInventoryMode(inventoryModeRaw)) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      `unsupported inventoryMode ${inventoryModeRaw}`,
    );
  }
  if (inventoryModeRaw !== context.inventoryMode) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      `contribution inventoryMode ${inventoryModeRaw} does not match required ${context.inventoryMode}`,
    );
  }
  const candidateSha = assertNonEmptyString(record.candidateSha, "candidateSha");
  if (!CANDIDATE_SHA_PATTERN.test(candidateSha)) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "candidateSha must be a full lowercase Git SHA");
  }
  if (candidateSha !== context.candidateSha) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      "contribution candidateSha is not bound to the aggregation context",
    );
  }
  const planPin = assertNonEmptyString(record.planPin, "planPin");
  if (planPin !== context.planPin) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      "contribution planPin is not bound to the aggregation context",
    );
  }
  const mappingHeadId = assertNonEmptyString(record.mappingHeadId, "mappingHeadId");
  if (mappingHeadId !== context.mappingHeadId) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      "contribution mappingHeadId is not bound to the aggregation context",
    );
  }
  const mappingHeadVersion = assertFiniteInteger(record.mappingHeadVersion, "mappingHeadVersion");
  if (mappingHeadVersion !== context.mappingHeadVersion) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      "contribution mappingHeadVersion is not bound to the aggregation context",
    );
  }
  const mappingHeadChecksum = assertNonEmptyString(
    record.mappingHeadChecksum,
    "mappingHeadChecksum",
  );
  if (!CHECKSUM_PATTERN.test(mappingHeadChecksum) || mappingHeadChecksum !== context.mappingHeadChecksum) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      "contribution mappingHeadChecksum is not bound to the aggregation context",
    );
  }
  const catalogSnapshotChecksum = assertNonEmptyString(
    record.catalogSnapshotChecksum,
    "catalogSnapshotChecksum",
  );
  if (
    !CHECKSUM_PATTERN.test(catalogSnapshotChecksum) ||
    catalogSnapshotChecksum !== context.catalogSnapshotChecksum
  ) {
    throw corpusRefusal(
      "PCAT-CMP-REPORT-INTEGRITY",
      "contribution catalogSnapshotChecksum is not bound to the aggregation context",
    );
  }
  const sourceInventoryCount = assertFiniteInteger(
    record.sourceInventoryCount,
    "sourceInventoryCount",
  );
  if (sourceInventoryCount < 0) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "sourceInventoryCount must be >= 0");
  }
  const sourceInventoryChecksum = assertNonEmptyString(
    record.sourceInventoryChecksum,
    "sourceInventoryChecksum",
  );
  if (!CHECKSUM_PATTERN.test(sourceInventoryChecksum)) {
    throw corpusRefusal("PCAT-CMP-CHECKSUM-INVALID", "sourceInventoryChecksum is not sha256 hex");
  }
  if (!Array.isArray(record.cases)) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "cases must be an array");
  }
  const checksum = assertNonEmptyString(record.checksum, "checksum");
  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw corpusRefusal("PCAT-CMP-CHECKSUM-INVALID", "contribution checksum is not sha256 hex");
  }

  const parsed: ComparisonContribution = {
    contractVersion: COMPARISON_CONTRIBUTION_CONTRACT_VERSION,
    family: familyRaw,
    phase: phaseRaw,
    inventoryMode: inventoryModeRaw,
    candidateSha,
    planPin,
    mappingHeadId,
    mappingHeadVersion,
    mappingHeadChecksum,
    catalogSnapshotChecksum,
    sourceInventoryCount,
    sourceInventoryChecksum,
    cases: record.cases as ComparisonCase[],
    checksum,
  };

  const recomputed = checksumComparisonContribution(parsed);
  if (recomputed !== checksum) {
    throw corpusRefusal(
      "PCAT-CMP-CHECKSUM-INVALID",
      `family ${familyRaw} checksum drifted from canonical bytes`,
    );
  }

  const cases = record.cases.map((item, index) => assertComparisonCase(item, parsed, index));
  if (!casesAreInCanonicalOrder(cases, familyRaw)) {
    throw corpusRefusal(
      "PCAT-CMP-ORDER-DRIFT",
      `family ${familyRaw} cases are not in canonical order`,
    );
  }
  const caseIds = new Set<string>();
  for (const item of cases) {
    if (caseIds.has(item.caseId)) {
      throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", `duplicate caseId ${item.caseId}`);
    }
    caseIds.add(item.caseId);
  }

  if (inventoryModeRaw === "fresh") {
    if (sourceInventoryCount !== 0 || cases.length !== 0) {
      throw corpusRefusal(
        "PCAT-CMP-FRESH-INVENTORY-NOT-ZERO",
        `family ${familyRaw} fresh inventory must be zero after a real query`,
      );
    }
  } else {
    const uniqueRefs = new Set(cases.map((item) => `${item.protectedReference.kind}\0${item.protectedReference.id}`));
    if (sourceInventoryCount > 0 && uniqueRefs.size < sourceInventoryCount) {
      throw corpusRefusal(
        "PCAT-CMP-SAMPLED-POPULATED",
        `family ${familyRaw} populated contribution is sampled: ${uniqueRefs.size} refs < ${sourceInventoryCount} inventory`,
      );
    }
    if (sourceInventoryCount > 0 && cases.length === 0) {
      throw corpusRefusal(
        "PCAT-CMP-SAMPLED-POPULATED",
        `family ${familyRaw} populated inventory has no cases`,
      );
    }
  }

  return { ...parsed, cases };
};
