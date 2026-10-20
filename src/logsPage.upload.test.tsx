import { selectControlOption } from "@/test/selectControlOption";
import userEvent from "@testing-library/user-event";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reducer } from "@/application/state/appState";
import { logRuntimeFailureNotification } from "@/application/logs/logRuntime";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogProtectedProjectBindingListResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { projectBindingDtoSchema } from "@wiseeff/dto-schemas";
import { initialState } from "./mockData";
import {
  createTestAuthClient,
  createTestAppPorts,
  createTestDebuggingGateway,
  createTestLogAnalysisRepository,
  createTestParameterRepository,
  renderApp
} from "./test/harness";

const userState = { ...initialState, activeRoleId: "user" };
const apiLog = {
  ...initialState.logs[0],
  id: "api-upload-log",
  fileName: "api-upload.log",
  status: "Processing" as const,
  stage: "parse" as const,
  updatedAtIso: "2026-05-26T08:00:00.000Z"
};

function createAuthClient() {
  return createTestAuthClient({
    user: {
      id: "user-api",
      organizationId: "org-api",
      name: "API User",
      email: "api@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-api", name: "API Org" },
    roles: [{ projectId: userState.activeProjectId, roleId: "hardware-user" }],
    permissions: ["logs:upload"]
  });
}

function createLogRepository(overrides: Partial<LogAnalysisRepository> = {}): LogAnalysisRepository {
  return createTestLogAnalysisRepository(initialState.logs, {
    getLog: vi.fn().mockResolvedValue(apiLog),
    uploadLog: vi.fn().mockResolvedValue({ log: apiLog, job: null }),
    ...overrides
  });
}

function renderApiLogs(repository = createLogRepository(), initialPath = "/logs", parameters = createTestParameterRepository(),
  catalog?: Pick<ParameterCatalogRepository, "listProtectedProjectBindings">) {
  renderApp({
    path: initialPath,
    initialAppState: userState,
    runtimeMode: "api",
    ports: {
      authClient: createAuthClient(),
      debuggingGateway: createTestDebuggingGateway(),
      logAnalysisRepository: repository,
      parameterRepository: parameters,
      ...(catalog ? { parameterCatalogRepository: { ...createTestAppPorts().parameterCatalogRepository, ...catalog } } : {})
    }
  });
  return repository;
}

async function waitForApiRuntime(repository: LogAnalysisRepository) {
  await waitFor(() => expect(repository.listLogs).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector(".api-runtime-sync-banner")).not.toBeInTheDocument());
}

function openUploadDialog() {
  fireEvent.click(screen.getByRole("button", { name: "上传新日志" }));
  return screen.getByRole("dialog");
}

function chooseFile(file: File) {
  fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [file] } });
}

function setQuestion(value: string) {
  fireEvent.change(document.querySelector("#upload-analysis-question") as HTMLTextAreaElement, { target: { value } });
}

