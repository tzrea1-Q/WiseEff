import { createCheckedEmptyDatabase as createCatalogEmpty, createDisposableParameterCatalogDatabase as createCatalogMigrated } from "./parameterCatalog/database";
import { createMigratedSelfHostedPg16Database, createSelfHostedPg16Database } from "./selfHostedUpgrade/database";

/** This extra deployment-shape fixture does not change the Catalog lane.
 * The PG16 path independently verifies its private owned-cluster receipt.
 * Existing ordinary Catalog tests retain their required pgvector harness. */
export type ParameterCatalogDatabase = { url: string; close(): Promise<void> };
function selfHostedProfile(): boolean {
  const profile = process.env.UPG_COMPONENT_PROFILE;
  if (profile === "selfhost-postgres16-alpine-v1") return true;
  if (profile === undefined || profile === "catalog-pgvector-v1") return false;
  throw new Error("upgrade-component-profile-unsupported");
}
export const createCheckedEmptyDatabase = (name: string): Promise<ParameterCatalogDatabase> =>
  selfHostedProfile() ? createSelfHostedPg16Database(name) : createCatalogEmpty(name);
export const createDisposableParameterCatalogDatabase = (name: string): Promise<ParameterCatalogDatabase> =>
  selfHostedProfile() ? createMigratedSelfHostedPg16Database(name) : createCatalogMigrated(name);
