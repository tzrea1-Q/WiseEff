import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import {
  CATALOG_AUTHOR_PERSON_ID, CATALOG_ORGANIZATION_ID, CATALOG_RELEASE_ID, CATALOG_SUBJECT_ID,
  catalogPublicationCandidate, catalogPublicationJob, catalogRegistration, readyCatalogDocument, registeredSubject, unregisteredSubject,
} from "@/application/parameter-catalog/fixtures";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { takeBatchRegistrationHandoff } from "./batchRegistrationHandoff";
import { PUBLICATION_JOB_STORAGE_KEY } from "./publicationJobStorage";
import { emptyPublicationDraft } from "./publicationState";
import { DefinitionImportDialog } from "./DefinitionImportDialog";

afterEach(() => { cleanup(); window.localStorage.removeItem(PUBLICATION_JOB_STORAGE_KEY); });

function renderImport(options: {
  outcome?: "active" | "needs-rebase";
  runtimeMode?: "api" | "mock";
  modules?: ParameterModule[];
  initialDocument?: string;
  prepare?: (ports: ReturnType<typeof createMockCatalogPorts>) => void;
} = {}) {
  const ports = createMockCatalogPorts({ publicationOutcome: options.outcome ?? "active" });
  options.prepare?.(ports);
  const completed = vi.fn();
  render(<DefinitionImportDialog open initialDocument={options.initialDocument} runtimeMode={options.runtimeMode ?? "api"}
    actor="org-admin" sessionPermissions={["catalog:author", "catalog:publish"]}
    domainState={deriveCatalogDomainState({ document: readyCatalogDocument })} catalog={ports.catalog}
    governance={ports.governance}
    moduleRegistry={{ getRegistry: async () => ({ modules: options.modules ?? [module("business", "电源", null, "business"),
      module("target", "充电器", "business", "driver-group")], mappings: [] }) }}
    catalogReleaseId={CATALOG_RELEASE_ID} currentPersonId={CATALOG_AUTHOR_PERSON_ID}
    organizationId={CATALOG_ORGANIZATION_ID} publicationSurface={{ publicationEnabled: true,
      lowRiskSingleActorPublish: false, policyRevision: 1, frozen: false, adopted: true,
      currentReleaseId: CATALOG_RELEASE_ID, authoringAllowed: true, publishingAllowed: true,
      reviewHighRiskAllowed: false, blockers: [] }}
    createIdempotencyKey={() => "pub-key"} onOpenChange={vi.fn()} onCompleted={completed} />);
  return { ports, completed };
}

it("opens a prepared document as editable pasted text without previewing or publishing", async () => {
  const preview = vi.fn();
  const { ports } = renderImport({ initialDocument: "# Driver `acme,power`\n", prepare: (ports) => {
    ports.catalog.previewMarkdownImport = preview;
  } });
  const publish = vi.spyOn(ports.catalog, "publishPublicationCandidate");
  expect(screen.getByLabelText("Markdown 文档")).toHaveValue("# Driver `acme,power`\n");
  expect(preview).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "解析并预览" })).toBeEnabled();
  await userEvent.setup().type(screen.getByLabelText("Markdown 文档"), "说明");
  expect(screen.getByLabelText("Markdown 文档")).toHaveValue("# Driver `acme,power`\n说明");
});

function module(id: string, name: string, parentId: string | null, kind: ParameterModule["kind"]): ParameterModule {
  return { id, name, parentId, kind, sortOrder: 0, description: "", scope: "", importance: "medium", origin: "curated",
    sourceKey: null, effectiveImportance: "medium", parameterCount: 0, definitionCount: 0 };
}

