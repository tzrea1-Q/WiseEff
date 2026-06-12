import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { reducer } from "./App";
import { logRuntimeFailureNotification } from "@/application/logs/logRuntime";
import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import type { AuthContextDto } from "@/infrastructure/http/authClient";
import type { UserGovernanceActions } from "@/UserPermissionsPage";
import { initialState } from "./mockData";

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
  const context: AuthContextDto = {
    user: {
      id: "user-api",
      organizationId: "org-api",
      name: "API User",
      email: "api@example.com",
      title: "Engineer",
      isActive: true
    },
    organization: { id: "org-api", name: "API Org" },
    roles: [{ projectId: userState.activeProjectId, roleId: "user" }],
    permissions: []
  };

  return {
    getCurrentAuthContext: vi.fn().mockResolvedValue(context)
  };
}

function createParameterRepository(overrides: Partial<ParameterRepository> = {}): ParameterRepository {
  return {
    listProjects: vi.fn().mockResolvedValue([]),
    listParameters: vi.fn().mockResolvedValue([]),
    getParameter: vi.fn().mockResolvedValue(initialState.parameters[0]),
    listParameterHistory: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn(),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
    listChangeRequests: vi.fn().mockResolvedValue([]),
    listSubmissionRounds: vi.fn().mockResolvedValue([]),
    submitParameterChanges: vi.fn(),
    reviewChange: vi.fn(),
    createImportPreview: vi.fn(),
    applyImportBatch: vi.fn(),
    ...overrides
  };
}

