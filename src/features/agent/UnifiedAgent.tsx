import { AlertTriangle, Bot, Info, Lightbulb, ListChecks, LockKeyhole, Play, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, Dispatch, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { AppAction } from "@/App";
import { canPerform, getDisabledReason } from "@/app/permissions";
import type { createAgentPlan } from "@/appConfig";
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
import { projects, type PrototypeState } from "@/mockData";
import type { ComparisonProjectSelection } from "@/ParameterComparison/types";

function createComparisonInsights(state: PrototypeState, selection: ComparisonProjectSelection) {
  const baseProject = projects.find((project) => project.id === selection.baseProjectId) ?? projects[0];
  const targetProject = projects.find((project) => project.id === selection.targetProjectId) ?? projects[1] ?? projects[0];
  const baseParameters = state.parameters.filter((parameter) => parameter.projectId === baseProject.id);
  const targetParameters = state.parameters.filter((parameter) => parameter.projectId === targetProject.id);
  const targetByName = new Map(targetParameters.map((parameter) => [parameter.name, parameter]));
  const comparisonRows = baseParameters.map((baseParameter) => {
    const targetParameter = targetByName.get(baseParameter.name);

    return {
      key: baseParameter.name,
      risk: baseParameter.risk,
      status: targetParameter && targetParameter.currentValue === baseParameter.currentValue ? "synced" : "drift"
    };
  });
  const driftRows = comparisonRows.filter((row) => row.status === "drift");
  const primaryInsight = driftRows.find((row) => row.risk === "High") ?? driftRows[0] ?? comparisonRows[0];
  const secondaryInsight = driftRows.find((row) => row.key !== primaryInsight?.key) ?? comparisonRows[1] ?? primaryInsight;

  return {
    baseProject,
    targetProject,
    primaryInsight,
    secondaryInsight
  };
}

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

export function UnifiedAgent({
  path,
  plan,
  state,
  dispatch,
  comparisonSelection
}: {
  path: string;
  plan: ReturnType<typeof createAgentPlan>;
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  comparisonSelection: ComparisonProjectSelection;
}) {
  const [open, setOpen] = useState(false);
  const [agentPosition, setAgentPosition] = useState<AgentPosition>({ right: 24, bottom: 24 });
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState<string[]>(["我会根据当前页面上下文给出建议。涉及状态变更的动作会先请求确认。"]);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const dragStateRef = useRef<AgentDragState | null>(null);
  const suppressNextClickRef = useRef(false);

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

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = String(form.get("agentPrompt") ?? "").trim();
    if (!value) {
      return;
    }
    setMessages((items) => [`你问：${value}`, `WiseAgent：我已结合 ${plan.contextTitle} 上下文生成一组可执行建议。`, ...items]);
    event.currentTarget.reset();
  };

  const agentPositionStyle: CSSProperties = {
    right: `${agentPosition.right}px`,
    bottom: `${agentPosition.bottom}px`
  };
  const agentPanelPositionStyle: CSSProperties = {
    right: `${clampAgentPanelOffset(agentPosition.right, window.innerWidth)}px`,
    bottom: `${agentPosition.bottom}px`
  };
  const comparisonInsights = path === "/parameter-comparison" ? createComparisonInsights(state, comparisonSelection) : null;
  const visibleActions = plan.actions.filter((action) => {
    const requiredAction = action.requiredPermission;
    return !requiredAction || canPerform(state.activeRoleId, requiredAction);
  });

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
    <div className="agent-panel" data-path={path} style={agentPanelPositionStyle}>
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
        {comparisonInsights ? (
          <div className="agent-insight-stack" aria-label="WiseAgent 洞察">
            <div className="agent-insight-heading">
              <Bot size={16} />
              <strong>WiseAgent 洞察</strong>
            </div>
            <div className="agent-insight-card accent-secondary">
              <SectionLabel icon={<Info size={15} />} label="项目差异风险" />
              <p>
                <code>{comparisonInsights.primaryInsight?.key}</code> 在 {comparisonInsights.baseProject.code} 与 {comparisonInsights.targetProject.code} 间存在差异，
                建议结合充电温升与降额日志判断是否同步。
              </p>
              <Button className="link-button" type="button" variant="link">查看历史延迟</Button>
            </div>
            <div className="agent-insight-card accent-tertiary">
              <SectionLabel icon={<ListChecks size={15} />} label="参数值对照" />
              <p>
                <code>{comparisonInsights.secondaryInsight?.key}</code> 的项目配置需要按机型定位、电池规格和区域电源策略一起复核。
              </p>
            </div>
            <div className="agent-insight-card accent-danger">
              <SectionLabel icon={<AlertTriangle size={15} />} label="风险阈值漂移" />
              <p>
                高重要性参数会直接影响充电安全、电量估算或热管理表现，同步前需要先完成参数审阅。
              </p>
            </div>
          </div>
        ) : null}
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
          {messages.slice(0, 4).map((message, index) => (
            <div className={index % 2 === 0 ? "agent-message" : "agent-message user"} key={`${message}-${index}`}>
              {message}
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
              onClick={() => {
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
        <Input name="agentPrompt" placeholder="询问 WiseAgent..." />
        <Button type="submit" aria-label="发送" size="icon">
          <Send size={17} />
        </Button>
      </form>
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
  onCancel,
  onConfirm
}: {
  title: string;
  message: string;
  cancelLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <AlertDialogContent className="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button" onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
