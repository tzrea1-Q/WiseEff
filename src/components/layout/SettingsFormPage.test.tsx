import { useLayoutEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsFormPage, SettingsFormSection, useDirtyState } from "./SettingsFormPage";
import { requestSettingsLeave as requestLeave } from "@/application/settingsFormNavigation";
import { act, within } from "@testing-library/react";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function SettingsExample() {
  const [saved, setSaved] = useState({ name: "原名称" });
  const [draft, setDraft] = useState(saved);
  const dirty = useDirtyState(draft, saved);
  return <SettingsFormPage label="测试设置" dirty={dirty}
    onSave={() => setSaved(draft)} onDiscard={() => setDraft(saved)}>
    <SettingsFormSection title="基本信息" help="设置显示名称。">
      <label>名称<input value={draft.name} onChange={(event) => setDraft({ name: event.target.value })} /></label>
    </SettingsFormSection>
  </SettingsFormPage>;
}

describe("SettingsFormPage", () => {
  it("keeps stale drafts discardable but blocks both button and Enter saves", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    render(<SettingsFormPage label="已过期设置" dirty saveDisabled onSave={onSave} onDiscard={onDiscard}>内容</SettingsFormPage>);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "已过期设置" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });
  it("allows navigation and reload as soon as the saved form is committed", () => {
    const onSavedCommit = vi.fn();
    function Example({ saved }: { saved: boolean }) {
      useLayoutEffect(() => {
        if (!saved) return;
        const unload = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(unload);
        onSavedCommit(requestLeave(), unload.defaultPrevented);
      }, [saved]);
      return <SettingsFormPage label="测试设置" dirty={!saved} saving={!saved}
        onSave={vi.fn()} onDiscard={vi.fn()}>内容</SettingsFormPage>;
    }
    const view = render(<Example saved={false} />);
    expect(requestLeave()).toBe(false);
    view.rerender(<Example saved />);
    expect(screen.getByRole("form", { name: "测试设置" })).toHaveAttribute("data-settings-dirty", "false");
    expect(onSavedCommit).toHaveBeenCalledExactlyOnceWith(true, false);
  });

  it("guards navigation with the shared dialog and reload only while dirty, and cleans up on unmount", async () => {
    const view = render(<SettingsExample />);
    expect(requestLeave()).toBe(true);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "未保存" } });
    let decision: boolean | Promise<boolean> = false;
    act(() => { decision = requestLeave(); });
    fireEvent.click(within(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "继续编辑" }));
    expect(await decision).toBe(false);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    act(() => { decision = requestLeave(); });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "放弃并离开" }));
    expect(await decision).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(requestLeave()).toBe(true);
    view.unmount();
    expect(requestLeave()).toBe(true);
  });

  it("summarizes failed saves and prevents save/discard or navigation while saving", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    render(<SettingsFormPage label="测试设置" dirty saving error="网络不可用" onSave={onSave} onDiscard={onDiscard}>内容</SettingsFormPage>);
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败网络不可用");
    fireEvent.click(screen.getByRole("button", { name: "保存中…" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(requestLeave()).toBe(false);
  });

  it("shows save and discard only for changed values, and returns to clean after save or discard", () => {
    render(<SettingsExample />);
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "新名称" } });
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(screen.getByLabelText("名称")).toHaveValue("原名称");
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "已保存名称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByLabelText("名称")).toHaveValue("已保存名称");
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "临时名称" } });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "已保存名称" } });
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });
});