function restoreChildImport(owner = registeredSubject) {
  const child = { ...unregisteredSubject, id: "new-child", type: "node-type" as const,
    canonicalName: "battery", ownerSubjectId: owner.id };
  window.localStorage.setItem(PUBLICATION_JOB_STORAGE_KEY, JSON.stringify({
    jobId: catalogPublicationJob.id, candidateId: catalogPublicationJob.candidateId,
    catalogReleaseId: CATALOG_RELEASE_ID, userId: CATALOG_AUTHOR_PERSON_ID,
    organizationId: CATALOG_ORGANIZATION_ID, draft: emptyPublicationDraft(), markdownImport: true, idempotencyKey: "stored",
  }));
  const result = renderImport({ modules: [module(catalogRegistration.placement.moduleId!, "电源", null, "business")], prepare: ports => {
    vi.spyOn(ports.catalog, "getPublication").mockResolvedValue({ item: {
      ...catalogPublicationJob, status: "active", effective: true, isCurrent: true, currentness: "active",
    } });
    vi.spyOn(ports.catalog, "getPublicationCandidate").mockResolvedValue({ item: { ...catalogPublicationCandidate,
      impactSummary: { addedDefinitionCount: 1, changedDefinitionCount: 0, addedSubjectCount: 1, addedSubjectIds: [child.id] } } });
    vi.spyOn(ports.catalog, "getSubject").mockImplementation(async id => ({ item: id === child.id ? child : owner }));
    vi.spyOn(ports.catalog, "listSubjects").mockResolvedValue({ catalogReleaseId: CATALOG_RELEASE_ID, items: [child], totalCount: 1, hasMore: false, nextCursor: null });
    vi.spyOn(ports.governance, "getRegistration").mockResolvedValue({ item: catalogRegistration });
    vi.spyOn(ports.governance, "createRegistration").mockImplementation(async () => {
      child.registration = { ...registeredSubject.registration };
      return { item: catalogRegistration };
    });
  } });
  return { ...result, child };
}

it("hands an imported child to its unregistered driver without copying child placement hints", async () => {
  const { ports } = restoreChildImport(unregisteredSubject);
  await userEvent.click(await screen.findByRole("button", { name: "前往批量登记" }));
  expect(takeBatchRegistrationHandoff(CATALOG_ORGANIZATION_ID, CATALOG_AUTHOR_PERSON_ID)).toMatchObject({ subjectIds: [unregisteredSubject.id] });
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
});

it("explicitly registers missing children under an already registered driver and retains its module", async () => {
  const { ports } = restoreChildImport();
  await userEvent.click(await screen.findByRole("button", { name: /补登记子节点/ }));
  const dialog = await screen.findByRole("dialog", { name: "补登记子节点" });
  expect(dialog).toHaveTextContent("battery");
  expect(dialog).toHaveTextContent("电源");
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("button", { name: "确认补登记" })).toBeDisabled();
  await confirm("确认补登记");
  await waitFor(() => expect(ports.governance.createRegistration).toHaveBeenCalledTimes(1));
  expect(ports.governance.createRegistration).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID,
    expect.objectContaining({ subjectId: registeredSubject.id, placement: { mode: "use-default" },
      destinationModuleId: catalogRegistration.placement.moduleId }),
    expect.objectContaining({ catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: expect.any(String) }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /补登记子节点/ })).not.toBeInTheDocument());
});

it("keeps the same supplement request on a lost response", async () => {
  const { ports } = restoreChildImport();
  vi.mocked(ports.governance.createRegistration).mockRejectedValueOnce(new Error("response lost"));
  await userEvent.click(await screen.findByRole("button", { name: /补登记子节点/ }));
  await confirm("确认补登记");
  expect(await screen.findByText(/补登记失败/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "确认补登记" }));
  await waitFor(() => expect(ports.governance.createRegistration).toHaveBeenCalledTimes(2));
  const calls = vi.mocked(ports.governance.createRegistration).mock.calls;
  expect(calls[1]).toEqual(calls[0]);
});

it("requires refreshed evidence and a new acknowledgement after registration changes", async () => {
  const { ports } = restoreChildImport();
  vi.mocked(ports.governance.createRegistration).mockRejectedValueOnce(
    new WiseEffApiError("CONFLICT", "changed", { reason: "placement-conflict" }, "request", 409));
  await userEvent.click(await screen.findByRole("button", { name: /补登记子节点/ }));
  await confirm("确认补登记");
  expect(await screen.findByText(/重新读取登记信息并确认/)).toBeVisible();
  expect(screen.getByRole("button", { name: "确认补登记" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "重新读取登记信息" }));
  const dialog = await screen.findByRole("dialog", { name: "补登记子节点" });
  expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
  await confirm("确认补登记");
  await waitFor(() => expect(ports.governance.createRegistration).toHaveBeenCalledTimes(2));
  const calls = vi.mocked(ports.governance.createRegistration).mock.calls;
  expect(calls[1]![2].idempotencyKey).not.toEqual(calls[0]![2].idempotencyKey);
});

