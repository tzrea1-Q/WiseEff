import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { collectConsistencyMeasurements } from "../../e2e/quality/consistency-collector";
import { requireCompactControlHeights } from "../../e2e/quality/consistency-assertions";
import { LibrarySelectFilter } from "../components/admin/LibrarySelectFilter";
import { Select, SelectTrigger, SelectValue } from "../components/ui/select";
import { declarationsFor, readStylesheet } from "./cssAssertions";
import { DataTable } from "../components/admin/DataTable";
import { ViewSwitch } from "../components/ui/view-switch";
import { AnalysisContextControls } from "../features/parameter-home/components/AnalysisContextControls";

describe("compact control measurement scope", () => {
  it("measures project scope as a compact filter rather than a view switch", () => {
    const { container } = render(<main>
      <AnalysisContextControls window="30d" dimension="project" projectScope={null}
        projectOptions={[{ value: "aurora", label: "Aurora" }]}
        onWindowChange={() => {}} onDimensionChange={() => {}} onProjectChange={() => {}} />
    </main>);
    for (const element of container.querySelectorAll("*")) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 120, element.hasAttribute("data-compact-control") ? 32 : 28);
      Object.defineProperty(element, "checkVisibility", { value: () => true });
    }
    const measurements = collectConsistencyMeasurements();
    expect(measurements.viewSwitches).toHaveLength(6);
    expect(measurements.viewSwitches.every((control) => control.role === "radio")).toBe(true);
    expect(measurements.filterControls).toEqual([expect.objectContaining({ role: "combobox", compactControl: "filter", height: 32 })]);
    expect(() => requireCompactControlHeights(measurements, "/parameter-home")).not.toThrow();
    expect(() => requireCompactControlHeights({
      ...measurements, filterControls: [{ ...measurements.filterControls[0], height: 28 }]
    }, "/parameter-home")).toThrow();
  });

  it("measures the home switch in the top bar as well as in-page switches", () => {
    const items = [{ value: "first", label: "第一项" }, { value: "second", label: "第二项" }];
    const { container } = render(<>
      <header className="topbar"><ViewSwitch variant="toggle" ariaLabel="工作台视图" value="first" items={items} onValueChange={() => {}} /></header>
      <main><ViewSwitch variant="toggle" ariaLabel="概览视角" value="first" items={items} onValueChange={() => {}} /></main>
    </>);
    for (const element of container.querySelectorAll("*")) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 120, 28);
      Object.defineProperty(element, "checkVisibility", { value: () => true });
    }
    const switches = collectConsistencyMeasurements().viewSwitches;
    expect(switches).toHaveLength(4);
    expect(switches.every((control) => control.role === "radio" && control.groupRole === "radiogroup")).toBe(true);
    expect(switches.filter((control) => control.selected)).toHaveLength(2);
  });

  it("ignores the live run's view switches, ordinary buttons, tree navigation and Xiaoze when validating a full result", () => {
    const { container } = render(<>
      <main>
        <button className="parameter-admin-scope-nav__tab" data-measured-height="43">参数</button>
        <div className="param-admin-audit-filters"><button className="chip chip-active" data-measured-height="30">审计</button></div>
        <button className="parameter-home__toggle-item" role="radio" aria-checked="true" data-measured-height="28">工作台</button>
        <button className="button subtle" data-measured-height="36">查看</button>
        <button className="parameter-catalog__tree-select" data-measured-height="40">模块</button>
        <button className="parameters-column-filter__trigger" data-measured-height="24">筛选模块</button>
        <select className="compact-filter-control" data-compact-control="filter"><option>项目</option></select>
        <button data-compact-control="pagination">下一页</button>
      </main>
      <button className="xiaoze-chat-toggle">小泽</button>
    </>);
    for (const element of container.querySelectorAll("*")) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 120, Number(element.getAttribute("data-measured-height") ?? 32));
      Object.defineProperty(element, "checkVisibility", { value: () => true });
    }
    const measurements = collectConsistencyMeasurements();
    expect(measurements.viewSwitches.map((control) => control.height)).toEqual([43, 30, 28]);
    expect(measurements.xiaozeLaunchers).toHaveLength(1);
    expect(measurements.filterControls).toEqual([expect.objectContaining({ compactControl: "filter", height: 32 })]);
    expect(() => requireCompactControlHeights(measurements, "/parameter-admin/specs")).not.toThrow();
  });

  it("marks pagination actions without adopting table-header sorts and preserves page changes", async () => {
    render(<DataTable rows={[{ name: "第一项" }, { name: "第二项" }]} rowKey={(row) => row.name}
      columns={[{ key: "name", header: "名称", render: (row) => row.name, sortAccessor: (row) => row.name }]} pageSize={1} />);
    const nextPage = screen.getByRole("button", { name: "下一页" });
    expect(nextPage).toHaveAttribute("data-compact-control", "pagination");
    expect(nextPage).toHaveClass("button", "subtle");
    expect(screen.getByRole("button", { name: "名称" })).not.toHaveAttribute("data-compact-control");
    await userEvent.click(nextPage);
    expect(screen.getByText("第二项")).toBeVisible();
    expect(nextPage).toBeDisabled();
  });

  it("opts native and custom filters into the same contract without changing dialog selects", () => {
    render(
      <main>
        <LibrarySelectFilter ariaLabel="状态筛选" value="all" options={[{ value: "all", label: "全部" }]} onChange={() => {}} />
        <Select value="all"><SelectTrigger aria-label="项目范围" size="filter"><SelectValue /></SelectTrigger></Select>
        <Select value="all"><SelectTrigger aria-label="对话框字段" size="sm"><SelectValue /></SelectTrigger></Select>
      </main>
    );
    const filters = document.querySelectorAll('[data-compact-control="filter"]');
    expect(filters).toHaveLength(2);
    for (const filter of filters) expect(filter).toHaveClass("compact-filter-control");
    expect(document.querySelector('[aria-label="对话框字段"]')).not.toHaveClass("compact-filter-control");
  });

  it("defines compact select geometry once using the PC tokens", () => {
    const styles = declarationsFor(readStylesheet("src/styles.css"), ".compact-filter-control");
    expect(styles.height).toBe("var(--space-8)");
    expect(styles["min-height"]).toBe("var(--space-8)");
    expect(styles["box-sizing"]).toBe("border-box");
    expect(styles["border-radius"]).toBe("var(--radius-sm)");
    expect(styles.border).toBe("1px solid var(--border)");
  });

  it("measures only explicitly marked filters, sort selects and pagination controls", () => {
    const { container } = render(
      <main>
        <select data-compact-control="filter" aria-label="项目筛选"><option>全部项目</option></select>
        <select data-compact-control="sort" aria-label="排序"><option>名称</option></select>
        <button data-compact-control="pagination" aria-label="下一页">下一页</button>
        <input role="combobox" aria-label="搜索" aria-controls="search-options" aria-expanded="false" />
        <div role="listbox" id="search-options" hidden />
        <button role="combobox" className="module-tree-trigger" aria-controls="module-options" aria-expanded="false">模块导航</button>
        <div role="tree" id="module-options" hidden />
        <select aria-label="普通表单字段"><option>字段值</option></select>
        <table><thead><tr><th aria-sort="none"><button>名称排序</button></th></tr></thead></table>
        <div role="dialog"><select aria-label="对话框字段"><option>字段值</option></select></div>
      </main>
    );
    for (const element of container.querySelectorAll("*")) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 120, 32);
      Object.defineProperty(element, "checkVisibility", { value: () => true });
    }
    const measurements = collectConsistencyMeasurements();
    expect(measurements.filterControls).toHaveLength(1);
    expect(measurements.sortControls).toHaveLength(1);
    expect(measurements.paginationControls).toHaveLength(1);
    expect(measurements.filterControls[0].dom).toBe("select");
    expect(measurements.filterControls[0].compactControl).toBe("filter");
    expect(measurements.sortControls[0].dom).toBe("select");
    expect(measurements.sortControls[0].compactControl).toBe("sort");
    expect(measurements.paginationControls[0].dom).toBe("button");
    expect(measurements.paginationControls[0].compactControl).toBe("pagination");
  });
});
