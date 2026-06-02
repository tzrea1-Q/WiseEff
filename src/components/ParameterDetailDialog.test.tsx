import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparisonProject } from "@/domain/parameters/singleParameterComparison";
import type { ParameterRecord } from "@/domain/parameters/types";
import { ParameterDetailDialog } from "./ParameterDetailDialog";

const projects: ComparisonProject[] = [
  { id: "aurora", code: "AUR-Prod", name: "Aurora Production" },
  { id: "nebula", code: "NEB-RD", name: "Nebula Lab" },
  { id: "atlas", code: "ATL-Intl", name: "Atlas Intl" }
];

function parameter(projectId: string, value: string, patch: Partial<ParameterRecord> = {}): ParameterRecord {
  return {
    id: `${projectId}-fast-charge-current`,
    name: "fast_charge_current_limit_ma",
    description: "Fast charge input current limit",
    explanation: "Limits fast charge current to keep thermal load controlled.",
    configFormat: "charging.fast_charge_current_limit_ma=3850",
    module: "Charging Policy",
    projectId,
    currentValue: value,
    recommendedValue: "3200",
    range: "2500 - 4500",
    unit: "mA",
    risk: "High",
    updatedAt: "today 10:00",
    updatedAtTs: "2026-05-21T02:00:00.000Z",
    history: [{ version: "v5.2", value: "3800", changedAt: "yesterday", changedBy: "Wang Jie" }],
    ...patch
  };
}

const selectedParameter = parameter("aurora", "3850");
const allParameters = [
  selectedParameter,
  parameter("nebula", "4200"),
  parameter("atlas", "3000", { risk: "Medium", updatedAt: "yesterday" })
];

const dtsValue = `fast-charge-profile-matrix =
  "0", "5000", "1500", "40", "entry",
  "1", "9000", "3000", "43", "balanced",
  "2", "11000", "4200", "46", "burst";`;

const dtsTargetValue = `fast-charge-profile-matrix =
  "0", "5000", "1500", "40", "entry",
  "1", "9000", "3000", "43", "balanced",
  "2", "12000", "4300", "48", "boost";`;

const dtsParameter = parameter("aurora", dtsValue, {
  id: "aurora-dts-fast-charge-profile-matrix",
  name: "dts_fast_charge_profile_matrix",
  description: "DTS string-list fast charge profile matrix.",
  explanation: "Uses a device-tree string-list property.",
  configFormat: `DTS: ${dtsValue}`,
  recommendedValue: dtsValue,
  range: "0 - 1",
  unit: "profile",
  risk: "Low"
});

const dtsParameters = [
  dtsParameter,
  parameter("nebula", dtsTargetValue, {
    id: "nebula-dts-fast-charge-profile-matrix",
    name: "dts_fast_charge_profile_matrix",
    recommendedValue: dtsTargetValue,
    unit: "profile",
    risk: "Low"
  }),
  parameter("atlas", dtsValue, {
    id: "atlas-dts-fast-charge-profile-matrix",
    name: "dts_fast_charge_profile_matrix",
    recommendedValue: dtsValue,
    unit: "profile",
    risk: "Low"
  })
];

afterEach(() => {
  cleanup();
});

