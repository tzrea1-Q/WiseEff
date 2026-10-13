import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import config from "../../eslint.config.js";

const lint = (source: string) => new Linter().verify(source, config, { filename: "src/accessibility-probe.tsx" });

describe("accessibility lint ratchet (#1139)", () => {
  it("blocks inaccessible labels and interactions instead of warning", () => {
    const messages = lint('const view = <><label>名称</label><article role="button" onClick={() => {}}>打开</article></>;');
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.severity === 2)).toBe(true);
  });

  it("recognizes native-backed controls and recommended composite roles", () => {
    expect(lint(`const view = <>
      <label><span>名称</span><Input /></label>
      <label><span><strong>从零开始</strong></span><input type="checkbox" /></label>
      <label><span>描述</span><Textarea /></label>
      <label><span>搜索</span><SearchField /></label>
      <label><span>角色</span><SelectControl /></label>
      <label><span>风险</span><DebugAdminSelectControl /></label>
      <ul role="tree" aria-label="模块"><li role="treeitem" aria-selected={false}>电源</li></ul>
      <table role="grid"><tbody><tr><td role="gridcell">内容</td></tr></tbody></table>
    </>;`)).toEqual([]);
    expect(lint('const view = <label>风险<RiskPicker /></label>;').some((message) => message.ruleId === "jsx-a11y/label-has-associated-control")).toBe(true);
  });
});