it.each([
  ["registration-required", "CONFLICT", 409],
  ["subject-retired", "CONFLICT", 409],
  ["forbidden", "FORBIDDEN", 403],
] as const)("stops retrying a rejected confirmation when the server reports %s", async (reason, code, status) => {
  const { ports } = restoreChildImport();
  vi.mocked(ports.governance.createRegistration).mockRejectedValueOnce(new WiseEffApiError(code, "rejected", { reason }, "request", status));
  await userEvent.click(await screen.findByRole("button", { name: /补登记子节点/ }));
  await confirm("确认补登记");
  expect(await screen.findByRole("button", { name: "重新读取登记信息" })).toBeVisible();
  expect(screen.getByRole("button", { name: "确认补登记" })).toBeDisabled();
  expect(screen.queryByText(/可重试同一次操作/)).not.toBeInTheDocument();
  expect(ports.governance.createRegistration).toHaveBeenCalledTimes(1);
});

it("reads all pages and shows missing children beyond the import, without including another owner or retired registrations", async () => {
  const { ports, child } = restoreChildImport();
  vi.mocked(ports.catalog.listSubjects)
    .mockResolvedValueOnce({ catalogReleaseId: CATALOG_RELEASE_ID, items: [{ ...child, id: "other-owner", ownerSubjectId: "another-driver" }], totalCount: 4, hasMore: true, nextCursor: "next" })
    .mockResolvedValueOnce({ catalogReleaseId: CATALOG_RELEASE_ID, items: [child, { ...child, id: "older-child", canonicalName: "older_battery" },
      { ...child, id: "retired-child", canonicalName: "retired_battery", registration: { ...catalogRegistration, status: "retired" } }],
    totalCount: 4, hasMore: false, nextCursor: null });
  await userEvent.click(await screen.findByRole("button", { name: /补登记子节点/ }));
  const dialog = await screen.findByRole("dialog", { name: "补登记子节点" });
  expect(within(dialog).getAllByRole("listitem").map(row => row.textContent)).toEqual(["battery", "older_battery"]);
  expect(ports.catalog.listSubjects).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next", registration: "unregistered", catalogReleaseId: CATALOG_RELEASE_ID }));
  await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
});

it("preserves unset placement and directs the administrator to choose it before supplementing", async () => {
  const { ports } = restoreChildImport();
  vi.mocked(ports.governance.getRegistration).mockResolvedValue({ item: { ...catalogRegistration,
    placement: { ...catalogRegistration.placement, moduleId: undefined } } });
  await userEvent.click(await screen.findByRole("button", { name: /补登记子节点/ }));
  expect(await screen.findByText(/设置有效的业务归属/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "确认补登记" })).not.toBeInTheDocument();
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
});

it("directs a retired driver to module management without offering registration", async () => {
  const { ports } = restoreChildImport({ ...registeredSubject, registration: { ...catalogRegistration, status: "retired" } });
  expect(await screen.findByText(/先恢复驱动/)).toBeVisible();
  expect(screen.getByRole("link", { name: /模块管理/ })).toHaveAttribute("href", expect.stringContaining("/parameter-admin/modules"));
  expect(screen.getByRole("link", { name: /模块管理/ })).toHaveAttribute("target", "_blank");
  expect(new URL(screen.getByRole("link", { name: /模块管理/ }).getAttribute("href")!, "http://localhost").searchParams.get("organizationId"))
    .toBe(CATALOG_ORGANIZATION_ID);
  expect(screen.queryByRole("button", { name: /补登记子节点|前往批量登记/ })).not.toBeInTheDocument();
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
});

it("hands unregistered new subjects to batch registration without registering them", async () => {
  const { ports } = renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async (_, context) => {
      const response = await ports.catalog.createPublicationCandidate({ changeSet: [{ op: "create-subject-with-definitions",
        kind: "driver", canonicalKey: "driver:acme,new", selector: { kind: "driver-compatible", value: "acme,new" },
        nature: "physical-device", cardinality: "multiple", definitions: [{ propertyKey: "one", content: {
          displayName: "参数", documentation: "", valueSchema: { type: "integer" },
        } }] }] }, context);
      return { item: { candidate: response.item, noChange: false, source: { fileName: "d.md", sha256: "sha256:test", parserVersion: "v1" }, entries: [], placementHints: [] } };
    };
    vi.spyOn(ports.catalog, "getSubject").mockImplementation(async (id) => ({ item: {
      ...unregisteredSubject, id, canonicalName: "acme,new", registration: { status: "unregistered" },
    } }));
    vi.spyOn(ports.governance, "createRegistration");
  } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "文档内容");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  expect(await screen.findByLabelText("发布预览")).toHaveTextContent("风险高");
  await user.click(screen.getByRole("button", { name: "发布到目录" }));
  await confirm("确认发布");
  await user.click(await screen.findByRole("button", { name: "前往批量登记" }));
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
  expect(takeBatchRegistrationHandoff(CATALOG_ORGANIZATION_ID, CATALOG_AUTHOR_PERSON_ID)).toMatchObject({ subjectIds: ["csub_new_1"] });
});

