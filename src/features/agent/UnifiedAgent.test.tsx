import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnifiedAgent } from "./UnifiedAgent";
import type { createAgentPlan } from "@/appConfig";
import type { AgentSession, AgentTurn } from "@/domain/agent/types";
import { createPrototypeState } from "@/mockData";

const parameterPlan = {
  shellVariant: "unified-glass-agent",
  contextTitle: "Parameter Agent",
  contextSummary: "Parameter context",
  steps: ["Read context"],
  prompts: [],
  actions: [
    { id: "filter-high-risk", label: "Filter high risk", requiresConfirm: false },
    { id: "draft-parameter-change", label: "Draft parameter change", requiresConfirm: true, requiredPermission: "parameter.edit" }
  ]
} satisfies ReturnType<typeof createAgentPlan>;

const staleComparisonPlan = {
  shellVariant: "unified-glass-agent",
  contextTitle: "Retired comparison Agent",
  contextSummary: "Retired comparison context",
  steps: ["Read stale comparison context"],
  prompts: [],
  actions: [{ id: "summarize-comparison", label: "Summarize comparison", requiresConfirm: false }]
} satisfies ReturnType<typeof createAgentPlan>;

const apiSession = {
  id: "agent-session-1",
  context: { path: "/parameters", pageKey: "parameters" },
  messages: []
} satisfies AgentSession;

const agentUnavailableMessage = /^Agent /;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

afterEach(() => {
  cleanup();
});

