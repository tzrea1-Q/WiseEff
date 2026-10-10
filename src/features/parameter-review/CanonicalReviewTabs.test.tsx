import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { CanonicalProjectValueReviewPanel } from "./CanonicalProjectValueReviewPanel";
import { CanonicalMemberRemovalReviewPanel } from "./CanonicalMemberRemovalReviewPanel";

afterEach(cleanup);

describe("canonical review and submission tabs", () => {
  it.each([false, true])("links separate keyboard-accessible pending/history panels (mineOnly=%s)", async (mineOnly) => {
    const user = userEvent.setup();
    const repository = {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] }),
      reviewProjectValueChangeRequest: vi.fn(),
      listMemberRemovalRequests: vi.fn().mockResolvedValue({ items: [] }),
      getMemberRemovalRequest: vi.fn()
    } as unknown as ParameterCatalogRepository;
    render(<>
      <CanonicalProjectValueReviewPanel projectId="project-1" repository={repository} currentUserId="reviewer" mineOnly={mineOnly} />
      <CanonicalMemberRemovalReviewPanel projectId="project-1" repository={repository} currentUserId="reviewer" mineOnly={mineOnly} />
    </>);
    await screen.findByText("当前没有成员删除请求。");
    const panelIds = new Set<string>();
    for (const name of [mineOnly ? "我的参数提交视角" : "软件配置审核视角", "成员删除视角"]) {
      const tabs = screen.getByRole("tablist", { name });
      const pending = within(tabs).getByRole("tab", { name: "待审核" });
      const history = within(tabs).getByRole("tab", { name: "历史" });
      pending.focus();
      await user.keyboard("{End}");
      expect(history).toHaveFocus();
      expect(pending).toHaveAttribute("aria-selected", "true");
      await user.keyboard("{Enter}");
      expect(history).toHaveAttribute("aria-selected", "true");
      for (const tab of [pending, history]) {
        const panelId = tab.getAttribute("aria-controls")!;
        const panel = document.getElementById(panelId);
        expect(panel).toHaveAttribute("role", "tabpanel");
        expect(panel).toHaveAttribute("aria-labelledby", tab.id);
        expect(panelIds.has(panelId)).toBe(false);
        panelIds.add(panelId);
        if (tab === pending) {
          expect(panel).not.toBeVisible();
          expect(panel).not.toHaveAttribute("tabindex");
        } else {
          expect(panel).toBeVisible();
          history.focus();
          await user.tab();
          if (name === "成员删除视角") {
            expect(panel).not.toHaveAttribute("tabindex");
            expect(within(panel!).getByRole("button", { name: "刷新成员删除结果" })).toHaveFocus();
          } else {
            expect(panel).toHaveAttribute("tabindex", "0");
            expect(panel).toHaveFocus();
          }
        }
      }
    }
  });
});
