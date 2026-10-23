import { selectControlOption } from "@/test/selectControlOption";
import userEvent from "@testing-library/user-event";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reducer } from "@/application/state/appState";
import { logRuntimeFailureNotification } from "@/application/logs/logRuntime";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { LogAnalysisRepository, LogSkillRecommendations } from "@/application/ports/LogAnalysisRepository";
import type { LogSkillRecommendationReason } from "@/domain/logs/types";
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

describe("upload skill recommendation", () => {
  const skill = { id: "skill-charging", name: "充电电源", status: "active" as const,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
  const recommendation: LogSkillRecommendations = { recommendedSkillId: skill.id, recommendations: [{
    skillId: skill.id, score: 12, reasons: [{ kind: "file", file: "kernel.log", detail: "skill glob **/kernel.log (充电)",
      source: "skill-glob", ref: "**/kernel.log", role: "充电" }]
  }] };

  async function setup(recommendLogSkills = vi.fn().mockResolvedValue(recommendation), fakeTimers = false) {
    const repository = renderApiLogs(createLogRepository({ recommendLogSkills,
      listLogDomains: vi.fn().mockResolvedValue([skill, { ...skill, id: "other", name: "其他技能" }]) }));
    await waitForApiRuntime(repository);
    if (fakeTimers) vi.useFakeTimers();
    openUploadDialog();
    chooseFile(new File(["charging ready\nnext"], "kernel.log", { type: "text/plain" }));
    if (fakeTimers) await act(async () => { await vi.waitFor(() => expect(recommendLogSkills).toHaveBeenCalled()); });
    else await waitFor(() => expect(recommendLogSkills).toHaveBeenCalled());
    return repository;
  }

  it("preselects the recommendation, exposes reasons and leaves routing to the server", async () => {
    const repository = await setup();
    await waitFor(() => expect(screen.getByLabelText(/分析技能/)).toHaveTextContent("充电电源"));
    expect(repository.recommendLogSkills).toHaveBeenCalledWith([{ path: "kernel.log", head: ["charging ready", "next"] }], expect.any(AbortSignal));
    expect(screen.getByText("推荐：充电电源 · 匹配 kernel.log（1 条理由）")).toBeInTheDocument();
    fireEvent.click(screen.getByText("查看理由"));
    expect(screen.getByRole("list", { name: "技能推荐理由" })).toHaveTextContent("适用文件规则 **/kernel.log（充电）");
    fireEvent.click(await screen.findByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(repository.uploadLog).toHaveBeenCalled());
    expect(vi.mocked(repository.uploadLog).mock.calls[0][0].skillId).toBeUndefined();
  });

  it("keeps a manual override when an in-flight recommendation completes", async () => {
    const pending = deferred<LogSkillRecommendations>();
    const repository = await setup(vi.fn().mockReturnValue(pending.promise));
    expect(screen.getByText("正在推荐分析技能…")).toHaveAttribute("role", "status");
    await selectControlOption(screen.getByLabelText(/分析技能/), "other");
    await act(async () => pending.resolve(recommendation));
    expect(screen.getByLabelText(/分析技能/)).toHaveTextContent("其他技能");
    fireEvent.click(await screen.findByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(repository.uploadLog).toHaveBeenCalledWith(expect.objectContaining({ skillId: "other" })));
  });

  it("shows the recommended skill once and sends no selector when choosing auto", async () => {
    const repository = await setup();
    await waitFor(() => expect(screen.getByLabelText(/分析技能/)).toHaveTextContent("充电电源"));
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/分析技能/));
    expect(screen.getAllByRole("option").map((option) => option.textContent))
      .toEqual(["充电电源（推荐）", "不使用技能（通用分析）", "其他技能"]);
    await user.keyboard("{Escape}");
    await selectControlOption(screen.getByLabelText(/分析技能/), "other");
    await selectControlOption(screen.getByLabelText(/分析技能/), "__auto__");
    fireEvent.click(await screen.findByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(repository.uploadLog).toHaveBeenCalled());
    expect(vi.mocked(repository.uploadLog).mock.calls[0][0].skillId).toBeUndefined();
    expect(vi.mocked(repository.uploadLog).mock.calls[0][0].skillSelection).toBeUndefined();
  });

  it.each([false, true])("preserves an explicit choice of the incoming recommendation unless auto is chosen (%s)", async (chooseAuto) => {
    const pending = deferred<LogSkillRecommendations>();
    const repository = await setup(vi.fn().mockReturnValue(pending.promise));
    await selectControlOption(screen.getByLabelText(/分析技能/), skill.id);
    await act(async () => pending.resolve(recommendation));
    const trigger = screen.getByLabelText(/分析技能/), user = userEvent.setup();
    expect(trigger).toHaveTextContent("充电电源");
    expect(trigger).toHaveAttribute("data-value", skill.id);
    await user.click(trigger);
    expect(screen.getAllByRole("option").map((option) => option.textContent))
      .toEqual(["充电电源（推荐）", "不使用技能（通用分析）", "其他技能"]);
    await user.keyboard("{Escape}");
    if (chooseAuto) await selectControlOption(trigger, "__auto__");
    fireEvent.click(await screen.findByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(repository.uploadLog).toHaveBeenCalled());
    expect(vi.mocked(repository.uploadLog).mock.calls[0][0].skillId).toBe(chooseAuto ? undefined : skill.id);
  });

  it("sends explicit generic selection when the user chooses none", async () => {
    const repository = await setup();
    await waitFor(() => expect(screen.getByLabelText(/分析技能/)).toHaveTextContent("充电电源"));
    await selectControlOption(screen.getByLabelText(/分析技能/), "");
    fireEvent.click(await screen.findByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(repository.uploadLog).toHaveBeenCalledWith(expect.objectContaining({ skillSelection: "generic" })));
    expect(vi.mocked(repository.uploadLog).mock.calls[0][0].skillId).toBeUndefined();
  });

  it("silently falls back after a recommendation failure and still uploads", async () => {
    const repository = await setup(vi.fn().mockRejectedValue(new Error("Unavailable")));
    await waitFor(() => expect(screen.queryByText("正在推荐分析技能…")).not.toBeInTheDocument());
    expect(screen.getByLabelText(/分析技能/)).toHaveTextContent("自动推荐（无匹配时通用分析）");
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(repository.uploadLog).toHaveBeenCalled());
    expect(vi.mocked(repository.uploadLog).mock.calls[0][0].skillSelection).toBeUndefined();
  });

  it("times out advisory scoring without blocking upload or applying a late result", async () => {
    const pending = deferred<LogSkillRecommendations>();
    const repository = await setup(vi.fn().mockReturnValue(pending.promise), true);
    expect(screen.getByText("正在推荐分析技能…")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await act(async () => pending.resolve(recommendation));
    expect(screen.queryByText("正在推荐分析技能…")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/分析技能/)).toHaveTextContent("自动推荐（无匹配时通用分析）");
    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
    await act(async () => {});
    expect(repository.uploadLog).toHaveBeenCalled();
  });

  it("shows the recorded skill and routing decision in the report header", async () => {
    const record = { ...initialState.logs[0], status: "Complete" as const, stage: "report" as const, skillSelection: { mode: "recommended" as const,
      reasons: recommendation.recommendations[0].reasons } };
    const repository = renderApiLogs(createLogRepository({ listLogs: vi.fn().mockResolvedValue([record]),
      getLog: vi.fn().mockResolvedValue(record) }));
    await waitForApiRuntime(repository);
    expect(screen.queryByRole("tab", { name: "元数据" })).not.toBeInTheDocument();
    expect(screen.getByText("技能：充电诊断 v1")).toBeInTheDocument();
    expect(screen.getByText("自动推荐")).toBeInTheDocument();
    expect(screen.queryByText("skill glob **/kernel.log (充电)")).not.toBeInTheDocument();
  });

  it("keeps every skill option when no recommendation is available", async () => {
    await setup(vi.fn().mockResolvedValue({ recommendations: [] }));
    await waitFor(() => expect(screen.queryByText("正在推荐分析技能…")).not.toBeInTheDocument());
    await userEvent.setup().click(screen.getByLabelText(/分析技能/));
    expect(screen.getAllByRole("option").map((option) => option.textContent))
      .toEqual(["自动推荐（无匹配时通用分析）", "不使用技能（通用分析）", "充电电源", "其他技能"]);
  });

  it.each([
    ["skill-glob", "charger/**", "适用文件规则 charger/**（充电）"],
    ["extractor-glob", "kernel/*.log", "抽取规则文件 kernel/*.log"],
    ["extractor", "voltage", "抽取规则 voltage 命中"],
    ["signal", "充电电流降低", "信号规则「充电电流降低」命中"],
    ["format-timestamp", "^\\d+", "时间戳格式匹配"],
    ["format-severity", "error", "错误 级别格式匹配"],
    ["format-severity", "warn", "警告 级别格式匹配"],
    ["format-severity", "info", "信息 级别格式匹配"]
  ] as const)("localizes %s reason %s", async (source, ref, label) => {
    await setup(vi.fn().mockResolvedValue({ ...recommendation, recommendations: [{ ...recommendation.recommendations[0],
      reasons: [{ kind: "pattern", source, ref, role: "充电", file: "charging.log", detail: "raw internal pattern" }] }] }));
    await screen.findByText("推荐：充电电源 · 匹配 charging.log（1 条理由）");
    fireEvent.click(screen.getByText("查看理由"));
    const list = screen.getByRole("list", { name: "技能推荐理由" });
    expect(within(list).getByText(label)).toBeInTheDocument();
    expect(list.querySelector("code")).toHaveTextContent("charging.log");
    expect(screen.queryByText("raw internal pattern")).not.toBeInTheDocument();
  });

  it("shows only five reasons with a remaining count", async () => {
    const reasons: LogSkillRecommendationReason[] = Array.from({ length: 7 }, (_, index) => ({
      kind: "pattern", source: "signal", ref: `信号${index + 1}`, file: "charging.log", detail: `raw ${index}`
    }));
    await setup(vi.fn().mockResolvedValue({ ...recommendation, recommendations: [{ ...recommendation.recommendations[0], reasons }] }));
    await screen.findByText("推荐：充电电源 · 匹配 charging.log（7 条理由）");
    fireEvent.click(screen.getByText("查看理由"));
    expect(within(screen.getByRole("list", { name: "技能推荐理由" })).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("另有 2 条")).toBeInTheDocument();
    expect(screen.queryByText("信号规则「信号6」命中")).not.toBeInTheDocument();
  });

  it("renders historical reason records without showing raw implementation details", async () => {
    const record = { ...initialState.logs[0], status: "Complete" as const, stage: "report" as const, skillSelection: { mode: "recommended" as const,
      reasons: [{ kind: "pattern" as const, file: "old.log", detail: "signal internal-id: raw pattern" }] } };
    const repository = renderApiLogs(createLogRepository({ listLogs: vi.fn().mockResolvedValue([record]), getLog: vi.fn().mockResolvedValue(record) }));
    await waitForApiRuntime(repository);
    expect(screen.getByText("技能：充电诊断 v1")).toBeInTheDocument();
    expect(screen.getByText("自动推荐")).toBeInTheDocument();
    expect(screen.queryByText("signal internal-id: raw pattern")).not.toBeInTheDocument();
  });

  it("preserves explicit none chosen while recommendation is pending", async () => {
    const pending = deferred<LogSkillRecommendations>();
    const repository = await setup(vi.fn().mockReturnValue(pending.promise));
    await selectControlOption(screen.getByLabelText(/分析技能/), "");
    await act(async () => pending.resolve(recommendation));
    expect(screen.getByLabelText(/分析技能/)).toHaveTextContent("不使用技能（通用分析）");
    fireEvent.click(await screen.findByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(repository.uploadLog).toHaveBeenCalledWith(expect.objectContaining({ skillSelection: "generic" })));
  });

  it("allows explicit none after no skill matches", async () => {
    const repository = await setup(vi.fn().mockResolvedValue({ recommendations: [] }));
    await waitFor(() => expect(screen.queryByText("正在推荐分析技能…")).not.toBeInTheDocument());
    await selectControlOption(screen.getByLabelText(/分析技能/), "");
    fireEvent.click(await screen.findByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(repository.uploadLog).toHaveBeenCalledWith(expect.objectContaining({ skillSelection: "generic" })));
  });
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

    fireEvent.keyDown(screen.getByRole("tab", { name: "信号" }), { key: "Enter" });
    expect(screen.getByRole("tab", { name: "信号" })).toHaveAttribute("aria-selected", "true");
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
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["自动推荐（无匹配时通用分析）", "不使用技能（通用分析）", "已发布技能"]);
    await userEvent.click(screen.getByRole("option", { name: "不使用技能（通用分析）" }));
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
    const advanced = screen.getByText("高级选项");
    expect(advanced.parentElement).not.toHaveAttribute("open");
    expect(screen.getByLabelText("源码版本（可选）")).not.toBeVisible();
    fireEvent.click(advanced);
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
    fireEvent.click(screen.getByText("高级选项"));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索关联参数的项目（可选）" }), { target: { value: "CAN" } });
    await selectControlOption(screen.getByLabelText("关联参数的项目（可选）"), project.id);
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索项目参数" }), { target: { value: "current" } });
    await userEvent.click(await screen.findByRole("combobox", { name: /^项目参数$/ }));
    const selectedBindingOption = await screen.findByRole("option", { name: "Canonical current parameter" });
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
    fireEvent.click(screen.getByText("高级选项"));
    await selectControlOption(screen.getByLabelText("关联参数的项目（可选）"), project.id);
    await screen.findByRole("button", { name: "重试加载关联参数" });
    vi.useFakeTimers();
    const file = new File(["line"], "unassociated.log", { type: "text/plain" });
    chooseFile(file);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
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
    fireEvent.click(screen.getByText("高级选项"));
    const projectSelect = screen.getByLabelText("关联参数的项目（可选）");
    await selectControlOption(projectSelect, "project-a");
    await selectControlOption(projectSelect, "project-b");
    await act(async () => { delayed.resolve({ items: [first] }); await delayed.promise; });
    await userEvent.click(screen.getByRole("combobox", { name: /^项目参数$/ }));
    const currentBindingOption = await screen.findByRole("option", { name: "Selected project parameter" });
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
    fireEvent.click(screen.getByText("高级选项"));
    await selectControlOption(screen.getByLabelText("关联参数的项目（可选）"), project.id);
    await screen.findByRole("button", { name: "重试加载关联参数" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("加载项目参数失败；请重试或取消关联。");
    expect(parameters.listParameters).not.toHaveBeenCalled();
    vi.useFakeTimers();
    const file = new File(["line"], "reader-missing.log", { type: "text/plain" });
    chooseFile(file);
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
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
    expect(dialog).toHaveTextContent("未识别文件扩展名，可仍然上传，由服务端校验是否为文本日志。");
    expect(within(dialog).getByRole("button", { name: "取消" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "开始分析" })).not.toBeInTheDocument();
    expect(repository.uploadLog).not.toHaveBeenCalled();
    const uploadButton = within(dialog).getByRole("button", { name: "仍然上传" });
    expect(uploadButton).toHaveClass("subtle");
    expect(uploadButton).not.toHaveClass("danger");
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
    await screen.findByRole("button", { name: "上传新日志" });
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

    expect(screen.getByTestId("file-drop-zone-input")).toHaveAttribute("accept", ".log,.txt,.csv,.json");
  });

  it.each(["fresh.json", "fresh.csv"])("treats %s as a supported mock upload", (fileName) => {
    vi.useFakeTimers();
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByTestId("file-drop-zone-input"), { target: { files: [new File(["x"], fileName)] } });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole("button", { name: "开始分析" })).toBeInTheDocument();
    expect(screen.queryByText(/格式不支持/)).not.toBeInTheDocument();
  });

  it("未选择文件时禁用开始分析，选择支持格式后立即可提交并新增 Processing 日志", () => {
    vi.useFakeTimers();
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    expect(screen.getByRole("button", { name: "开始分析" })).toBeDisabled();
    fireEvent.change(screen.getByTestId("file-drop-zone-input"), { target: { files: [new File(["x"], "fresh.log")] } });
    expect(screen.getByRole("button", { name: "开始分析" })).toBeEnabled();
    expect(screen.queryByText(/正在读取/)).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "已选文件" })).toHaveTextContent("fresh.log");
    expect(document.querySelector(".upload-dialog__state")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /fresh\.log/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog", { name: "上传日志" })).not.toBeInTheDocument();
  });

  it("上传时可输入可选问题，新建分析任务展示该问题", () => {
    vi.useFakeTimers();
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByTestId("file-drop-zone-input"), { target: { files: [new File(["x"], "question.log")] } });
    fireEvent.change(screen.getByLabelText("分析问题（可选）"), {
      target: { value: "为什么充电后段降频？" }
    });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));

    expect(screen.getByText("用户问题")).toBeInTheDocument();
    expect(screen.getByText("为什么充电后段降频？")).toBeInTheDocument();
  });

  it("选择不支持格式后显示警示，仍然上传会创建 Failed 日志", () => {
    vi.useFakeTimers();
    renderApp({ path: "/logs", initialAppState: userState });

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));
    fireEvent.change(screen.getByTestId("file-drop-zone-input"), { target: { files: [new File(["x"], "thermal.bin")] } });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    const dialog = screen.getByRole("dialog", { name: "上传日志" });
    expect(dialog).toHaveTextContent("未识别文件扩展名");

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
  function renderFeedbackReport(submitFeedback: LogAnalysisRepository["submitFeedback"]) {
    const log = { ...initialState.logs[0], status: "Complete" as const, stage: "report" as const };
    return renderApiLogs(createLogRepository({ submitFeedback,
      getLog: vi.fn().mockResolvedValue(log), listLogs: vi.fn().mockResolvedValue([log]) }));
  }

  it("submits real feedback through logActions and closes only after success", async () => {
    const pending = deferred<void>();
    const submitFeedback = vi.fn().mockReturnValue(pending.promise);
    const repository = renderFeedbackReport(submitFeedback);
    await waitForApiRuntime(repository);

    fireEvent.click(screen.getByRole("button", { name: "没帮助" }));
    const dialog = screen.getByRole("dialog", { name: "没帮助" });
    expect(within(dialog).getByPlaceholderText("例如：根因判断错误、证据不足")).not.toBeRequired();
    fireEvent.change(within(dialog).getByLabelText("补充说明（可选）"), {
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
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "提交中…" })).toBeDisabled();
    await act(async () => pending.resolve());
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "没帮助" })).not.toBeInTheDocument();
    });
    expect(toastWithText("已提交分析反馈")).toBeTruthy();
    expect(screen.getByText("已反馈：没帮助")).toBeInTheDocument();
  });

  it("submits helpful immediately without opening a dialog", async () => {
    const submitFeedback = vi.fn().mockResolvedValue(undefined);
    const repository = renderFeedbackReport(submitFeedback);
    await waitForApiRuntime(repository);

    fireEvent.click(screen.getByRole("button", { name: "有帮助" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(submitFeedback).toHaveBeenCalledWith({
        logId: "log-active",
        rating: "helpful"
      });
    });
    expect(await screen.findByText("已反馈：有帮助")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有帮助" })).toHaveAttribute("aria-pressed", "true");
  });

  it("allows changing helpful to not helpful with no optional note", async () => {
    const submitFeedback = vi.fn().mockResolvedValue(undefined);
    const repository = renderFeedbackReport(submitFeedback);
    await waitForApiRuntime(repository);
    fireEvent.click(screen.getByRole("button", { name: "有帮助" }));
    await screen.findByText("已反馈：有帮助");
    fireEvent.click(screen.getByRole("button", { name: "没帮助" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "没帮助" })).getByRole("button", { name: "提交反馈" }));
    await waitFor(() => expect(submitFeedback).toHaveBeenLastCalledWith({ logId: "log-active", rating: "not_helpful" }));
    expect(await screen.findByText("已反馈：没帮助")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "没帮助" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the feedback dialog open with an inline error when submission fails", async () => {
    const submitFeedback = vi.fn().mockRejectedValue(new Error("feedback api down"));
    const repository = renderFeedbackReport(submitFeedback);
    await waitForApiRuntime(repository);

    fireEvent.click(screen.getByRole("button", { name: "没帮助" }));
    const dialog = screen.getByRole("dialog", { name: "没帮助" });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    await waitFor(() => expect(submitFeedback).toHaveBeenCalled());
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(logRuntimeFailureNotification);
    expect(screen.getByRole("dialog", { name: "没帮助" })).toBeInTheDocument();
  });
});
