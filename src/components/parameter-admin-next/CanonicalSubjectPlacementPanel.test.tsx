import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_ORGANIZATION_ID,
  CATALOG_RELEASE_ID,
  activeDefinition,
  readyCatalogDocument,
  registeredSubject,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import type { CatalogListQuery } from "@/infrastructure/http/parameterCatalogDtos";

import { CanonicalSubjectPlacementPanel } from "./CanonicalSubjectPlacementPanel";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function subject(
  overrides: Partial<typeof unregisteredSubject> & { id: string; canonicalName: string }
) {
  return {
    ...unregisteredSubject,
    ...overrides,
    membership: { status: "active" as const, catalogReleaseId: CATALOG_RELEASE_ID },
    registration: { status: "unregistered" as const },
    definitionCounts: { active: 1, deprecated: 0, retired: 0 }
  };
}

function module(id: string, name: string, kind: ParameterModule["kind"]): ParameterModule {
  return {
    id,
    name,
    parentId: null,
    sortOrder: 0,
    description: "",
    scope: "organization",
    importance: "medium",
    kind,
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "medium",
    parameterCount: 0,
    definitionCount: 0
  };
}

function createPorts() {
  const driver = {
    ...registeredSubject,
    id: "subject-driver",
    canonicalName: "vendor,driver",
    registration: {
      ...registeredSubject.registration,
      id: "registration-driver",
      placement: {
        ...registeredSubject.registration.placement,
        moduleId: "issue897-driver-a"
      }
    }
  };
  const node = subject({
    id: "subject-node",
    type: "node-type",
    canonicalName: "vendor,node"
  });
  const configuration = subject({
    id: "subject-config",
    type: "configuration-schema",
    canonicalName: "vendor,configuration"
  });
  const secondDefinition = {
    ...activeDefinition,
    id: "definition-extra-119",
    propertyKey: "extra_119",
    subject: {
      ...activeDefinition.subject,
      id: driver.id,
      canonicalName: driver.canonicalName
    }
  };
  const subjectQueries: CatalogListQuery[] = [];
  const definitionQueries: CatalogListQuery[] = [];
  const listSubjects = vi.fn(async (query?: CatalogListQuery) => {
    subjectQueries.push(query ?? {});
    if (query?.cursor === "subjects-2") {
      return {
        items: [configuration],
        totalCount: 3,
        hasMore: false,
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      };
    }
    return {
      items: [driver, node],
      totalCount: 3,
      hasMore: true,
      nextCursor: "subjects-2",
      catalogReleaseId: CATALOG_RELEASE_ID
    };
  });
  const listDefinitions = vi.fn(async (query?: CatalogListQuery) => {
    definitionQueries.push(query ?? {});
    if (query?.cursor === "definitions-2") {
      return {
        items: [secondDefinition],
        totalCount: 2,
        hasMore: false,
        nextCursor: null,
        catalogReleaseId: CATALOG_RELEASE_ID
      };
    }
    if (query?.subjectId === driver.id) {
      return {
        items: [
          {
            ...activeDefinition,
            subject: {
              ...activeDefinition.subject,
              id: driver.id,
              canonicalName: driver.canonicalName
            }
          }
        ],
        totalCount: 2,
        hasMore: true,
        nextCursor: "definitions-2",
        catalogReleaseId: CATALOG_RELEASE_ID
      };
    }
    return {
      items: [],
      totalCount: 0,
      hasMore: false,
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    };
  });
  const catalog = {
    getCatalog: vi.fn(async () => readyCatalogDocument),
    listSubjects,
    listDefinitions
  } as unknown as ParameterCatalogRepository;
  const listRegistrations = vi.fn(async () => ({
    items: [
      {
        id: "registration-driver",
        organizationId: CATALOG_ORGANIZATION_ID,
        subjectId: driver.id,
        status: "active" as const,
        method: "explicit" as const,
        placement: {
          id: "placement-driver",
          displayName: "Driver A",
          parentPlacementId: null,
          moduleId: "issue897-driver-a"
        },
        catalogReleaseId: CATALOG_RELEASE_ID
      }
    ],
    totalCount: 1,
    hasMore: false,
    nextCursor: null,
    catalogReleaseId: CATALOG_RELEASE_ID
  }));
  const createRegistration = vi.fn(async () => ({
    item: {
      id: "registration-node",
      organizationId: CATALOG_ORGANIZATION_ID,
      subjectId: node.id,
      status: "active" as const,
      method: "explicit" as const,
      placement: {
        id: "placement-node",
        displayName: "Node",
        parentPlacementId: null,
        moduleId: "issue897-node"
      },
      catalogReleaseId: CATALOG_RELEASE_ID
    }
  }));
  const getRegistration = vi.fn(async () => ({
    item: {
      id: "registration-driver",
      organizationId: CATALOG_ORGANIZATION_ID,
      subjectId: driver.id,
      status: "active" as const,
      method: "explicit" as const,
      placement: {
        id: "placement-driver",
        displayName: "Driver A",
        parentPlacementId: null,
        moduleId: "issue897-driver-a"
      },
      catalogReleaseId: CATALOG_RELEASE_ID,
      impact: { bindingCount: 1, projectCount: 1 }
    }
  }));
  const getPlacement = vi.fn(async () => ({
    item: {
      id: "placement-driver",
      displayName: "Driver A",
      parentPlacementId: null,
      moduleId: "issue897-driver-a"
    },
    etag: "etag-driver"
  }));
  const updatePlacement = vi.fn(async () => ({
    item: {
      id: "placement-driver",
      displayName: "Driver B",
      parentPlacementId: null,
      moduleId: "issue897-driver-b"
    },
    etag: "etag-driver-b"
  }));
  const governance = {
    listRegistrations,
    createRegistration,
    getRegistration,
    getPlacement,
    updatePlacement
  } as unknown as ParameterCatalogGovernanceRepository;

  return {
    catalog,
    governance,
    listSubjects,
    listRegistrations,
    createRegistration,
    getRegistration,
    getPlacement,
    updatePlacement,
    subjectQueries,
    definitionQueries,
    modules: [
      module("issue897-driver-a", "Driver A", "driver-group"),
      module("issue897-driver-b", "Driver B", "driver-group"),
      module("issue897-node", "Node", "node-type"),
      module("issue897-config", "Configuration", "business")
    ]
  };
}

