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
import { selectControlOption } from "@/test/selectControlOption";
import { PUBLICATION_JOB_STORAGE_KEY } from "./publicationJobStorage";
import { emptyPublicationDraft } from "./publicationState";
import { DefinitionImportDialog } from "./DefinitionImportDialog";

afterEach(() => { cleanup(); window.localStorage.removeItem(PUBLICATION_JOB_STORAGE_KEY); });

function renderImport(options: {
  outcome?: "active" | "needs-rebase";
  runtimeMode?: "api" | "mock";
  modules?: ParameterModule[];
  prepare?: (ports: ReturnType<typeof createMockCatalogPorts>) => void;
} = {}) {
  const ports = createMockCatalogPorts({ publicationOutcome: options.outcome ?? "active" });
  options.prepare?.(ports);
  const completed = vi.fn();
  render(<DefinitionImportDialog open runtimeMode={options.runtimeMode ?? "api"}
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

function module(id: string, name: string, parentId: string | null, kind: ParameterModule["kind"]): ParameterModule {
  return { id, name, parentId, kind, sortOrder: 0, description: "", scope: "", importance: "medium", origin: "curated",
    sourceKey: null, effectiveImportance: "medium", parameterCount: 0, definitionCount: 0 };
}

it("lists unregistered new subjects after activation and keeps publication success on registration failure", async () => {
  const { ports } = renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async (_, context) => {
      const response = await ports.catalog.createPublicationCandidate({ changeSet: [{ op: "create-subject-with-definitions",
        kind: "driver", canonicalKey: "driver:acme,new", selector: { kind: "driver-compatible", value: "acme,new" },
        nature: "physical-device", cardinality: "multiple", definitions: [{ propertyKey: "one", content: {
          displayName: "参数", documentation: "", valueSchema: { type: "integer" },
        } }] }] }, context);
      return { item: { candidate: response.item, noChange: false, source: { fileName: "d.md", sha256: "sha256:test", parserVersion: "v1" }, entries: [] } };
    };
    vi.spyOn(ports.catalog, "getSubject").mockImplementation(async (id) => ({ item: {
      ...unregisteredSubject, id, canonicalName: "acme,new", registration: { status: "unregistered" },
    } }));
    vi.spyOn(ports.governance, "createRegistration").mockRejectedValueOnce(new Error("registration failed"));
  } });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Markdown 文档"), "文档内容");
  await user.click(screen.getByRole("button", { name: "解析并预览" }));
  expect(await screen.findByLabelText("发布预览")).toHaveTextContent("风险高");
  await user.click(screen.getByRole("button", { name: "发布到目录" }));
  await confirm("确认发布");
  const register = await screen.findByRole("button", { name: "登记 acme,new" });
  expect(register).toHaveTextContent(/^登记$/);
  await user.click(register);
  const dialog = await screen.findByRole("dialog", { name: "登记主体" });
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
  expect(within(dialog).getByText("acme,new")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "继续确认" })).toBeDisabled();
  await selectControlOption(within(dialog).getByRole("combobox", { name: "目标模块" }), "target");
  await user.click(within(dialog).getByRole("button", { name: "继续确认" }));
  await confirm("确认登记");
  expect(await within(dialog).findByRole("alert")).toBeVisible();
  expect(screen.getByRole("status", { name: "发布任务状态" })).toHaveTextContent("生效");
  expect(ports.governance.createRegistration).toHaveBeenCalledTimes(1);
  expect(ports.governance.createRegistration).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID,
    expect.objectContaining({ subjectId: "csub_new_1", destinationModuleId: "target" }), expect.anything());
  await user.click(within(dialog).getByRole("button", { name: "继续确认" }));
  await confirm("确认登记");
  await waitFor(() => expect(screen.queryByRole("button", { name: "登记 acme,new" })).not.toBeInTheDocument());
  expect(ports.governance.createRegistration).toHaveBeenCalledTimes(2);
  expect(vi.mocked(ports.governance.createRegistration).mock.calls.map((call) => call[2].idempotencyKey)).toEqual(["pub-key", "pub-key"]);
});

