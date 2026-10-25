import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { SharedDtsiPage } from "./SharedDtsiPage";

beforeAll(() => {
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
function setup(options: { writable?: boolean; saveError?: boolean } = {}) {
  const resourceId = "33333333-3333-4333-8333-333333333333";
  let item: Record<string, unknown> | null = null;
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const input = JSON.parse(init!.body as string);
      item = { id: "11111111-1111-4111-8111-111111111111", resourceId, name: input.name, revision: 1, updatedAt: "2026-10-25T00:00:00Z",
        members: [{ id: "22222222-2222-4222-8222-222222222222", sourceName: input.sourceName, content: input.content }] };
      return new Response(JSON.stringify({ item }), { status: 201 });
    }
    if (method === "PUT" && options.saveError) return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "草稿已被更新，请重新载入后核对；本地修改仍保留。" } }), { status: 409 });
    if (method === "GET" && String(_url).includes(resourceId)) return new Response(JSON.stringify({ item }));
    return new Response(JSON.stringify({ items: item ? [{ ...item, sourceName: "common.dtsi" }] : [], total: item ? 1 : 0 }));
  });
  const api = createApiClient({ baseUrl: "", fetchImpl });
  function Harness() {
    const [search, setSearch] = useState("");
    return <SharedDtsiPage apiClient={api} canWrite={options.writable ?? true} search={search}
      onNavigate={path => setSearch(new URL(path, "http://localhost").search)} />;
  }
  return { ...render(<Harness />), fetchImpl };
}

describe("shared DTSI draft authoring", () => {
  it("saves a draft and preserves edited input when a later save conflicts", async () => {
    const user = userEvent.setup();
    setup({ saveError: true });
    await user.click(await screen.findByRole("button", { name: "导入资源" }));
    await user.type(screen.getByLabelText("资源名称"), "Battery common");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByText("草稿已保存");
    await user.type(screen.getByLabelText("资源名称"), " changed");
    const event = new Event("beforeunload", { cancelable: true });
    act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "返回资源列表" }));
    await screen.findByRole("dialog", { name: "放弃未保存的更改？" });
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("资源名称")).toHaveValue("Battery common changed");
    expect(screen.getByRole("button", { name: "重新载入" })).toBeVisible();
  });

  it("does not offer draft mutations to a resource reader", async () => {
    setup({ writable: false });
    await screen.findByText("尚无共享 DTSI");
    expect(screen.queryByRole("button", { name: "导入资源" })).not.toBeInTheDocument();
  });
});
