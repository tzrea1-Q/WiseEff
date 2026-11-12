import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createMockParameterCatalogRepository } from "@/application/parameter-catalog/mockAdapter";
import type { CatalogProjectConfigurationsResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { ProjectConfigurations } from "./ProjectConfigurations";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function response(projectName: string, value: string): CatalogProjectConfigurationsResponse {
  return { summary: { configuredProjectCount: 1, configuredInstanceCount: 1 }, totalCount: 1, readAt: "2026-11-05T00:00:00.000Z", nextCursor: null, continuedProjectId: null,
    selected: null, items: [{ kind: "instance", bindingId: projectName, projectId: projectName, projectName,
      configSetId: "set", configSetName: "配置集", sourceOccurrenceId: "source", sourceFormat: "dts",
      fileId: "file", fileVersionId: "version", fileName: "board.dts", sourceLocator: { propertyName: "limit" }, sourceLocation: "/charger · limit",
      currentValueId: "value", definitionRevisionId: "revision", definitionRevisionNumber: "1", effectiveRevisionId: "revision",
      unit: null, definitionLifecycle: "active", valueState: "present", valueKind: "number", valuePreview: value, valuePreviewTruncated: false }] };
}

it("clears the prior Organization and ignores its delayed response after switching", async () => {
  const previous = deferred<CatalogProjectConfigurationsResponse>();
  const current = deferred<CatalogProjectConfigurationsResponse>();
  const repository = { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn()
    .mockResolvedValueOnce(response("旧项目", "旧值"))
    .mockReturnValueOnce(previous.promise)
    .mockReturnValueOnce(current.promise) };
  const view = render(<ProjectConfigurations repository={repository} organizationId="org-a" definitionId="definition" onChange={() => {}} />);
  expect(await screen.findByText("旧值")).toBeVisible();
  expect(screen.getByText(/已配置实例 1/)).toBeVisible();
  view.rerender(<ProjectConfigurations repository={repository} organizationId="org-a" definitionId="definition" selectedId="selection" onChange={() => {}} />);
  view.rerender(<ProjectConfigurations repository={repository} organizationId="org-b" definitionId="definition" onChange={() => {}} />);
  expect(screen.queryByText("旧值")).not.toBeInTheDocument();
  expect(screen.queryByText(/已配置实例 1/)).not.toBeInTheDocument();
  await act(async () => previous.resolve(response("迟到的旧项目", "迟到的旧值")));
  expect(screen.queryByText("迟到的旧值")).not.toBeInTheDocument();
  await act(async () => current.resolve(response("新项目", "新值")));
  expect(screen.getByText("新值")).toBeVisible();
  expect(screen.queryByText("旧值")).not.toBeInTheDocument();
});

it("explains a stale page and lets the reader restart from the first page", async () => {
  const onChange = vi.fn();
  const repository = { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn()
    .mockRejectedValue(new WiseEffApiError("VALIDATION_FAILED", "stale", { reason: "invalid-cursor" }, "request")) };
  render(<ProjectConfigurations repository={repository} organizationId="org-a" definitionId="definition" cursor="old" onChange={onChange} />);
  expect(await screen.findByText(/项目配置已变化/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "返回第一页" }));
  expect(onChange).toHaveBeenCalledWith({ instance: null, instanceCursor: null });
});

it("allows resetting a project filter that is unavailable in the current Organization", async () => {
  const onChange = vi.fn();
  const repository = { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn()
    .mockRejectedValue(new WiseEffApiError("NOT_FOUND", "missing", { reason: "invalid-filter" }, "request")) };
  render(<ProjectConfigurations repository={repository} organizationId="org-b" definitionId="definition" projectId="old-project" onChange={onChange} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("所选项目或配置集在当前可查看范围内不可用");
  fireEvent.click(screen.getByRole("button", { name: "重置项目和配置集" }));
  expect(onChange).toHaveBeenCalledWith({ configProjectId: null, configSetId: null, instanceCursor: null });
});

it("labels a DTS boolean as present even when its source value has no text", async () => {
  const data = response("项目", "");
  if (data.items[0]?.kind !== "instance") throw new Error("Expected an instance");
  data.items[0].valueKind = "boolean";
  const repository = { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn().mockResolvedValue(data) };
  render(<ProjectConfigurations repository={repository} organizationId="org-a" definitionId="definition" onChange={() => {}} />);
  expect(await screen.findByText("当前可查看范围")).toBeVisible();
  expect(await screen.findByText("存在")).toBeVisible();
});

it("opens the exact project and configuration set from an instance row", async () => {
  const repository = { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn().mockResolvedValue(response("项目", "42")) };
  const onOpenProject = vi.fn();
  render(<ProjectConfigurations repository={repository} definitionId="definition" onChange={() => {}} onOpenProject={onOpenProject} />);
  fireEvent.click(await screen.findByRole("button", { name: "在项目中打开 board.dts /charger · limit" }));
  expect(onOpenProject).toHaveBeenCalledWith(expect.objectContaining({ bindingId: "项目", projectId: "项目", configSetId: "set" }));
});

it("copies the selected full source exactly and keeps it available after clipboard failure", async () => {
  const data = response("项目", "truncated");
  const item = data.items[0];
  if (item?.kind !== "instance") throw new Error("Expected an instance");
  data.selected = { ...item, rawValue: '"long\\nvalue"\nsecond line\n' };
  const write = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce();
  const repository = { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn().mockResolvedValue(data) };
  render(<ProjectConfigurations repository={repository} organizationId="org-a" definitionId="definition" selectedId="项目" onChange={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "复制完整原值" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
  expect(screen.getByRole("region", { name: "选中的完整值" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "复制完整原值" }));
  await waitFor(() => expect(write).toHaveBeenLastCalledWith('"long\\nvalue"\nsecond line\n'));
  expect(await screen.findByRole("status")).toHaveTextContent("已复制");
  write.mockRestore();
});

it("hides a previously selected value as soon as the read context changes", async () => {
  const first = response("项目", "preview");
  const item = first.items[0];
  if (item?.kind !== "instance") throw new Error("Expected an instance");
  first.selected = { ...item, rawValue: "old source" };
  const next = deferred<CatalogProjectConfigurationsResponse>();
  const repository = { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn().mockResolvedValueOnce(first).mockReturnValueOnce(next.promise) };
  const view = render(<ProjectConfigurations repository={repository} organizationId="org-a" definitionId="definition" selectedId="项目" onChange={() => {}} />);
  expect(await screen.findByText("old source")).toBeVisible();
  view.rerender(<ProjectConfigurations repository={repository} organizationId="org-a" definitionId="definition" selectedId="other" onChange={() => {}} />);
  expect(screen.queryByText("old source")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "复制完整原值" })).not.toBeInTheDocument();
});
