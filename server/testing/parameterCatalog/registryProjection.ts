import type pg from "pg";

import type { CatalogSubjectId } from "../../modules/parameter-catalog-contract/index";
import { installRegistryProjectionCatalogFixture } from "../../modules/catalog-kernel/runtime/catalogChain.fixture";
import { createRegistrationService } from "../../modules/parameter-governance/registration/index";

export async function installParameterModuleRegistryProjectionFixture(pool: pg.Pool) {
  return installRegistryProjectionCatalogFixture(pool);
}

type RegistryProjectionFixture = Awaited<ReturnType<typeof installParameterModuleRegistryProjectionFixture>>;

export async function registerParameterModuleRegistryProjectionDriver(
  pool: pg.Pool,
  input: {
    organizationId: string;
    subjectId: CatalogSubjectId;
    destinationModuleId: string;
    release: RegistryProjectionFixture["pin"];
  },
) {
  const registration = await createRegistrationService(pool).execute({
    kind: "register",
    organizationId: input.organizationId,
    subjectId: input.subjectId,
    subjectKind: "driver",
    expectedRelease: input.release,
    placement: { mode: "use-default" },
    destinationModuleId: input.destinationModuleId,
    method: "explicit",
    proof: { reason: "Issue 897 canonical registry fixture" },
    idempotencyKey: "registration-897-canonical",
    context: { actorKind: "org-admin", principalId: "issue-897-fixture" },
  });
  if (!registration.ok) throw new Error(JSON.stringify(registration.error));
  return registration.value.registrationId;
}
