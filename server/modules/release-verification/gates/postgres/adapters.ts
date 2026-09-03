import {
  databaseVerificationFailureCodes,
  databaseVerificationGateIds,
  migrationVerificationFailureCodes,
  migrationVerificationGateIds,
  privilegeVerificationFailureCodes,
  privilegeVerificationGateIds,
} from "../../../parameter-catalog-contract/index";
import type { Database } from "../../../../shared/database/client";
import { findRegistryGate } from "../../core/gateRegistry";
import type { GateAdapter, GateResult, VerificationPlan } from "../../core/types";
import {
  runV01,
  runV02,
  runV03,
  runV04,
  runV05,
  runV06,
  runV07,
  runV08,
  runV09,
  runV10,
  runV11,
  runV12,
  runV13,
  runV14,
  runV15,
  runV16,
  runV17,
} from "./countGates";
import { failedResult } from "./evidence";
import { DEFAULT_MIGRATIONS_DIR, loadPackagedMigrationInventory } from "./inventory";
import { runM01, runM02, runM03, runM04 } from "./migrationGates";
import { runP01, runP02 } from "./privilegeGates";
import { queryOf } from "./session";

export const POSTGRES_GATE_IDS = [
  ...databaseVerificationGateIds,
  ...migrationVerificationGateIds,
  ...privilegeVerificationGateIds,
] as const;

export const POSTGRES_FAILURE_CODES = [
  ...databaseVerificationFailureCodes,
  ...migrationVerificationFailureCodes,
  ...privilegeVerificationFailureCodes,
] as const;

export type PostgresGateOptions = {
  readonly db: Database;
  readonly migrationsDir?: string;
};

const applicabilityResult = (
  gateId: string,
  plan: VerificationPlan,
): GateResult | null => {
  const entry = plan.applicabilityProfile.find((item) => item.gateId === gateId);
  if (!entry) {
    return failedResult(gateId, "PCAT-VRF-APPLICABLE-GATE-MISSING", {
      detail: "gate-not-in-purpose-profile",
    });
  }
  if (entry.applicability.status === "not-yet-executable") {
    return {
      gateId: entry.gateId,
      status: "not-yet-executable",
      failureCode: null,
      evidenceDigest: null,
      successorPurpose: entry.applicability.successorPurpose,
      notApplicableProof: null,
    };
  }
  if (entry.applicability.status === "not-applicable") {
    return {
      gateId: entry.gateId,
      status: "not-applicable",
      failureCode: null,
      evidenceDigest: null,
      successorPurpose: null,
      notApplicableProof: entry.applicability.proof,
    };
  }
  return null;
};

const executeRequired = async (
  options: PostgresGateOptions,
  gateId: string,
  plan: VerificationPlan,
): Promise<GateResult> => {
  const query = queryOf(options.db);
  const inventory = await loadPackagedMigrationInventory(
    options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR,
  );
  switch (gateId) {
    case "PCAT-DB-V01":
      return runV01(query, plan);
    case "PCAT-DB-V02":
      return runV02(query);
    case "PCAT-DB-V03":
      return runV03(query);
    case "PCAT-DB-V04":
      return runV04(query);
    case "PCAT-DB-V05":
      return runV05(query);
    case "PCAT-DB-V06":
      return runV06(query);
    case "PCAT-DB-V07":
      return runV07(query);
    case "PCAT-DB-V08":
      return runV08(query);
    case "PCAT-DB-V09":
      return runV09(query, plan);
    case "PCAT-DB-V10":
      return runV10(query);
    case "PCAT-DB-V11":
      return runV11(query);
    case "PCAT-DB-V12":
      return runV12(query, plan);
    case "PCAT-DB-V13":
      return runV13(query);
    case "PCAT-DB-V14":
      return runV14(query);
    case "PCAT-DB-V15":
      return runV15(query);
    case "PCAT-DB-V16":
      return runV16(query);
    case "PCAT-DB-V17":
      return runV17(query, plan);
    case "PCAT-DB-M01":
      return runM01(query, plan, inventory);
    case "PCAT-DB-M02":
      return runM02(query, inventory);
    case "PCAT-DB-M03":
      return runM03(query, inventory);
    case "PCAT-DB-M04":
      return runM04(query, plan, inventory);
    case "PCAT-DB-P01":
      return runP01(options.db);
    case "PCAT-DB-P02":
      return runP02(options.db);
    default: {
      const registry = findRegistryGate(gateId);
      return failedResult(gateId, registry?.failureCode ?? "PCAT-VRF-APPLICABLE-GATE-MISSING", {
        detail: "unknown-postgres-gate",
      });
    }
  }
};

export const createPostgresGateAdapters = (
  options: PostgresGateOptions,
): Map<string, GateAdapter> => {
  const adapters = new Map<string, GateAdapter>();
  for (const gateId of POSTGRES_GATE_IDS) {
    adapters.set(gateId, async ({ gateId: id, plan }) => {
      const skipped = applicabilityResult(id, plan);
      if (skipped) {
        return skipped;
      }
      return executeRequired(options, id, plan);
    });
  }
  return adapters;
};
