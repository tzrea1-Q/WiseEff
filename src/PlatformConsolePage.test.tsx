import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformConsolePage } from "./PlatformConsolePage";

const repository = vi.hoisted(() => ({
  listPromotionHistory: vi.fn(),
  listPromotionCandidates: vi.fn(),
  promoteDriverSchemaOverlay: vi.fn(),
  revertDriverSchemaPromotion: vi.fn()
}));
vi.mock("@/application/parameters/driverSchemaPromotionResolve", () => ({
  resolveDriverSchemaPromotionRepository: () => repository
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Platform overlay retirement", () => {
  it("explains old bookmarks and preserves promotion records as read-only history", async () => {
    repository.listPromotionCandidates.mockResolvedValue({ items: [
      { compatible: "vendor,new", contributorOrganizationIds: ["org_one"], contributorCount: 1,
        propertyKeys: [], contributors: [], equivalent: true, hasActivePlatformOverlay: false },
      { compatible: "vendor,old", contributorOrganizationIds: ["org_one"], contributorCount: 1,
        propertyKeys: [], contributors: [], equivalent: true, hasActivePlatformOverlay: true,
        promotionIds: ["promotion_one"] }
    ] });
    repository.listPromotionHistory.mockResolvedValue({ items: [{
      id: "promotion_one", platformSchemaId: "platform_schema_one", sourceSchemaId: "org_schema_one",
      sourceOrganizationId: "org_one", promotedByUserId: "user_one",
      promotedAt: "2026-07-01T00:00:00.000Z", documentationSource: "preserved evidence"
    }] });
    render(<PlatformConsolePage />);
    expect(await screen.findByRole("heading", { name: "覆盖解析已退役" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往 Catalog" })).toHaveAttribute("href", "/parameter-admin/specs");
    expect(await screen.findByText("promotion_one")).toBeInTheDocument();
    expect(screen.getByText("org_schema_one")).toBeInTheDocument();
    expect(screen.getByText("preserved evidence")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /晋升|撤销|恢复/ })).not.toBeInTheDocument();
    expect(repository.listPromotionCandidates).not.toHaveBeenCalled();
    expect(repository.promoteDriverSchemaOverlay).not.toHaveBeenCalled();
    expect(repository.revertDriverSchemaPromotion).not.toHaveBeenCalled();
  });

  it("keeps the retired bookmark explanation when history is unavailable", async () => {
    repository.listPromotionHistory.mockRejectedValue(new Error("历史读取不可用"));
    render(<PlatformConsolePage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("历史读取不可用");
    expect(screen.getByRole("link", { name: "前往 Catalog" })).toHaveAttribute("href", "/parameter-admin/specs");
    expect(screen.queryByRole("button", { name: /晋升|撤销|恢复/ })).not.toBeInTheDocument();
  });
});
