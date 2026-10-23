import type { z } from "zod";
import { administratorRecoverySchema, createPlatformOrganizationSchema, platformOrganizationSchema, recoverOrganizationAdministratorSchema, experienceRegistrationSchema, updateExperienceRegistrationSchema } from "@wiseeff/dto-schemas";
import { createDefaultApiClient } from "./defaultApiClient";
import { parseContractDto } from "./parseContractDto";

export type PlatformOrganization = z.infer<typeof platformOrganizationSchema>;
export type CreatePlatformOrganizationInput = z.infer<typeof createPlatformOrganizationSchema>;
export type AdministratorRecovery = z.infer<typeof administratorRecoverySchema>;
export type RecoverOrganizationAdministratorInput = z.infer<typeof recoverOrganizationAdministratorSchema>;
export type PlatformOrganizationsClient = ReturnType<typeof createPlatformOrganizationsClient>;
export function createPlatformOrganizationsClient(api = createDefaultApiClient()) {
  return {
    async getExperienceRegistration() {
      const response = await api.get<{ item: unknown }>("/api/v1/platform/experience-registration");
      return parseContractDto(experienceRegistrationSchema, response.item, "ExperienceRegistration");
    },
    async updateExperienceRegistration(input: z.infer<typeof updateExperienceRegistrationSchema>) {
      const response = await api.patch<{ item: unknown }>("/api/v1/platform/experience-registration", input);
      return parseContractDto(experienceRegistrationSchema, response.item, "ExperienceRegistration");
    },
    async list(query = "") {
      const response = await api.get<{ items: unknown }>(`/api/v1/platform/organizations${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      return parseContractDto(platformOrganizationSchema.array(), response.items, "PlatformOrganizationList");
    },
    async get(organizationId: string) {
      const response = await api.get<{ item: unknown }>(`/api/v1/platform/organizations/${encodeURIComponent(organizationId)}`);
      return parseContractDto(platformOrganizationSchema, response.item, "PlatformOrganization");
    },
    async changeLifecycle(organization: Pick<PlatformOrganization, "id" | "status">, status: PlatformOrganization["status"]) {
      const response = await api.patch<{ item: unknown }>(`/api/v1/platform/organizations/${encodeURIComponent(organization.id)}/lifecycle`, { status, expectedStatus: organization.status });
      return parseContractDto(platformOrganizationSchema, response.item, "PlatformOrganization");
    },
    async create(input: CreatePlatformOrganizationInput) {
      const response = await api.post<{ item: unknown }>("/api/v1/platform/organizations", input);
      return parseContractDto(platformOrganizationSchema, response.item, "PlatformOrganization");
    },
    async getAdministratorRecovery(organizationId: string) {
      return parseContractDto(administratorRecoverySchema, await api.get(`/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/administrator-recovery`), "AdministratorRecovery");
    },
    async recoverAdministrator(organizationId: string, input: RecoverOrganizationAdministratorInput) {
      const response = await api.post<{ item: unknown }>(`/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/administrator-recovery`, input);
      return parseContractDto(platformOrganizationSchema, response.item, "PlatformOrganization");
    },
    async emergencyDisableAdministrator(organizationId: string, userId: string, reason: string) {
      const response = await api.post<{ item: unknown }>(`/api/v1/platform/organizations/${encodeURIComponent(organizationId)}/administrators/${encodeURIComponent(userId)}/emergency-disable`, { reason });
      return parseContractDto(platformOrganizationSchema, response.item, "PlatformOrganization");
    }
  };
}
