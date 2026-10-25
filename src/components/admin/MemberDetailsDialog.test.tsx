import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import type { User } from "@/domain/prototype/types";
import { createPrototypeState } from "@/mockData";
import { createTestUserGovernanceActions } from "@/test/harness";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import { MemberDetailsDialog } from "./MemberDetailsDialog";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderMember(updateUserProfile: NonNullable<UserGovernanceActions["updateUserProfile"]>) {
  const state = createPrototypeState();
  const user = state.users.find((item) => item.id === "u-liu-min")!;
  const actions = createTestUserGovernanceActions({ updateUserProfile });
  const onUpdated = vi.fn();
  const onClose = vi.fn();
  function Example() {
    const [member, setMember] = useState(user);
    return <MemberDetailsDialog user={member} state={state} actions={actions} roleEditor={<span>组织角色编辑</span>}
      roleLabel={(roleId) => roleId} onUpdated={(next) => { onUpdated(next); setMember(next); }} onClose={onClose} />;
  }
  render(<Example />);
  return { user, onUpdated, onClose };
}

describe("MemberDetailsDialog", () => {
  it("saves trimmed profile fields and adopts the complete server-returned user", async () => {
    const update = vi.fn<NonNullable<UserGovernanceActions["updateUserProfile"]>>();
    const { user, onUpdated } = renderMember(update);
    const returned = { ...user, name: "Liu Min Updated", title: "Senior Engineer", isActive: false };
    update.mockResolvedValue(returned);
    expect(screen.queryByRole("button", { name: "保存基本资料" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "  Liu Min Updated  " } });
    fireEvent.change(screen.getByLabelText("职务（选填）"), { target: { value: "  Senior Engineer  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存基本资料" }));

    expect(await screen.findByRole("status")).toHaveTextContent("成员资料已保存。");
    expect(update).toHaveBeenCalledExactlyOnceWith(user.id, { name: "Liu Min Updated", title: "Senior Engineer" });
    expect(onUpdated).toHaveBeenCalledExactlyOnceWith(returned);
    expect(screen.getByLabelText("姓名")).toHaveValue(returned.name);
    expect(screen.getByLabelText("职务（选填）")).toHaveValue(returned.title);
    expect(screen.queryByRole("button", { name: "保存基本资料" })).not.toBeInTheDocument();
    expect(requestSettingsLeave()).toBe(true);
  });

  it("blocks dismissal and duplicate saves while pending and preserves a rejected draft for retry", async () => {
    let rejectSave!: (error: Error) => void;
    const update = vi.fn(() => new Promise<User>((_resolve, reject) => { rejectSave = reject; }));
    const { onUpdated, onClose } = renderMember(update);
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Pending Name" } });
    fireEvent.click(screen.getByRole("button", { name: "保存基本资料" }));
    const pendingButton = screen.getByRole("button", { name: "保存中…" });
    expect(pendingButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();
    expect(screen.getByLabelText("姓名")).toBeDisabled();
    expect(requestSettingsLeave()).toBe(false);
    fireEvent.click(pendingButton);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => { rejectSave(new Error("网络中断")); });
    expect(await screen.findByRole("alert", { name: "保存错误摘要" })).toHaveTextContent("网络中断");
    expect(screen.getByLabelText("姓名")).toHaveValue("Pending Name");
    expect(screen.getByRole("button", { name: "保存基本资料" })).toBeEnabled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("guards unsaved navigation and closes only after confirming discard", async () => {
    const update = vi.fn();
    const { onClose } = renderMember(update);
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Unsaved Name" } });
    let decision: boolean | Promise<boolean> = false;
    act(() => { decision = requestSettingsLeave(); });
    const leaveDialog = screen.getByRole("dialog", { name: "放弃未保存的更改？" });
    fireEvent.click(within(leaveDialog).getByRole("button", { name: "继续编辑" }));
    expect(await decision).toBe(false);
    expect(screen.getByLabelText("姓名")).toHaveValue("Unsaved Name");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "放弃并离开" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(update).not.toHaveBeenCalled();
  });

  it("lets the router guard team navigation once, preserving the modal on cancel", async () => {
    const state = createPrototypeState();
    const user = state.users.find((item) => item.id === "u-liu-min")!;
    const actions = createTestUserGovernanceActions({ updateUserProfile: vi.fn() });
    function RoutedExample() {
      const [route, setRoute] = useState("members");
      const [open, setOpen] = useState(true);
      const navigate = () => {
        const decision = requestSettingsLeave();
        if (decision instanceof Promise) void decision.then((allowed) => { if (allowed) setRoute("teams"); });
        else if (decision) setRoute("teams");
      };
      return route === "teams" ? <h1>团队管理</h1> : open ? <MemberDetailsDialog user={user} state={state}
        actions={actions} roleEditor={<span>组织角色编辑</span>} roleLabel={(roleId) => roleId}
        onUpdated={vi.fn()} onClose={() => setOpen(false)} onManageTeams={navigate} /> : <p>成员列表</p>;
    }
    render(<RoutedExample />);
    expect(screen.getByLabelText("姓名")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Unsaved Name" } });
    fireEvent.click(screen.getByRole("button", { name: "管理团队归属" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("姓名")).toHaveValue("Unsaved Name");
    expect(screen.queryByRole("heading", { name: "团队管理" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "管理团队归属" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "放弃未保存的更改？" })).getByRole("button", { name: "放弃并离开" }));
    expect(await screen.findByRole("heading", { name: "团队管理" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
