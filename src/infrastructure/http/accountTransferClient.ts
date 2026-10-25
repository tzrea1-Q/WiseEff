import type { z } from "zod";
import { accountTransferPreviewSchema, accountTransferRequestSchema } from "@wiseeff/dto-schemas";
import { createDefaultApiClient } from "./defaultApiClient";
import { parseContractDto } from "./parseContractDto";
import { createPlatformOrganizationsClient } from "./platformOrganizationsClient";

export type AccountTransferPreview = z.infer<typeof accountTransferPreviewSchema>;
export type AccountTransferInput = z.infer<typeof accountTransferRequestSchema>;
export type AccountTransferClient = {
  listTargets(): Promise<Array<{ id: string; name: string }>>;
  preview(userId: string, targetOrganizationId: string): Promise<AccountTransferPreview>;
  transfer(userId: string, input: AccountTransferInput): Promise<unknown>;
};
export function createAccountTransferClient(sourceOrganizationId: string, api = createDefaultApiClient()): AccountTransferClient {
  const path = (userId: string) => `/api/v1/platform/organizations/${encodeURIComponent(sourceOrganizationId)}/members/${encodeURIComponent(userId)}/transfer`;
  return {
    async listTargets() { return (await createPlatformOrganizationsClient(api).list()).filter(org => org.id !== sourceOrganizationId && org.status === "active"); },
    async preview(userId, targetOrganizationId) {
      const result = await api.post<{ item: unknown }>(`${path(userId)}-preview`, { targetOrganizationId });
      return parseContractDto(accountTransferPreviewSchema, result.item, "AccountTransferPreview");
    },
    transfer(userId, input) { return api.post(path(userId), input); }
  };
}