describe("CanonicalSubjectPlacementPanel", () => {
  it("loads all subject pages, keeps identity visible, and loads all active definitions", async () => {
    const ports = createPorts();
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    expect(await screen.findByText("vendor,configuration")).toBeInTheDocument();
    expect(screen.getAllByText("Driver").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NodeType").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ConfigurationSchema").length).toBeGreaterThan(0);
    expect(ports.subjectQueries).toEqual([
      { catalogReleaseId: CATALOG_RELEASE_ID, limit: 100 },
      { catalogReleaseId: CATALOG_RELEASE_ID, limit: 100, cursor: "subjects-2" }
    ]);

    const driverRow = screen.getByRole("listitem", { name: /vendor,driver/ });
    await userEvent.setup().click(within(driverRow).getByRole("button", { name: "查看参数" }));
    expect(await within(driverRow).findByText("extra_119")).toBeInTheDocument();
    expect(ports.definitionQueries).toEqual([
      {
        subjectId: "subject-driver",
        lifecycle: "active",
        catalogReleaseId: CATALOG_RELEASE_ID,
        limit: 100
      },
      {
        subjectId: "subject-driver",
        lifecycle: "active",
        catalogReleaseId: CATALOG_RELEASE_ID,
        limit: 100,
        cursor: "definitions-2"
      }
    ]);
  });

  it("registers an unregistered subject with the selected real module ID", async () => {
    const ports = createPorts();
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    const nodeRow = await screen.findByRole("listitem", { name: /vendor,node/ });
    const user = userEvent.setup();
    await user.click(within(nodeRow).getByRole("button", { name: "登记主体：vendor,node" }));
    expect(screen.getByRole("button", { name: "继续确认" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("目标模块"), "issue897-node");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirmation = await screen.findByRole("dialog", { name: "确认登记主体" });
    await user.click(within(confirmation).getByRole("checkbox"));
    await user.click(within(confirmation).getByRole("button", { name: "确认登记" }));

    await waitFor(() => expect(ports.createRegistration).toHaveBeenCalledTimes(1));
    expect(ports.createRegistration.mock.calls[0]?.[1]).toMatchObject({
      subjectId: "subject-node",
      placement: { mode: "use-default" },
      destinationModuleId: "issue897-node"
    });
    expect(ports.createRegistration.mock.calls[0]?.[2]).toMatchObject({
      catalogReleaseId: CATALOG_RELEASE_ID,
      idempotencyKey: expect.any(String)
    });
  });

  it("reads an ETag before changing a registered subject's module", async () => {
    const ports = createPorts();
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    const driverRow = await screen.findByRole("listitem", { name: /vendor,driver/ });
    const user = userEvent.setup();
    await user.click(
      within(driverRow).getByRole("button", { name: "调整归属：vendor,driver" })
    );
    await waitFor(() => expect(ports.getPlacement).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      "registration-driver"
    ));
    expect(ports.getRegistration).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      "registration-driver"
    );
    expect(screen.getByText(/14 个有效定义、1 个当前 Binding、1 个项目/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("目标模块"), "issue897-driver-b");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirmation = await screen.findByRole("dialog", { name: "确认调整放置" });
    await user.click(within(confirmation).getByRole("checkbox"));
    await user.click(within(confirmation).getByRole("button", { name: "确认调整放置" }));

    await waitFor(() => expect(ports.updatePlacement).toHaveBeenCalledTimes(1));
    expect(ports.updatePlacement.mock.calls[0]).toEqual([
      CATALOG_ORGANIZATION_ID,
      "registration-driver",
      {
        placement: { mode: "use-default" },
        destinationModuleId: "issue897-driver-b"
      },
      {
        catalogReleaseId: CATALOG_RELEASE_ID,
        idempotencyKey: expect.any(String),
        ifMatch: "etag-driver"
      }
    ]);
  });

  it("blocks placement changes when a registered subject has no canonical impact", async () => {
    const ports = createPorts();
    ports.getRegistration.mockResolvedValueOnce({
      item: {
        id: "registration-driver",
        organizationId: CATALOG_ORGANIZATION_ID,
        subjectId: "subject-driver",
        status: "active",
        method: "explicit",
        placement: {
          id: "placement-driver",
          displayName: "Driver A",
          parentPlacementId: null,
          moduleId: "issue897-driver-a"
        },
        catalogReleaseId: CATALOG_RELEASE_ID
      }
    } as never);
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    const driverRow = await screen.findByRole("listitem", { name: /vendor,driver/ });
    await userEvent.setup().click(
      within(driverRow).getByRole("button", { name: "调整归属：vendor,driver" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("当前主体缺少影响数据");
    expect(screen.queryByLabelText("目标模块")).not.toBeInTheDocument();
    expect(ports.updatePlacement).not.toHaveBeenCalled();
  });

  it("keeps retired subjects visible but read-only", async () => {
    const ports = createPorts();
    const retiredSubject = {
      ...subject({ id: "subject-retired", canonicalName: "vendor,retired" }),
      membership: { status: "retired" as const, catalogReleaseId: CATALOG_RELEASE_ID },
      registration: {
        status: "retired" as const,
        id: "registration-retired",
        method: "explicit" as const,
        placement: {
          id: "placement-retired",
          displayName: "Driver A",
          parentPlacementId: null,
          moduleId: "issue897-driver-a"
        }
      }
    };
    ports.listSubjects.mockReset();
    ports.listSubjects.mockResolvedValue({
      items: [retiredSubject],
      totalCount: 1,
      hasMore: false,
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    } as never);
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    const row = await screen.findByRole("listitem", { name: /vendor,retired/ });
    expect(within(row).queryByRole("button", { name: "登记主体：vendor,retired" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "调整归属：vendor,retired" })).not.toBeInTheDocument();
  });

  it("does not show a zero active count while canonical loading fails", async () => {
    const ports = createPorts();
    vi.spyOn(ports.catalog, "getCatalog").mockRejectedValueOnce(new Error("catalog unavailable"));
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/目录发布 未就绪。/)).toBeInTheDocument();
    expect(screen.queryByText(/个有效主体/)).not.toBeInTheDocument();
  });

  it("keeps an active subject read-only when its organization registration is retired", async () => {
    const ports = createPorts();
    ports.listRegistrations.mockResolvedValue({
      items: [
        {
          id: "registration-driver",
          organizationId: CATALOG_ORGANIZATION_ID,
          subjectId: "subject-driver",
          status: "retired" as const,
          method: "explicit" as const,
          placement: {
            id: "placement-driver",
            displayName: "Driver A",
            parentPlacementId: null,
            moduleId: "issue897-driver-a"
          },
          catalogReleaseId: CATALOG_RELEASE_ID
        }
      ],
      totalCount: 1,
      hasMore: false,
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    });
    render(
      <CanonicalSubjectPlacementPanel
        catalog={ports.catalog}
        governance={ports.governance}
        organizationId={CATALOG_ORGANIZATION_ID}
        actor="org-admin"
        canAdmin
        modules={ports.modules}
      />
    );

    const row = await screen.findByRole("listitem", { name: /vendor,driver/ });
    expect(within(row).queryByRole("button", { name: "调整归属：vendor,driver" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "规范模块统计" })).not.toBeInTheDocument();
  });
});
