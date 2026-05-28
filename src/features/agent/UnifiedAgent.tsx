import { Bot, Lightbulb, LockKeyhole, Play, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, Dispatch, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { AppAction } from "@/App";
import { buildAgentContext } from "@/application/agent/agentRuntime";
import type { AgentGateway } from "@/application/ports/AgentGateway";
import { canPerform, getDisabledReason } from "@/app/permissions";
import type { createAgentPlan, PageKey } from "@/appConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { getCoverage } from "@/parameterAdminAnalytics";
import type { PrototypeState } from "@/mockData";
import type { AgentApproval, AgentMessage, AgentSession, AgentToolCall, AgentTurn } from "@/domain/agent/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

const agentFabSize = 56;
const agentPanelDesktopWidth = 430;
const agentDragInset = 14;
const agentDragThreshold = 4;

type AgentPosition = {
  right: number;
  bottom: number;
};

type AgentDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startRight: number;
  startBottom: number;
  moved: boolean;
};

type ApiTurnRequest = {
  contextVersion: number;
  sequence: number;
};

type UnifiedAgentProps = {
  path: string;
  pageKey: PageKey;
  projectId?: string;
  roleId?: string;
  runtimeMode?: WiseEffRuntimeMode;
  gateway?: AgentGateway;
  plan: ReturnType<typeof createAgentPlan>;
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
};

function clampAgentOffset(value: number, viewportSize: number) {
  return Math.min(Math.max(value, agentDragInset), Math.max(agentDragInset, viewportSize - agentFabSize - agentDragInset));
}

function clampAgentPanelOffset(value: number, viewportSize: number) {
  return Math.min(Math.max(value, agentDragInset), Math.max(agentDragInset, viewportSize - agentPanelDesktopWidth - agentDragInset));
}

function updateParameterAdminQuery(patch: Record<string, string | undefined>) {
  const url = new URL(window.location.href);
  Object.entries(patch).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  });
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
}

