import type { CatalogReleasePin } from "../../parameter-catalog-contract/index";
import {
  PARAMETER_GOVERNANCE_WRITER_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";

import type { RegistrationFailure } from "./failures";
import { mapGuardDatabaseError } from "./failures";
import type { Result } from "./result";

export type GuardClient = {
  query: (text: string, values?: readonly unknown[]) => Promise<unknown>;
};

export const ASSERT_CATALOG_SUBJECT_ACTIVE_SQL =
  "select parameter_catalog.assert_catalog_subject_active($1,$2,$3,$4)";

export const assertCatalogSubjectActive = async (
  client: GuardClient,
  expectedRelease: CatalogReleasePin,
  subjectId: string,
): Promise<Result<true, RegistrationFailure>> => {
  await client.query("savepoint catalog_subject_guard");
  try {
    await client.query(`set local role ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)}`);
    await client.query(ASSERT_CATALOG_SUBJECT_ACTIVE_SQL, [
      expectedRelease.id,
      expectedRelease.digest,
      subjectId,
      "active",
    ]);
    await client.query("rollback to savepoint catalog_subject_guard");
    return { ok: true, value: true };
  } catch (error) {
    await client.query("rollback to savepoint catalog_subject_guard").catch(() => undefined);
    const mapped = mapGuardDatabaseError(error, expectedRelease, subjectId);
    if (mapped) return { ok: false, error: mapped };
    throw error;
  }
};
