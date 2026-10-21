import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileDialog } from "./App";
import { initialState } from "@/infrastructure/mock/prototypeState";

const user = initialState.users[0];
afterEach(cleanup);
describe("authentication-aware profile dialog", () => {
  it("lets an OIDC user edit application display fields without offering a local password or an invented identity-provider URL", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined), onChangePassword = vi.fn();
    render(<ProfileDialog user={user} onCancel={vi.fn()} onSave={onSave} onChangePassword={onChangePassword}
      getAuthConfig={async () => ({ provider: "oidc", selfRegisterEnabled: false, hasLocalAdmin: true, evaluationOrganizationName: null })} />);
    expect(await screen.findByText(/密码由组织身份提供方管理/)).toBeVisible();
    expect(screen.queryByLabelText("当前密码")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "Application display name" } });
    fireEvent.change(screen.getByLabelText("职务"), { target: { value: "Application title" } });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Application display name", title: "Application title" });
    expect(onChangePassword).not.toHaveBeenCalled();
  });
  it("waits for actual local capability, retains failed password input, and clears it after a successful retry", async () => {
    let resolve!: (value: { provider: "local"; selfRegisterEnabled: boolean; hasLocalAdmin: boolean; evaluationOrganizationName: null }) => void;
    const getAuthConfig = () => new Promise<{ provider: "local"; selfRegisterEnabled: boolean; hasLocalAdmin: boolean; evaluationOrganizationName: null }>((done) => { resolve = done; });
    const onChangePassword = vi.fn().mockRejectedValueOnce(new Error("wrong password")).mockResolvedValue(undefined);
    render(<ProfileDialog user={user} onCancel={vi.fn()} onSave={vi.fn()} onChangePassword={onChangePassword} getAuthConfig={getAuthConfig} />);
    expect(screen.queryByLabelText("当前密码")).toBeNull();
    resolve({ provider: "local", selfRegisterEnabled: true, hasLocalAdmin: true, evaluationOrganizationName: null });
    fireEvent.change(await screen.findByLabelText("当前密码"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password" } });
    await userEvent.click(screen.getByRole("button", { name: "更新密码" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("修改密码失败");
    expect(screen.getByLabelText("当前密码")).toHaveValue("old-password");
    await userEvent.click(screen.getByRole("button", { name: "更新密码" }));
    await waitFor(() => expect(screen.getByLabelText("当前密码")).toHaveValue(""));
    expect(onChangePassword).toHaveBeenCalledTimes(2);
  });
  it("keeps profile editing usable while capability loading fails, and retries without assuming a local password service", async () => {
    const getAuthConfig = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ provider: "oidc", selfRegisterEnabled: false, hasLocalAdmin: true, evaluationOrganizationName: null });
    render(<ProfileDialog user={user} onCancel={vi.fn()} onSave={vi.fn()} onChangePassword={vi.fn()} getAuthConfig={getAuthConfig} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法确认密码修改能力");
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    expect(screen.queryByLabelText("当前密码")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "重试账号能力" }));
    expect(await screen.findByText(/密码由组织身份提供方管理/)).toBeVisible();
  });
});