async function confirmSelectedFile(selector = ".upload-dialog__actions .button.primary") {
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
  await act(async () => {
    fireEvent.click(document.querySelector(selector) as HTMLButtonElement);
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

// Public ProjectBindingDto fixture: validate the producer shape, without a legacy ParameterRecord.
const publicBinding = projectBindingDtoSchema.parse({
  id: "binding-current", projectId: "canonical-project", parameterSpecId: "definition-current",
  parameterSpecVersionId: "definition-revision-current", definitionId: "definition-current",
  effectiveRevisionId: "definition-revision-current", currentValueId: "value-current",
  propertyKey: "iin_max", driverModule: "Configuration", logicalNodeId: null, instanceName: null, locator: "/limit",
  effectiveValue: { kind: "json", value: 36.5 }, rawValue: "36.5\n", schemaState: "valid", policyState: "not_applicable",
  moduleId: "module-current", displayName: "Canonical current parameter", description: null, documentation: null
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("reducer · SIMULATE_LOG_UPLOAD", () => {
  it("supported=true 时新增 Processing 状态 log", () => {
    const next = reducer(userState, { type: "SIMULATE_LOG_UPLOAD", fileName: "new.log", supported: true });

    expect(next.logs.length).toBe(userState.logs.length + 1);
    expect(next.logs[0].status).toBe("Processing");
    expect(next.logs[0].fileName).toBe("new.log");
    expect(next.logs[0].stage).toBe("parse");
  });

  it("supported=false 时新增 Failed 状态 log 且带 failureReason", () => {
    const next = reducer(userState, { type: "SIMULATE_LOG_UPLOAD", fileName: "x.bin", supported: false });

    expect(next.logs[0].status).toBe("Failed");
    expect(next.logs[0].failureReason).toMatch(/不支持/);
  });

  it("上传时可保存用户问题", () => {
    const next = reducer(userState, {
      type: "SIMULATE_LOG_UPLOAD",
      fileName: "question.log",
      supported: true,
      question: "为什么充电后段降频？"
    });

    expect(next.logs[0].analysisQuestion).toBe("为什么充电后段降频？");
    expect(next.logs[0].rawLines[0]).toContain("question.log");
  });
});

function toastWithText(text: string) {
  return screen.getAllByTestId("app-toast").find((item) => (item.textContent ?? "").includes(text));
}

describe("LogsPage api upload wiring", () => {
  it("does not restrict file input accept in api mode", async () => {
    const repository = renderApiLogs();
    await waitForApiRuntime(repository);

    openUploadDialog();

    expect(document.querySelector("input[type='file']")).not.toHaveAttribute("accept");
    expect(screen.getByRole("dialog", { name: "上传日志" })).toHaveTextContent(".json");
  });

  it("passes the selected File and question to the log repository", async () => {
    const repository = renderApiLogs();
    const file = new File(["line"], "runtime.log", { type: "text/plain" });
    await waitForApiRuntime(repository);
    vi.useFakeTimers();

    fireEvent.keyDown(screen.getByRole("tab", { name: "元数据" }), { key: "Enter" });
    expect(screen.getByRole("tab", { name: "元数据" })).toHaveAttribute("aria-selected", "true");
    openUploadDialog();
    chooseFile(file);
    setQuestion("why");
    await confirmSelectedFile();

    expect(repository.uploadLog).toHaveBeenCalledWith({
      file, files: [file],
      analysisQuestion: "why"
    });
    expect(screen.getByRole("tab", { name: "报告" })).toHaveAttribute("aria-selected", "true");
  });

  it("omits initial drafts from analysis choices and offers them after publication", async () => {
    const skill = {
      id: "draft-skill", name: "待发布技能", status: "active" as const,
      createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z",
      currentRevision: { id: "revision-1", number: 1, publishedAt: null }
    };
    const published = { ...skill, id: "published-skill", name: "已发布技能",
      currentRevision: { ...skill.currentRevision, publishedAt: "2026-10-19T00:00:00.000Z" } };
    const listLogSkills = vi.fn().mockResolvedValueOnce([skill, published])
      .mockResolvedValueOnce([{ ...skill, currentRevision: published.currentRevision }, published]);
    const repository = renderApiLogs(createLogRepository({ listLogSkills }));
    await waitForApiRuntime(repository);

    openUploadDialog();
    await waitFor(() => expect(listLogSkills).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByLabelText(/分析技能/));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["通用分析", "已发布技能"]);
    await userEvent.click(screen.getByRole("option", { name: "通用分析" }));
    await userEvent.click(screen.getByRole("button", { name: "关闭上传日志" }));

    openUploadDialog();
    await waitFor(() => expect(listLogSkills).toHaveBeenCalledTimes(2));
    await selectControlOption(screen.getByLabelText(/分析技能/), skill.id);
    expect(screen.getByLabelText(/分析技能/)).toHaveTextContent(skill.name);
  });

  it.each(["", "firmware-v7"])("offers ready source versions and uploads selection %j", async (sourceVersion) => {
    const chargingDomain = {
      id: "domain-charging",
      name: "charging-power",
      hasSourceSnapshots: true,
      readySourceVersions: ["firmware-v7", "firmware-v8"],
      status: "active" as const,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z"
    };
    const repository = renderApiLogs(
      createLogRepository({ listLogDomains: vi.fn().mockResolvedValue([chargingDomain,
        { ...chargingDomain, id: "indexing-only", name: "indexing-only", readySourceVersions: [] }]) })
    );
    const file = new File(["line"], "charging.log", { type: "text/plain" });
    await waitForApiRuntime(repository);

    openUploadDialog();
    expect(screen.queryByLabelText("源码版本（可选）")).not.toBeInTheDocument();
    await waitFor(() => expect(repository.listLogDomains).toHaveBeenCalled());
    const domainSelect = await screen.findByLabelText(/分析技能/);
    await selectControlOption(domainSelect, chargingDomain.id);
    const sourceSelect = screen.getByRole("combobox", { name: "源码版本（可选）" });
    expect(sourceSelect).toHaveTextContent("使用默认快照");
    expect(sourceSelect).toHaveAccessibleDescription("选择源码快照版本；不选择时使用技能版本的默认快照。");
    await userEvent.click(sourceSelect);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["使用默认快照", "firmware-v7", "firmware-v8"]);
    await userEvent.click(screen.getByRole("option", { name: "firmware-v7" }));
    await selectControlOption(domainSelect, "indexing-only");
    expect(screen.queryByLabelText("源码版本（可选）")).not.toBeInTheDocument();
    await selectControlOption(domainSelect, chargingDomain.id);
    expect(screen.getByRole("combobox", { name: "源码版本（可选）" })).toHaveTextContent("使用默认快照");
    if (sourceVersion) await selectControlOption(screen.getByLabelText("源码版本（可选）"), sourceVersion);

    vi.useFakeTimers();
    chooseFile(file);
    await confirmSelectedFile();

    expect(repository.uploadLog).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        skillId: "domain-charging",
        ...(sourceVersion ? { sourceVersion } : {})
      })
    );
    if (!sourceVersion) expect(vi.mocked(repository.uploadLog).mock.calls[0][0].sourceVersion).toBeUndefined();
  });

  it("uploads the exact selected project Binding and Definition revision, excluding foreign and incomplete pins", async () => {
    const project = { id: "canonical-project", code: "CAN", name: "Canonical project" };
    const binding = publicBinding;
    const parameters = createTestParameterRepository({
      listProjects: vi.fn().mockResolvedValue([project])
    });
    const listProtectedProjectBindings = vi.fn().mockResolvedValue({ items: [binding,
      { ...binding, displayName: "Foreign parameter", projectId: "foreign-project", id: "binding-foreign" },
      { ...binding, displayName: "Incomplete parameter", id: "binding-incomplete", currentValueId: undefined }] });
    const repository = renderApiLogs(createLogRepository(), "/logs", parameters, { listProtectedProjectBindings });
    await waitForApiRuntime(repository);
    vi.mocked(parameters.listParameters).mockClear();
    openUploadDialog();
    await selectControlOption(screen.getByLabelText("关联参数的项目（可选）"), project.id);
    await userEvent.click(await screen.findByRole("combobox", { name: /^项目参数$/ }));
    const selectedBindingOption = await screen.findByRole("option", { name: "Canonical current parameter · /limit · binding-current" });
    expect(listProtectedProjectBindings).toHaveBeenCalledWith(project.id);
    expect(parameters.listParameters).not.toHaveBeenCalled();
    expect(screen.queryByRole("option", { name: /Foreign parameter|Incomplete parameter/ })).not.toBeInTheDocument();
    await userEvent.click(selectedBindingOption);
    vi.useFakeTimers();
    const file = new File(["line"], "canonical.log", { type: "text/plain" });
    chooseFile(file);
    await confirmSelectedFile();
    expect(repository.uploadLog).toHaveBeenCalledWith({ file, files: [file], analysisQuestion: "",
      relatedParameterPin: { kind: "canonical-pin", projectId: project.id, bindingId: binding.id,
        definitionRevisionId: binding.effectiveRevisionId } });
  });

  it("blocks a requested association after a project read failure and allows explicit unassociated upload", async () => {
    const project = { id: "unavailable-project", code: "ERR", name: "Unavailable project" };
    const parameters = createTestParameterRepository({ listProjects: vi.fn().mockResolvedValue([project]) });
    const repository = renderApiLogs(createLogRepository(), "/logs", parameters, {
      listProtectedProjectBindings: vi.fn().mockRejectedValue(new Error("Parameter reader unavailable")) });
    await waitForApiRuntime(repository);
    openUploadDialog();
    await selectControlOption(screen.getByLabelText("关联参数的项目（可选）"), project.id);
    await screen.findByRole("button", { name: "重试加载关联参数" });
    vi.useFakeTimers();
    const file = new File(["line"], "unassociated.log", { type: "text/plain" });
    chooseFile(file);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole("button", { name: "确认上传" })).toBeDisabled();
    expect(repository.uploadLog).not.toHaveBeenCalled();
    // The file-validation timer has settled; use real event timing for the Radix menu.
    vi.useRealTimers();
    await selectControlOption(screen.getByLabelText("关联参数的项目（可选）"), "");
    vi.useFakeTimers();
    await confirmSelectedFile();
    expect(repository.uploadLog).toHaveBeenCalledWith({ file, files: [file], analysisQuestion: "" });
  });

  it("ignores a delayed parameter response after switching projects", async () => {
    const projects = [{ id: "project-a", code: "A", name: "First project" },
      { id: "project-b", code: "B", name: "Second project" }];
    const first = { ...publicBinding, projectId: "project-a", displayName: "Old project parameter",
      id: "binding-a", effectiveRevisionId: "revision-a", currentValueId: "value-a" };
    const second = { ...first, projectId: "project-b", displayName: "Selected project parameter",
      id: "binding-b", effectiveRevisionId: "revision-b", currentValueId: "value-b" };
    const parameters = createTestParameterRepository({ listProjects: vi.fn().mockResolvedValue(projects) });
    const delayed = deferred<CatalogProtectedProjectBindingListResponse>();
    const listProtectedProjectBindings = vi.fn<NonNullable<ParameterCatalogRepository["listProtectedProjectBindings"]>>((projectId: string) =>
      Promise.resolve({ items: [projectId === "project-a" ? first : second] }));
    const repository = renderApiLogs(createLogRepository(), "/logs", parameters, { listProtectedProjectBindings });
    await waitForApiRuntime(repository);
    listProtectedProjectBindings.mockImplementation((projectId: string) =>
      projectId === "project-a" ? delayed.promise : Promise.resolve({ items: [second] }));
    openUploadDialog();
    const projectSelect = screen.getByLabelText("关联参数的项目（可选）");
    await selectControlOption(projectSelect, "project-a");
    await selectControlOption(projectSelect, "project-b");
    await act(async () => { delayed.resolve({ items: [first] }); await delayed.promise; });
    await userEvent.click(screen.getByRole("combobox", { name: /^项目参数$/ }));
    const currentBindingOption = await screen.findByRole("option", { name: "Selected project parameter · /limit · binding-b" });
    expect(screen.queryByRole("option", { name: /Old project parameter/ })).not.toBeInTheDocument();
    await userEvent.click(currentBindingOption);
    vi.useFakeTimers();
    chooseFile(new File(["line"], "second-project.log", { type: "text/plain" }));
    await confirmSelectedFile();
    expect(repository.uploadLog).toHaveBeenCalledWith(expect.objectContaining({ relatedParameterPin: {
      kind: "canonical-pin", projectId: "project-b", bindingId: "binding-b", definitionRevisionId: "revision-b"
    } }));
  });

  it("refuses a requested association when the protected reader is missing, without falling back to legacy rows", async () => {
    const project = { id: "canonical-project", code: "CAN", name: "Canonical project" };
    const parameters = createTestParameterRepository({ listProjects: vi.fn().mockResolvedValue([project]) });
    const repository = renderApiLogs(createLogRepository(), "/logs", parameters, { listProtectedProjectBindings: undefined });
    await waitForApiRuntime(repository);
    vi.mocked(parameters.listParameters).mockClear();
    const dialog = openUploadDialog();
    await selectControlOption(screen.getByLabelText("关联参数的项目（可选）"), project.id);
    await screen.findByRole("button", { name: "重试加载关联参数" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("加载项目参数失败；请重试或取消关联。");
    expect(parameters.listParameters).not.toHaveBeenCalled();
    vi.useFakeTimers();
    const file = new File(["line"], "reader-missing.log", { type: "text/plain" });
    chooseFile(file);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole("button", { name: "确认上传" })).toBeDisabled();
    expect(repository.uploadLog).not.toHaveBeenCalled();
    // The file-validation timer has settled; use real event timing for the Radix menu.
    vi.useRealTimers();
    await selectControlOption(screen.getByLabelText("关联参数的项目（可选）"), "");
    vi.useFakeTimers();
    await confirmSelectedFile();
    expect(repository.uploadLog).toHaveBeenCalledWith({ file, files: [file], analysisQuestion: "" });
  });

  it("selects a rejected archive after submit and displays the server reason", async () => {
    const reason = "路径安全规则：不允许 .. 路径穿越";
    const failedLog = { ...apiLog, id: "api-rejected-bundle", fileName: "bundle.zip", status: "Failed" as const, failureReason: reason };
    const repository = renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockResolvedValue({ log: failedLog, job: null }) }));
    await waitForApiRuntime(repository);
    vi.useFakeTimers();
    openUploadDialog();
    chooseFile(new File(["archive"], "bundle.zip", { type: "application/zip" }));
    await confirmSelectedFile();

    expect(screen.queryByRole("dialog", { name: "上传日志" })).not.toBeInTheDocument();
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /bundle\.zip/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(reason);
    expect(repository.rerunLog).not.toHaveBeenCalled();
  });

  it("warns for a single unsupported file and uploads it when explicitly confirmed", async () => {
    const failedLog = {
      ...apiLog,
      id: "api-failed-log",
      fileName: "thermal.bin",
      status: "Failed" as const,
      stage: "parse" as const,
      failureReason: "Unsupported file extension"
    };
    const repository = renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockResolvedValue({ log: failedLog, job: null }) }));
    const file = new File(["bin"], "thermal.bin", { type: "application/octet-stream" });
    await waitForApiRuntime(repository);
    vi.useFakeTimers();

    const dialog = openUploadDialog();
    chooseFile(file);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(dialog).toHaveTextContent("thermal.bin 格式不支持。");
    expect(within(dialog).getByRole("button", { name: "知道了" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "确认上传" })).not.toBeInTheDocument();
    expect(repository.uploadLog).not.toHaveBeenCalled();
    const uploadButton = within(dialog).getByRole("button", { name: "仍然上传" });
    expect(uploadButton).toHaveClass("danger");
    await act(async () => { fireEvent.click(uploadButton); });

    expect(repository.uploadLog).toHaveBeenCalledWith(
      expect.objectContaining({
        file
      })
    );
    // The raw English failureReason maps to product copy in the error alert.
    expect(document.body).toHaveTextContent("暂不支持该日志格式");
    expect(document.body).not.toHaveTextContent("Unsupported file extension");
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /thermal\.bin/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(".log / .txt / .csv / .json");
    expect(screen.queryByRole("region", { name: "分析结果" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新上传" }));
    expect(screen.getByRole("dialog", { name: "上传日志" })).toBeInTheDocument();
    expect(repository.rerunLog).not.toHaveBeenCalled();
  });

  it("disables the upload action while the runtime upload is pending", async () => {
    let resolveUpload: (value: { log: typeof apiLog; job: null }) => void = () => {};
    const uploadPromise = new Promise<{ log: typeof apiLog; job: null }>((resolve) => {
      resolveUpload = resolve;
    });
    const repository = renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockReturnValue(uploadPromise) }));
    await waitForApiRuntime(repository);
    vi.useFakeTimers();

    openUploadDialog();
    chooseFile(new File(["line"], "pending.log", { type: "text/plain" }));
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    const uploadButton = document.querySelector(".upload-dialog__actions .button.primary") as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(uploadButton);
    });

    expect(uploadButton).toBeDisabled();
    expect(uploadButton).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      resolveUpload({ log: apiLog, job: null });
      await uploadPromise;
    });
  });

  it("keeps the dialog open and shows the runtime failure notification when upload rejects", async () => {
    // The App is rendered with runtimeMode="api", so this asserts the toast that
    // real API deployments render, not the mock-only path that used to make
    // this test pass while API mode dropped every notification.
    const repository = renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockRejectedValue(new Error("boom")) }));
    await waitForApiRuntime(repository);
    vi.useFakeTimers();

    openUploadDialog();
    chooseFile(new File(["line"], "reject.log", { type: "text/plain" }));
    await confirmSelectedFile();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toastWithText(logRuntimeFailureNotification)).toBeTruthy();
  });

  it("keeps upload open and explains unavailable related parameter context", async () => {
    const repository = renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockRejectedValue(
      new WiseEffApiError("CONFLICT", "Unavailable", { reason: "related-parameter-unavailable" }, "request-904")
    ) }));
    await waitForApiRuntime(repository);
    vi.useFakeTimers();
    openUploadDialog();
    chooseFile(new File(["line"], "unavailable.log", { type: "text/plain" }));
    await confirmSelectedFile();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(toastWithText("关联参数已删除或其规范值、来源快照不可用")).toBeTruthy();
  });

  it("auto-dismisses the api-mode failure toast and supports manual close", async () => {
    const repository = renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockRejectedValue(new Error("boom")) }));
    await waitForApiRuntime(repository);
    vi.useFakeTimers();

    openUploadDialog();
    chooseFile(new File(["line"], "reject.log", { type: "text/plain" }));
    await confirmSelectedFile();

    expect(toastWithText(logRuntimeFailureNotification)).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(
      screen.queryAllByTestId("app-toast").some((item) => (item.textContent ?? "").includes(logRuntimeFailureNotification))
    ).toBe(false);

    // Drain the remaining startup notifications through manual close (their
    // timers were armed on real time before useFakeTimers), then verify the
    // viewport empties.
    for (let attempt = 0; attempt < 10 && screen.queryAllByTestId("app-toast").length > 0; attempt += 1) {
      fireEvent.click(screen.getAllByRole("button", { name: "关闭提示" })[0]);
    }
    expect(screen.queryAllByTestId("app-toast")).toHaveLength(0);

    await act(async () => {
      fireEvent.click(document.querySelector(".upload-dialog__actions .button.primary") as HTMLButtonElement);
    });
    const failureToast = toastWithText(logRuntimeFailureNotification);
    expect(failureToast).toBeTruthy();

    fireEvent.click(within(failureToast as HTMLElement).getByRole("button", { name: "关闭提示" }));
    expect(
      screen.queryAllByTestId("app-toast").some((item) => (item.textContent ?? "").includes(logRuntimeFailureNotification))
    ).toBe(false);
  });

  it("removes an individual file before submitting the remaining selection", async () => {
    const repository = renderApiLogs();
    await waitForApiRuntime(repository); vi.useFakeTimers(); openUploadDialog();
    const first = new File(["one"], "first.log"), second = new File(["two"], "second.log");
    fireEvent.change(document.querySelector("input[type='file']")!, { target: { files: [first, second] } });
    fireEvent.click(screen.getByRole("button", { name: "移除 first.log" }));
    expect(screen.getByRole("list", { name: "已选文件" })).not.toHaveTextContent("first.log");
    expect(screen.getByRole("list", { name: "已选文件" })).toHaveTextContent("second.log");
    await confirmSelectedFile();
    expect(repository.uploadLog).toHaveBeenCalledWith(expect.objectContaining({ files: [second] }));
  });

  it("shows the server's Chinese rejection rule inline without closing the dialog", async () => {
    const reason = "路径安全规则：不允许 .. 路径穿越";
    const repository = renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockRejectedValue(new Error(reason)) }));
    await waitForApiRuntime(repository); vi.useFakeTimers();
    const dialog = openUploadDialog(); chooseFile(new File(["archive"], "bad.zip"));
    await confirmSelectedFile();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(reason);
    expect(repository.uploadLog).toHaveBeenCalledTimes(1);
  });

  it.each(["second.log", "second.bin"])("lists multiple selected files including %s and submits one bundle, preserving handled failure state", async (secondName) => {
    const uploadLog = vi.fn().mockRejectedValue(new Error("boom"));
    const repository = renderApiLogs(createLogRepository({ uploadLog }));
    const first = new File(["line"], "first.log", { type: "text/plain" });
    const second = new File(["line"], secondName, { type: "text/plain" });
    await waitForApiRuntime(repository);
    vi.useFakeTimers();
    openUploadDialog();
    await act(async () => {
      fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [first, second] } });
      await Promise.resolve();
    });

    expect(screen.getByRole("list", { name: "已选文件" })).toHaveTextContent("first.log");
    expect(screen.getByRole("list", { name: "已选文件" })).toHaveTextContent(secondName);
    expect(repository.uploadLog).not.toHaveBeenCalled();
    await confirmSelectedFile();
    expect(toastWithText(logRuntimeFailureNotification)).toBeTruthy();
    expect(repository.uploadLog).toHaveBeenCalledTimes(1);
    expect(repository.uploadLog).toHaveBeenCalledWith(expect.objectContaining({ files: [first, second] }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not close the dialog from stale pending upload state after upload rejects", async () => {
    const hydratedLog = {
      ...apiLog,
      id: "api-hydrated-log",
      fileName: "hydrated.log"
    };
    const refresh = deferred<typeof initialState.logs>();
    const repository = renderApiLogs(
      createLogRepository({
        uploadLog: vi.fn().mockRejectedValue(new Error("boom")),
        listLogs: vi.fn().mockReturnValue(refresh.promise)
      })
    );
    await waitFor(() => expect(repository.listLogs).toHaveBeenCalled());
    vi.useFakeTimers();

    openUploadDialog();
    chooseFile(new File(["line"], "reject.log", { type: "text/plain" }));
    await confirmSelectedFile();

    expect(toastWithText(logRuntimeFailureNotification)).toBeTruthy();

    await act(async () => {
      refresh.resolve([hydratedLog, ...initialState.logs]);
      await refresh.promise;
    });

    expect(repository.listLogs).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("LogsPage deep link", () => {
  it("restores the selected log from ?logId= and keeps the address bar shareable", async () => {
    const target = initialState.logs[1];
    expect(target).toBeTruthy();
    const repository = renderApiLogs(createLogRepository(), `/logs?logId=${target.id}`);
    await waitForApiRuntime(repository);

    // The deep-linked log becomes the active selection (history rail entry is
    // marked current) and the address bar keeps carrying its id.
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("logId")).toBe(target.id);
    });
    const historyRail = screen.getByRole("complementary", { name: "历史日志记录" });
    await waitFor(() => {
      const activeEntry = historyRail.querySelector('[aria-current="true"], .active, [data-active="true"]');
      expect(activeEntry?.textContent ?? "").toContain(target.fileName);
    });
  });
});