it("offers batch registration after restoring an activated import", async () => {
  window.localStorage.setItem(PUBLICATION_JOB_STORAGE_KEY, JSON.stringify({
    jobId: catalogPublicationJob.id, candidateId: catalogPublicationJob.candidateId,
    catalogReleaseId: CATALOG_RELEASE_ID, userId: CATALOG_AUTHOR_PERSON_ID,
    organizationId: CATALOG_ORGANIZATION_ID, draft: emptyPublicationDraft(), markdownImport: true, idempotencyKey: "stored",
  }));
  const { ports } = renderImport({ prepare: (ports) => {
    vi.spyOn(ports.catalog, "getPublication").mockResolvedValue({ item: {
      ...catalogPublicationJob, status: "active", effective: true, isCurrent: true, currentness: "active",
    } });
    vi.spyOn(ports.catalog, "getPublicationCandidate").mockResolvedValue({ item: { ...catalogPublicationCandidate,
      impactSummary: { addedDefinitionCount: 1, changedDefinitionCount: 0, addedSubjectCount: 1, addedSubjectIds: ["new"] } } });
    vi.spyOn(ports.catalog, "getSubject").mockResolvedValue({ item: { ...unregisteredSubject, id: "new", canonicalName: "acme,new" } });
    vi.spyOn(ports.governance, "createRegistration");
  } });
  await userEvent.click(await screen.findByRole("button", { name: "前往批量登记" }));
  expect(takeBatchRegistrationHandoff(CATALOG_ORGANIZATION_ID, CATALOG_AUTHOR_PERSON_ID)).toMatchObject({ subjectIds: ["new"] });
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
});

it("keeps publication active and reports a subject lookup failure", async () => {
  window.localStorage.setItem(PUBLICATION_JOB_STORAGE_KEY, JSON.stringify({
    jobId: catalogPublicationJob.id, candidateId: catalogPublicationJob.candidateId,
    catalogReleaseId: CATALOG_RELEASE_ID, userId: CATALOG_AUTHOR_PERSON_ID,
    organizationId: CATALOG_ORGANIZATION_ID, draft: emptyPublicationDraft(), markdownImport: true, idempotencyKey: "stored",
  }));
  const { ports } = renderImport({ prepare: (ports) => {
    vi.spyOn(ports.catalog, "getPublication").mockResolvedValue({ item: {
      ...catalogPublicationJob, status: "active", effective: true, isCurrent: true, currentness: "active",
    } });
    vi.spyOn(ports.catalog, "getPublicationCandidate").mockResolvedValue({ item: { ...catalogPublicationCandidate,
      impactSummary: { addedDefinitionCount: 1, changedDefinitionCount: 0, addedSubjectCount: 1, addedSubjectIds: ["new"] } } });
    vi.spyOn(ports.catalog, "getSubject").mockRejectedValue(new Error("offline"));
    vi.spyOn(ports.governance, "createRegistration");
  } });
  expect(await screen.findByText(/新主体的登记状态加载失败/)).toHaveTextContent("发布仍已生效");
  expect(screen.queryByRole("button", { name: "前往批量登记" })).not.toBeInTheDocument();
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
});

async function confirm(label: string) {
  const user = userEvent.setup();
  const dialog = await screen.findByRole("dialog", { name: /确认|补登记子节点/ });
  expect(within(dialog).getByRole("button", { name: label })).toBeDisabled();
  await user.click(within(dialog).getByRole("checkbox"));
  await user.click(within(dialog).getByRole("button", { name: label }));
}

