import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getContextQuery } from "./App";
import { logRuntimeFailureNotification } from "@/application/logs/logRuntime";
import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import type { LogAnalysisRepository, LogJobSnapshot } from "@/application/ports/LogAnalysisRepository";
import type { ParameterRepository } from "@/application/ports/ParameterRepository";
import type { AuthContextDto } from "@/infrastructure/http/authClient";
import { initialState } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };
const completeLog = initialState.logs.find((log) => log.id === "log-auth") ?? initialState.logs[1];
const processingRerunLog = {
  ...completeLog,
  status: "Processing" as const,
  stage: "parse" as const,
  confidence: 16,
  updatedAtIso: "2026-05-26T09:00:00.000Z"
};
const queuedJob: LogJobSnapshot = {
  id: "job-rerun",
  kind: "log-analysis",
  logId: completeLog.id,
  runId: "run-rerun",
  status: "queued",
  progress: 0,
  currentStage: "parse",
  error: null,
  updatedAt: "2026-05-26T09:00:00.000Z"
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
    roles: [{ projectId: userState.activeProjectId, roleId: "hardware-user" }],
    permissions: ["logs:upload"]
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
    withdrawSubmissionRound: vi.fn(),
    reviewChange: vi.fn(),
    createImportPreview: vi.fn(),
    applyImportBatch: vi.fn(),
    parseDtsImport: vi.fn().mockResolvedValue({ format: "dts-full", rows: [] }),
    ...overrides
  };
}

function createLogRepository(overrides: Partial<LogAnalysisRepository> = {}): LogAnalysisRepository {
  return {
    listLogs: vi.fn().mockResolvedValue(initialState.logs),
    getLog: vi.fn().mockResolvedValue(processingRerunLog),
    uploadLog: vi.fn(),
    getJob: vi.fn().mockResolvedValue({ ...queuedJob, status: "complete", progress: 100, currentStage: "report" }),
    rerunLog: vi.fn().mockResolvedValue({ log: processingRerunLog, job: queuedJob }),
    archiveLog: vi.fn().mockResolvedValue(undefined),
    unarchiveLog: vi.fn().mockResolvedValue(undefined),
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
    />
  );
  return repository;
}

async function waitForApiRuntime(repository: LogAnalysisRepository) {
  await waitFor(() => expect(repository.listLogs).toHaveBeenCalled());
  await waitFor(() => expect(document.body).toHaveTextContent("已连接雷泽调试 API"));
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage api rerun wiring", () => {
  it("Complete log api rerun action calls repository rerunLog", async () => {
    const repository = renderApiLogs();
    await waitForApiRuntime(repository);

    const history = document.querySelector(".logs-aux-panel") as HTMLElement;
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    fireEvent.click(document.querySelector(".logs-conclusion-actions .button.danger") as HTMLButtonElement);

    expect(repository.rerunLog).toHaveBeenCalledWith({
      logId: "log-auth",
      analysisQuestion: completeLog.analysisQuestion
    });
  });

  it("absorbs handled runtime failures when api rerun rejects", async () => {
    const repository = renderApiLogs(createLogRepository({ rerunLog: vi.fn().mockRejectedValue(new Error("boom")) }));
    await waitForApiRuntime(repository);

    const history = document.querySelector(".logs-aux-panel") as HTMLElement;
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    await act(async () => {
      fireEvent.click(document.querySelector(".logs-conclusion-actions .button.danger") as HTMLButtonElement);
      await Promise.resolve();
    });

    expect(repository.rerunLog).toHaveBeenCalledWith({
      logId: "log-auth",
      analysisQuestion: completeLog.analysisQuestion
    });
    await waitFor(() => expect(document.body).toHaveTextContent(logRuntimeFailureNotification));
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});

describe("getContextQuery", () => {
  it("返回 logId 字段", () => {
    const query = getContextQuery("?logId=log-active&project=aurora");

    expect(query.logId).toBe("log-active");
    expect(query.projectId).toBe("aurora");
  });

  it("无 logId 时返回空字符串", () => {
    const query = getContextQuery("?project=aurora");

    expect(query.logId).toBe("");
  });
});

describe("LogsPage · 主行动", () => {
  it("Complete 日志点击主按钮跳转到 /parameters 且 URL 带 logId", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成参数修改请求/ }));

    expect(window.location.pathname).toBe("/parameters");
    expect(window.location.search).toContain("logId=log-auth");
    expect(window.location.search).not.toContain("project=");
  });

  it("从日志跳到参数页后，修改原因预填日志结论", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    fireEvent.click(screen.getByRole("button", { name: /生成参数修改请求/ }));

    const reason = screen.getByLabelText("修改原因");
    expect(reason).toHaveValue("依据日志 usb_pd_negotiation_20260503.log 分析：PD 协商在 9V/3A 档位稳定完成，未出现握手重试。");
  });

  it("点击导出报告会创建 Markdown 下载", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    fireEvent.click(screen.getByRole("button", { name: /导出报告/ }));

    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("点击复制链接会写入包含 logId 的分享链接", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: /复制链接/ }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("logId=log-active"));
  });
});
