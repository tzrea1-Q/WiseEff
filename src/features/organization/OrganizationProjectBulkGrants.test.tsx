import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OrganizationProjectsPanel } from "./OrganizationProjectsPanel";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import { createApiClient } from "@/infrastructure/http/apiClient";

afterEach(() => vi.unstubAllGlobals());
const person = (id: string, isActive = true) => ({ id, name: id, title: "Engineer", isActive, organizationId: "target", roles: [], createdAt: "2026-01-01", lastActiveAt: null });
const member = (userId: string, roles: string[]) => ({ userId, name: userId, username: null, title: "Engineer", isActive: true, roles });
function setup(mode: "normal" | "retry" = "normal", holdWrite?: () => Promise<void>) {
  let members = [member("Alice", ["hardware-user"])], writes = 0;
  const bodies: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("organizationId")).toBe("target");
    let body: unknown;
    if (url.pathname.endsWith("project-candidates")) body = { items: [{ id: "project", name: "Target project" }] };
    else if (url.pathname.endsWith("/teams")) body = { items: [{ id: "team", organizationId: "target", name: "Engineering", memberIds: ["Alice", "Bob", "Inactive", "Gone"] }] };
    else if (url.pathname.endsWith("/users")) body = { items: [person("Alice"), person("Bob"), person("Inactive", false)] };
    else if (init?.method === "PUT") {
      bodies.push(JSON.parse(String(init.body))); writes++;
      await holdWrite?.();
      const id = url.pathname.split("/").at(-1)!;
      if (mode === "retry" && writes === 1) {
        members = [member("Alice", ["hardware-user", "hardware-committer"])];
        return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "项目参与角色已更新，请刷新后重试。" } }), { status: 409 });
      }
      const roles = (JSON.parse(String(init.body)) as { roles: string[] }).roles;
      members = [...members.filter((item) => item.userId !== id), member(id, roles)];
      if (mode === "retry" && writes === 2) throw new TypeError("Failed to fetch");
      body = { projectId: "project", members };
    } else body = { projectId: "project", members };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  const view = render(<OrganizationProjectsPanel client={createUserGovernanceClient(createApiClient({ baseUrl: "http://localhost" }), "target")} />);
  return { bodies, unmount: view.unmount };
}
async function preview() {
  await userEvent.click(await screen.findByRole("button", { name: "批量授予项目角色" }));
  const dialog = screen.getByRole("dialog", { name: "批量授予项目角色" });
  await userEvent.click(await within(dialog).findByRole("combobox", { name: "选择来源团队" }));
  await userEvent.click(screen.getByRole("option", { name: "Engineering" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "授予项目编辑角色" }));
  await userEvent.click(await screen.findByRole("checkbox", { name: "软件开发" }));
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(dialog).getByRole("button", { name: "预览授权" }));
  return dialog;
}
it("previews concrete team members and adds roles without replacing existing participation", async () => {
  const { bodies } = setup();
  const dialog = await preview();
  const table = within(dialog).getByRole("table", { name: "批量项目授权结果" });
  expect(table).toHaveTextContent("Target project");
  expect(within(table).getByRole("row", { name: /Alice/ })).toHaveTextContent("硬件开发、软件开发");
  expect(within(table).getByRole("row", { name: /Inactive/ })).toHaveTextContent("已跳过：账号已停用");
  expect(within(table).getByRole("row", { name: /Gone/ })).toHaveTextContent("成员已不存在或不属于当前组织");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认授予 2 人" }));
  expect(await within(dialog).findByText("已生效 2 人，需重试 0 人，已跳过 2 人")).toBeInTheDocument();
  expect(bodies).toEqual([
    { roles: ["hardware-user", "software-user"], expectedRoles: ["hardware-user"] },
    { roles: ["software-user"], expectedRoles: [] }
  ]);
});
it("retains mixed results and reconciles conflict and uncertain writes before retrying only unfinished members", async () => {
  const { bodies } = setup("retry");
  const dialog = await preview();
  await userEvent.click(within(dialog).getByRole("button", { name: "确认授予 2 人" }));
  expect(await within(dialog).findByText("已生效 0 人，需重试 2 人，已跳过 2 人")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "确认授予 2 人" })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "重新核对可重试项" }));
  expect(await within(dialog).findByText("已核实生效")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "确认授予 1 人" }));
  expect(await within(dialog).findByText("已生效 2 人，需重试 0 人，已跳过 2 人")).toBeInTheDocument();
  expect(bodies).toHaveLength(3);
  expect(bodies[2]).toEqual({ roles: ["hardware-user", "hardware-committer", "software-user"], expectedRoles: ["hardware-user", "hardware-committer"] });
});
it("stops the remaining batch when its target workspace is left during a pending write", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const { bodies, unmount } = setup("normal", () => held);
  const dialog = await preview();
  await userEvent.click(within(dialog).getByRole("button", { name: "确认授予 2 人" }));
  await vi.waitFor(() => expect(bodies).toHaveLength(1));
  unmount();
  await act(async () => { release(); await held; });
  expect(bodies).toHaveLength(1);
});
