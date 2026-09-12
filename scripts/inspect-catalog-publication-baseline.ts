import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const CATALOG_BASELINE_READONLY_ENV = "CATALOG_BASELINE_READONLY_DATABASE_URL";

const WRITE_PRIVILEGES = ["INSERT", "UPDATE", "DELETE"] as const;

const PROTECTED_RELATIONS = [
  "catalog_publication.release_artifacts",
  "catalog_publication.candidates",
  "catalog_publication.publication_authorizations",
  "catalog_publication.publication_jobs",
  "catalog_publication.publication_policies",
  "catalog_publication.publication_policy_revisions",
  "catalog_publication.publication_guard",
  "catalog_publication.publication_freeze",
  "parameter_catalog.catalog_activation_receipts",
  "parameter_catalog.catalog_releases",
  "parameter_catalog.catalog_state",
  "parameter_catalog.catalog_subjects",
  "parameter_catalog.parameter_definitions",
  "parameter_catalog.definition_revisions",
] as const;

export type BaselineCollectorFailure =
  | { readonly kind: "usage"; readonly message: string }
  | { readonly kind: "privilege"; readonly message: string; readonly grants: readonly string[] }
  | { readonly kind: "read-failed"; readonly message: string };

export type CatalogPublicationBaselineEvidence = {
  readonly kind: "catalog-publication-baseline-evidence";
  readonly insertsArtifact: false;
  readonly current: {
    readonly id: string;
    readonly digest: string;
    readonly version: string;
    readonly predecessorReleaseId: string | null;
  } | null;
  readonly receipts: readonly {
    readonly id: string;
    readonly kind: string;
    readonly releaseId: string;
    readonly releaseDigest: string;
  }[];
  readonly artifact: {
    readonly artifactDigest: string;
    readonly bytesChecksum: string;
    readonly sourceKind: string;
  } | null;
  readonly materializationFingerprint: string | null;
  readonly capabilityContractRevision: string | null;
  readonly publicationEnabled: boolean | null;
  readonly publicationFrozen: boolean | null;
  readonly receiptCount: number;
  readonly sha256: string;
};

const canonicalWithoutDigest = (
  evidence: Omit<CatalogPublicationBaselineEvidence, "sha256">,
): string => JSON.stringify(evidence);

const digestOf = (canonical: string): string =>
  `sha256:${createHash("sha256").update(canonical).digest("hex")}`;

export const redactSecrets = (value: string, dsn: string): string => {
  if (!dsn) return value;
  return value.split(dsn).join("[redacted-dsn]");
};

export const parseCollectorEnv = (
  env: NodeJS.Dict<string>,
): { ok: true; dsn: string } | { ok: false; error: BaselineCollectorFailure } => {
  const dsn = env[CATALOG_BASELINE_READONLY_ENV]?.trim() ?? "";
  if (!dsn) {
    return {
      ok: false,
      error: {
        kind: "usage",
        message: `${CATALOG_BASELINE_READONLY_ENV} is required. DATABASE_URL is not accepted.`,
      },
    };
  }
  return { ok: true, dsn };
};

export const assertReadOnlyPrivileges = async (
  client: pg.Client,
): Promise<{ ok: true } | { ok: false; error: BaselineCollectorFailure }> => {
  const grants: string[] = [];
  for (const relation of PROTECTED_RELATIONS) {
    for (const privilege of WRITE_PRIVILEGES) {
      const result = await client.query<{ allowed: boolean }>(
        `select has_table_privilege(current_user, $1, $2) as allowed`,
        [relation, privilege],
      );
      if (result.rows[0]?.allowed === true) {
        grants.push(`${relation}:${privilege}`);
      }
    }
  }
  if (grants.length > 0) {
    return {
      ok: false,
      error: {
        kind: "privilege",
        message: "read-only collector role must not have INSERT/UPDATE/DELETE on catalog or publication relations",
        grants,
      },
    };
  }
  return { ok: true };
};