function createLogRepository(overrides: Partial<LogAnalysisRepository> = {}): LogAnalysisRepository {
  return {
    listLogs: vi.fn().mockResolvedValue(initialState.logs),
    getLog: vi.fn().mockResolvedValue(apiLog),
    uploadLog: vi.fn().mockResolvedValue({ log: apiLog, job: null }),
    getJob: vi.fn(),
    rerunLog: vi.fn(),
    archiveLog: vi.fn().mockResolvedValue({ ...apiLog, archiveState: "archived" as const }),
    unarchiveLog: vi.fn().mockResolvedValue({ ...apiLog, archiveState: "active" as const }),
    submitFeedback: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function createDebuggingGateway(): DebuggingGateway {
  return {
    listDevices: vi.fn().mockResolvedValue([]),
    listParameters: vi.fn().mockResolvedValue([]),
    detectTargets: vi.fn().mockResolvedValue([]),
    readNode: vi.fn(),
    writeNode: vi.fn()
  };
}

function createUserGovernanceActions(): UserGovernanceActions {
  return {
    listUsers: vi.fn().mockResolvedValue(userState.users),
    createUser: vi.fn(),
    assignUserRole: vi.fn(),
    setUserActive: vi.fn()
  };
}

function renderApiLogs(repository = createLogRepository()) {
  window.history.replaceState(null, "", "/logs");
  render(
    <App
      authClient={createAuthClient()}
      debuggingGateway={createDebuggingGateway()}
      initialAppState={userState}
      logAnalysisRepository={repository}
      parameterRepository={createParameterRepository()}
      runtimeMode="api"
      userGovernanceActions={createUserGovernanceActions()}
    />
  );
  return repository;
}

async function waitForApiRuntime(repository: LogAnalysisRepository) {
  await waitFor(() => expect(repository.listLogs).toHaveBeenCalled());
  await waitFor(() => expect(document.body).toHaveTextContent("已连接雷泽日志 API"));
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

describe("LogsPage api upload wiring", () => {
  it("hides archived API logs from the workbench history and default selection", () => {
    const archivedLog = {
      ...initialState.logs[0],
      id: "api-archived-log",
      fileName: "archived-api.log",
      archiveState: "archived" as const
    };
    const activeLog = {
      ...initialState.logs[1],
      id: "api-active-log",
      fileName: "active-api.log",
      archiveState: "active" as const
    };

    window.history.replaceState(null, "", "/logs");
    render(
      <App
        initialAppState={{
          ...userState,
          logs: [archivedLog, activeLog],
          archivedLogIds: [archivedLog.id]
        }}
      />
    );

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).queryByRole("button", { name: /archived-api\.log/ })).not.toBeInTheDocument();
    expect(within(history).getByRole("button", { name: /active-api\.log/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("log-live-region")).toHaveTextContent("active-api.log");
  });

  it("does not restrict file input accept in api mode", () => {
    renderApiLogs();

    openUploadDialog();

    expect(document.querySelector("input[type='file']")).not.toHaveAttribute("accept");
  });

  it("passes the selected File and question to the log repository", async () => {
    vi.useFakeTimers();
    const repository = renderApiLogs();
    const file = new File(["line"], "runtime.log", { type: "text/plain" });

    openUploadDialog();
    chooseFile(file);
    setQuestion("why");
    await confirmSelectedFile();

    expect(repository.uploadLog).toHaveBeenCalledWith({
      projectId: userState.activeProjectId,
      file,
      analysisQuestion: "why"
    });
  });

  it("allows unsupported extensions to reach the runtime", async () => {
    vi.useFakeTimers();
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

    openUploadDialog();
    chooseFile(file);
    await confirmSelectedFile(".upload-dialog__actions .button.danger");

    expect(repository.uploadLog).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: userState.activeProjectId,
        file
      })
    );
    expect(document.body).toHaveTextContent("Unsupported file extension");
  });

  it("disables the upload action while the runtime upload is pending", async () => {
    vi.useFakeTimers();
    let resolveUpload: (value: { log: typeof apiLog; job: null }) => void = () => {};
    const uploadPromise = new Promise<{ log: typeof apiLog; job: null }>((resolve) => {
      resolveUpload = resolve;
    });
    renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockReturnValue(uploadPromise) }));

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
    const repository = renderApiLogs(createLogRepository({ uploadLog: vi.fn().mockRejectedValue(new Error("boom")) }));
    await waitForApiRuntime(repository);
    vi.useFakeTimers();

    openUploadDialog();
    chooseFile(new File(["line"], "reject.log", { type: "text/plain" }));
    await confirmSelectedFile();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.body).toHaveTextContent(logRuntimeFailureNotification);
  });

  it("absorbs handled runtime failures when multiple selected files include a rejected upload", async () => {
    const uploadLog = vi.fn().mockRejectedValue(new Error("boom"));
    const repository = renderApiLogs(createLogRepository({ uploadLog }));
    const first = new File(["line"], "first.log", { type: "text/plain" });
    const second = new File(["line"], "second.log", { type: "text/plain" });

    openUploadDialog();
    await waitForApiRuntime(repository);
    await act(async () => {
      fireEvent.change(document.querySelector("input[type='file']") as HTMLInputElement, { target: { files: [first, second] } });
      await Promise.resolve();
    });

    await waitFor(() => expect(document.body).toHaveTextContent(logRuntimeFailureNotification));
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

    expect(document.body).toHaveTextContent(logRuntimeFailureNotification);

    await act(async () => {
      refresh.resolve([hydratedLog, ...initialState.logs]);
      await refresh.promise;
    });

    expect(repository.listLogs).toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("LogsPage · 上传日志对话框", () => {
  it("打开时聚焦文件选择入口并设置 aria-modal", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: /上传新日志/ }));

    const dialog = screen.getByRole("dialog", { name: "上传日志" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("选择日志文件")).toHaveFocus();
  });

  it("选择支持格式后先显示 validating，再确认上传并新增 Processing 日志", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

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
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

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
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

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
    expect(screen.getByRole("alert")).toHaveTextContent(/格式不支持/);
  });

  it("Failed 日志点击重新上传会打开 UploadLogDialog", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot/ }));
    fireEvent.click(screen.getByRole("button", { name: /重新上传/ }));

    expect(screen.getByRole("dialog", { name: "上传日志" })).toBeInTheDocument();
  });
});
