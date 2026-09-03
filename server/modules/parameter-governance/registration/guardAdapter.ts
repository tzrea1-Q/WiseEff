import type { CatalogReleasePin } from "../../parameter-catalog-contract/index";

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
  try {
    await client.query(ASSERT_CATALOG_SUBJECT_ACTIVE_SQL, [
      expectedRelease.id,
      expectedRelease.digest,
      subjectId,
      "active",
    ]);
    return { ok: true, value: true };
  } catch (error) {
    const mapped = mapGuardDatabaseError(error, expectedRelease, subjectId);
    if (mapped) return { ok: false, error: mapped };
    throw error;
  }
};
