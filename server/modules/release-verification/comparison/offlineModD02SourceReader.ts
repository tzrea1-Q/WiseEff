import type pg from "pg";

import { createUserInvocation } from "../../auth/trustedInvocation";
import { resolveOfflineLocalSession } from "../../auth/offlineLocalSession";
import { provideModParameterCatalogComparisonCaseBatchV2 } from "../../parameter-modules/parameterCatalogComparisonContribution";
import { readCompletedModComparisonManifestForComparison } from "../../parameter-catalog-api/productionWire";
import { getRootPostgresPool, type Database } from "../../../shared/database/client";
import type { ComparisonCaseBatchV2 } from "./corpusContributionSchema";
import { assertModD02CapturableBatch } from "./caseResultV2Writer";

export type OfflineModD02SourceReaderOptions = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly enabled?: boolean;
  readonly authProvider?: string;
  readonly now?: () => Date;
};

export type OfflineModD02SourceRead = {
  readonly sessionId: string;
  readonly principalId: string;
  readonly organizationId: string;
  readonly batch: ComparisonCaseBatchV2;
};

/** Builds the read-only source batch for capture; capture stays disabled unless explicitly enabled. */
export function createOfflineModD02SourceReader(options: OfflineModD02SourceReaderOptions) {
  const enabled = options.enabled ?? process.env.MOD_D02_CAPTURE_ENABLED === "true";
  const authProvider = options.authProvider ?? process.env.AUTH_PROVIDER ?? "local";

  return async (input: { readonly token: string; readonly runId: string }): Promise<OfflineModD02SourceRead> => {
    if (!enabled) throw new Error("MOD D02 offline capture is disabled.");
    if (authProvider !== "local") throw new Error("MOD D02 offline capture requires AUTH_PROVIDER=local.");
    if (getRootPostgresPool(options.database) !== options.pool) {
      throw new Error("MOD D02 source-reader database and pool must be the same configured root.");
    }
    if (!input.runId.trim()) throw new Error("MOD D02 offline capture requires a run id.");

    const resolved = await resolveOfflineLocalSession(options.database, input.token, options.now);
    const invocation = createUserInvocation(resolved.auth);
    const batch = await provideModParameterCatalogComparisonCaseBatchV2({
      database: options.database,
      pool: options.pool,
      runId: input.runId,
      invocation,
    });
    const manifest = await readCompletedModComparisonManifestForComparison({
      database: options.database,
      pool: options.pool,
      runId: input.runId,
      invocation,
    });
    assertModD02CapturableBatch(batch, manifest.manifest);

    return {
      sessionId: resolved.sessionId,
      principalId: resolved.auth.user.id,
      organizationId: resolved.auth.organization.id,
      batch,
    };
  };
}
