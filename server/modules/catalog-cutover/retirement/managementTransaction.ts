import type pg from "pg";

/** Caller owns the verified management lease, S7 session lock and rollback.
 * This preparation must run before any snapshot-producing query in the new
 * transaction. It is not an authority check or a Kernel transaction. */
export async function beginLegacyRetirementTransaction(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("begin isolation level serializable");
    await client.query("set local synchronous_commit=on");
    await client.query("set local timezone='UTC'");
    // Like P12, fence mapping/installer writers that do not take the S7 lock.
    // No SELECT may precede this statement and establish an older snapshot.
    await client.query(`lock table parameter_catalog.catalog_state,
      parameter_catalog.catalog_releases, parameter_catalog.catalog_materializations,
      parameter_catalog.legacy_identities, parameter_catalog.legacy_mapping_heads,
      parameter_catalog.legacy_mapping_versions in share mode nowait`);
  } catch {
    throw new Error("PCAT-UPG-LEGACY-LOGIN-TRANSACTION-PREPARE-FAILED");
  }
}
