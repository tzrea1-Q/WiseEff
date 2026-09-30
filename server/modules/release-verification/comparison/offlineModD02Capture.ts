import type pg from "pg";

import { createPostgresDatabase, getRootPostgresPool, type Database } from "../../../shared/database/client";
import { hashLocalSessionToken } from "../../auth/localAccountCredentials";
import { createOfflineModD02SourceReader } from "./offlineModD02SourceReader";

type DatabaseIdentity = {
  session_user: string;
  current_user: string;
  database_name: string;
  cluster_identifier: string;
  parameter_log_limit: string;
  is_superuser: boolean;
  bypass_rls: boolean;
};

export type OfflineModD02CaptureInput = {
  readonly sourceDatabase: Database;
  readonly sourcePool: pg.Pool;
  readonly captureDatabase: Database;
  readonly token: string;
  readonly runId: string;
  readonly requestId: string;
  readonly expectedPlanDigest: string;
  readonly expectedArtifactSha: string;
  readonly expectedCatalogReleaseDigest: string;
  readonly enabled?: boolean;
  readonly authProvider?: string;
};

export type OfflineModD02CaptureFromUrlsInput = Omit<
  OfflineModD02CaptureInput,
  "sourceDatabase" | "sourcePool" | "captureDatabase"
> & {
  readonly sourceDatabaseUrl: string;
  readonly captureDatabaseUrl: string;
};

export type OfflineModD02CaptureReceipt = {
  readonly sourceIdentity: DatabaseIdentity;
  readonly captureIdentity: DatabaseIdentity;
  readonly organizationId: string;
  readonly selectionRunId: string;
  readonly selectionProjectionDigest: string;
  readonly caseCount: number;
  readonly newlyWrittenCount: number;
  readonly replayedWriteCount: number;
  readonly selectionStatusCounts: { readonly appended: number; readonly replayed: number };
  readonly fullReport: {
    readonly available: false;
    readonly reason: "eleven-family-and-nine-gate-coverage-not-collected";
  };
};

const readIdentity = async (database: Database): Promise<DatabaseIdentity> => {
  const result = await database.query<DatabaseIdentity>(
    `select session_user, current_user, current_database() as database_name,
            system_identifier::text as cluster_identifier,
            current_setting('log_parameter_max_length') as parameter_log_limit,
            role.rolsuper as is_superuser, role.rolbypassrls as bypass_rls
       from pg_catalog.pg_control_system(), pg_catalog.pg_roles role
      where role.rolname = session_user`,
  );
  if (result.rows.length !== 1) throw new Error("MOD D02 database identity is unavailable");
  return result.rows[0]!;
};