it("shows the mock-mode limitation as soon as the dialog opens", () => {
  renderImport({ runtimeMode: "mock" });
  expect(screen.getByRole("status")).toHaveTextContent("模拟模式不支持导入预览，请使用 API 模式。");
  expect(screen.queryByRole("button", { name: "解析并预览" })).not.toBeInTheDocument();
});

it("shows each revision field's old and new values and its class", async () => {
  renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => ({ item: { candidate: null, noChange: false, placementHints: [],
      source: { fileName: "d.md", sha256: "sha256:test", parserVersion: "v1" }, entries: [{
        subjectHeading: "# Driver `acme,power`", definitionHeading: "## `iin_max` 电流", selector: "acme,power",
        propertyKey: "iin_max", displayName: "电流", outcome: "revise", revisionClass: "semantic",
        diffs: [{ field: "最大值", oldValue: 1000, newValue: 3000 }], diagnostics: [],
      }] } });
  } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "修订文档");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  const row = (await screen.findByText("iin_max")).closest("tr")!;
  expect(row).toHaveTextContent("修订");
  expect(row).toHaveTextContent("语义修订");
  expect(row).toHaveTextContent("最大值：1000 → 3000");
});

it("shows revision risk, unchanged notices and conflict guidance", async () => {
  renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => ({ item: { candidate: null, noChange: false, placementHints: [],
      source: { fileName: "d.md", sha256: "sha256:test", parserVersion: "v1" }, entries: [
        { subjectHeading: "subject", definitionHeading: "revision", selector: "a", propertyKey: "rev", displayName: "Rev",
          outcome: "revise", revisionClass: "semantic", riskClass: "high", usageSummary: { policyCount: null, projectCount: 2, currentValueCount: 3 }, diffs: [], diagnostics: [] },
        { subjectHeading: "subject", definitionHeading: "documentation", selector: "a", propertyKey: "docs", displayName: "Docs",
          outcome: "revise", revisionClass: "documentation", riskClass: "low", diffs: [], diagnostics: [] },
        { subjectHeading: "subject", definitionHeading: "unchanged", selector: "a", propertyKey: "same", displayName: "Same",
          outcome: "skip", diagnostics: [{ subjectHeading: "subject", definitionHeading: "unchanged", field: "操作", message: "无变化。", line: 2 }] },
        { subjectHeading: "subject", definitionHeading: "conflict", selector: "a", propertyKey: "conflict", displayName: "Conflict",
          outcome: "conflict", diagnostics: [{ subjectHeading: "subject", definitionHeading: "conflict", field: "属性键", message: "如要修订，请加 `操作：修订`。", line: 8 }] },
      ] } });
  } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "文档");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  expect((await screen.findByText("rev")).closest("tr")).toHaveTextContent("高风险");
  expect(screen.getByText("docs").closest("tr")).toHaveTextContent("低风险");
  expect(screen.getByText(/项目 2 · 当前值 3/)).toBeVisible();
  expect(screen.getByText(/无变化/)).toBeVisible();
  expect(screen.getByText(/如要修订，请加/)).toBeVisible();
});

it("previews pasted text, publishes and tracks the existing publication job", async () => {
  const { ports, completed } = renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => {
      const response = await ports.catalog.createPublicationCandidate({ changeSet: [{
        op: "create-definition", subjectId: CATALOG_SUBJECT_ID, propertyKey: "batch_one",
        content: { displayName: "电流", documentation: "", valueSchema: { type: "integer" } },
      }] }, { catalogReleaseId: CATALOG_RELEASE_ID });
      return { item: { candidate: response.item, noChange: false, placementHints: [], source: { fileName: "粘贴.md", sha256: "sha256:test", parserVersion: "v1" },
        entries: [{ subjectHeading: "# Driver `acme,power`", definitionHeading: "## `batch_one` 电流",
          selector: "acme,power", propertyKey: "batch_one", displayName: "电流",
          outcome: "create", diagnostics: [] }] } };
    };
  } });
  const publish = vi.spyOn(ports.catalog, "publishPublicationCandidate");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "文档内容");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  expect(screen.queryByRole("dialog", { name: /确认预览/ })).not.toBeInTheDocument();
  expect(await screen.findByText("batch_one")).toBeVisible();
  expect(screen.getByText("acme,power")).toBeVisible();
  expect(screen.getByText("电流")).toBeVisible();
  expect(screen.queryByText("## `batch_one` 电流")).not.toBeInTheDocument();
  expect(within(screen.getByRole("table", { name: "导入结果" })).getAllByRole("columnheader")
    .map((cell) => cell.textContent)).toEqual(["主体", "属性键", "显示名", "结果", "诊断"]);
  expect(screen.getByText("新建 1")).toBeVisible();
  expect(screen.queryByRole("button", { name: "仅显示错误与冲突" })).not.toBeInTheDocument();
  expect(screen.getByText("新建")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "发布到目录" }));
  await confirm("确认发布");
  await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
  expect(publish).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status", { name: "发布任务状态" })).toHaveTextContent("已发布 1 条定义，目录已生效。");
  expect(screen.getByRole("table", { name: "导入结果" })).toHaveTextContent("batch_one");
});

