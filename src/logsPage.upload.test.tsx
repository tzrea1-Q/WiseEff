import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reducer } from "@/application/state/appState";
import { logRuntimeFailureNotification } from "@/application/logs/logRuntime";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import { initialState } from "./mockData";
import {
  createTestAuthClient,
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

function renderApiLogs(repository = createLogRepository(), initialPath = "/logs") {
  renderApp({
    path: initialPath,
    initialAppState: userState,
    runtimeMode: "api",
    ports: {
      authClient: createAuthClient(),
      debuggingGateway: createTestDebuggingGateway(),
      logAnalysisRepository: repository,
      parameterRepository: createTestParameterRepository()
    }
  });
  return repository;
}

async function waitForApiRuntime(repository: LogAnalysisRepository) {
  await waitFor(() => expect(repository.listLogs).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector(".api-runtime-sync-banner")).not.toBeInTheDocument());
}

function openUploadDialog() {
  fireEvent.click(document.querySelector(".topbar-page-actions .button.primary") as HTMLButtonElement);
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

    openUploadDialog();
    chooseFile(file);
    setQuestion("why");
    await confirmSelectedFile();

    expect(repository.uploadLog).toHaveBeenCalledWith({
      file,
      analysisQuestion: "why"
    });
  });

  it("lists log domains in the upload dialog and passes the selected logDomainId", async () => {
    const chargingDomain = {
      id: "domain-charging",
      name: "charging-power",
      status: "active" as const,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z"
    };
    const repository = renderApiLogs(
      createLogRepository({ listLogDomains: vi.fn().mockResolvedValue([chargingDomain]) })
    );
    const file = new File(["line"], "charging.log", { type: "text/plain" });
    await waitForApiRuntime(repository);

    openUploadDialog();
    await waitFor(() => expect(repository.listLogDomains).toHaveBeenCalled());
    const domainSelect = (await screen.findByLabelText(/业务域/)) as HTMLSelectElement;
    expect(within(domainSelect).getByRole("option", { name: /未分类/ })).toBeInTheDocument();
    await waitFor(() => expect(within(domainSelect).getByRole("option", { name: "charging-power" })).toBeInTheDocument());

    vi.useFakeTimers();
    fireEvent.change(domainSelect, { target: { value: "domain-charging" } });
    chooseFile(file);
    await confirmSelectedFile();

    expect(repository.uploadLog).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        logDomainId: "domain-charging"
      })
    );
  });

  it("allows unsupported extensions to reach the runtime", async () => {
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

    openUploadDialog();
    chooseFile(file);
    await confirmSelectedFile(".upload-dialog__actions .button.danger");

    expect(repository.uploadLog).toHaveBeenCalledWith(
      expect.objectContaining({
        file
      })
    );
    // The raw English failureReason maps to product copy in the error alert.
    expect(document.body).toHaveTextContent("暂不支持该日志格式");
    expect(document.body).not.toHaveTextContent("Unsupported file extension");
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

  it("absorbs handled runtime failures when multiple selected files include a rejected upload", async () => {
    const uploadLog = vi.fn().mockRejectedValue(new Error("boom"));
    const repository = renderApiLogs(createLogRepository({ uploadLog }));
    const first = new File(["line"], "first.log", { type: "text/plain" });
    const second = new File(["line"], "second.log", { type: "text/plain" });
    await waitForApiRuntime(repository);

    openUploadDialog();
    await act(async () => {
      fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [first, second] } });
      await Promise.resolve();
    });

    await waitFor(() => expect(toastWithText(logRuntimeFailureNotification)).toBeTruthy());
    expect(repository.uploadLog).toHaveBeenCalledTimes(2);
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
    fireEvent.change(within(dialog).getByLabelText("置信度反馈"), { target: { value: "low" } });
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
    fireEvent.change(within(dialog).getByLabelText("置信度反馈"), { target: { value: "high" } });
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