describe("LogsPage · 上传日志对话框", () => {
  it("打开时焦点进入对话框并设置 aria-modal", () => {
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));

    const dialog = screen.getByRole("dialog", { name: "上传日志" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The shared modal contract moves initial focus onto the dialog card.
    expect(dialog).toHaveFocus();
  });

  it("restricts mock file input to the shared text-log accept list", () => {
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));

    expect(screen.getByLabelText("选择日志文件")).toHaveAttribute("accept", ".log,.txt,.csv,.json");
  });

  it.each(["fresh.json", "fresh.csv"])("treats %s as a supported mock upload", (fileName) => {
    vi.useFakeTimers();
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByLabelText("选择日志文件"), { target: { files: [new File(["x"], fileName)] } });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole("button", { name: "确认上传" })).toBeInTheDocument();
    expect(screen.queryByText(/格式不支持/)).not.toBeInTheDocument();
  });

  it("选择支持格式后先显示 validating，再确认上传并新增 Processing 日志", () => {
    vi.useFakeTimers();
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByLabelText("选择日志文件"), { target: { files: [new File(["x"], "fresh.log")] } });

    expect(screen.getByText(/正在读取/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.queryByText(/正在读取/)).not.toBeInTheDocument();
    expect(screen.getByText("fresh.log")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认上传" }));

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /fresh\.log/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog", { name: "上传日志" })).not.toBeInTheDocument();
  });

  it("上传时可输入可选问题，新建分析任务展示该问题", () => {
    vi.useFakeTimers();
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByLabelText("选择日志文件"), { target: { files: [new File(["x"], "question.log")] } });
    fireEvent.change(screen.getByLabelText("分析问题（可选）"), {
      target: { value: "为什么充电后段降频？" }
    });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    fireEvent.click(screen.getByRole("button", { name: "确认上传" }));

    expect(screen.getByText("用户问题")).toBeInTheDocument();
    expect(screen.getByText("为什么充电后段降频？")).toBeInTheDocument();
  });

  it("选择不支持格式后显示警示，仍然上传会创建 Failed 日志", () => {
    vi.useFakeTimers();
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByLabelText("选择日志文件"), { target: { files: [new File(["x"], "thermal.bin")] } });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    const dialog = screen.getByRole("dialog", { name: "上传日志" });
    expect(dialog).toHaveTextContent("格式不支持");

    fireEvent.click(within(dialog).getByRole("button", { name: "仍然上传" }));

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /thermal\.bin/ })).toHaveTextContent("失败");
    const pageAlert = screen.getAllByRole("alert").find((element) => element.classList.contains("log-error-alert"));
    expect(pageAlert).toBeTruthy();
    expect(pageAlert).toHaveTextContent(/格式不支持/);
  });

  it("Failed 日志点击重新上传会打开 UploadLogDialog", () => {
    renderApp({ path: "/logs", initialAppState: userState });

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot/ }));
    fireEvent.click(screen.getByRole("button", { name: /重新上传/ }));

    expect(screen.getByRole("dialog", { name: "上传日志" })).toBeInTheDocument();
  });
});