/** One organization-scoped pre-P11 capture; the caller owns and closes both roots. */
export async function captureOfflineModD02PreP11(
  input: OfflineModD02CaptureInput,
): Promise<OfflineModD02CaptureReceipt> {
  if (!(input.enabled ?? process.env.MOD_D02_CAPTURE_ENABLED === "true")) {
    throw new Error("MOD D02 offline capture is disabled.");
  }
  if (getRootPostgresPool(input.sourceDatabase) !== input.sourcePool ||
      !getRootPostgresPool(input.captureDatabase) ||
      input.sourceDatabase === input.captureDatabase) {
    throw new Error("MOD D02 capture requires separate configured source and capture roots");
  }
  const [sourceIdentity, captureIdentity] = await Promise.all([
    readIdentity(input.sourceDatabase), readIdentity(input.captureDatabase),
  ]);
  if (sourceIdentity.session_user !== "wiseeff_mod_d02_source_reader" ||
      sourceIdentity.current_user !== sourceIdentity.session_user ||
      captureIdentity.session_user !== "wiseeff_mod_d02_capture" ||
      captureIdentity.current_user !== captureIdentity.session_user ||
      sourceIdentity.database_name !== captureIdentity.database_name ||
      sourceIdentity.cluster_identifier !== captureIdentity.cluster_identifier ||
      sourceIdentity.is_superuser || sourceIdentity.bypass_rls ||
      captureIdentity.is_superuser || captureIdentity.bypass_rls ||
      sourceIdentity.parameter_log_limit !== "0" || captureIdentity.parameter_log_limit !== "0") {
    throw new Error("MOD D02 capture database logins or target database differ");
  }

  const read = await createOfflineModD02SourceReader({
    database: input.sourceDatabase,
    pool: input.sourcePool,
    enabled: input.enabled,
    authProvider: input.authProvider,
  })({ token: input.token, runId: input.runId });
  if (read.batch.cases.some((item) =>
    item.context.selectionPlanDigest !== input.expectedPlanDigest ||
    item.context.selectionTargetArtifactSha !== input.expectedArtifactSha ||
    item.context.selectionCatalogReleaseDigest !== input.expectedCatalogReleaseDigest)) {
    throw new Error("MOD D02 capture input differs from the maintenance plan pins");
  }
  const receipt = await input.captureDatabase.transaction(async (tx) => {
    const transactionIdentity = await tx.query<DatabaseIdentity>(
      `select session_user, current_user, current_database() as database_name,
              system_identifier::text as cluster_identifier,
              current_setting('log_parameter_max_length') as parameter_log_limit,
              role.rolsuper as is_superuser, role.rolbypassrls as bypass_rls
         from pg_catalog.pg_control_system(), pg_catalog.pg_roles role
        where role.rolname = session_user`,
    );
    if (transactionIdentity.rows.length !== 1 ||
        Object.entries(captureIdentity).some(([key, value]) =>
          transactionIdentity.rows[0]?.[key as keyof DatabaseIdentity] !== value)) {
      throw new Error("MOD D02 capture transaction changed database identity");
    }
    const result = await tx.query<{ receipt: unknown }>(
      `select parameter_catalog.capture_mod_d02_pre_activation_v2(
         $1, $2, $3, $4, $5, $6::jsonb, $7
       ) as receipt`,
      [input.runId, read.sessionId, hashLocalSessionToken(input.token), read.principalId, read.organizationId,
        JSON.stringify(read.batch), input.requestId],
    );
    const value = result.rows[0]?.receipt as Record<string, unknown> | undefined;
    if (!value || value.organizationId !== read.organizationId ||
        value.selectionRunId !== input.runId ||
        value.selectionProjectionDigest !== read.batch.selectionProjectionDigest ||
        value.caseCount !== read.batch.cases.length ||
        value.fullReport === null || typeof value.fullReport !== "object" ||
        (value.fullReport as Record<string, unknown>).available !== false) {
      throw new Error("MOD D02 capture receipt does not match the produced batch");
    }
    return value;
  });
  return {
    ...(receipt as Omit<OfflineModD02CaptureReceipt, "sourceIdentity" | "captureIdentity">),
    sourceIdentity,
    captureIdentity,
  };
}

/** The maintenance entry owns both roots, including when capture rejects. */
export async function captureOfflineModD02PreP11FromUrls(
  input: OfflineModD02CaptureFromUrlsInput,
): Promise<OfflineModD02CaptureReceipt> {
  const { sourceDatabaseUrl, captureDatabaseUrl, ...captureInput } = input;
  const sourceDatabase = createPostgresDatabase(sourceDatabaseUrl);
  let captureDatabase: ReturnType<typeof createPostgresDatabase> | undefined;
  try {
    captureDatabase = createPostgresDatabase(captureDatabaseUrl);
    return await captureOfflineModD02PreP11({
      ...captureInput,
      sourceDatabase,
      sourcePool: getRootPostgresPool(sourceDatabase)!,
      captureDatabase,
    });
  } finally {
    await Promise.all([sourceDatabase.close(), captureDatabase?.close()]);
  }
}
