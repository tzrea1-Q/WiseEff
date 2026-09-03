import {
  comparisonVerificationFailureCodes,
  comparisonVerificationGateIds,
  databaseVerificationFailureCodes,
  databaseVerificationGateIds,
  migrationVerificationFailureCodes,
  migrationVerificationGateIds,
  privilegeVerificationFailureCodes,
  privilegeVerificationGateIds,
  verificationModes,
  verificationPurposes,
  type VerificationMode,
  type VerificationPurpose,
} from "../../parameter-catalog-contract/index";
import { digestOf } from "./digest";
import {
  GateRegistryDigest,
  VerificationGateId,
  type GateApplicability,
  type GateFamily,
  type PurposeGateProfileEntry,
} from "./types";

const freezeRegistry = <const Values extends readonly unknown[]>(values: Values): Values => {
  Object.freeze(values);
  return values;
};

export const apiVerificationGateIds = freezeRegistry([
  "PCAT-API-01",
  "PCAT-API-02",
  "PCAT-API-03",
  "PCAT-API-04",
  "PCAT-API-05",
  "PCAT-API-06",
  "PCAT-API-07",
  "PCAT-API-08",
  "PCAT-API-09",
  "PCAT-API-10",
  "PCAT-API-11",
  "PCAT-API-12",
]);

export const browserVerificationGateIds = freezeRegistry([
  "PCAT-UI-01",
  "PCAT-UI-02",
  "PCAT-UI-03",
  "PCAT-UI-04",
  "PCAT-UI-05",
  "PCAT-UI-06",
  "PCAT-UI-07",
  "PCAT-UI-08",
  "PCAT-UI-09",
  "PCAT-UI-10",
  "PCAT-UI-11",
  "PCAT-UI-12",
  "PCAT-UI-13",
  "PCAT-UI-14",
  "PCAT-UI-15",
]);

export const auxiliaryVerificationGateIds = freezeRegistry([
  "PCAT-RP-RECOVERY-POINT",
  "PCAT-WRITER-PRE-SWITCH-FENCE",
  "PCAT-OBS-INTERNAL",
  "PCAT-RB-POINTER-CLOSURE",
  "PCAT-UPG-RUNTIME-PIN",
  "PCAT-LINEAGE-PREDECESSOR-DIGESTS",
  "PCAT-RET-COMPAT-WINDOW",
  "PCAT-RET-CONSUMER-DISPOSITION",
  "PCAT-RET-ZERO-DEPENDENCY",
  "PCAT-RESTORE-REHEARSAL",
  "PCAT-RET-LEGAL-HOLD",
]);

export type RegistryGate = {
  readonly id: VerificationGateId;
  readonly family: GateFamily;
  readonly failureCode: string;
  readonly executionPurposes: readonly VerificationPurpose[];
};

const zipFailure = <Ids extends readonly string[], Codes extends readonly string[]>(
  ids: Ids,
  codes: Codes,
  family: GateFamily,
  executionPurposes: readonly VerificationPurpose[],
): readonly RegistryGate[] => {
  if (ids.length !== codes.length) {
    throw new Error(`Gate/failure registry length mismatch for family ${family}`);
  }
  return ids.map((id, index) => {
    const failureCode = codes[index];
    if (failureCode === undefined) {
      throw new Error(`Missing failure code for ${id}`);
    }
    return {
      id: VerificationGateId(id),
      family,
      failureCode,
      executionPurposes,
    };
  });
};

const DATABASE_EXECUTIONS: readonly VerificationPurpose[] = [
  "pre-activation",
  "post-retirement-runtime",
  "p16-cleanup",
];
const MIGRATION_EXECUTIONS: readonly VerificationPurpose[] = ["pre-activation", "p16-cleanup"];
const ISOLATED_EXECUTIONS: readonly VerificationPurpose[] = [
  "isolated-candidate-acceptance",
  "p16-cleanup",
];
const RECOVERY_EXECUTIONS: readonly VerificationPurpose[] = [
  "pre-activation",
  "post-retirement-runtime",
  "public-release",
  "legacy-read-sunset",
  "p16-cleanup",
];

