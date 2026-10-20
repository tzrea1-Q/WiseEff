import { expect, expectTypeOf, it, vi } from "vitest";
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

it("saves current recognition settings and reads them back from the registry", async () => {
  const settings = { compatibles: ["vendor,new-device"], driverNature: "logical-service" as const,
    instanceCardinality: "singleton-per-project" as const };
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("{}"))
    .mockResolvedValueOnce(Response.json({ item: { modules: [{ id: "driver", name: "Driver",
      kind: "driver-group", recognitionSubjectId: "subject", ...settings }], mappings: [] } }));
  const repository = createHttpParameterModuleRegistryRepository(createApiClient({ baseUrl: "", fetchImpl }));
  const registry = await repository.updateModule("driver", settings);
  expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/v1/parameter-modules/driver");
  expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual(settings);
  expect(registry.modules[0]).toMatchObject({ recognitionSubjectId: "subject", ...settings });
});

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
