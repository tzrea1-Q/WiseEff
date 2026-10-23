import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkflowPublicationAdminState } from "@/domain/workflowPublication";
import type { WorkflowPublicationClient } from "@/infrastructure/http/workflowPublicationClient";
import { WorkflowPublicationPage } from "./WorkflowPublicationPage";

afterEach(cleanup);

function configuration(): WorkflowPublicationAdminState {
  return {
    workflows: { "parameter-management": true, debugging: true, "log-analysis": true, knowledge: true },
    version: 7,
    updatedAt: "2026-10-23T08:00:00.000Z",
    updatedBy: { id: "platform-admin-1", name: "平台管理员" }
  };
}

function createClient(): WorkflowPublicationClient {
  return {
    getPublication: vi.fn(async () => configuration()),
    getAdministration: vi.fn(async () => configuration()),
    updatePublication: vi.fn(async ({ workflows, expectedVersion }) => ({
      ...configuration(), workflows, version: expectedVersion + 1
    }))
  };
}

async function knowledgeOptions() {
  return within(await screen.findByRole("radiogroup", { name: "知识库开放状态" }));
}

describe("WorkflowPublicationPage", () => {
  it("keeps changes local until save, sends the loaded version, and discards to the latest saved state", async () => {
    const client = createClient();
    const onSaved = vi.fn();
    render(<WorkflowPublicationPage client={client} onSaved={onSaved} />);
    const options = await knowledgeOptions();
    expect(options.getByRole("radio", { name: "开放" })).toBeChecked();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.click(options.getByRole("radio", { name: "不开放" }));
    expect(client.updatePublication).not.toHaveBeenCalled();
    expect(screen.getByText("未保存")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(options.getByRole("radio", { name: "开放" })).toBeChecked();
    fireEvent.click(options.getByRole("radio", { name: "不开放" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ version: 8, workflows: { ...configuration().workflows, knowledge: false } })));
    expect(client.updatePublication).toHaveBeenCalledExactlyOnceWith({ expectedVersion: 7, workflows: { ...configuration().workflows, knowledge: false } });
    expect(screen.getByRole("status")).toHaveTextContent("工作流发布配置已保存");
    expect(screen.getByText("平台管理员")).toHaveAttribute("title", "账户 platform-admin-1");
    expect(screen.queryByText("未保存")).not.toBeInTheDocument();
    fireEvent.click(options.getByRole("radio", { name: "开放" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(options.getByRole("radio", { name: "不开放" })).toBeChecked();
    expect(client.updatePublication).toHaveBeenCalledTimes(1);
  });

  it("shows a load error without invented defaults and recovers through retry", async () => {
    const client = createClient();
    vi.mocked(client.getAdministration).mockRejectedValueOnce(new Error("service unavailable"));
    render(<WorkflowPublicationPage client={client} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载工作流发布配置");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "发布记录" })).not.toBeInTheDocument();
    expect(screen.queryByText("保存失败")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await knowledgeOptions();
    expect(client.getAdministration).toHaveBeenCalledTimes(2);
    expect(client.updatePublication).not.toHaveBeenCalled();
  });

  it("retains the draft after a failed save and allows a retry without claiming success", async () => {
    const client = createClient();
    const onSaved = vi.fn();
    vi.mocked(client.updatePublication).mockRejectedValueOnce(new Error("service unavailable"));
    render(<WorkflowPublicationPage client={client} onSaved={onSaved} />);
    const options = await knowledgeOptions();
    fireEvent.click(options.getByRole("radio", { name: "不开放" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存发布配置失败，你的修改已保留");
    expect(options.getByRole("radio", { name: "不开放" })).toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(client.updatePublication).toHaveBeenCalledTimes(2);
  });

  it("blocks stale saves, confirms replacing a conflict draft, and keeps it when refresh fails", async () => {
    const client = createClient();
    vi.mocked(client.updatePublication).mockRejectedValueOnce(Object.assign(new Error("stale version"), { code: "CONFLICT" }));
    render(<WorkflowPublicationPage client={client} />);
    const options = await knowledgeOptions();
    fireEvent.click(options.getByRole("radio", { name: "不开放" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("发布配置已被其他管理员修改");
    expect(options.getByRole("radio", { name: "不开放" })).toBeChecked();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "工作流发布设置" }));
    expect(client.updatePublication).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "重新加载配置" }));
    fireEvent.click(screen.getByRole("button", { name: "保留当前修改" }));
    expect(client.getAdministration).toHaveBeenCalledOnce();
    expect(options.getByRole("radio", { name: "不开放" })).toBeChecked();
    vi.mocked(client.getAdministration).mockRejectedValueOnce(new Error("refresh unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "重新加载配置" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃并重新加载" }));
    expect(await screen.findByText("无法加载工作流发布配置，请重试。")).toBeInTheDocument();
    expect(options.getByRole("radio", { name: "不开放" })).toBeChecked();
    expect(options.getByRole("radio", { name: "不开放" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃并重新加载" }));
    await waitFor(() => expect(options.getByRole("radio", { name: "开放" })).toBeChecked());
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(client.getAdministration).toHaveBeenCalledTimes(3);
  });
});