export const RELEASE_VERIFICATION_GATES: readonly RegistryGate[] = freezeRegistry([
  ...zipFailure(
    databaseVerificationGateIds,
    databaseVerificationFailureCodes,
    "database",
    DATABASE_EXECUTIONS,
  ),
  ...zipFailure(
    migrationVerificationGateIds,
    migrationVerificationFailureCodes,
    "migration",
    MIGRATION_EXECUTIONS,
  ),
  ...zipFailure(
    privilegeVerificationGateIds,
    privilegeVerificationFailureCodes,
    "privilege",
    DATABASE_EXECUTIONS,
  ),
  ...zipFailure(
    comparisonVerificationGateIds,
    comparisonVerificationFailureCodes,
    "comparison",
    DATABASE_EXECUTIONS,
  ),
  ...apiVerificationGateIds.map((id) => ({
    id: VerificationGateId(id),
    family: "api" as const,
    failureCode: `${id}-FAILED`,
    executionPurposes: ISOLATED_EXECUTIONS,
  })),
  ...browserVerificationGateIds.map((id) => ({
    id: VerificationGateId(id),
    family: "browser" as const,
    failureCode: `${id}-FAILED`,
    executionPurposes: ISOLATED_EXECUTIONS,
  })),
  {
    id: VerificationGateId("PCAT-RP-RECOVERY-POINT"),
    family: "recovery",
    failureCode: "PCAT-RP-RECOVERY-POINT-FAILED",
    executionPurposes: RECOVERY_EXECUTIONS,
  },
  {
    id: VerificationGateId("PCAT-WRITER-PRE-SWITCH-FENCE"),
    family: "writer",
    failureCode: "PCAT-WRITER-PRE-SWITCH-FENCE-FAILED",
    executionPurposes: ["pre-activation"],
  },
  {
    id: VerificationGateId("PCAT-OBS-INTERNAL"),
    family: "observability",
    failureCode: "PCAT-OBS-INTERNAL-FAILED",
    executionPurposes: ["isolated-candidate-acceptance", "public-release", "p16-cleanup"],
  },
  {
    id: VerificationGateId("PCAT-RB-POINTER-CLOSURE"),
    family: "rollback",
    failureCode: "PCAT-RB-POINTER-CLOSURE-FAILED",
    executionPurposes: ["isolated-candidate-acceptance", "public-release"],
  },
  {
    id: VerificationGateId("PCAT-UPG-RUNTIME-PIN"),
    family: "runtime-pin",
    failureCode: "PCAT-UPG-CANDIDATE-DIGEST-MISMATCH",
    executionPurposes: ["post-retirement-runtime"],
  },
  {
    id: VerificationGateId("PCAT-LINEAGE-PREDECESSOR-DIGESTS"),
    family: "lineage",
    failureCode: "PCAT-LINEAGE-PREDECESSOR-DIGESTS-FAILED",
    executionPurposes: ["public-release", "legacy-read-sunset", "p16-cleanup"],
  },
  {
    id: VerificationGateId("PCAT-RET-COMPAT-WINDOW"),
    family: "retirement",
    failureCode: "PCAT-RET-COMPAT-WINDOW-FAILED",
    executionPurposes: ["legacy-read-sunset"],
  },
  {
    id: VerificationGateId("PCAT-RET-CONSUMER-DISPOSITION"),
    family: "retirement",
    failureCode: "PCAT-RET-CONSUMER-DISPOSITION-FAILED",
    executionPurposes: ["legacy-read-sunset"],
  },
  {
    id: VerificationGateId("PCAT-RET-ZERO-DEPENDENCY"),
    family: "retirement",
    failureCode: "PCAT-RET-ZERO-DEPENDENCY-FAILED",
    executionPurposes: ["p16-cleanup"],
  },
  {
    id: VerificationGateId("PCAT-RESTORE-REHEARSAL"),
    family: "restore",
    failureCode: "PCAT-RESTORE-REHEARSAL-FAILED",
    executionPurposes: ["p16-cleanup"],
  },
  {
    id: VerificationGateId("PCAT-RET-LEGAL-HOLD"),
    family: "retirement",
    failureCode: "PCAT-RET-LEGAL-HOLD-FAILED",
    executionPurposes: ["p16-cleanup"],
  },
]);

