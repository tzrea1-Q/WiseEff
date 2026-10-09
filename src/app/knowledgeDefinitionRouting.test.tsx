import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { getPageByPath } from "@/appConfig";
import { initialState } from "@/mockData";
import { ToastProvider } from "@/components/common/toast/ToastProvider";
import { activeDefinition, CATALOG_RELEASE_ID } from "@/application/parameter-catalog/fixtures";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";
import type { AppRuntime } from "./appRuntime";
import { canAccessPage } from "./permissions";
import { PageRouter } from "./routes";

describe("Knowledge Definition navigation", () => {
  it.each(["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin", "platform-admin"])("opens an authorized Definition destination for %s", async (roleId) => {
    const knowledgeRepository = createMockKnowledgeRepository();
    const entry = await knowledgeRepository.get("mock-kb-1");
    knowledgeRepository.get = async () => ({ ...entry!, parameterReferences: [{
      kind: "definition", definitionId: activeDefinition.id, availability: "current",
      propertyKey: activeDefinition.propertyKey, displayName: activeDefinition.currentRevision.displayName,
      driverModule: activeDefinition.subject.canonicalName, lifecycle: "active",
      createdByUserId: initialState.currentUserId, createdAt: "2026-10-09T00:00:00.000Z"
    }] });
    const ports = createMockCatalogPorts();
    const runtime = { knowledgeRepository, parameterCatalogRepository: ports.catalog,
      parameterCatalogGovernanceRepository: ports.governance } as AppRuntime;
    const navigate = vi.fn();
    function Session() {
      const [href, setHref] = useState("/knowledge?entryId=mock-kb-1");
      const url = new URL(href, "http://localhost");
      return <ToastProvider><PageRouter
        page={getPageByPath(url.pathname)} search={url.search}
        state={{ ...initialState, activeRoleId: roleId }} dispatch={() => undefined}
        runtime={runtime} runtimeMode="api" onNavigate={(path) => { navigate(path); setHref(path); }} onFeedback={() => undefined}
        knowledgeCapability={{ userId: initialState.currentUserId, canView: true, canEdit: false, canManage: false }}
        DebuggingAdminPage={() => null}
      /></ToastProvider>;
    }
    render(<Session />);
    await userEvent.setup().click(await screen.findByTitle(`查看参数定义 ${activeDefinition.propertyKey}`));
    const destination = new URL(navigate.mock.calls[0][0], "http://localhost");
    expect(destination.searchParams.get("definitionId")).toBe(activeDefinition.id);
    expect(canAccessPage(roleId, getPageByPath(destination.pathname).key)).toBe(true);
    const detail = await screen.findByRole("region", { name: "定义详情" });
    expect(screen.queryByRole("heading", { name: "无权访问该页面" })).not.toBeInTheDocument();
    if (roleId !== "admin" && roleId !== "platform-admin") {
      expect(within(detail).getByText(activeDefinition.propertyKey)).toBeInTheDocument();
      expect(destination.pathname).toBe("/parameters/definitions");
      expect(screen.getByRole("heading", { name: `查看 ${activeDefinition.propertyKey}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: `编辑 ${activeDefinition.propertyKey}` })).not.toBeInTheDocument();
      expect(within(detail).queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole("button", { name: "关闭定义详情" }));
      await waitFor(() => expect(new URL(navigate.mock.calls.at(-1)![0], "http://localhost").pathname)
        .toBe("/parameters/definitions"));
      const closedDestination = new URL(navigate.mock.calls.at(-1)![0], "http://localhost");
      expect(closedDestination.searchParams.get("catalogReleaseId")).toBe(CATALOG_RELEASE_ID);
      expect(closedDestination.searchParams.has("definitionId")).toBe(false);
    } else {
      expect(within(detail).getByDisplayValue(activeDefinition.propertyKey)).toBeInTheDocument();
      expect(destination.pathname).toBe("/parameter-admin/specs");
    }
  });
});
