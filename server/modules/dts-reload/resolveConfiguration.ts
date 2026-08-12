import type { Queryable } from "../../shared/database/client";
import {
  SEEDED_RELOAD_CONFIGURATION,
  type ReloadConfigurationContract,
  type ResolvedReloadConfiguration
} from "./configurationTypes";
import { getOrganisationDefaultRow, rowToContract } from "./configurationRepository";

export type ResolveReloadConfigurationInput = {
  organizationId: string;
  deviceId: string;
};

/**
 * Resolution entry point for reload runs.
 *
 * Later tickets (#285 / #286) must call this — and only this — to obtain the effective device-side
 * contract for a device. Inputs are organisation and device identifiers only; request bodies and
 * other client-supplied contract fields are never consulted. Effective values come from the
 * organisation default row, or seeded defaults when none exists.
 */
export async function resolveReloadConfiguration(
  db: Queryable,
  input: ResolveReloadConfigurationInput
): Promise<ResolvedReloadConfiguration> {
  const organizationId = input.organizationId;
  const deviceId = input.deviceId;

  const orgRow = await getOrganisationDefaultRow(db, organizationId);
  if (orgRow) {
    return {
      organizationId,
      deviceId,
      source: "organisation",
      ...rowToContract(orgRow)
    };
  }

  const seeded: ReloadConfigurationContract = { ...SEEDED_RELOAD_CONFIGURATION };
  return {
    organizationId,
    deviceId,
    source: "seeded-default",
    ...seeded
  };
}