const isPurpose = (value: string): value is VerificationPurpose =>
  (verificationPurposes as readonly string[]).includes(value);

const isMode = (value: string): value is VerificationMode =>
  (verificationModes as readonly string[]).includes(value);

export const parseVerificationPurpose = (value: string): VerificationPurpose | null =>
  isPurpose(value) ? value : null;

export const parseVerificationMode = (value: string): VerificationMode | null =>
  isMode(value) ? value : null;

const REQUIRED_NOW: GateApplicability = { status: "required-now" };

const notYetExecutable = (successorPurpose: VerificationPurpose): GateApplicability => ({
  status: "not-yet-executable",
  successorPurpose,
});

const notApplicable = (proof: string): GateApplicability => ({
  status: "not-applicable",
  proof,
});

const BELONGS_LAUNCH = "belongs-to-purpose:pre-activation,post-retirement-runtime";
const BELONGS_PRE_ACTIVATION = "belongs-to-purpose:pre-activation";
const BELONGS_POST_RETIREMENT = "belongs-to-purpose:post-retirement-runtime";
const BELONGS_ISOLATED = "belongs-to-purpose:isolated-candidate-acceptance";
const BELONGS_SUNSET = "belongs-to-purpose:legacy-read-sunset";
const BELONGS_CLEANUP = "belongs-to-purpose:p16-cleanup";

const launchDatabaseApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "pre-activation":
    case "post-retirement-runtime":
    case "p16-cleanup":
      return REQUIRED_NOW;
    case "isolated-candidate-acceptance":
    case "public-release":
    case "legacy-read-sunset":
      return notApplicable(BELONGS_LAUNCH);
  }
};

const migrationApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "pre-activation":
    case "p16-cleanup":
      return REQUIRED_NOW;
    case "post-retirement-runtime":
    case "isolated-candidate-acceptance":
    case "public-release":
    case "legacy-read-sunset":
      return notApplicable(BELONGS_PRE_ACTIVATION);
  }
};

const apiBrowserApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "pre-activation":
    case "post-retirement-runtime":
      return notYetExecutable("isolated-candidate-acceptance");
    case "isolated-candidate-acceptance":
    case "p16-cleanup":
      return REQUIRED_NOW;
    case "public-release":
    case "legacy-read-sunset":
      return notApplicable(BELONGS_ISOLATED);
  }
};

const recoveryApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "pre-activation":
    case "post-retirement-runtime":
    case "public-release":
    case "legacy-read-sunset":
    case "p16-cleanup":
      return REQUIRED_NOW;
    case "isolated-candidate-acceptance":
      return notApplicable(BELONGS_LAUNCH);
  }
};

const observabilityApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "pre-activation":
    case "post-retirement-runtime":
      return notYetExecutable("isolated-candidate-acceptance");
    case "isolated-candidate-acceptance":
    case "public-release":
    case "p16-cleanup":
      return REQUIRED_NOW;
    case "legacy-read-sunset":
      return notApplicable(BELONGS_ISOLATED);
  }
};

const rollbackApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "pre-activation":
    case "post-retirement-runtime":
      return notYetExecutable("isolated-candidate-acceptance");
    case "isolated-candidate-acceptance":
    case "public-release":
    case "p16-cleanup":
      return REQUIRED_NOW;
    case "legacy-read-sunset":
      return notApplicable(BELONGS_ISOLATED);
  }
};

const lineageApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "isolated-candidate-acceptance":
      return notYetExecutable("public-release");
    case "public-release":
    case "legacy-read-sunset":
    case "p16-cleanup":
      return REQUIRED_NOW;
    case "pre-activation":
    case "post-retirement-runtime":
      return notApplicable("belongs-to-purpose:public-release");
  }
};

const sunsetWindowApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "public-release":
      return notYetExecutable("legacy-read-sunset");
    case "legacy-read-sunset":
      return REQUIRED_NOW;
    case "p16-cleanup":
      return notApplicable(BELONGS_SUNSET);
    case "pre-activation":
    case "post-retirement-runtime":
    case "isolated-candidate-acceptance":
      return notApplicable(BELONGS_SUNSET);
  }
};

const cleanupFamilyApplicability = (purpose: VerificationPurpose): GateApplicability => {
  switch (purpose) {
    case "public-release":
    case "legacy-read-sunset":
      return notYetExecutable("p16-cleanup");
    case "p16-cleanup":
      return REQUIRED_NOW;
    case "pre-activation":
    case "post-retirement-runtime":
    case "isolated-candidate-acceptance":
      return notApplicable(BELONGS_CLEANUP);
  }
};

export const gateApplicability = (
  gate: RegistryGate,
  purpose: VerificationPurpose,
  mode: VerificationMode,
): GateApplicability => {
  if (gate.id === "PCAT-WRITER-PRE-SWITCH-FENCE" && mode === "cleanup") {
    return notApplicable("mode=cleanup/no-pre-switch-fence");
  }
  switch (gate.family) {
    case "database":
    case "privilege":
    case "comparison":
      return launchDatabaseApplicability(purpose);
    case "migration":
      return migrationApplicability(purpose);
    case "api":
    case "browser":
      return apiBrowserApplicability(purpose);
    case "recovery":
      return recoveryApplicability(purpose);
    case "writer":
      return purpose === "pre-activation"
        ? REQUIRED_NOW
        : notApplicable(BELONGS_PRE_ACTIVATION);
    case "observability":
      return observabilityApplicability(purpose);
    case "rollback":
      return rollbackApplicability(purpose);
    case "runtime-pin":
      if (purpose === "pre-activation") {
        return notYetExecutable("post-retirement-runtime");
      }
      if (purpose === "post-retirement-runtime") {
        return REQUIRED_NOW;
      }
      return notApplicable(BELONGS_POST_RETIREMENT);
    case "lineage":
      return lineageApplicability(purpose);
    case "restore":
      return cleanupFamilyApplicability(purpose);
    case "retirement":
      if (gate.id === "PCAT-RET-COMPAT-WINDOW" || gate.id === "PCAT-RET-CONSUMER-DISPOSITION") {
        return sunsetWindowApplicability(purpose);
      }
      return cleanupFamilyApplicability(purpose);
  }
};

export const purposeProfile = (
  purpose: VerificationPurpose,
  mode: VerificationMode,
): readonly PurposeGateProfileEntry[] =>
  RELEASE_VERIFICATION_GATES.map((gate) => ({
    gateId: gate.id,
    family: gate.family,
    failureCode: gate.failureCode,
    applicability: gateApplicability(gate, purpose, mode),
  }));

export const closedGateIds = (): readonly VerificationGateId[] =>
  RELEASE_VERIFICATION_GATES.map((gate) => gate.id);

export const gateRegistryDigest = (): GateRegistryDigest =>
  GateRegistryDigest(
    digestOf({
      gates: RELEASE_VERIFICATION_GATES.map((gate) => ({
        id: gate.id,
        family: gate.family,
        failureCode: gate.failureCode,
        executionPurposes: gate.executionPurposes,
      })),
      purposes: verificationPurposes,
      modes: verificationModes,
    }),
  );

export const findRegistryGate = (gateId: string): RegistryGate | null =>
  RELEASE_VERIFICATION_GATES.find((gate) => gate.id === gateId) ?? null;

export const MISSING_APPLICABLE_GATE_FAILURE = "PCAT-VRF-APPLICABLE-GATE-MISSING";