describe("ParameterDetailDialog", () => {
  it("shows definition and all-project comparison for the selected parameter", () => {
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /fast_charge_current_limit_ma/ });
    expect(within(dialog).getByText("Fast charge input current limit")).toBeInTheDocument();
    expect(within(dialog).getByText("Limits fast charge current to keep thermal load controlled.")).toBeInTheDocument();
    expect(within(dialog).getByText("charging.fast_charge_current_limit_ma=3850")).toBeInTheDocument();
    expect(within(dialog).getByText("v5.2")).toBeInTheDocument();
    expect(within(dialog).getAllByText("AUR-Prod").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("NEB-RD").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("ATL-Intl").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("+350 mA (+9.1%)")).toBeInTheDocument();
    expect(within(dialog).getByText("模块：充电策略 · 重要性：高")).toBeInTheDocument();
    const definitionSection = within(dialog).getByRole("region", { name: "参数定义" });
    const comparisonSection = within(dialog).getByRole("region", { name: "跨项目对比" });
    expect(within(definitionSection).getByText("当前值")).toBeInTheDocument();
    expect(within(definitionSection).getByText("推荐值")).toBeInTheDocument();
    expect(within(definitionSection).getByText("配置格式")).toBeInTheDocument();
    expect(within(definitionSection).getByText("近期历史")).toBeInTheDocument();
    expect(comparisonSection).toBeInTheDocument();
    expect(within(comparisonSection).getByText("差异视图")).toBeInTheDocument();
    expect(within(comparisonSection).getByText("基准项目")).toBeInTheDocument();
    expect(within(comparisonSection).getAllByText("目标项目").length).toBeGreaterThanOrEqual(1);
    expect(within(comparisonSection).getByText("当前值对比")).toBeInTheDocument();
    expect(within(comparisonSection).queryByText("推荐值对比")).not.toBeInTheDocument();
    expect(comparisonSection.querySelectorAll(".parameter-diff-section")).toHaveLength(1);
    expect(comparisonSection.querySelector(".parameter-diff-code-row[data-kind='remove'] code")?.textContent).toBe("3850 mA");
    expect(comparisonSection.querySelector(".parameter-diff-code-row[data-kind='add'] code")?.textContent).toBe("4200 mA");
    const footer = dialog.querySelector(".parameter-detail-dialog__footer");
    const footerActions = footer?.querySelector(".parameter-detail-dialog__actions");
    expect(footerActions).toBeInTheDocument();
    expect(within(footerActions as HTMLElement).getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(within(footerActions as HTMLElement).getByRole("button", { name: "加入修改草稿" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "关闭参数详情" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "加入修改草稿" })).toBeInTheDocument();
  });

  it("renders complex DTS values in code diff panes", () => {
    render(
      <ParameterDetailDialog
        parameter={dtsParameter}
        parameters={dtsParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /dts_fast_charge_profile_matrix/ });
    expect(dialog.querySelector(".parameter-detail-dialog")).toHaveClass("parameter-detail-dialog--wide");
    const definitionSection = within(dialog).getByRole("region", { name: "参数定义" });
    expect(within(definitionSection).getByText("当前配置")).toBeInTheDocument();
    expect(within(definitionSection).getByText("推荐配置")).toBeInTheDocument();
    expect(within(definitionSection).getAllByText(/"0", "5000", "1500", "40", "entry"/)).toHaveLength(3);
    expect(definitionSection.querySelectorAll(".parameter-detail-code-value")).toHaveLength(2);

    const comparisonSection = within(dialog).getByRole("region", { name: "跨项目对比" });
    expect(within(comparisonSection).getByText("差异视图")).toBeInTheDocument();
    expect(within(comparisonSection).getByText("当前值对比")).toBeInTheDocument();
    expect(within(comparisonSection).queryByText("推荐值对比")).not.toBeInTheDocument();
    expect(comparisonSection.querySelectorAll(".parameter-diff-section")).toHaveLength(1);
    expect(comparisonSection.querySelectorAll(".parameter-diff-code-row[data-kind='equal']").length).toBeGreaterThan(0);
    expect(comparisonSection.querySelectorAll(".parameter-diff-code-row[data-kind='remove']").length).toBeGreaterThan(0);
    expect(comparisonSection.querySelectorAll(".parameter-diff-code-row[data-kind='add']").length).toBeGreaterThan(0);
    expect(within(comparisonSection).getAllByText(/"2", "11000", "4200", "46", "burst"/).length).toBeGreaterThan(0);
    expect(within(comparisonSection).getAllByText(/"2", "12000", "4300", "48", "boost"/).length).toBeGreaterThan(0);
    expect(within(comparisonSection).queryByText("复杂配置")).not.toBeInTheDocument();
  });

  it("changes the emphasized target project", () => {
    const onTargetProjectChange = vi.fn();
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={onTargetProjectChange}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("对比目标项目"), { target: { value: "atlas" } });

    expect(onTargetProjectChange).toHaveBeenCalledWith("atlas");
  });

  it("opens recent history in a nested diff dialog", () => {
    render(
      <ParameterDetailDialog
        parameter={{
          ...selectedParameter,
          history: [
            { version: "v5.0", value: "3800", changedAt: "2026-01-01T00:00:00.000Z", changedBy: "Wang Jie" },
            { version: "v5.1", value: "3750", changedAt: "2026-02-01T00:00:00.000Z", changedBy: "Li Chen", requestId: "PRQ-1001" },
            { version: "v5.2", value: "3200", changedAt: "2026-03-01T00:00:00.000Z", changedBy: "Xu Yun", requestId: "PRQ-1002" }
          ]
        }}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const mainDialog = screen.getByRole("dialog", { name: /fast_charge_current_limit_ma/ });
    const historySection = within(mainDialog).getByText("近期历史").closest(".parameter-detail-history") as HTMLElement;

    expect(within(historySection).getByRole("button", { name: "查看历史差异" })).toBeInTheDocument();
    expect(historySection.querySelector(".parameter-history-diff-dialog")).not.toBeInTheDocument();

    fireEvent.click(within(historySection).getByRole("button", { name: "查看历史差异" }));

    const historyDialog = screen.getByRole("dialog", { name: "历史差异 fast_charge_current_limit_ma" });
    expect(historyDialog).toHaveTextContent("v5.0 → v5.1");
    expect(historyDialog).toHaveTextContent("v5.1 → v5.2");
    expect(historyDialog.querySelectorAll(".parameter-history-diff-card")).toHaveLength(2);
    expect(historyDialog.querySelector(".parameter-diff-code-row[data-kind='remove'] code")).toHaveTextContent("3800 mA");
    expect(historyDialog.querySelector(".parameter-diff-code-row[data-kind='add'] code")).toHaveTextContent("3750 mA");
    expect(within(historyDialog).getByText("PRQ-1002")).toBeInTheDocument();

    fireEvent.click(within(historyDialog).getByRole("button", { name: "关闭历史差异" }));

    expect(screen.queryByRole("dialog", { name: "历史差异 fast_charge_current_limit_ma" })).not.toBeInTheDocument();
  });

  it("adds the recommended config value to the draft from the definition action", () => {
    const onAddToDraft = vi.fn();
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={onAddToDraft}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "使用推荐配置加入草稿" }));

    expect(onAddToDraft).toHaveBeenCalledWith({
      reason: "使用推荐配置生成草稿",
      targetValue: selectedParameter.recommendedValue
    });
  });

  it("adds the selected comparison project's current value to the draft", () => {
    const onAddToDraft = vi.fn();
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="atlas"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={onAddToDraft}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "使用该项目配置加入草稿" }));

    expect(onAddToDraft).toHaveBeenCalledWith({
      reason: "参考 ATL-Intl 项目当前配置生成草稿",
      targetValue: "3000"
    });
  });

  it("uses the same visual treatment for source draft actions", () => {
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "使用推荐配置加入草稿" })).toHaveClass("parameter-source-draft-button");
    expect(screen.getByRole("button", { name: "使用该项目配置加入草稿" })).toHaveClass("parameter-source-draft-button");
    expect(screen.getByRole("button", { name: "使用该项目配置加入草稿" })).not.toHaveClass("button", "subtle");
  });

  it("focuses the close button on mount and closes from close controls", () => {
    const onClose = vi.fn();
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={onClose}
      />
    );

    const closeButton = screen.getByRole("button", { name: "关闭参数详情" });
    expect(closeButton).toHaveFocus();

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab focus within the dialog", () => {
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const closeButton = screen.getByRole("button", { name: "关闭参数详情" });
    const configFormatCode = screen.getByText("charging.fast_charge_current_limit_ma=3850");
    const targetSelect = screen.getByLabelText("对比目标项目");
    const recommendedConfigButton = screen.getByRole("button", { name: "使用推荐配置加入草稿" });
    const targetProjectConfigButton = screen.getByRole("button", { name: "使用该项目配置加入草稿" });
    const footerClose = screen.getByRole("button", { name: "关闭" });
    const draftButton = screen.getByRole("button", { name: "加入修改草稿" });

    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: "Tab" });
    expect(recommendedConfigButton).toHaveFocus();

    fireEvent.keyDown(recommendedConfigButton, { key: "Tab" });
    expect(configFormatCode).toHaveFocus();

    fireEvent.keyDown(configFormatCode, { key: "Tab" });
    expect(targetSelect).toHaveFocus();

    fireEvent.keyDown(targetSelect, { key: "Tab" });
    expect(targetProjectConfigButton).toHaveFocus();

    fireEvent.keyDown(targetProjectConfigButton, { key: "Tab" });
    expect(footerClose).toHaveFocus();

    fireEvent.keyDown(footerClose, { key: "Tab" });
    expect(draftButton).toHaveFocus();

    fireEvent.keyDown(draftButton, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(draftButton).toHaveFocus();
  });

  it("restores focus to the opener after unmount", () => {
    const { rerender } = render(
      <div>
        <button type="button">打开参数详情</button>
        <ParameterDetailDialog
          parameter={selectedParameter}
          parameters={allParameters}
          projects={projects}
          currentProjectId="aurora"
          targetProjectId="nebula"
          canEdit
          alreadyInDraft={false}
          onTargetProjectChange={vi.fn()}
          onAddToDraft={vi.fn()}
          onClose={vi.fn()}
        />
      </div>
    );

    const opener = screen.getByRole("button", { name: "打开参数详情" });
    opener.focus();
    expect(opener).toHaveFocus();

    rerender(
      <div>
        <button type="button">打开参数详情</button>
      </div>
    );

    expect(opener).toHaveFocus();
  });

  it("closes when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the missing tone for a target project without the parameter", () => {
    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={[selectedParameter, parameter("nebula", "4200")]}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="atlas"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const overview = screen.getByLabelText("项目配置概览");
    const atlasCell = within(overview).getByText("ATL-Intl");
    const atlasRow = atlasCell.closest(".parameter-detail-project-overview__item");
    expect(atlasRow).toHaveAttribute("data-tone", "missing");
    expect(within(atlasRow as HTMLElement).getByText("目标")).toBeInTheDocument();
  });

  it("adds the parameter to the draft or reports disabled and already-added states", () => {
    const onAddToDraft = vi.fn();
    const { rerender } = render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={onAddToDraft}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "加入修改草稿" }));
    expect(onAddToDraft).toHaveBeenCalledTimes(1);

    rerender(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit
        disabledReason="草稿中已包含该参数。"
        alreadyInDraft
        onTargetProjectChange={vi.fn()}
        onAddToDraft={onAddToDraft}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "已在草稿中" })).toBeDisabled();
    expect(screen.getByText("草稿中已包含该参数。")).toBeInTheDocument();

    rerender(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit={false}
        disabledReason="需要参数编辑权限。"
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={onAddToDraft}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "加入修改草稿" })).toBeDisabled();
    expect(screen.getByText("需要参数编辑权限。")).toBeInTheDocument();
  });

  it("keeps a long disabled reason inside the footer structure", () => {
    const longReason =
      "权限不足：当前用户需要参数编辑权限才能对 Aurora Production 进行操作，且该原因字符串没有空格。";

    render(
      <ParameterDetailDialog
        parameter={selectedParameter}
        parameters={allParameters}
        projects={projects}
        currentProjectId="aurora"
        targetProjectId="nebula"
        canEdit={false}
        disabledReason={longReason}
        alreadyInDraft={false}
        onTargetProjectChange={vi.fn()}
        onAddToDraft={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const reason = screen.getByText(longReason);
    const footer = reason.closest(".parameter-detail-dialog__footer");

    expect(footer).toHaveClass("parameter-detail-dialog__footer");
    expect(reason).toHaveClass("parameter-detail-disabled-reason");
    expect(footer).toBeInTheDocument();
    expect(footer?.children).toHaveLength(2);
    const actions = footer?.querySelector(".parameter-detail-dialog__actions");
    expect(actions).toBeInTheDocument();
    expect(within(actions as HTMLElement).getByRole("button", { name: "关闭" })).toBeInTheDocument();
    expect(within(actions as HTMLElement).getByRole("button", { name: "加入修改草稿" })).toBeDisabled();
  });

  it("keeps long header titles from pushing the close button offscreen", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

    expect(styles).toMatch(/\.parameter-detail-dialog__header > div\s*\{[^}]*min-width:\s*0;/s);
    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain("word-break: break-word;");
  });

  it("keeps footer actions visually styled as buttons", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const baseRule = styles.match(/\.parameter-detail-dialog__actions \.button\s*\{[^}]*\}/)?.[0] ?? "";
    const subtleRule = styles.match(/\.parameter-detail-dialog__actions \.button\.subtle\s*\{[^}]*\}/)?.[0] ?? "";
    const primaryRule = styles.match(/\.parameter-detail-dialog__actions \.button\.primary\s*\{[^}]*\}/)?.[0] ?? "";

    expect(baseRule).toContain("height: 38px;");
    expect(baseRule).toContain("border-radius: 9px;");
    expect(baseRule).toContain("box-shadow:");
    expect(baseRule).toContain("cursor: pointer;");
    expect(subtleRule).toContain("background: #ffffff;");
    expect(subtleRule).toContain("border: 1px solid rgba(148, 163, 184, 0.64);");
    expect(primaryRule).toContain("background: var(--app-primary);");
    expect(primaryRule).toContain("border: 1px solid var(--app-primary);");
  });

  it("keeps long DTS config lines unwrapped with horizontal scrolling", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const codeRule = styles.match(/\.parameter-detail-copy code\s*\{[^}]*\}/)?.[0] ?? "";
    const wideRule = styles.match(/\.parameter-detail-dialog--wide\s*\{[^}]*\}/)?.[0] ?? "";

    expect(wideRule).toContain("width: min(1500px, calc(100vw - 48px));");
    expect(codeRule).toContain("white-space: pre;");
    expect(codeRule).toContain("overflow: auto;");
    expect(codeRule).toContain("max-width: 100%;");
    expect(codeRule).not.toContain("white-space: pre-wrap;");
    expect(codeRule).not.toContain("overflow-wrap: anywhere;");
  });
});
