import { CATALOG_PUBLICATION_COORDINATOR_ROLE, quoteIdent } from "../catalog-kernel/security/catalogRoleManifest";
import type { Database } from "../../shared/database/client";

export async function withPublicationCoordinator<T>(
  db: Database,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
    return fn(tx);
  });
}
