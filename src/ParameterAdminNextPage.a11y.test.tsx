import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { ParameterAdminNextPage } from "./ParameterAdminNextPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/parameter-admin");
});

function createRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return {
    listSpecs: vi.fn().mockResolvedValue([
      {
        id: "spec-sc8562-gpio-int",
        organizationId: "org-teaching",
        sourceKind: "dts",
        specificationKey: "dts/sc8562/gpio_int",
        propertyKey: "gpio_int",
        driverModule: "sc8562",
        lifecycle: "active",
        currentVersionId: "specver-1",
        currentVersion: 1
      }
    ]),
    getSpec: vi.fn().mockResolvedValue({
      id: "spec-sc8562-gpio-int",
      organizationId: "org-teaching",
      sourceKind: "dts",
      specificationKey: "dts/sc8562/gpio_int",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      lifecycle: "active",
      currentVersionId: "specver-1",
      currentVersion: 1,
      displayName: "gpio_int",
      description: null,
      valueShape: { kind: "cells" },
      schemaDefault: null,
      exampleValue: null,
      schemaNamespace: "vendor,sc8562/bindings",
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: ["vendor,sc8562"],
      policyTarget: null
    }),
    listSpecReviewTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    activateParameterSpec: vi.fn(),
    updateParameterSpec: vi.fn(),
    deprecateParameterSpec: vi.fn(),
    restoreParameterSpec: vi.fn(),
    listBindings: vi.fn().mockResolvedValue([]),
    getTopology: vi.fn(),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    listConfigRevisions: vi.fn().mockResolvedValue([]),
    validateRevision: vi.fn(),
    createBindingDraft: vi.fn(),
    ...overrides
  };
}

describe("ParameterAdminNextPage · a11y", () => {

  it("项目运营目的地有可访问的区域标题", () => {
    render(
      <ToastProvider>
        <ParameterAdminNextPage
          area="projects"
          onNavigate={() => {}}
          search=""
          pathname="/parameter-admin/projects"
          parameterTopologyRepository={createRepository()}
          dispatch={() => undefined}
          state={
            {
              configDraft: { projects: [{ id: "aurora", name: "Aurora", code: "AUR" }] },
              parameters: [],
              activeProjectId: "aurora",
              activeRoleId: "admin",
              projectInitializationStatuses: { aurora: "initialized" }
            } as never
          }
        />
      </ToastProvider>
    );

    expect(screen.getByRole("navigation", { name: "参数管理后台配置范围" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目运营" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目清单" })).toBeInTheDocument();
  });
});