it("uploads Markdown and shows the line of each diagnostic", async () => {
  const preview = vi.fn(async () => ({ item: { candidate: null, noChange: false, placementHints: [],
    source: { fileName: "bad.md", sha256: "sha256:test", parserVersion: "v1" }, entries: [{
      subjectHeading: "# Driver `acme,power`", definitionHeading: "## `bad` 错误", outcome: "error" as const,
      selector: "acme,power", propertyKey: "bad", displayName: "错误参数",
      diagnostics: [{ subjectHeading: "# Driver `acme,power`", definitionHeading: "## `bad` 错误",
        field: "类型", message: "不支持此类型。", line: 5 }],
    }] } }));
  renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = preview;
  } });
  const user = userEvent.setup();
  const file = new File(["无效内容"], "bad.md", { type: "text/markdown" });
  Object.defineProperty(file, "text", { value: async () => "无效内容" });
  const input = screen.getByLabelText("上传 .md 文件");
  const openPicker = vi.spyOn(input, "click");
  await user.click(screen.getByRole("button", { name: "上传 .md 文件" }));
  expect(openPicker).toHaveBeenCalledOnce();
  await user.upload(input, file);
  await waitFor(() => expect(screen.getByLabelText("Markdown 文档")).toHaveValue("无效内容"));
  expect(screen.getByText("bad.md")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  expect(await screen.findByText("第 5 行 · 类型：不支持此类型。")).toBeVisible();
  expect(screen.getByText("错误 1")).toBeVisible();
  expect(screen.getByRole("button", { name: "仅显示错误与冲突" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "发布到目录" })).not.toBeInTheDocument();
  expect(preview).toHaveBeenCalledWith({ markdownImport: { document: "无效内容", fileName: "bad.md" } },
    { catalogReleaseId: CATALOG_RELEASE_ID });
});

it("summarizes outcomes and filters errors and conflicts without losing the counts", async () => {
  renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => ({ item: { candidate: null, noChange: false, placementHints: [],
      source: { fileName: "粘贴.md", sha256: "sha256:test", parserVersion: "v1" },
      entries: (["create", "error", "skip", "conflict"] as const).map((outcome) => ({
        subjectHeading: "# Driver `acme,power`", definitionHeading: `## \`${outcome}\` 名称`,
        selector: "acme,power", propertyKey: outcome, displayName: "名称", outcome, diagnostics: [],
      })) } });
  } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "文档内容");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  expect(await screen.findByText("新建 1 · 错误 1 · 跳过 1 · 冲突 1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "仅显示错误与冲突" }));
  expect(screen.queryByText("create")).not.toBeInTheDocument();
  expect(screen.queryByText("skip")).not.toBeInTheDocument();
  expect(screen.getByText("error")).toBeVisible();
  expect(screen.getByText("conflict")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "仅显示错误与冲突" }));
  expect(screen.getByText("skip")).toBeVisible();
});

it("omits zero counts from a mixed create and skip summary", async () => {
  renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => ({ item: { candidate: null, noChange: false, placementHints: [],
      source: { fileName: "粘贴.md", sha256: "sha256:test", parserVersion: "v1" },
      entries: (["create", "skip", "skip", "skip"] as const).map((outcome, index) => ({
        subjectHeading: "# Driver `acme,power`", definitionHeading: `## \`key${index}\` 名称`,
        selector: "acme,power", propertyKey: `key${index}`, displayName: "名称", outcome, diagnostics: [],
      })) } });
  } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "文档内容");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  expect(await screen.findByText("新建 1 · 跳过 3")).toBeVisible();
});

