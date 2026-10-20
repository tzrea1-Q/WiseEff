import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogAdminPage } from "./LogAdminPage";
import { createPrototypeState } from "./mockData";
import { createTestLogRuntimeActions } from "./test/harness";

afterEach(cleanup);

describe("log admin compact skills table", () => {
  it("uses the compact table with one secondary description and a separate operations cell", async () => {
    window.history.replaceState(null, "", "/log-admin?tab=skills");
    const skill = { id: "skill-1", name: "充电诊断", description: "用于充电日志的完整说明", status: "active" as const, createdAt: "2026-10-19", updatedAt: "2026-10-19" };
    render(<LogAdminPage state={{ ...createPrototypeState(), activeRoleId: "admin" }} dispatch={vi.fn()} onNavigate={vi.fn()} search=""
      logActions={createTestLogRuntimeActions({ listLogDomains: vi.fn().mockResolvedValue([skill]) })} />);
    const name = await screen.findByRole("link", { name: skill.name });
    const row = name.closest("tr")!;
    expect(row.closest("table")).toHaveClass("log-admin-skills-table");
    expect(within(row).getByTitle(skill.description)).toHaveClass("truncate");
    expect(within(row).getByTitle(skill.description).closest("td")).toContainElement(name);
    expect(within(row).getByRole("button", { name: "充电诊断：更多" }).closest("td")).not.toBe(name.closest("td"));
    expect(within(row).getAllByRole("cell")).toHaveLength(6);
  });
});
