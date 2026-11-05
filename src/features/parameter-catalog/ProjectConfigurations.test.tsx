import { act, fireEvent, render, screen } from "@testing-library/react";
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

it("labels a DTS boolean as present even when its source value has no text", async () => {
  const data = response("项目", "");
  data.items[0]!.valueKind = "boolean";
  const repository = { ...createMockParameterCatalogRepository(), getProjectConfigurations: vi.fn().mockResolvedValue(data) };
  render(<ProjectConfigurations repository={repository} organizationId="org-a" definitionId="definition" onChange={() => {}} />);
  expect(await screen.findByText("存在")).toBeVisible();
});
