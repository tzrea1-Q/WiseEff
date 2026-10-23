import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { CATALOG_ORGANIZATION_ID } from "@/application/parameter-catalog/fixtures";
import { createTestModuleRegistryRepository, createTestParameterTopologyRepository } from "@/test/harness";
import { OrganizationModuleGovernancePanel } from "./OrganizationModuleGovernancePanel";
import { ParameterAdminProvider } from "./ParameterAdminProvider";

describe("module taxonomy and subject authority", () => {
  it.each([
    { actor: "platform-admin", permissions: ["admin:access"], taxonomy: true, subjects: true },
    { actor: "platform-admin", permissions: [], taxonomy: false, subjects: true },
    { actor: "org-admin", permissions: ["admin:access"], taxonomy: true, subjects: true },
    { actor: "org-admin", permissions: [], taxonomy: false, subjects: true },
    { actor: "user", permissions: null, taxonomy: false, subjects: false },
    { actor: "agent", permissions: ["admin:access"], taxonomy: false, subjects: false }
  ])("keeps taxonomy permissions separate from subject authority for $actor ($taxonomy / $subjects)", async ({ actor, permissions, taxonomy, subjects }) => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const registry = { modules: [{ id: "business-one", name: "电源", parentId: null, sortOrder: 0,
      description: "", scope: "", importance: "medium" as const, kind: "business" as const,
      origin: "curated" as const, sourceKey: null, attributionSubjectId: null,
      effectiveImportance: "medium" as const, parameterCount: 0, definitionCount: 0 }], mappings: [], navigationOnly: true };
    render(<ParameterAdminProvider topology={createTestParameterTopologyRepository()}
      moduleRegistry={createTestModuleRegistryRepository({ getRegistry: vi.fn().mockResolvedValue(registry) })}>
      <OrganizationModuleGovernancePanel canonicalEnabled actor={actor as CatalogActorKind}
        sessionPermissions={permissions}
        catalog={ports.catalog} governance={ports.governance} organizationId={CATALOG_ORGANIZATION_ID} />
    </ParameterAdminProvider>);
    await screen.findByRole("button", { name: "查看模块：电源" });
    await screen.findByRole("list", { name: "规范主体列表" });
    if (taxonomy) {
      expect(screen.getByRole("button", { name: "新建模块" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "电源 更多操作" })).toBeVisible();
    } else {
      expect(screen.queryByRole("button", { name: "新建模块" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "电源 更多操作" })).not.toBeInTheDocument();
    }
    if (subjects) expect(screen.queryByText("此页仅可查看；登记主体和调整归属需要组织管理员权限。")).not.toBeInTheDocument();
    else expect(await screen.findByText("此页仅可查看；登记主体和调整归属需要组织管理员权限。")).toBeVisible();
  });
});
