import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createApiClient } from "@/infrastructure/http/apiClient";
import { createCanonicalMemberAdditionClient } from "@/infrastructure/http/canonicalMemberAdditionClient";
import { WorkbenchMemberAdditionDialog } from "./WorkbenchMemberAdditionDialog";

afterEach(cleanup);
it("retains choices on a refused preview and confirms the complete preview with the keyboard", async () => {
  const user = userEvent.setup(), submitted = vi.fn(), requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let failed = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input), body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ path, body });
    if (path.endsWith("/preview") && !failed) { failed = true; return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "来源已变化，请重新预览。" } }), { status: 409 }); }
    return new Response(JSON.stringify({ item: path.endsWith("/apply") ? { requestId: "request", fileId: "file", fileVersionId: "version", configRevisionId: "revision" } : {
      proofToken: "a".repeat(64), configSetId: "set", fileName: "overlay.dts", format: "dts", members: [
        { fileId: "file", fileVersionId: "version", sourceName: "overlay.dts", format: "dts", role: "overlay", sortOrder: 2, checksum: "digest", sizeBytes: 12 }],
      entryFile: "board.dts", includeSearchPaths: ["."], overlayOrder: ["overlay.dts"], diagnostics: [],
      impact: { parameterChanges: 1, nodeAdditions: 0, nodeRemovals: 0, retainedBindings: 1, sourceReplacements: 0 }
    } }), { status: 200 });
  };
  const client = createCanonicalMemberAdditionClient(createApiClient({ baseUrl: "", fetchImpl }));
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{ id: "set", name: "默认配置" }]} initialConfigSetId="set"
    availableFiles={[{ id: "file", projectId: "project", fileName: "overlay.dts", format: "dts", enabled: true, updatedAt: "" }]}
    client={client} onDismiss={vi.fn()} onApplied={submitted} />);
  await user.selectOptions(screen.getByLabelText("文件来源"), "existing");
  await user.selectOptions(screen.getByLabelText("文件用途"), "overlay");
  await user.clear(screen.getByLabelText("文件顺序")); await user.type(screen.getByLabelText("文件顺序"), "2");
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("来源已变化");
  expect(screen.getByLabelText("文件用途")).toHaveValue("overlay");
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(await screen.findByText("参数变化：1；新增节点：0；移除节点：0。")).toBeInTheDocument();
  await user.type(screen.getByLabelText("加入原因"), "Add reviewed overlay");
  screen.getByRole("button", { name: "确认加入配置" }).focus(); await user.keyboard("{Enter}");
  expect(submitted).toHaveBeenCalledOnce();
  expect(requests.at(-1)?.body).toMatchObject({ role: "overlay", sortOrder: 2, fileId: "file", proofToken: "a".repeat(64) });
});

it("allows a JSON source member without forcing parameter registration and shows its zero-admission preview", async () => {
  const user = userEvent.setup(); let submitted: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    submitted = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ item: { proofToken: "b".repeat(64), configSetId: "set", fileName: "metadata.json", format: "json",
      members: [{ fileId: "json", fileVersionId: "version", sourceName: "metadata.json", format: "json", role: "misc", sortOrder: 0, checksum: "digest", sizeBytes: 12 }],
      entryFile: null, includeSearchPaths: [], overlayOrder: [], diagnostics: [{ severity: "warning", code: "json-unregistered", message: "未登记为参数，将产生 0 个新 Binding。" }],
      impact: { parameterChanges: 0, nodeAdditions: 0, nodeRemovals: 0, retainedBindings: 0, sourceReplacements: 0 } } }), { status: 200 });
  };
  render(<WorkbenchMemberAdditionDialog projectId="project" configSets={[{ id: "set", name: "默认配置" }]} initialConfigSetId="set"
    availableFiles={[{ id: "json", projectId: "project", fileName: "metadata.json", format: "json", enabled: true, updatedAt: "" }]}
    client={createCanonicalMemberAdditionClient(createApiClient({ baseUrl: "", fetchImpl }))} onDismiss={vi.fn()} onApplied={vi.fn()} />);
  await user.selectOptions(screen.getByLabelText("文件来源"), "existing");
  await user.click(screen.getByRole("button", { name: "预览加入配置" }));
  expect(await screen.findByText("未登记为参数，将产生 0 个新 Binding。")).toBeInTheDocument();
  expect(submitted).toMatchObject({ fileId: "json", role: "misc" });
  expect(submitted).not.toHaveProperty("json");
});