describe("LogsPage api feedback wiring", () => {
  it("submits real feedback through logActions and closes only after success", async () => {
    const submitFeedback = vi.fn().mockResolvedValue(undefined);
    const repository = renderApiLogs(createLogRepository({ submitFeedback }));
    await waitForApiRuntime(repository);

    fireEvent.click(screen.getByRole("button", { name: /反馈分析质量/ }));
    const dialog = screen.getByRole("dialog", { name: "反馈分析质量" });
    await selectControlOption(within(dialog).getByLabelText("置信度反馈"), "low");
    fireEvent.change(within(dialog).getByLabelText("可能存在的问题"), {
      target: { value: "证据链缺少温控阈值来源" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    await waitFor(() => {
      expect(submitFeedback).toHaveBeenCalledWith({
        logId: "log-active",
        rating: "not_helpful",
        note: "证据链缺少温控阈值来源"
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "反馈分析质量" })).not.toBeInTheDocument();
    });
    expect(document.body).toHaveTextContent(/已提交 RPT-9092 的分析反馈/);
  });

  it("maps a high confidence rating to helpful", async () => {
    const submitFeedback = vi.fn().mockResolvedValue(undefined);
    const repository = renderApiLogs(createLogRepository({ submitFeedback }));
    await waitForApiRuntime(repository);

    fireEvent.click(screen.getByRole("button", { name: /反馈分析质量/ }));
    const dialog = screen.getByRole("dialog", { name: "反馈分析质量" });
    await selectControlOption(within(dialog).getByLabelText("置信度反馈"), "high");
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    await waitFor(() => {
      expect(submitFeedback).toHaveBeenCalledWith({
        logId: "log-active",
        rating: "helpful"
      });
    });
  });

  it("keeps the feedback dialog open with an inline error when submission fails", async () => {
    const submitFeedback = vi.fn().mockRejectedValue(new Error("feedback api down"));
    const repository = renderApiLogs(createLogRepository({ submitFeedback }));
    await waitForApiRuntime(repository);

    fireEvent.click(screen.getByRole("button", { name: /反馈分析质量/ }));
    const dialog = screen.getByRole("dialog", { name: "反馈分析质量" });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    await waitFor(() => expect(submitFeedback).toHaveBeenCalled());
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(logRuntimeFailureNotification);
    expect(screen.getByRole("dialog", { name: "反馈分析质量" })).toBeInTheDocument();
  });
});