it("offers module creation when all matching modules are occupied", async () => {
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
    const list = ports.governance.listRegistrations;
    vi.spyOn(ports.governance, "listRegistrations").mockImplementation(async (org, query) => ({
      ...await list(org, query), items: [{ ...catalogRegistration, placement: { ...catalogRegistration.placement, moduleId: "target" } }],
    }));
    vi.spyOn(ports.governance, "createRegistration");
  } });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "登记 acme,new" }));
  const dialog = await screen.findByRole("dialog", { name: "登记主体" });
  await selectControlOption(within(dialog).getByRole("combobox", { name: "新模块业务分类" }), "business");
  await user.type(within(dialog).getByLabelText("模块名称"), "新充电器");
  await user.click(within(dialog).getByRole("button", { name: "继续确认" }));
  await confirm("确认登记");
  await waitFor(() => expect(screen.queryByRole("button", { name: "登记 acme,new" })).not.toBeInTheDocument());
  expect(ports.governance.createRegistration).toHaveBeenCalledWith(CATALOG_ORGANIZATION_ID,
    expect.objectContaining({ subjectId: "new", newDestination: { parentModuleId: "business", name: "新充电器" } }), expect.anything());
});

it("keeps publication active and refuses a blind registration when module inventory fails", async () => {
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
    vi.spyOn(ports.governance, "listRegistrations").mockRejectedValue(new Error("offline"));
    vi.spyOn(ports.governance, "createRegistration");
  } });
  await userEvent.click(await screen.findByRole("button", { name: "登记 acme,new" }));
  expect(await screen.findByText(/无法加载登记目标/)).toHaveTextContent("发布仍已生效");
  expect(screen.queryByRole("dialog", { name: "登记主体" })).not.toBeInTheDocument();
  expect(ports.governance.createRegistration).not.toHaveBeenCalled();
});

async function confirm(label: string) {
  const user = userEvent.setup();
  const dialog = await screen.findByRole("dialog", { name: /确认/ });
  expect(within(dialog).getByRole("button", { name: label })).toBeDisabled();
  await user.click(within(dialog).getByRole("checkbox"));
  await user.click(within(dialog).getByRole("button", { name: label }));
}

it("shows the mock-mode limitation as soon as the dialog opens", () => {
  renderImport({ runtimeMode: "mock" });
  expect(screen.getByRole("status")).toHaveTextContent("模拟模式不支持导入预览，请使用 API 模式。");
  expect(screen.queryByRole("button", { name: "解析并预览" })).not.toBeInTheDocument();
});

it("previews pasted text, publishes and tracks the existing publication job", async () => {
  const { ports, completed } = renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => {
      const response = await ports.catalog.createPublicationCandidate({ changeSet: [{
        op: "create-definition", subjectId: CATALOG_SUBJECT_ID, propertyKey: "batch_one",
        content: { displayName: "电流", documentation: "", valueSchema: { type: "integer" } },
      }] }, { catalogReleaseId: CATALOG_RELEASE_ID });
      return { item: { candidate: response.item, noChange: false, source: { fileName: "粘贴.md", sha256: "sha256:test", parserVersion: "v1" },
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
  const preview = vi.fn(async () => ({ item: { candidate: null, noChange: false,
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
    ports.catalog.previewMarkdownImport = async () => ({ item: { candidate: null, noChange: false,
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
    ports.catalog.previewMarkdownImport = async () => ({ item: { candidate: null, noChange: false,
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
      return { item: { candidate: response.item, noChange: false, source: { fileName: markdownImport.fileName,
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

it("shows a no-change result without offering publication", async () => {
  renderImport({ prepare: (ports) => {
    ports.catalog.previewMarkdownImport = async () => ({ item: { candidate: null, noChange: true,
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
  expect(await screen.findByRole("button", { name: "登记 acme,new" })).toBeVisible();
  expect(screen.queryByText("acme,registered")).not.toBeInTheDocument();
});