it("keeps the document on rebase and invalidates a preview after editing", async () => {
  const requests: string[] = [];
  renderImport({ outcome: "needs-rebase", prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async ({ markdownImport }, context) => {
      requests.push(markdownImport.document);
      const response = await ports.catalog.createPublicationCandidate({ changeSet: [{
        op: "create-definition", subjectId: CATALOG_SUBJECT_ID, propertyKey: `batch_${requests.length}`,
        content: { displayName: "电流", documentation: "", valueSchema: { type: "integer" } },
      }] }, context);
      return { item: { candidate: response.item, noChange: false, placementHints: [], source: { fileName: markdownImport.fileName,
        sha256: "sha256:test", parserVersion: "v1" }, entries: [] } };
    };
  } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "文档内容");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  await user.click(await screen.findByRole("button", { name: "发布到目录" }));
  await confirm("确认发布");
  await user.click(await screen.findByRole("button", { name: "重新预览" }));
  await waitFor(() => expect(requests).toEqual(["文档内容", "文档内容"]));
  await user.type(screen.getByLabelText("Markdown 文档"), "修改");
  expect(screen.queryByRole("button", { name: "发布到目录" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "解析并预览" })).toBeEnabled();
});

it("shows non-blocking placement warnings alongside a no-change result", async () => {
  renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => ({ item: { candidate: null, noChange: true,
      placementHints: [{ kind: "driver", selector: "acme,power", categoryPath: "不存在", line: 3, warnings: [{ message: "业务分类不存在。", line: 3 }, { message: "模块名称（moduleName）已弃用。", line: 2 }] }],
      source: { fileName: "粘贴.md", sha256: "sha256:test", parserVersion: "v1" }, entries: [{
        subjectHeading: "# Driver `acme,power`", definitionHeading: "## `key` 参数",
        selector: "acme,power", propertyKey: "key", displayName: "参数",
        outcome: "skip", diagnostics: [],
      }] } });
  } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "文档内容");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  expect(await screen.findByText("没有需要发布的变更。")).toBeVisible();
  const notice = screen.getByRole("region", { name: "登记提示（不影响发布）" });
  expect(notice).toHaveAttribute("data-tone", "warning");
  expect(within(notice).getByRole("list")).toHaveTextContent("acme,power · 第 3 行：业务分类不存在。");
  expect(within(notice).getByRole("list")).toHaveTextContent("acme,power · 第 2 行：模块名称（moduleName）已弃用。");
  expect(within(notice).getAllByRole("listitem")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "发布到目录" })).not.toBeInTheDocument();
});

it("restores a stored import job and tracks activation without storing the document", async () => {
  window.localStorage.setItem(PUBLICATION_JOB_STORAGE_KEY, JSON.stringify({
    jobId: catalogPublicationJob.id, candidateId: catalogPublicationJob.candidateId,
    catalogReleaseId: CATALOG_RELEASE_ID, userId: CATALOG_AUTHOR_PERSON_ID,
    organizationId: CATALOG_ORGANIZATION_ID, draft: emptyPublicationDraft(),
    markdownImport: true, idempotencyKey: "stored-key",
  }));
  const { completed } = renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => { throw new Error("unexpected preview"); };
    vi.spyOn(ports.catalog, "getPublication").mockResolvedValue({ item: {
      ...catalogPublicationJob, status: "active", effective: true, isCurrent: true, currentness: "active",
    } });
    vi.spyOn(ports.catalog, "getPublicationCandidate").mockResolvedValue({ item: {
      ...catalogPublicationCandidate, impactSummary: { addedDefinitionCount: 2, changedDefinitionCount: 0,
        addedSubjectCount: 2, addedSubjectIds: ["new", "registered"] },
    } });
    vi.spyOn(ports.catalog, "getSubject").mockImplementation(async (id) => ({ item: id === "new"
      ? { ...unregisteredSubject, id, canonicalName: "acme,new" }
      : { ...registeredSubject, id, canonicalName: "acme,registered" } }));
  } });
  await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("status", { name: "发布任务状态" })).toHaveTextContent("生效");
  expect(window.localStorage.getItem(PUBLICATION_JOB_STORAGE_KEY)).toBeNull();
  expect(await screen.findByRole("button", { name: "前往批量登记" })).toBeVisible();
  expect(screen.queryByText("acme,registered")).not.toBeInTheDocument();
});