export const collectCatalogPublicationBaseline = async (
  client: pg.Client,
): Promise<Omit<CatalogPublicationBaselineEvidence, "sha256">> => {
  await client.query("set transaction read only");
  const privileges = await assertReadOnlyPrivileges(client);
  if (!privileges.ok) {
    throw privileges.error;
  }

  const current = await client.query<{
    id: string;
    release_digest: string;
    release_version: string;
    predecessor_release_id: string | null;
  }>(
    `select
       release.id,
       release.release_digest,
       release.release_version,
       release.predecessor_release_id
     from parameter_catalog.catalog_state state
     join parameter_catalog.catalog_releases release
       on release.id = state.current_catalog_release_id`,
  );
  const currentRow = current.rows[0] ?? null;

  const receipts = await client.query<{
    id: string;
    kind: string;
    release_id: string;
    release_digest: string;
  }>(
    `select id, kind, release_id, release_digest
       from parameter_catalog.catalog_activation_receipts
      order by created_at, id`,
  );

  const artifact = currentRow
    ? await client.query<{
        artifact_digest: string;
        bytes_checksum: string;
        source_kind: string;
      }>(
        `select artifact_digest, bytes_checksum, source_kind
           from catalog_publication.release_artifacts
          where artifact_digest = $1`,
        [currentRow.release_digest],
      )
    : { rows: [] };

  const fingerprint = currentRow
    ? await client.query<{ compiled_fingerprint: string }>(
        `select compiled_fingerprint
           from parameter_catalog.catalog_materializations
          where release_id = $1`,
        [currentRow.id],
      )
    : { rows: [] };

  const policy = await client.query<{
    capability_contract_revision: string;
    publication_enabled: boolean;
  }>(
    `select capability_contract_revision, publication_enabled
       from catalog_publication.publication_policies
      where singleton`,
  );
  const freeze = await client.query<{ frozen: boolean }>(
    `select frozen from catalog_publication.publication_freeze where singleton`,
  );

  return {
    kind: "catalog-publication-baseline-evidence",
    insertsArtifact: false,
    current: currentRow
      ? {
          id: currentRow.id,
          digest: currentRow.release_digest,
          version: currentRow.release_version,
          predecessorReleaseId: currentRow.predecessor_release_id,
        }
      : null,
    receipts: receipts.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      releaseId: row.release_id,
      releaseDigest: row.release_digest,
    })),
    artifact: artifact.rows[0]
      ? {
          artifactDigest: artifact.rows[0].artifact_digest,
          bytesChecksum: artifact.rows[0].bytes_checksum,
          sourceKind: artifact.rows[0].source_kind,
        }
      : null,
    materializationFingerprint: fingerprint.rows[0]?.compiled_fingerprint ?? null,
    capabilityContractRevision: policy.rows[0]?.capability_contract_revision ?? null,
    publicationEnabled: policy.rows[0]?.publication_enabled ?? null,
    publicationFrozen: freeze.rows[0]?.frozen ?? null,
    receiptCount: receipts.rows.length,
  };
};

export const runInspectCatalogPublicationBaseline = async (
  env: NodeJS.Dict<string> = process.env,
): Promise<
  | { readonly ok: true; readonly evidence: CatalogPublicationBaselineEvidence }
  | { readonly ok: false; readonly error: BaselineCollectorFailure }
> => {
  const parsed = parseCollectorEnv(env);
  if (!parsed.ok) {
    return parsed;
  }
  const client = new pg.Client({ connectionString: parsed.dsn });
  try {
    await client.connect();
    await client.query("begin");
    try {
      const collected = await collectCatalogPublicationBaseline(client);
      const sha256 = digestOf(canonicalWithoutDigest(collected));
      await client.query("commit");
      return { ok: true, evidence: { ...collected, sha256 } };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (error && typeof error === "object" && "kind" in error) {
        return { ok: false, error: error as BaselineCollectorFailure };
      }
      const message = error instanceof Error ? error.message : "catalog-publication-baseline-read-failed";
      return {
        ok: false,
        error: { kind: "read-failed", message: redactSecrets(message, parsed.dsn) },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "catalog-publication-baseline-connect-failed";
    return {
      ok: false,
      error: { kind: "read-failed", message: redactSecrets(message, parsed.dsn) },
    };
  } finally {
    await client.end().catch(() => undefined);
  }
};

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  if (process.argv.slice(2).some((arg) => arg.includes("database-url") || arg === "--dsn")) {
    process.stderr.write("inspect-catalog-publication-baseline refuses DATABASE_URL flags\n");
    process.exitCode = 2;
  } else {
    runInspectCatalogPublicationBaseline()
      .then((result) => {
        if (!result.ok) {
          process.stderr.write(`${result.error.message}\n`);
          process.exitCode = result.error.kind === "usage" ? 2 : 1;
          return;
        }
        process.stdout.write(`${JSON.stringify(result.evidence)}\n`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      });
  }
}