function ApiAgentMessage({ message }: { message: AgentMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <div className={message.role === "user" ? "agent-message user" : "agent-message"}>
      <p>{message.content}</p>
      {isAssistant && (message.confidence !== undefined || message.citations?.length) ? (
        <div className="agent-message-meta">
          {message.confidence !== undefined ? <small>{Math.round(message.confidence * 100)}%</small> : null}
          {message.citations?.map((citation) =>
            citation.href ? (
              <a className="agent-citation" href={citation.href} key={`${citation.type}-${citation.id}`}>
                <small>{citation.label}</small>
              </a>
            ) : (
              <span className="agent-citation" key={`${citation.type}-${citation.id}`}>
                <small>{citation.label}</small>
              </span>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

export function UnifiedAgent({
  path,
  pageKey,
  projectId,
  roleId,
  runtimeMode = "mock",
  gateway,
  plan,
  state,
  dispatch
}: UnifiedAgentProps) {
  const [open, setOpen] = useState(false);
  const [agentPosition, setAgentPosition] = useState<AgentPosition>({ right: 24, bottom: 24 });
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<string[]>(["我会根据当前页面上下文给出建议。涉及状态变更的动作会先请求确认。"]);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [apiMessages, setApiMessages] = useState<AgentMessage[]>([]);
  const [apiToolCalls, setApiToolCalls] = useState<AgentToolCall[]>([]);
  const [apiApprovals, setApiApprovals] = useState<AgentApproval[]>([]);
  const [apiBusy, setApiBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [confirmApproval, setConfirmApproval] = useState<AgentApproval | null>(null);
  const dragStateRef = useRef<AgentDragState | null>(null);
  const suppressNextClickRef = useRef(false);
  const sessionRef = useRef<AgentSession | null>(null);
  const startSessionPromiseRef = useRef<Promise<AgentSession | null> | null>(null);
  const isApiMode = runtimeMode === "api";
  const apiContextKey = `${runtimeMode}|${path}|${pageKey}|${projectId ?? ""}|${roleId ?? ""}`;
  const apiContextVersionRef = useRef(0);
  const apiTurnLockedRef = useRef(false);
  const apiTurnSequenceRef = useRef(0);

  const setApiBusyState = (busy: boolean) => {
    setApiBusy(busy);
  };

  const isCurrentApiContext = (version: number) => apiContextVersionRef.current === version;

  const beginApiTurnRequest = () => {
    if (apiTurnLockedRef.current) {
      return null;
    }

    const request = {
      contextVersion: apiContextVersionRef.current,
      sequence: apiTurnSequenceRef.current + 1
    };
    apiTurnSequenceRef.current = request.sequence;
    apiTurnLockedRef.current = true;
    setApiBusyState(true);
    return request;
  };

  const isCurrentApiTurnRequest = (request: ApiTurnRequest) =>
    isCurrentApiContext(request.contextVersion) && apiTurnSequenceRef.current === request.sequence;

  const finishApiTurnRequest = (request: ApiTurnRequest) => {
    if (!isCurrentApiTurnRequest(request)) {
      return;
    }
    apiTurnLockedRef.current = false;
    setApiBusyState(false);
  };

  useEffect(() => {
    if (!dragging) {
      return undefined;
    }

    const moveAgent = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      dragState.moved = dragState.moved || Math.hypot(deltaX, deltaY) > agentDragThreshold;

      setAgentPosition({
        right: clampAgentOffset(dragState.startRight - deltaX, window.innerWidth),
        bottom: clampAgentOffset(dragState.startBottom - deltaY, window.innerHeight)
      });
    };

    const stopDragging = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      suppressNextClickRef.current = dragState.moved;
      dragStateRef.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", moveAgent);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointermove", moveAgent);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [dragging]);

  useEffect(() => {
    apiContextVersionRef.current += 1;
    apiTurnSequenceRef.current += 1;
    apiTurnLockedRef.current = false;
    sessionRef.current = null;
    startSessionPromiseRef.current = null;
    setSession(null);
    setApiMessages([]);
    setApiToolCalls([]);
    setApiApprovals([]);
    setConfirmApproval(null);
    setApiBusyState(false);
  }, [apiContextKey, gateway]);

  const setCurrentSession = (nextSession: AgentSession) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
  };

  const addAgentUnavailableMessage = () => {
    setMessages((items) => ["Agent 暂时不可用，请稍后重试。", ...items]);
  };

  const applyAgentTurn = (turn: AgentTurn) => {
    setCurrentSession(turn.session);
    setApiMessages((items) => {
      if (turn.messages.length) return turn.messages;
      if (turn.session.messages.length) return turn.session.messages;
      return items;
    });
    setApiToolCalls(turn.toolCalls);
    setApiApprovals(turn.approvals);
    const pendingApproval = turn.approvals.find((approval) => approval.status === "pending");
    if (pendingApproval) {
      setConfirmApproval(pendingApproval);
    }
  };

  const startApiSession = () => {
    if (!gateway) {
      addAgentUnavailableMessage();
      return Promise.resolve(null);
    }
    if (sessionRef.current) {
      return Promise.resolve(sessionRef.current);
    }
    if (startSessionPromiseRef.current) {
      return startSessionPromiseRef.current;
    }

    const requestVersion = apiContextVersionRef.current;
    const promise: Promise<AgentSession | null> = gateway
      .startSession(buildAgentContext({ path, pageKey, projectId, roleId }))
      .then((nextSession) => {
        if (!isCurrentApiContext(requestVersion)) {
          return null;
        }
        setCurrentSession(nextSession);
        setApiMessages((items) => [...items, ...nextSession.messages]);
        return nextSession;
      })
      .catch(() => {
        if (isCurrentApiContext(requestVersion)) {
          addAgentUnavailableMessage();
        }
        return null;
      })
      .finally(() => {
        if (isCurrentApiContext(requestVersion)) {
          startSessionPromiseRef.current = null;
        }
      });
    startSessionPromiseRef.current = promise;
    return promise;
  };

  const buildApiActionRequest = (id: string) => {
    const action = plan.actions.find((item) => item.id === id);
    return [
      "WiseAgent action request",
      `actionId: ${id}`,
      `label: ${action?.label ?? id}`,
      `path: ${path}`,
      projectId ? `projectId: ${projectId}` : undefined
    ]
      .filter(Boolean)
      .join("\n");
  };

  const runApiAction = async (id: string) => {
    const request = beginApiTurnRequest();
    if (!request) {
      return;
    }

    try {
      const activeSession = sessionRef.current ?? (await startApiSession());
      if (!gateway || !activeSession || !isCurrentApiTurnRequest(request)) {
        return;
      }
      const turn = await gateway.sendMessage(activeSession.id, buildApiActionRequest(id));
      if (!isCurrentApiTurnRequest(request)) {
        return;
      }
      applyAgentTurn(turn);
    } catch {
      if (isCurrentApiTurnRequest(request)) {
        addAgentUnavailableMessage();
      }
    } finally {
      if (isCurrentApiTurnRequest(request)) {
        finishApiTurnRequest(request);
      }
    }
  };

  const decideApiApproval = async (approval: AgentApproval, approved: boolean) => {
    const request = beginApiTurnRequest();
    if (!request) {
      return;
    }

    let completed = false;
    try {
      const activeSession = sessionRef.current;
      if (!gateway || !activeSession || !isCurrentApiTurnRequest(request)) {
        setConfirmApproval(null);
        return;
      }
      const turn = approved
        ? await gateway.approveToolCall(activeSession.id, approval.id)
        : await gateway.rejectToolCall(activeSession.id, approval.id, "User cancelled in WiseAgent");
      if (!isCurrentApiTurnRequest(request)) {
        return;
      }
      applyAgentTurn(turn);
      completed = true;
    } catch {
      if (isCurrentApiTurnRequest(request)) {
        addAgentUnavailableMessage();
      }
    } finally {
      if (isCurrentApiTurnRequest(request)) {
        if (completed) {
          setConfirmApproval(null);
        }
        finishApiTurnRequest(request);
      }
    }
  };

  const executeAction = (id: string) => {
    const requiredAction = plan.actions.find((action) => action.id === id)?.requiredPermission;
    if (requiredAction && !canPerform(state.activeRoleId, requiredAction)) {
      setMessages((items) => [getDisabledReason(state.activeRoleId, requiredAction) ?? "Action unavailable for current role", ...items]);
      return;
    }

    switch (id) {
      case "scan-orphans": {
        if (path === "/parameter-admin") {
          const orphanCount = state.configDraft.parameterLibrary.filter(
            (parameter) => getCoverage(parameter, state.configDraft.projects) === "orphan"
          ).length;
          updateParameterAdminQuery({ coverage: "orphan" });
          dispatch({ type: "AGENT_ACTION_EXECUTED", actionId: id, metadata: { orphanCount } });
          setMessages((items) => [`WiseAgent 已切换到闲置参数视角，当前命中 ${orphanCount} 项。`, ...items]);
          break;
        }
        setMessages((items) => ["当前页面暂不支持闲置参数扫描。", ...items]);
        break;
      }
      case "draft-cleanup": {
        if (path === "/parameter-admin") {
          const orphanIds = state.configDraft.parameterLibrary
            .filter((parameter) => getCoverage(parameter, state.configDraft.projects) === "orphan")
            .map((parameter) => parameter.id);
          updateParameterAdminQuery({ coverage: "orphan" });
          dispatch({ type: "AGENT_ACTION_EXECUTED", actionId: id, metadata: { orphanIds } });
          setMessages((items) => [`WiseAgent 已生成闲置清理建议，包含 ${orphanIds.length} 个候选参数。`, ...items]);
          break;
        }
        setMessages((items) => ["当前页面暂不支持清理建议。", ...items]);
        break;
      }
      case "preview-import":
      case "summarize-audit":
        if (path === "/parameter-admin") {
          console.info(`[Agent m2 pending] ${id}`);
          dispatch({ type: "AGENT_ACTION_EXECUTED", actionId: id });
          setMessages((items) => ["该 Agent 动作已记录，完整 UI 会在 m2 接入。", ...items]);
          break;
        }
        setMessages((items) => ["该 Agent 动作已记录，等待后续页面能力接入。", ...items]);
        break;
      case "filter-high-risk":
        setMessages((items) => ["已标记高风险参数：max_concurrent_sessions、risk_score_threshold。", ...items]);
        break;
      case "draft-parameter-change":
        dispatch({
          type: "ADD_CHANGE_REQUEST",
          parameterId: "p-max-session",
          targetValue: "80",
          reason: "WiseAgent 建议将会话上限调整到安全阈值内。"
        });
        setMessages((items) => ["已生成并提交参数修改草稿，进入审阅队列。", ...items]);
        break;
      case "advance-review":
        dispatch({ type: "ADVANCE_REVIEW", requestId: state.changeRequests[0]?.id ?? "PRQ-8902" });
        setMessages((items) => ["当前审阅请求已推进到下一流程节点。", ...items]);
        break;
      case "advance-log":
        dispatch({ type: "ADVANCE_LOG", logId: "log-active" });
        setMessages((items) => ["日志分析阶段已推进，证据链同步刷新。", ...items]);
        break;
      case "connect-device":
        dispatch({ type: "CONNECT_DEVICE", deviceId: state.devices[0]?.id ?? "device-x01" });
        setMessages((items) => ["推荐样机已连接，调试动作现在可用。", ...items]);
        break;
      case "push-debug-value":
        dispatch({ type: "CONNECT_DEVICE", deviceId: state.devices[0]?.id ?? "device-x01" });
        dispatch({ type: "PUSH_DEBUG_VALUE", parameterId: "dbg-pid-p" });
        setMessages((items) => ["PID 比例系数调试值已下发，已准备回滚快照。", ...items]);
        break;
      case "import-parameters":
        dispatch({ type: "IMPORT_PARAMETERS" });
        setMessages((items) => ["批量参数导入已模拟完成，冲突项进入审计队列。", ...items]);
        break;
      default:
        setMessages((items) => ["已生成当前页面治理摘要，可用于正式汇报。", ...items]);
    }
  };

  const submitPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = String(form.get("agentPrompt") ?? "").trim();
    if (isApiMode) {
      if (!value) {
        return;
      }
      const request = beginApiTurnRequest();
      if (!request) {
        return;
      }

      try {
        const activeSession = sessionRef.current ?? (await startApiSession());
        if (!gateway || !activeSession || !isCurrentApiTurnRequest(request)) {
          return;
        }
        const turn = await gateway.sendMessage(activeSession.id, value);
        if (!isCurrentApiTurnRequest(request)) {
          return;
        }
        applyAgentTurn(turn);
      } catch {
        if (isCurrentApiTurnRequest(request)) {
          addAgentUnavailableMessage();
        }
      } finally {
        if (isCurrentApiTurnRequest(request)) {
          formElement.reset();
          finishApiTurnRequest(request);
        }
      }
      return;
    }
    if (!value) {
      return;
    }
    setMessages((items) => [`你问：${value}`, `WiseAgent：我已结合 ${plan.contextTitle} 上下文生成一组可执行建议。`, ...items]);
    formElement.reset();
  };

  const agentPositionStyle: CSSProperties = {
    right: `${agentPosition.right}px`,
    bottom: `${agentPosition.bottom}px`
  };
  const agentPanelPositionStyle: CSSProperties = {
    right: `${clampAgentPanelOffset(agentPosition.right, window.innerWidth)}px`,
    bottom: `${agentPosition.bottom}px`
  };
  const visibleActions = plan.actions.filter((action) => {
    const requiredAction = action.requiredPermission;
    return !requiredAction || canPerform(state.activeRoleId, requiredAction);
  });
  const apiControlsDisabled = isApiMode && apiBusy;

  const startDraggingAgent = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: agentPosition.right,
      startBottom: agentPosition.bottom,
      moved: false
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const openAgent = () => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setOpen(true);
    if (isApiMode) {
      void startApiSession();
    }
  };

  if (!open) {
    return (
      <button
        className={dragging ? "agent-fab dragging" : "agent-fab"}
        type="button"
        onClick={openAgent}
        onPointerDown={startDraggingAgent}
        style={agentPositionStyle}
        aria-label="打开 WiseAgent"
      >
        <Bot size={24} />
      </button>
    );
  }

  return (
    <div
      className="agent-panel"
      data-path={path}
      data-session-id={session?.id}
      data-approval-count={apiApprovals.length}
      aria-busy={apiBusy}
      style={agentPanelPositionStyle}
    >
      <div className="agent-header">
        <div className="agent-avatar">
          <Bot size={19} />
        </div>
        <div>
          <strong>WiseAgent</strong>
          <span>{plan.contextTitle}</span>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="最小化 WiseAgent">
          <X size={18} />
        </Button>
      </div>
      <div className="agent-body">
        <div className="agent-context">
          <SectionLabel icon={<Lightbulb size={15} />} label="上下文洞察" />
          <p>{plan.contextSummary}</p>
        </div>
        <div className="agent-steps">
          {plan.steps.map((step, index) => (
            <div key={step}>
              <span>{index + 1}</span>
              {step}
            </div>
          ))}
        </div>
        <div className="quick-prompts">
          {plan.prompts.map((prompt) => (
            <Button key={prompt} type="button" variant="outline" size="sm" onClick={() => setMessages((items) => [`已选择建议问题：${prompt}`, ...items])}>
              {prompt}
            </Button>
          ))}
        </div>
        <div className="agent-messages">
          {apiMessages.map((message) => (
            <ApiAgentMessage key={message.id} message={message} />
          ))}
          {messages.slice(0, 4).map((message, index) => (
            <div className={index % 2 === 0 ? "agent-message" : "agent-message user"} key={`${message}-${index}`}>
              {message}
            </div>
          ))}
          {apiToolCalls.map((toolCall) => (
            <div className="agent-tool-call" key={toolCall.id}>
              <span>{toolCall.label}</span>
              <span>{toolCall.status}</span>
            </div>
          ))}
        </div>
        <div className="agent-actions">
          {visibleActions.map((action) => (
            <Button
              className={action.requiresConfirm ? "requires-confirm" : ""}
              key={action.id}
              type="button"
              variant={action.requiresConfirm ? "default" : "outline"}
              disabled={apiControlsDisabled}
              onClick={() => {
                if (isApiMode) {
                  void runApiAction(action.id);
                  return;
                }
                if (action.requiresConfirm) {
                  setConfirmAction(action.id);
                } else {
                  executeAction(action.id);
                }
              }}
            >
              {action.requiresConfirm ? <LockKeyhole size={14} /> : <Play size={14} />}
              {action.label}
            </Button>
          ))}
        </div>
      </div>
      <form className="agent-input" onSubmit={submitPrompt}>
        <Input name="agentPrompt" placeholder="询问 WiseAgent..." disabled={apiControlsDisabled} />
        <Button type="submit" aria-label="发送" size="icon" disabled={apiControlsDisabled}>
          <Send size={17} />
        </Button>
      </form>
      {confirmApproval ? (
        <ConfirmDialog
          title={confirmApproval.title}
          message={confirmApproval.message}
          disabled={apiControlsDisabled}
          onCancel={() => void decideApiApproval(confirmApproval, false)}
          onConfirm={() => void decideApiApproval(confirmApproval, true)}
        />
      ) : null}
      {confirmAction ? (
        <ConfirmDialog
          title="确认执行 Agent 动作"
          message="该动作会改变当前原型状态。为体现治理闭环，AI 不会绕过人工确认。"
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            executeAction(confirmAction);
            setConfirmAction(null);
          }}
        />
      ) : null}
    </div>
  );
}

function SectionLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="section-label">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  cancelLabel = "\u53d6\u6d88",
  confirmLabel = "\u786e\u8ba4\u6267\u884c",
  disabled = false,
  onCancel,
  onConfirm
}: {
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const decisionHandledRef = useRef(false);
  useEffect(() => {
    if (!disabled) {
      decisionHandledRef.current = false;
    }
  }, [disabled]);

  const cancelOnce = () => {
    if (disabled || decisionHandledRef.current) {
      return;
    }
    decisionHandledRef.current = true;
    onCancel();
  };
  const confirmOnce = () => {
    if (disabled || decisionHandledRef.current) {
      return;
    }
    decisionHandledRef.current = true;
    onConfirm();
  };

  return (
    <AlertDialog open onOpenChange={(open) => (!open ? cancelOnce() : undefined)}>
      <AlertDialogContent className="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button" onClick={cancelOnce} disabled={disabled}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={confirmOnce} disabled={disabled}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
