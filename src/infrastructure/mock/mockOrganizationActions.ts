import type { OrganizationActions, OrganizationRecord } from "@/OrganizationPage";

const defaultOrganization: OrganizationRecord = {
  id: "org-chargelab",
  name: "ChargeLab",
  createdAt: "2026-01-15T00:00:00.000Z"
};

export function createMockOrganizationActions(
  initial: OrganizationRecord = defaultOrganization
): OrganizationActions {
  let current = { ...initial };
  return {
    async getOrganization() {
      return { ...current };
    },
    async updateOrganization(input) {
      const name = input.name.trim();
      if (!name) {
        throw new Error("显示名称不能为空。");
      }
      current = { ...current, name };
      return { ...current };
    }
  };
}
