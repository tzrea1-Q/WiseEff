import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageToolbar } from "./PageToolbar";

describe("PageToolbar", () => {
  it("separates scoped filters from utility actions", () => {
    render(
      <PageToolbar
        ariaLabel="参数筛选工具"
        leading={<input aria-label="搜索参数" />}
        filters={
          <>
            <button type="button">重要性</button>
            <button type="button">模块</button>
          </>
        }
        trailing={<button type="button">列设置</button>}
      />
    );

    const toolbar = screen.getByRole("toolbar", { name: "参数筛选工具" });

    expect(within(toolbar).getByRole("textbox", { name: "搜索参数" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "重要性" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "模块" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "列设置" })).toBeInTheDocument();
  });
});