describe("UnifiedAgent permission boundaries", () => {
  it("starts an API session when opened", async () => {
    const gateway = {
      startSession: vi.fn(async () => apiSession),
      sendMessage: vi.fn(),
      runAction: vi.fn(),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };

    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));

    expect(await screen.findByText("Parameter context")).toBeInTheDocument();
    expect(gateway.startSession).toHaveBeenCalledWith({
      path: "/parameters",
      pageKey: "parameters",
      projectId: "aurora",
      roleId: "hardware-user"
    });
  });

  it("renders API citations and confidence after sending a prompt", async () => {
    const gateway = {
      startSession: vi.fn(async () => apiSession),
      sendMessage: vi.fn(async () => ({
        session: apiSession,
        messages: [
          {
            id: "agent-msg-1",
            role: "assistant",
            content: "Found one review item.",
            citations: [{ type: "parameter", id: "change-1", label: "Fast charge current" }],
            confidence: 0.84,
            createdAt: "2026-05-27T00:00:00.000Z"
          }
        ],
        toolCalls: [],
        approvals: []
      } satisfies AgentTurn)),
      runAction: vi.fn(),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };

    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
    fireEvent.change(screen.getByPlaceholderText("询问 WiseAgent..."), { target: { value: "Summarize review queue" } });
    fireEvent.submit(screen.getByPlaceholderText("询问 WiseAgent...").closest("form")!);

    expect(await screen.findByText("Found one review item.")).toBeInTheDocument();
    expect(screen.getByText("Fast charge current")).toBeInTheDocument();
    expect(screen.getByText("84%")).toBeInTheDocument();
  });

  it("starts a new API session when context changes before sending", async () => {
    const logSession = {
      id: "agent-session-2",
      context: { path: "/logs", pageKey: "logs" },
      messages: []
    } satisfies AgentSession;
    const gateway = {
      startSession: vi.fn(async (context: AgentSession["context"]) => (context.path === "/logs" ? logSession : apiSession)),
      sendMessage: vi.fn(async (sessionId: string, message: string) => ({
        session: sessionId === "agent-session-2" ? logSession : apiSession,
        messages: [
          {
            id: `agent-msg-${sessionId}`,
            role: "assistant",
            content: `Answered ${message}`,
            createdAt: "2026-05-27T00:00:00.000Z"
          }
        ],
        toolCalls: [],
        approvals: []
      } satisfies AgentTurn)),
      runAction: vi.fn(),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };
    const { rerender } = render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
    await waitFor(() =>
      expect(gateway.startSession).toHaveBeenCalledWith({
        path: "/parameters",
        pageKey: "parameters",
        projectId: "aurora",
        roleId: "hardware-user"
      })
    );

    rerender(
      <UnifiedAgent
        path="/logs"
        pageKey="logs"
        projectId="nebula"
        roleId="software-user"
        runtimeMode="api"
        gateway={gateway}
        plan={{ ...parameterPlan, contextTitle: "Log Agent", contextSummary: "Log context" }}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("询问 WiseAgent..."), { target: { value: "Check logs" } });
    fireEvent.submit(screen.getByPlaceholderText("询问 WiseAgent...").closest("form")!);

    await waitFor(() =>
      expect(gateway.startSession).toHaveBeenCalledWith({
        path: "/logs",
        pageKey: "logs",
        projectId: "nebula",
        roleId: "software-user"
      })
    );
    expect(gateway.sendMessage).toHaveBeenCalledWith("agent-session-2", "Check logs");
  });

  it("keeps API failure notices visible after API messages exist", async () => {
    const gateway = {
      startSession: vi.fn(async () => apiSession),
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          session: apiSession,
          messages: [
            {
              id: "agent-msg-success",
              role: "assistant",
              content: "First API answer.",
              createdAt: "2026-05-27T00:00:00.000Z"
            }
          ],
          toolCalls: [],
          approvals: []
        } satisfies AgentTurn)
        .mockRejectedValueOnce(new Error("Agent API unavailable")),
      runAction: vi.fn(),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };

    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
    fireEvent.change(screen.getByPlaceholderText("询问 WiseAgent..."), { target: { value: "First prompt" } });
    fireEvent.submit(screen.getByPlaceholderText("询问 WiseAgent...").closest("form")!);
    expect(await screen.findByText("First API answer.")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("询问 WiseAgent..."), { target: { value: "Second prompt" } });
    fireEvent.submit(screen.getByPlaceholderText("询问 WiseAgent...").closest("form")!);

    expect(await screen.findByText(agentUnavailableMessage)).toBeInTheDocument();
  });

  it("prevents duplicate API prompt submissions while a send is pending", async () => {
    const pendingSend = createDeferred<AgentTurn>();
    const gateway = {
      startSession: vi.fn(async () => apiSession),
      sendMessage: vi.fn().mockReturnValueOnce(pendingSend.promise),
      runAction: vi.fn(),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };

    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /WiseAgent/ }));
    await waitFor(() => expect(gateway.startSession).toHaveBeenCalled());
    const promptInput = screen.getByPlaceholderText(/WiseAgent/);
    const sendButton = promptInput.closest("form")!.querySelector("button")!;
    fireEvent.change(promptInput, { target: { value: "Summarize review queue" } });
    fireEvent.submit(promptInput.closest("form")!);
    fireEvent.submit(promptInput.closest("form")!);

    expect(gateway.sendMessage).toHaveBeenCalledTimes(1);
    expect(promptInput).toBeDisabled();
    expect(sendButton).toBeDisabled();

    await act(async () => {
      pendingSend.resolve({
        session: apiSession,
        messages: [
          {
            id: "agent-msg-pending",
            role: "assistant",
            content: "Pending prompt answered.",
            createdAt: "2026-05-27T00:00:00.000Z"
          }
        ],
        toolCalls: [],
        approvals: []
      } satisfies AgentTurn);
      await pendingSend.promise;
    });

    expect(await screen.findByText("Pending prompt answered.")).toBeInTheDocument();
    await waitFor(() => expect(promptInput).not.toBeDisabled());
    expect(sendButton).not.toBeDisabled();
  });

  it("prevents duplicate API action clicks while an action is pending", async () => {
    const pendingAction = createDeferred<AgentTurn>();
    const gateway = {
      startSession: vi.fn(async () => apiSession),
      sendMessage: vi.fn(),
      runAction: vi.fn().mockReturnValueOnce(pendingAction.promise),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };

    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /WiseAgent/ }));
    await waitFor(() => expect(gateway.startSession).toHaveBeenCalled());
    const actionButton = await screen.findByRole("button", { name: "Filter high risk" });
    fireEvent.click(actionButton);
    fireEvent.click(actionButton);

    expect(gateway.runAction).toHaveBeenCalledTimes(1);
    expect(actionButton).toBeDisabled();

    await act(async () => {
      pendingAction.resolve({
        session: apiSession,
        messages: [],
        toolCalls: [
          {
            id: "tool-call-pending",
            name: "parameter.summarizeReviewQueue",
            label: "Pending action tool",
            payload: {},
            requiresApproval: false,
            status: "succeeded"
          }
        ],
        approvals: []
      } satisfies AgentTurn);
      await pendingAction.promise;
    });

    expect(await screen.findByText("Pending action tool")).toBeInTheDocument();
    await waitFor(() => expect(actionButton).not.toBeDisabled());
  });

  it("keeps mock mode prompt and actions enabled", () => {
    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /WiseAgent/ }));
    const promptInput = screen.getByPlaceholderText(/WiseAgent/);
    const sendButton = promptInput.closest("form")!.querySelector("button")!;
    const actionButton = screen.getByRole("button", { name: "Filter high risk" });

    expect(promptInput).not.toBeDisabled();
    expect(sendButton).not.toBeDisabled();
    expect(actionButton).not.toBeDisabled();

    fireEvent.change(promptInput, { target: { value: "Local prompt" } });
    fireEvent.submit(promptInput.closest("form")!);
    expect(promptInput).toHaveValue("");

    fireEvent.click(actionButton);
    expect(screen.getAllByText((_, node) => node?.textContent?.includes("max_concurrent_sessions") ?? false).length).toBeGreaterThan(0);
  });

  it("ignores stale sendMessage responses after API context changes", async () => {
    const oldSend = createDeferred<AgentTurn>();
    const newSession = {
      id: "agent-session-new",
      context: { path: "/logs", pageKey: "logs" },
      messages: []
    } satisfies AgentSession;
    const staleTurn = {
      session: apiSession,
      messages: [
        {
          id: "agent-msg-stale",
          role: "assistant",
          content: "Stale parameter answer",
          createdAt: "2026-05-27T00:00:00.000Z"
        }
      ],
      toolCalls: [
        {
          id: "tool-call-stale",
          name: "parameter.summarizeReviewQueue",
          label: "Stale parameter tool",
          payload: {},
          requiresApproval: false,
          status: "succeeded"
        }
      ],
      approvals: []
    } satisfies AgentTurn;
    const gateway = {
      startSession: vi.fn(async (context: AgentSession["context"]) => (context.path === "/logs" ? newSession : apiSession)),
      sendMessage: vi
        .fn()
        .mockReturnValueOnce(oldSend.promise)
        .mockImplementation(async (sessionId: string, message: string) => ({
          session: sessionId === "agent-session-new" ? newSession : apiSession,
          messages: [
            {
              id: `agent-msg-${sessionId}`,
              role: "assistant",
              content: `Fresh ${message}`,
              createdAt: "2026-05-27T00:00:00.000Z"
            }
          ],
          toolCalls: [],
          approvals: []
        } satisfies AgentTurn)),
      runAction: vi.fn(),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };
    const { rerender } = render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /WiseAgent/ }));
    await waitFor(() => expect(gateway.startSession).toHaveBeenCalledWith(expect.objectContaining({ path: "/parameters" })));
    fireEvent.change(screen.getByPlaceholderText(/WiseAgent/), { target: { value: "Old prompt" } });
    fireEvent.submit(screen.getByPlaceholderText(/WiseAgent/).closest("form")!);
    await waitFor(() => expect(gateway.sendMessage).toHaveBeenCalledWith("agent-session-1", "Old prompt"));

    rerender(
      <UnifiedAgent
        path="/logs"
        pageKey="logs"
        projectId="nebula"
        roleId="software-user"
        runtimeMode="api"
        gateway={gateway}
        plan={{ ...parameterPlan, contextTitle: "Log Agent", contextSummary: "Log context" }}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );
    await act(async () => {
      oldSend.resolve(staleTurn);
      await oldSend.promise;
    });

    expect(screen.queryByText("Stale parameter answer")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale parameter tool")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/WiseAgent/), { target: { value: "New prompt" } });
    fireEvent.submit(screen.getByPlaceholderText(/WiseAgent/).closest("form")!);

    await waitFor(() => expect(gateway.startSession).toHaveBeenCalledWith(expect.objectContaining({ path: "/logs" })));
    expect(gateway.sendMessage).toHaveBeenLastCalledWith("agent-session-new", "New prompt");
  });

  it("ignores stale runAction responses after API context changes", async () => {
    const oldAction = createDeferred<AgentTurn>();
    const newSession = {
      id: "agent-session-action-new",
      context: { path: "/logs", pageKey: "logs" },
      messages: []
    } satisfies AgentSession;
    const staleTurn = {
      session: apiSession,
      messages: [
        {
          id: "agent-msg-action-stale",
          role: "assistant",
          content: "Stale action answer",
          createdAt: "2026-05-27T00:00:00.000Z"
        }
      ],
      toolCalls: [
        {
          id: "tool-call-action-stale",
          name: "parameter.summarizeReviewQueue",
          label: "Stale action tool",
          payload: {},
          requiresApproval: false,
          status: "succeeded"
        }
      ],
      approvals: []
    } satisfies AgentTurn;
    const gateway = {
      startSession: vi.fn(async (context: AgentSession["context"]) => (context.path === "/logs" ? newSession : apiSession)),
      sendMessage: vi.fn(),
      runAction: vi
        .fn()
        .mockReturnValueOnce(oldAction.promise)
        .mockImplementation(async (sessionId: string, actionId: string) => ({
          session: sessionId === "agent-session-action-new" ? newSession : apiSession,
          messages: [],
          toolCalls: [
            {
              id: `tool-call-${sessionId}`,
              name: "parameter.summarizeReviewQueue",
              label: `Fresh ${actionId}`,
              payload: {},
              requiresApproval: false,
              status: "succeeded"
            }
          ],
          approvals: []
        } satisfies AgentTurn)),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };
    const { rerender } = render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /WiseAgent/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Filter high risk" }));
    await waitFor(() => expect(gateway.runAction).toHaveBeenCalledWith("agent-session-1", "filter-high-risk", expect.any(Object)));

    rerender(
      <UnifiedAgent
        path="/logs"
        pageKey="logs"
        projectId="nebula"
        roleId="software-user"
        runtimeMode="api"
        gateway={gateway}
        plan={{ ...parameterPlan, contextTitle: "Log Agent", contextSummary: "Log context" }}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );
    await act(async () => {
      oldAction.resolve(staleTurn);
      await oldAction.promise;
    });

    expect(screen.queryByText("Stale action answer")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale action tool")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filter high risk" }));

    await waitFor(() =>
      expect(gateway.runAction).toHaveBeenLastCalledWith(
        "agent-session-action-new",
        "filter-high-risk",
        expect.objectContaining({ path: "/logs", projectId: "nebula" })
      )
    );
  });

  it("runs API actions without local dispatch", async () => {
    const gateway = {
      startSession: vi.fn(async () => apiSession),
      sendMessage: vi.fn(),
      runAction: vi.fn(async () => ({
        session: apiSession,
        messages: [],
        toolCalls: [
          {
            id: "tool-call-1",
            name: "parameter.summarizeReviewQueue",
            label: "Filter high risk",
            payload: {},
            requiresApproval: false,
            status: "succeeded"
          }
        ],
        approvals: []
      } satisfies AgentTurn)),
      approveToolCall: vi.fn(),
      rejectToolCall: vi.fn()
    };
    const dispatch = vi.fn();

    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={dispatch}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
    fireEvent.click(await screen.findByRole("button", { name: "Filter high risk" }));

    await waitFor(() =>
      expect(gateway.runAction).toHaveBeenCalledWith("agent-session-1", "filter-high-risk", {
        actionId: "filter-high-risk",
        path: "/parameters",
        projectId: "aurora"
      })
    );
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
  });

  it("approves and rejects API approval requests from confirmed actions", async () => {
    const pendingTurn = {
      session: apiSession,
      messages: [],
      toolCalls: [
        {
          id: "tool-call-1",
          name: "parameter.submitChangeDraft",
          label: "Submit parameter change",
          payload: {},
          requiresApproval: true,
          status: "pending_approval",
          approvalId: "approval-1"
        }
      ],
      approvals: [
        {
          id: "approval-1",
          toolCallId: "tool-call-1",
          title: "Confirm draft",
          message: "Approve draft?",
          status: "pending"
        }
      ]
    } satisfies AgentTurn;
    const gateway = {
      startSession: vi.fn(async () => apiSession),
      sendMessage: vi.fn(),
      runAction: vi.fn(async () => pendingTurn),
      approveToolCall: vi.fn(async () => ({ ...pendingTurn, approvals: [{ ...pendingTurn.approvals[0], status: "approved" }] } satisfies AgentTurn)),
      rejectToolCall: vi.fn(async () => ({ ...pendingTurn, approvals: [{ ...pendingTurn.approvals[0], status: "rejected" }] } satisfies AgentTurn))
    };

    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
    fireEvent.click(await screen.findByRole("button", { name: "Draft parameter change" }));
    expect(await screen.findByText("Approve draft?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(gateway.rejectToolCall).toHaveBeenCalledWith("agent-session-1", "approval-1", "User cancelled in WiseAgent"));
    await waitFor(() => expect(screen.queryByText("Approve draft?")).not.toBeInTheDocument());
    expect(gateway.rejectToolCall).toHaveBeenCalledTimes(1);
    expect(gateway.approveToolCall).not.toHaveBeenCalled();

    cleanup();
    gateway.runAction.mockClear();
    gateway.approveToolCall.mockClear();
    gateway.rejectToolCall.mockClear();
    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        projectId="aurora"
        roleId="hardware-user"
        runtimeMode="api"
        gateway={gateway}
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
    fireEvent.click(await screen.findByRole("button", { name: "Draft parameter change" }));
    expect(await screen.findByText("Approve draft?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));

    await waitFor(() => expect(gateway.approveToolCall).toHaveBeenCalledWith("agent-session-1", "approval-1"));
    await waitFor(() => expect(screen.queryByText("Approve draft?")).not.toBeInTheDocument());
    expect(gateway.approveToolCall).toHaveBeenCalledTimes(1);
    expect(gateway.rejectToolCall).not.toHaveBeenCalled();
  });

  it("hides parameter draft actions from Guest", () => {
    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "guest" }}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));

    expect(screen.getByRole("button", { name: "Filter high risk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft parameter change" })).not.toBeInTheDocument();
  });

  it("keeps permitted parameter draft actions executable for User", () => {
    const dispatch = vi.fn();
    render(
      <UnifiedAgent
        path="/parameters"
        pageKey="parameters"
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={dispatch}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
    fireEvent.click(screen.getByRole("button", { name: "Draft parameter change" }));
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_CHANGE_REQUEST"
      })
    );
  });

  it("does not depend on retired comparison selection for stale comparison plans", () => {
    render(
      <UnifiedAgent
        path="/parameter-comparison"
        pageKey="parameter-comparison"
        plan={staleComparisonPlan}
        state={createPrototypeState()}
        dispatch={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));

    expect(screen.getByText("Retired comparison context")).toBeInTheDocument();
    expect(screen.queryByLabelText("WiseAgent 洞察")).not.toBeInTheDocument();
  });
});
