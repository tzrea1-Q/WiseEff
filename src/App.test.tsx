import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import App from "./App";
import { initialState } from "./mockData";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

function expectSelectValue(trigger: HTMLElement, value: string) {
  expect(trigger).toHaveAttribute("data-value", value);
}

function changeSelectValue(trigger: HTMLElement, optionName: string | RegExp) {
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

function readCssBlock(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end);
}

describe("WiseEff app shell", () => {
  it("declares the WiseEff favicon assets in the document shell", () => {
    const indexHtml = readFileSync("index.html", "utf8");

    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/wiseeff-icon.svg" />');
    expect(indexHtml).toContain('<meta name="theme-color" content="#003D9B" />');
    expect(existsSync("public/favicon.svg")).toBe(true);
    expect(existsSync("public/wiseeff-icon.svg")).toBe(true);

    const favicon = readFileSync("public/favicon.svg", "utf8");
    const fullIcon = readFileSync("public/wiseeff-icon.svg", "utf8");

    expect(favicon).toContain('aria-label="WiseEff favicon"');
    expect(favicon).toContain("#003D9B");
    expect(favicon).toContain('stroke-linecap="round"');
    expect(favicon).not.toContain("wiseeff-icon-spark");

    expect(fullIcon).toContain('aria-label="WiseEff elastic path W icon"');
    expect(fullIcon).toContain("wiseeff-icon-spark");
    expect(fullIcon).toContain("#50DCFF");
  });

  it("renders the WiseEff platform homepage on the home route", () => {
    window.history.replaceState(null, "", "/");

    render(<App />);

    const homeRoot = document.querySelector(".linear-template-home");
    expect(screen.getByRole("main", { name: "WiseEff homepage" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(homeRoot).toBeInTheDocument();
    expect(homeRoot).toHaveClass("light-homepage");
    expect(homeRoot).toHaveAttribute("data-theme", "light");
    expect(homeRoot?.querySelector(".linear-logo-link .wiseeff-icon")).toBeInTheDocument();
    expect(homeRoot?.querySelector(".linear-logo-link .wiseeff-icon-spark")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "让业务流程更智能更高效" })).toBeInTheDocument();
    expect(screen.queryByText("智能参数管理")).not.toBeInTheDocument();
    expect(document.querySelector(".topbar")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("打开 WiseAgent")).not.toBeInTheDocument();
  });

  it("keeps the platform homepage inside the app scroll container", () => {
    window.history.replaceState(null, "", "/");

    render(<App />);

    expect(screen.getByRole("main", { name: "WiseEff homepage" }).closest(".main-content.home-content")).toBeInTheDocument();
  });

  it("routes platform homepage workbench entry links through the parameter homepage", () => {
    window.history.replaceState(null, "", "/");

    render(<App />);

    const homepageEntryLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/parameter-home"]')).filter(
      (link) => link.className.includes("linear-button") || link.closest(".linear-footer")
    );

    expect(homepageEntryLinks).toHaveLength(3);
    expect(document.querySelector('a[href="/parameters"]')).not.toBeInTheDocument();
  });

  it("adds a parameter management homepage without replacing the platform homepage", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App />);

    expect(screen.getByRole("main", { name: "参数管理首页" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "智能参数管理" })).not.toBeInTheDocument();
    expect(screen.queryByText("参数运营中枢")).not.toBeInTheDocument();
    expect(screen.getByText("热门模块")).toBeInTheDocument();
    expect(screen.getByText("关键参数变化")).toBeInTheDocument();
    expect(document.querySelector(".topbar")).toBeInTheDocument();
    const topbar = document.querySelector(".topbar") as HTMLElement;
    const topbarEntries = within(topbar).getByRole("navigation", { name: "参数管理快捷入口" });
    const timeWindowSelect = within(topbar).getByRole("combobox", { name: "时间范围" });
    const searchInput = within(topbar).getByRole("textbox", { name: "搜索" });

    expect(screen.queryByRole("button", { name: "进入 项目参数工作台" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入 参数合入审核" })).not.toBeInTheDocument();
    expect(within(topbarEntries).getByRole("button", { name: "项目参数工作台" })).toBeInTheDocument();
    expect(within(topbarEntries).getByRole("button", { name: "项目参数对比分析" })).toBeInTheDocument();
    expect(within(topbarEntries).getByRole("button", { name: "参数合入审核" })).toBeInTheDocument();
    expect(within(topbarEntries).getByRole("button", { name: "项目参数管理后台" })).toBeInTheDocument();
    expectSelectValue(timeWindowSelect, "30d");
    expect(topbar.querySelector(".topbar-actions")?.firstElementChild).toBe(topbarEntries);
    expect(
      Boolean(topbarEntries.compareDocumentPosition(timeWindowSelect) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    expect(
      Boolean(timeWindowSelect.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    expect(screen.getByRole("button", { name: "参数首页" })).toHaveClass("active");
  });

  it("updates parameter homepage analytics from the topbar time range selector", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App />);

    const topbar = document.querySelector(".topbar") as HTMLElement;
    const timeWindowSelect = within(topbar).getByRole("combobox", { name: "时间范围" });

    expect(screen.getByText(/近 30 天 ·/)).toBeInTheDocument();

    changeSelectValue(timeWindowSelect, "7天");

    expectSelectValue(timeWindowSelect, "7d");
    expect(screen.getByText(/近 7 天 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/近 30 天 ·/)).not.toBeInTheDocument();
  });

  it("keeps the WiseEff workbench shell on non-home routes", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    const workbenchBrand = document.querySelector(".brand-mark .wiseeff-icon");
    expect(workbenchBrand).toBeInTheDocument();
    expect(workbenchBrand).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("智效 WiseEff")).toBeInTheDocument();
    expect(document.querySelector(".topbar")).toBeInTheDocument();
    expect(screen.getByLabelText("打开 WiseAgent")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目参数用户工作台" })).toBeInTheDocument();
  });

  it("organizes the localized homepage around WiseEff workflow sections", () => {
    window.history.replaceState(null, "", "/");

    render(<App />);

    const homepage = screen.getByRole("main", { name: "WiseEff homepage" });

    expect(within(homepage).getByRole("heading", { name: "不是另一个后台系统" })).toBeInTheDocument();
    expect(within(homepage).getByRole("heading", { name: "参数流转，从查询到审阅" })).toBeInTheDocument();
    expect(within(homepage).getByRole("heading", { name: "日志分析，不只给结论" })).toBeInTheDocument();
    expect(within(homepage).getByRole("heading", { name: "调试动作，保留控制权" })).toBeInTheDocument();
    expect(within(homepage).queryByRole("heading", { name: "从一个场景，沉淀一套工作方式" })).not.toBeInTheDocument();
    expect(homepage.querySelector("#governance")).not.toBeInTheDocument();
    expect(homepage).toHaveTextContent("fast_charge_current_limit_ma");
    expect(homepage).toHaveTextContent("battery_pack_temp=46.8C");
    expect(homepage).toHaveTextContent("PRQ-9102");
    expect(homepage).toHaveTextContent("ChargeLab_X01");
  });

  it("links the localized homepage CTAs into the WiseEff parameter homepage", () => {
    window.history.replaceState(null, "", "/");

    render(<App />);

    expect(screen.getAllByRole("link", { name: /进入工作台|进入 WiseEff 工作台/ }).every((link) => link.getAttribute("href") === "/parameter-home")).toBe(true);
    expect(screen.getByRole("link", { name: "查看当前能力" })).toHaveAttribute("href", "#platform");
    expect(document.body).not.toHaveTextContent("Linear is a better way");
    expect(document.body).not.toHaveTextContent("Powering the world's best product teams.");
  });

  it("switches the hero stage carousel across WiseEff applications", () => {
    window.history.replaceState(null, "", "/");

    render(<App />);

    expect(screen.getByRole("heading", { name: "把参数差异变成可审阅变更" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一项 WiseEff 应用展示" }));
    expect(screen.getByRole("heading", { name: "把异常日志变成可追溯证据链" })).toBeInTheDocument();
    expect(screen.getByText("ANL-2405")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一项 WiseEff 应用展示" }));
    expect(screen.getByRole("heading", { name: "把现场调参变成受控执行流程" })).toBeInTheDocument();
    expect(screen.getByText("ChargeLab_X01 已连接")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "上一项 WiseEff 应用展示" }));
    expect(screen.getByRole("heading", { name: "把异常日志变成可追溯证据链" })).toBeInTheDocument();
  });

  it("pauses the hero stage auto rotation after manual carousel navigation", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "下一项 WiseEff 应用展示" }));
    expect(screen.getByRole("heading", { name: "把异常日志变成可追溯证据链" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(9600);
    });

    expect(screen.getByRole("heading", { name: "把异常日志变成可追溯证据链" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "把现场调参变成受控执行流程" })).not.toBeInTheDocument();
  });

  it("navigates from parameter homepage entries into parameter management routes", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App />);

    const topbar = document.querySelector(".topbar") as HTMLElement;
    const topbarEntries = within(topbar).getByRole("navigation", { name: "参数管理快捷入口" });

    fireEvent.click(within(topbarEntries).getByRole("button", { name: "项目参数工作台" }));
    expect(window.location.pathname).toBe("/parameters");

    window.history.replaceState(null, "", "/parameter-home");
    cleanup();
    render(<App />);

    const rerenderedTopbar = document.querySelector(".topbar") as HTMLElement;
    const rerenderedEntries = within(rerenderedTopbar).getByRole("navigation", { name: "参数管理快捷入口" });

    fireEvent.click(within(rerenderedEntries).getByRole("button", { name: "参数合入审核" }));
    expect(window.location.pathname).toBe("/parameter-review");
  });

  it("preserves contextual query strings when navigating from parameter homepage hotspots", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App />);

    const hotspotRegion = screen.getByRole("region", { name: "热门模块" });
    fireEvent.click(within(hotspotRegion).getAllByRole("button", { name: /进入/ })[0]);

    expect(["/parameters", "/parameter-review"]).toContain(window.location.pathname);
    expect(window.location.search).toMatch(/module=|project=/);
  });

  it("uses dropdown controls for project, importance, and module filters", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    const filters = screen.getByRole("complementary", { name: "参数筛选" });
    const getTableRow = (parameterName: string) =>
      Array.from(screen.getByRole("table").querySelectorAll<HTMLElement>("tbody tr")).find((row) =>
        row.textContent?.includes(parameterName)
      );
    const projectSelect = within(filters).getByRole("combobox", { name: "项目" });
    const importanceSelect = within(filters).getByRole("combobox", { name: "重要性" });
    const moduleSelect = within(filters).getByRole("combobox", { name: "模块" });

    expectSelectValue(projectSelect, "aurora");
    expectSelectValue(importanceSelect, "All");
    expectSelectValue(moduleSelect, "All");
    expect(within(filters).queryByRole("button", { name: /AUR-Prod/ })).not.toBeInTheDocument();
    expect(within(filters).queryByRole("button", { name: "高" })).not.toBeInTheDocument();
    expect(within(filters).queryByText(/当前筛选/)).not.toBeInTheDocument();

    changeSelectValue(moduleSelect, "Charging Policy");

    expect(within(screen.getByRole("table")).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("battery_health_guard_enable")).not.toBeInTheDocument();

    changeSelectValue(projectSelect, /NEB-RD/);

    expectSelectValue(projectSelect, "nebula");
    expectSelectValue(moduleSelect, "All");
    expect(getTableRow("fast_charge_current_limit_ma")).toHaveTextContent("4200");
  });

  it("exports the currently filtered project parameters as an Excel-readable file", async () => {
    window.history.replaceState(null, "", "/parameters");
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:project-parameters");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<App />);

    const filters = screen.getByRole("complementary", { name: "参数筛选" });
    changeSelectValue(within(filters).getByRole("combobox", { name: "模块" }), "Charging Policy");
    fireEvent.click(screen.getByRole("button", { name: "导出 Excel" }));

    const exportedBlob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsText(exportedBlob);
    });

    expect(exportedBlob.type).toContain("application/vnd.ms-excel");
    expect(exportedText).toContain("fast_charge_current_limit_ma");
    expect(exportedText).toContain("charge_voltage_limit_mv");
    expect(exportedText).not.toContain("battery_health_reserve_pct");
    expect(clickAnchor).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:project-parameters");
  });

  it("labels the parameter recommendation column as example", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    expect(screen.getByRole("columnheader", { name: "示例" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Recommended" })).not.toBeInTheDocument();
  });

  it("consumes parameter route context from query strings", () => {
    window.history.replaceState(
      null,
      "",
      "/parameters?project=nebula&module=Battery%20Safety&parameter=nebula-battery-temp-target"
    );

    render(<App />);

    const filters = screen.getByRole("complementary", { name: "参数筛选" });
    const projectSelect = within(filters).getByRole("combobox", { name: "项目" });
    const moduleSelect = within(filters).getByRole("combobox", { name: "模块" });
    const detailPanel = document.querySelector<HTMLElement>(".detail-panel");

    expectSelectValue(projectSelect, "nebula");
    expectSelectValue(moduleSelect, "Battery Safety");
    expect(within(screen.getByRole("table")).getByText("battery_temp_target_c")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
    expect(detailPanel).toHaveTextContent("battery_temp_target_c");
  });

  it("keeps the parameter example value aligned inside a normal table cell", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    const fastChargeRow = Array.from(screen.getByRole("table").querySelectorAll<HTMLTableRowElement>("tbody tr")).find(
      (row) => row.textContent?.includes("fast_charge_current_limit_ma")
    );
    const exampleCell = fastChargeRow?.querySelector<HTMLTableCellElement>("td.recommended");

    expect(exampleCell).toBeInTheDocument();
    expect(exampleCell?.firstElementChild).toHaveClass("value-change");
  });

  it("removes the parameter page header subtitle and submit-change shortcut", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    expect(screen.queryByText(/当前项目：/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交变更" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "提交参数修改请求" })).toBeInTheDocument();
  });

  it("opens a hidden personal submission history page from the parameter workbench", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    expect(screen.queryByRole("button", { name: "我的历史提交" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "历史提交" }));

    expect(window.location.pathname).toBe("/parameter-submissions");
    expect(screen.getByRole("heading", { name: "我的历史提交" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "我的历史提交" })).not.toBeInTheDocument();
  });

  it("submits a round with multiple parameter changes and shows it in personal history", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "加入本轮" }));

    const voltageRow = Array.from(screen.getByRole("table").querySelectorAll<HTMLTableRowElement>("tbody tr")).find((row) =>
      row.textContent?.includes("charge_voltage_limit_mv")
    );
    expect(voltageRow).toBeInTheDocument();
    fireEvent.click(voltageRow as HTMLTableRowElement);
    fireEvent.change(screen.getByLabelText("目标值"), { target: { value: "4310" } });
    fireEvent.click(screen.getByRole("button", { name: "加入本轮" }));

    expect(screen.getByText("本轮提交 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "提交参数修改请求" }));

    const dialog = screen.getByRole("dialog", { name: "提交本轮参数" });
    expect(within(dialog).getByText(/本轮提交包含\s*2\s*个参数修改/)).toBeInTheDocument();
    expect(within(dialog).getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(within(dialog).getByText("charge_voltage_limit_mv")).toBeInTheDocument();
    expect(within(dialog).getByText(/4310/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "确认提交本轮" }));
    fireEvent.click(screen.getByRole("button", { name: "历史提交" }));

    expect(screen.getByRole("heading", { name: "我的历史提交" })).toBeInTheDocument();
    expect(screen.getAllByText(/PRS-/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/本轮提交包含\s*2\s*个参数/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getByText("charge_voltage_limit_mv")).toBeInTheDocument();
  });

  it("opens a parameter comparison workspace from the compare action", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    expect(screen.queryByRole("button", { name: "对比参数" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "跨项目对比" }));

    expect(window.location.pathname).toBe("/parameter-comparison");
    expect(screen.getByRole("heading", { name: "项目参数对比分析" })).toBeInTheDocument();
    const comparisonControls = screen.getByRole("region", { name: "项目对比选择" });
    expectSelectValue(within(comparisonControls).getByRole("combobox", { name: "基准项目" }), "aurora");
    expectSelectValue(within(comparisonControls).getByRole("combobox", { name: "对比项目" }), "nebula");
    expect(comparisonControls.querySelector(".project-choice-card")).not.toBeInTheDocument();
    expect(comparisonControls).not.toHaveTextContent("当前选择 AUR-Prod，Aurora 量产平台");
    expect(comparisonControls).not.toHaveTextContent("当前选择 NEB-RD，Nebula 高频调试项目");
    expect(document.body).not.toHaveTextContent("生产 vs 预发");
    expect(document.body).not.toHaveTextContent("的充电、电池和电源管理参数差异分析。");
    expect(screen.queryByRole("button", { name: "同步选中项" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "参数对比摘要" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("对比范围");
    expect(document.body).not.toHaveTextContent("实际项目参数对比");
    expect(document.body).not.toHaveTextContent("漂移参数");
    expect(document.body).not.toHaveTextContent("需要审阅后同步");
    expect(document.body).not.toHaveTextContent("高重要性差异");
    expect(document.body).not.toHaveTextContent("WiseAgent 已生成风险说明");
    expect(screen.getByText("参数差异矩阵")).toBeInTheDocument();
    expect(screen.getAllByText("fast_charge_current_limit_ma").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("打开 WiseAgent")).toBeInTheDocument();
    expect(screen.queryByText("WiseAgent 洞察")).not.toBeInTheDocument();
  });

  it("exports the project comparison matrix as an Excel-readable file", async () => {
    window.history.replaceState(null, "", "/parameter-comparison");
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:comparison-parameters");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickAnchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    const exportedBlob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsText(exportedBlob);
    });

    expect(exportedBlob.type).toContain("application/vnd.ms-excel");
    expect(exportedText).toContain("fast_charge_current_limit_ma");
    expect(exportedText).toContain("AUR-Prod");
    expect(exportedText).toContain("NEB-RD");
    expect(exportedText).toContain("参数含义");
    expect(clickAnchor).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:comparison-parameters");
  });

  it("compares parameter values between two real projects without percent importance drift", () => {
    window.history.replaceState(null, "", "/parameter-comparison");

    render(<App />);

    const comparisonControls = screen.getByRole("region", { name: "项目对比选择" });
    const getComparisonRow = (parameterName: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(".comparison-row")).find((row) =>
        row.textContent?.includes(parameterName)
      );

    const baseProjectSelect = within(comparisonControls).getByRole("combobox", { name: "基准项目" });
    const targetProjectSelect = within(comparisonControls).getByRole("combobox", { name: "对比项目" });

    expectSelectValue(baseProjectSelect, "aurora");
    expectSelectValue(targetProjectSelect, "nebula");
    expect(within(comparisonControls).queryByRole("button", { name: /选择对比项目/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("AUR-Prod").length).toBeGreaterThan(0);
    expect(screen.getAllByText("NEB-RD").length).toBeGreaterThan(0);
    expect(screen.queryByText("生产")).not.toBeInTheDocument();
    expect(screen.queryByText("预发")).not.toBeInTheDocument();

    const fastChargeRow = getComparisonRow("fast_charge_current_limit_ma");
    expect(fastChargeRow).toHaveTextContent("3850");
    expect(fastChargeRow).toHaveTextContent("4200");
    expect(fastChargeRow).toHaveTextContent("高");
    expect(fastChargeRow).not.toHaveTextContent("%");

    changeSelectValue(targetProjectSelect, /ATL-Intl/);

    const atlasFastChargeRow = getComparisonRow("fast_charge_current_limit_ma");
    expect(screen.getAllByText("ATL-Intl").length).toBeGreaterThan(0);
    expect(atlasFastChargeRow).toHaveTextContent("3000");
    expect(atlasFastChargeRow).not.toHaveTextContent("%");
  });

  it("consumes parameter comparison context from query strings", () => {
    window.history.replaceState(null, "", "/parameter-comparison?project=nebula&module=Battery%20Safety");

    render(<App />);

    const comparisonControls = screen.getByRole("region", { name: "项目对比选择" });
    const filters = screen.getByRole("region", { name: "参数矩阵筛选" });
    const matrix = document.querySelector<HTMLElement>(".comparison-matrix");

    expectSelectValue(within(comparisonControls).getByRole("combobox", { name: "基准项目" }), "nebula");
    expectSelectValue(within(comparisonControls).getByRole("combobox", { name: "对比项目" }), "aurora");
    expectSelectValue(within(filters).getByRole("combobox", { name: "模块" }), "Battery Safety");
    expect(screen.getAllByText("NEB-RD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AUR-Prod").length).toBeGreaterThan(0);
    expect(matrix).toHaveTextContent("battery_temp_target_c");
    expect(matrix).not.toHaveTextContent("fast_charge_current_limit_ma");
  });

  it("filters the parameter comparison matrix and shows parameter meanings", () => {
    window.history.replaceState(null, "", "/parameter-comparison");

    render(<App />);

    const filters = screen.getByRole("region", { name: "参数矩阵筛选" });
    const importanceSelect = within(filters).getByRole("combobox", { name: "重要性" });
    const moduleSelect = within(filters).getByRole("combobox", { name: "模块" });
    const getComparisonRow = (parameterName: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(".comparison-row")).find((row) =>
        row.textContent?.includes(parameterName)
      );

    expect(screen.getByText("参数含义")).toBeInTheDocument();
    expect(getComparisonRow("fast_charge_current_limit_ma")).toHaveTextContent("限制快充阶段的最大充电电流。");
    expect(filters).not.toHaveTextContent("当前筛选");

    changeSelectValue(importanceSelect, "高");

    expect(getComparisonRow("fast_charge_current_limit_ma")).toBeDefined();
    expect(getComparisonRow("charge_voltage_limit_mv")).toBeDefined();
    expect(getComparisonRow("battery_temp_target_c")).toBeUndefined();
    expect(filters).not.toHaveTextContent("当前筛选");

    changeSelectValue(moduleSelect, "Battery Protection");

    expect(getComparisonRow("low_battery_shutdown_soc")).toBeDefined();
    expect(getComparisonRow("fast_charge_current_limit_ma")).toBeUndefined();
    expect(filters).not.toHaveTextContent("当前筛选");
  });

  it("keeps comparison insights inside the floating WiseAgent after opening it", () => {
    window.history.replaceState(null, "", "/parameter-comparison");

    render(<App />);

    expect(document.querySelector(".comparison-insights")).not.toBeInTheDocument();
    expect(screen.getByLabelText("打开 WiseAgent")).toBeInTheDocument();
    expect(document.querySelector(".agent-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("打开 WiseAgent"));

    const agentPanel = document.querySelector<HTMLElement>(".agent-panel");
    expect(agentPanel).toBeInTheDocument();
    expect(within(agentPanel!).getByText("WiseAgent")).toBeInTheDocument();
    expect(within(agentPanel!).getByText("项目差异风险")).toBeInTheDocument();
    expect(within(agentPanel!).getByText("参数值对照")).toBeInTheDocument();
    expect(within(agentPanel!).getByText("风险阈值漂移")).toBeInTheDocument();
    expect(agentPanel).toHaveTextContent("fast_charge_current_limit_ma");
    expect(agentPanel).toHaveTextContent("AUR-Prod 与 NEB-RD");
  });

  it("requires a rejection reason when an admin sends a parameter request back", () => {
    window.history.replaceState(null, "", "/parameter-review");

    render(<App />);

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });
    const advanceButton = within(reviewDetail).getByRole("button", { name: "推进流程" });
    const rejectButton = within(reviewDetail).getByRole("button", { name: "打回修改" });

    expect(advanceButton).toHaveClass("full");
    expect(rejectButton).toHaveClass("full");

    fireEvent.click(rejectButton);

    const dialog = screen.getByRole("alertdialog", { name: "打回修改" });
    const reasonInput = within(dialog).getByLabelText("打回原因");
    fireEvent.change(reasonInput, { target: { value: "热测试数据缺少高温工况说明，需要补充后再提交。" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交打回" }));

    expect(screen.queryByRole("dialog", { name: "打回修改" })).not.toBeInTheDocument();
    expect(reviewDetail).toHaveTextContent("已打回");
    expect(reviewDetail).toHaveTextContent("热测试数据缺少高温工况说明，需要补充后再提交。");
  });

  it("consumes parameter review context from project and module query strings", () => {
    window.history.replaceState(null, "", "/parameter-review?project=aurora&module=Battery%20Safety");

    render(<App />);

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });

    expect(reviewDetail).toHaveTextContent("PRQ-9101");
    expect(reviewDetail).toHaveTextContent("Battery Safety");
  });

  it("falls back to module-only matching for parameter review query strings", () => {
    window.history.replaceState(null, "", "/parameter-review?module=Charging%20Policy");

    render(<App />);

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });

    expect(reviewDetail).toHaveTextContent("PRQ-9102");
    expect(reviewDetail).toHaveTextContent("Charging Policy");
  });

  it("labels and aligns the review change column", () => {
    window.history.replaceState(null, "", "/parameter-review");

    render(<App />);

    expect(screen.getByRole("columnheader", { name: "变更" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "建议变更" })).not.toBeInTheDocument();

    const changeCell = screen.getByRole("table").querySelector<HTMLTableCellElement>("td.change-cell");

    expect(changeCell).toBeInTheDocument();
    expect(changeCell?.firstElementChild).toHaveClass("value-change");
  });

  it("shows unsupported log format feedback in a dialog only after upload simulation", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);

    expect(screen.queryByText("system_dump.bin 无法处理，请上传 .log、.txt 或 .json。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /拖放日志文件到此处/ }));

    const dialog = screen.getByRole("alertdialog", { name: "不支持的日志格式" });
    expect(dialog).toHaveTextContent("system_dump.bin 无法处理");
    expect(dialog).toHaveTextContent("请上传 .log、.txt 或 .json");

    fireEvent.click(within(dialog).getByRole("button", { name: "知道了" }));

    expect(screen.queryByRole("dialog", { name: "不支持的日志格式" })).not.toBeInTheDocument();
  });

  it("switches log analysis content from clickable history records", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /charging_thermal_trace_20260504\.log/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("快充阶段电池包温升过快，触发热降额链路。")).toBeInTheDocument();
    expect(screen.getByText("日志分析证据链")).toBeInTheDocument();
    expect(screen.getByText("关联处置：下调快充电流上限")).toBeInTheDocument();

    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation_20260503\.log/ }));

    expect(screen.getByText("PD 协商在 9V/3A 档位稳定完成，未出现握手重试。")).toBeInTheDocument();
    expect(screen.getByText("关联处置：保留 9V/3A 充电档位")).toBeInTheDocument();
    expect(screen.getAllByText(/PD_CTRL Accept profile 9V\/3A/)).toHaveLength(2);

    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot\.bin/ }));

    expect(screen.getByText("不支持的二进制热快照格式。")).toBeInTheDocument();
    expect(screen.getByText("关联处置：请重新上传 .log、.txt 或 .json 文本日志。")).toBeInTheDocument();
  });

  it("shows a log analysis evidence chain instead of suggested actions", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);

    const analysis = screen.getByRole("region", { name: "分析结果" });
    expect(within(analysis).getByText("原始日志内容")).toBeInTheDocument();
    expect(within(analysis).getByText("日志分析证据链")).toBeInTheDocument();
    expect(within(analysis).getByText("证据 01")).toBeInTheDocument();
    expect(within(analysis).getByText("证据 02")).toBeInTheDocument();
    expect(within(analysis).getByText("证据 03")).toBeInTheDocument();
    expect(within(analysis).getAllByText("10:24:01 WARN [CHG_THERMAL] battery_pack_temp=46.8C over soft_limit=45C")).toHaveLength(2);
    expect(within(analysis).getByText("电池包温度越过 45°C 软阈值，确认热异常触发点。")).toBeInTheDocument();
    expect(within(analysis).queryByText("建议动作")).not.toBeInTheDocument();
    expect(within(analysis).queryByText("应用缓解措施")).not.toBeInTheDocument();
  });

  it("uses Chinese visible copy on every page surface", () => {
    const pageChecks = [
      {
        path: "/",
        present: ["让业务流程更智能更高效", "WiseEff 把参数管理、日志分析、设备调试和审阅治理连接到同一平台。", "参数管理", "日志分析", "参数调试"],
        absent: ["WiseEff Prototype", "Linear is a better way", "Powering the world's best product teams", "Issue tracking you'll enjoy using"]
      },
      {
        path: "/parameter-home",
        present: ["热门模块", "关键参数变化", "参数工作台", "参数合入审核"],
        absent: ["WiseEff Prototype", "Linear is a better way", "Powering the world's best product teams", "Issue tracking you'll enjoy using"]
      },
      {
        path: "/parameters",
        present: ["筛选条件", "全部", "参数名称", "当前值", "范围 / 单位", "更新时间"],
        absent: ["Filters", "All", "Current", "Range / Unit", "Importance", "Updated"]
      },
      {
        path: "/parameter-comparison",
        present: ["参数", "对比分析", "基准项目", "对比项目", "参数差异矩阵", "AUR-Prod", "NEB-RD"],
        absent: [
          "Parameters",
          "Comparison",
          "当前选择 AUR-Prod",
          "当前选择 NEB-RD",
          "对比范围",
          "实际项目参数对比",
          "漂移参数",
          "需要审阅后同步",
          "高重要性差异",
          "WiseAgent 已生成风险说明",
          "生产 vs 预发",
          "Export",
          "Sync Selected",
          "Parameter Key",
          "OpsAgent",
          "OpsAgent Insights",
          "View Historical Latency"
        ]
      },
      {
        path: "/parameter-review",
        present: ["筛选队列", "待审阅请求", "变更", "变更历史", "现在"],
        absent: ["Filter Queue", "Pending Requests", "Req ID", "Submitter", "Proposed Change", "Change History", "Targeting module"]
      },
      {
        path: "/parameter-admin",
        present: ["项目参数管理后台", "项目共享参数库", "共享参数定义", "项目参数值矩阵", "保存到 JSON 文件", "导出 JSON", "共享参数"],
        absent: ["项目参数 Admin", "items", "events"]
      },
      {
        path: "/logs",
        present: ["拖放日志文件到此处", "分析结果", "原始日志内容", "日志分析证据链"],
        absent: ["Unsupported Log Format", "Drag and drop log files here", "Analysis Results", "Suggested Actions", "Apply Mitigation", "建议动作", "应用缓解措施"]
      },
      {
        path: "/log-admin",
        present: ["日志分析管理后台", "分析记录概览"],
        absent: ["日志分析 Admin", "Failed", "Complete", "Processing"]
      },
      {
        path: "/debugging",
        present: ["需要连接", "实时可调参数"],
        absent: ["Device Online", "Connect Required"]
      },
      {
        path: "/debugging-admin",
        present: ["参数调试管理后台", "可写入"],
        absent: ["参数调试 Admin", "Ready"]
      }
    ];

    pageChecks.forEach(({ path, present, absent }) => {
      cleanup();
      window.history.replaceState(null, "", path);
      render(<App />);

      present.forEach((text) => {
        expect(document.body).toHaveTextContent(text);
      });
      absent.forEach((text) => {
        expect(document.body).not.toHaveTextContent(text);
      });
    });
  });

  it("uses Chinese helper copy in the global chrome and WiseAgent panel", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);

    expect(screen.getByPlaceholderText("搜索...")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("打开 WiseAgent"));

    expect(document.body).toHaveTextContent("上下文洞察");
    expect(screen.getByPlaceholderText("询问 WiseAgent...")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Context-Aware Insight");
    expect(screen.queryByPlaceholderText("Ask OpsAgent...")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("OpsAgent");
  });

  it("filters debugging parameters by module from a left filter panel", () => {
    window.history.replaceState(null, "", "/debugging");

    render(<App />);

    const filters = screen.getByRole("complementary", { name: "参数筛选" });
    const moduleSelect = within(filters).getByRole("combobox", { name: "模块" });

    expect(within(filters).queryByText("项目")).not.toBeInTheDocument();
    expect(within(filters).queryByText("重要性")).not.toBeInTheDocument();
    expectSelectValue(moduleSelect, "All");
    expect(within(screen.getByRole("table")).getByText("charger.input_current_limit_ma")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("battery.cell_temp_limit_c")).toBeInTheDocument();

    changeSelectValue(moduleSelect, "Battery");

    expect(within(screen.getByRole("table")).queryByText("charger.input_current_limit_ma")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("battery.cell_temp_limit_c")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("battery.impedance_mohm")).toBeInTheDocument();
    expect(filters).toHaveTextContent("当前筛选命中 3 条参数。");
  });

  it("edits and pushes debugging target values with operation records", () => {
    window.history.replaceState(null, "", "/debugging");

    render(<App />);

    const findDebugRow = (parameterKey: string) =>
      Array.from(screen.getByRole("table").querySelectorAll<HTMLElement>("tbody tr")).find((row) =>
        row.textContent?.includes(parameterKey)
      );
    const parameterKey = "charger.charge_pump.enable";
    const row = findDebugRow(parameterKey);

    expect(row).toBeDefined();
    expect(within(row as HTMLElement).getByText("已同步")).toBeInTheDocument();

    fireEvent.change(within(row as HTMLElement).getByLabelText(`${parameterKey} 目标设定值`), { target: { value: "0" } });

    expect(within(findDebugRow(parameterKey) as HTMLElement).getByText("待下发")).toBeInTheDocument();
    expect(document.body).toHaveTextContent("1 项参数等待应用");

    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    fireEvent.click(screen.getByRole("button", { name: "下发调试值" }));

    const updatedRow = findDebugRow(parameterKey);
    const timeline = screen.getByRole("complementary", { name: "调试操作记录" });

    expect(updatedRow).toBeDefined();
    expect(updatedRow).toHaveTextContent("0");
    expect(within(updatedRow as HTMLElement).getByText("下发成功")).toBeInTheDocument();
    expect(timeline).toHaveTextContent(`下发 ${parameterKey}`);
    expect(timeline).toHaveTextContent("值变更：1 -> 0 bool，执行成功。");
  });

  it("removes the global project selector from review and parameter admin topbars", () => {
    ["/parameter-review", "/parameter-admin"].forEach((path) => {
      cleanup();
      window.history.replaceState(null, "", path);
      render(<App />);

      const topbar = document.querySelector<HTMLElement>(".topbar");
      expect(topbar).not.toBeNull();
      expect(within(topbar as HTMLElement).queryByRole("combobox")).not.toBeInTheDocument();
    });
  });

  it("keeps the platform homepage as the root surface", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "让业务流程更智能更高效" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "智能参数管理" })).not.toBeInTheDocument();
  });

  it("provides a left-bottom feedback entry for internal testing feedback", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App />);

    const feedbackEntry = screen.getByRole("button", { name: "问题反馈" });
    expect(feedbackEntry).toBeInTheDocument();
    expect(feedbackEntry.closest(".feedback-entry")).toBeInTheDocument();
    const css = readFileSync("src/styles.css", "utf8");
    const navItemCss = readCssBlock(css, ".nav-item");
    const feedbackEntryCss = readCssBlock(css, ".feedback-entry");
    expect(css).toContain(".utility-nav {\n  flex: 0 0 auto;");
    expect(css).toContain(".utility-nav {\n    display: block;");
    expect(navItemCss).toContain("justify-content: flex-start;");
    expect(navItemCss).toContain("height: auto;");
    expect(feedbackEntryCss).toContain("align-items: flex-start;");
    expect(css).toContain(".agent-header [data-slot=\"button\"]");

    fireEvent.click(feedbackEntry);

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    expect(within(dialog).getByLabelText("反馈类型")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("问题描述")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "提交反馈" })).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("问题描述"), { target: { value: "导出按钮需要提示成功状态" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    expect(screen.getByText("反馈已记录，内测团队会结合页面路径和问题类型跟进。")).toBeInTheDocument();
  });

  it("keeps the feedback dialog wide enough for form and screenshot capture columns", () => {
    window.history.replaceState(null, "", "/parameter-home");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "问题反馈" }));

    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    expect(dialog).toHaveClass("feedback-dialog");
    expect(within(dialog).getByText("问题信息")).toBeInTheDocument();
    expect(within(dialog).getByText("粘贴上传截图")).toBeInTheDocument();

    const css = readFileSync("src/styles.css", "utf8");
    const feedbackDialogCss = readCssBlock(css, ".feedback-dialog");
    const feedbackDialogFormCss = readCssBlock(css, ".feedback-dialog form");
    const feedbackLayoutCss = readCssBlock(css, ".feedback-layout");

    expect(feedbackDialogCss).toContain("max-width: min(900px, calc(100vw - 48px));");
    expect(feedbackDialogCss).toContain("padding: 0;");
    expect(feedbackDialogFormCss).toContain("display: grid;");
    expect(feedbackLayoutCss).toContain("grid-template-columns: minmax(300px, 1fr) minmax(280px, 360px);");
  });

  it("attaches a screenshot pasted from the clipboard for internal feedback", async () => {
    window.history.replaceState(null, "", "/parameter-home");
    const pastedImage = new File(["pasted screenshot"], "feedback.png", { type: "image/png" });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pasted-feedback-screenshot");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "问题反馈" }));
    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    const pasteZone = within(dialog).getByText("粘贴上传截图").closest("section") as HTMLElement;

    expect(within(dialog).queryByRole("button", { name: "截取当前页面" })).not.toBeInTheDocument();

    fireEvent.paste(pasteZone, { clipboardData: { files: [pastedImage] } });

    expect(await within(dialog).findByAltText("问题反馈截图预览")).toHaveAttribute("src", "blob:pasted-feedback-screenshot");
    expect(screen.getByText("截图已粘贴，可随反馈一起提交。")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("问题描述"), { target: { value: "对比页卡片内容发生重叠" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    expect(screen.getByText("反馈已记录，并附带粘贴截图。")).toBeInTheDocument();
  });

  it("shows inline guidance when pasted feedback content is not an image", () => {
    window.history.replaceState(null, "", "/parameter-home");
    const pastedText = new File(["not an image"], "notes.txt", { type: "text/plain" });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "问题反馈" }));
    const dialog = screen.getByRole("dialog", { name: "问题反馈" });
    const pasteZone = within(dialog).getByText("粘贴上传截图").closest("section") as HTMLElement;

    fireEvent.paste(pasteZone, { clipboardData: { files: [pastedText] } });

    expect(screen.getByText("请粘贴 PNG、JPG 或 WebP 格式截图。")).toBeInTheDocument();
    expect(within(dialog).queryByAltText("问题反馈截图预览")).not.toBeInTheDocument();
  });

  it("resolves direct tutorial urls back to the home surface", () => {
    window.history.replaceState(null, "", "/tutorial/parameters");

    render(<App />);

    expect(screen.getByRole("heading", { name: "让业务流程更智能更高效" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "项目参数演示脚本" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("provides 10 power-management parameters for every project", () => {
    const parameterCountsByProject = initialState.parameters.reduce<Record<string, number>>(
      (counts, parameter) => {
        counts[parameter.projectId] = (counts[parameter.projectId] ?? 0) + 1;
        return counts;
      },
      {}
    );

    expect(parameterCountsByProject).toEqual({
      atlas: 10,
      aurora: 10,
      nebula: 10
    });
  });

  it("edits project parameter config and reflects it in comparison data", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App />);

    const projectValues = screen.getByRole("region", { name: "项目参数值矩阵" });
    const sharedDefinition = screen.getByRole("region", { name: "共享参数定义" });
    const auroraCurrentValue = within(projectValues).getByLabelText("AUR-Prod 当前值");

    fireEvent.change(auroraCurrentValue, { target: { value: "3650" } });

    expect(screen.queryByText("配置源预览")).not.toBeInTheDocument();
    expect(within(sharedDefinition).getByLabelText("参数推荐值")).toHaveValue("3200");
    expect(within(projectValues).queryByLabelText("AUR-Prod 推荐值")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "项目参数对比分析" }));

    const fastChargeRow = Array.from(document.querySelectorAll<HTMLElement>(".comparison-row")).find((row) =>
      row.textContent?.includes("fast_charge_current_limit_ma")
    );
    expect(fastChargeRow).toHaveTextContent("3650");
  });

  it("adds and deletes shared project parameters from the project admin config", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App />);

    expect(screen.getByText("项目共享参数库")).toBeInTheDocument();
    expect(screen.getByText("共享参数定义")).toBeInTheDocument();
    expect(screen.getByText("项目参数值矩阵")).toBeInTheDocument();
    expect(screen.queryByText("配置源预览")).not.toBeInTheDocument();
    expect(document.querySelector(".config-preview-panel")).not.toBeInTheDocument();
    expect(document.querySelector(".config-toolbar-actions")).toHaveTextContent("批量参数导入");
    expect(document.querySelector(".config-toolbar-actions")).toHaveTextContent("保存到 JSON 文件");
    expect(document.querySelector(".config-toolbar-actions")).toHaveTextContent("导出 JSON");
    const configFormLabelCss = readCssBlock(readFileSync("src/styles.css", "utf8"), ".config-form-grid label");
    expect(configFormLabelCss).toContain("align-items: flex-start;");
    expect(configFormLabelCss).toContain("text-align: left;");
    expect(readCssBlock(readFileSync("src/styles.css", "utf8"), ".project-value-row label")).toContain("text-align: left;");
    expect(screen.getByText("所有项目共用同一条参数定义，只在这里维护各项目的实际值。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "NEB-RD" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "新增参数" }));

    expect(screen.getByDisplayValue("new_power_parameter_11")).toBeInTheDocument();

    expect(screen.getByText("new_power_parameter_11")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "项目参数值矩阵" })).toHaveTextContent("NEB-RD");

    fireEvent.click(screen.getByRole("button", { name: "删除参数" }));

    expect(screen.queryByDisplayValue("new_power_parameter_11")).not.toBeInTheDocument();
  });

  it("keeps the project shared parameter library list breathable and scannable", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const listBlock = readCssBlock(css, ".project-parameter-library-list");
    const rowBlock = readCssBlock(css, "[data-slot=\"button\"].project-parameter-list-row");
    const selectedBlock = readCssBlock(css, "[data-slot=\"button\"].project-parameter-list-row.selected");
    const nameBlock = readCssBlock(css, ".project-parameter-list-row strong");

    expect(listBlock).toContain("gap: 8px;");
    expect(listBlock).toContain("max-height: 520px;");
    expect(listBlock).toContain("overflow: auto;");
    expect(rowBlock).toContain("grid-template-columns: minmax(0, 1fr) auto;");
    expect(rowBlock).toContain("min-height: 68px;");
    expect(rowBlock).toContain("border-radius: 8px;");
    expect(rowBlock).toContain("transition: none;");
    expect(selectedBlock).toContain("background-color: #eef4ff;");
    expect(selectedBlock).toContain("box-shadow: inset 3px 0 0 var(--app-primary);");
    expect(nameBlock).toContain("font-size: 14px;");
    expect(nameBlock).toContain("overflow-wrap: anywhere;");
    expect(nameBlock).toContain("white-space: normal;");
  });

  it("saves project admin edits to the local JSON config endpoint", () => {
    window.history.replaceState(null, "", "/parameter-admin");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const projectValues = screen.getByRole("region", { name: "项目参数值矩阵" });
    fireEvent.change(within(projectValues).getByLabelText("AUR-Prod 当前值"), { target: { value: "3650" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到 JSON 文件" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/power-management-config",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"currentValue": "3650"')
      })
    );
  });

  it("edits debug parameter config and reflects it in the debugging workspace", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App />);

    fireEvent.change(screen.getByLabelText("调试目标值"), { target: { value: "3650" } });

    expect(document.body).toHaveTextContent('"targetValue": "3650"');

    fireEvent.click(screen.getByRole("button", { name: "参数调试平台" }));

    expect(screen.getByDisplayValue("3650")).toBeInTheDocument();
  });

  it("adds and deletes debug parameters from the debugging admin config", () => {
    window.history.replaceState(null, "", "/debugging-admin");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新增可调参数" }));

    expect(screen.getByDisplayValue("new_debug_parameter_9")).toBeInTheDocument();
    expect(document.body).toHaveTextContent('"key": "debug.new_parameter_9"');

    fireEvent.click(screen.getByRole("button", { name: "删除可调参数" }));

    expect(screen.queryByDisplayValue("new_debug_parameter_9")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('"key": "debug.new_parameter_9"');
  });

  it("saves debug admin edits to the local JSON config endpoint", () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("调试目标值"), { target: { value: "3650" } });
    fireEvent.click(screen.getByRole("button", { name: "保存到 JSON 文件" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/power-management-config",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"targetValue": "3650"')
      })
    );
  });

  it("removes reset-to-code-version actions from both config admin pages", () => {
    window.history.replaceState(null, "", "/parameter-admin");

    render(<App />);

    expect(screen.queryByRole("button", { name: "重置为代码版本" })).not.toBeInTheDocument();

    cleanup();
    window.history.replaceState(null, "", "/debugging-admin");
    render(<App />);

    expect(screen.queryByRole("button", { name: "重置为代码版本" })).not.toBeInTheDocument();
  });

  it("keeps browser history navigation synced with rendered pages", () => {
    window.history.replaceState(null, "", "/parameters");

    render(<App />);
    expect(screen.getByRole("heading", { name: "项目参数用户工作台" })).toBeInTheDocument();

    window.history.pushState(null, "", "/logs");
    fireEvent.popState(window);

    expect(screen.getByRole("heading", { name: "日志智能分析" })).toBeInTheDocument();
  });
});
