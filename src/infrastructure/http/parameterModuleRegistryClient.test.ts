import { expect, expectTypeOf, it } from "vitest";
import type { ParameterModuleRegistryRepository } from "@/application/ports/ParameterModuleRegistryRepository";
import { createMockParameterModuleRegistryRepository } from "@/infrastructure/mock/mockParameterModuleRegistryRepository";
import { createApiClient } from "./apiClient";
import { createHttpParameterModuleRegistryRepository } from "./parameterModuleRegistryClient";

const retiredMethods = [
  "createOrganizationDriverSchema",
  "listOrganizationDriverSchemas",
  "updateOrganizationDriverSchema",
  "activateOrganizationDriverSchema",
  "previewOrganizationDriverSchemaDeprecation",
  "deprecateOrganizationDriverSchema",
  "getDiscoveryHints",
  "dismissCompatible",
  "restoreDismissedCompatible",
  "previewMapping",
  "createMapping",
  "deleteMapping",
  "recomputeBindings",
  "registerOrClaimDriver",
  "updateDriverRegistration",
  "updateDriverRegistrationDefault",
  "replayDriverPlacement"
] as const;

it.each([
  ["HTTP", createHttpParameterModuleRegistryRepository(createApiClient({ baseUrl: "" }))],
  ["mock", createMockParameterModuleRegistryRepository()]
])("omits retired identity and driver-schema methods from the %s public port", (_adapter, repository) => {
  expectTypeOf<Extract<keyof ParameterModuleRegistryRepository, typeof retiredMethods[number]>>()
    .toEqualTypeOf<never>();
  for (const method of retiredMethods) {
    expect(repository).not.toHaveProperty(method);
  }
});
