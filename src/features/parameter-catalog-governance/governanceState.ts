import {
  isCatalogActionEnabled,
  type CatalogActorKind,
  type CatalogAuthorizedAction
} from "@/application/parameter-catalog/authority";
import {
  catalogStateFromFailure,
  deriveCatalogDomainState,
  type CatalogConflictReason,
  type CatalogDomainState
} from "@/application/parameter-catalog/states";
import type {
  CatalogConditionalWriteContext,
  CatalogIdempotentWriteContext
} from "@/application/ports/ParameterCatalogGovernanceRepository";
import { requireConditionalWriteContext, requireIdempotentWriteContext } from "@/application/parameter-catalog/writeContext";
import type {
  CatalogRegisterSubjectRequest,
  CatalogReviewItemResponse
} from "@/infrastructure/http/parameterCatalogDtos";

export const REVIEW_RESOLUTION_COMMAND = "resolveReviewItem" as const;

export type GovernanceWriteKind = Exclude<CatalogAuthorizedAction, "read">;

export type GovernanceWriteSession = {
  kind: GovernanceWriteKind;
  catalogReleaseId: string;
  idempotencyKey: string;
  ifMatch?: string;
  fingerprint: string;
  pending: boolean;
};

export type GovernanceDeniedReason = "actor" | "state" | "missing-release" | "missing-etag";

export type PrepareGovernanceWriteInput = {
  actor: CatalogActorKind;
  action: CatalogAuthorizedAction;
  state: CatalogDomainState;
  catalogReleaseId: string;
  ifMatch?: string;
  draftFingerprint: string;
  pendingSession?: GovernanceWriteSession | null;
  createIdempotencyKey?: () => string;
};

export type PrepareGovernanceWriteResult =
  | { status: "denied"; reason: GovernanceDeniedReason }
  | { status: "in-flight"; session: GovernanceWriteSession }
  | {
      status: "ready";
      session: GovernanceWriteSession;
      context: CatalogIdempotentWriteContext | CatalogConditionalWriteContext;
    };

export type GovernanceWriteExecution<T> = {
  outcome: "denied" | "in-flight" | "success" | "failure";
  reason?: GovernanceDeniedReason;
  result?: T;
  error?: unknown;
  domain?: CatalogDomainState;
  session: GovernanceWriteSession | null;
  draft: unknown;
  silentRetry: false;
};

export type PlacementChoice =
  | { mode: "use-default" }
  | { mode: "choose-parent"; parentPlacementId: string; displayName: string };

export const governanceCopy = {
  agentReadOnly: "当前身份仅可阅读，不能执行写入。",
  preserveInput: "输入已保留。",
  refreshEvidence: "刷新证据",
  continueConfirm: "继续确认",
  pending: "处理中…",
  reason: "原因",
  placementMode: "放置方式",
  useDefaultPlacement: "使用默认根放置",
  chooseParentPlacement: "选择父放置",
  parentPlacement: "父放置",
  placementDisplayName: "放置显示名",
  registerTitle: "登记主体",
  placementTitle: "调整放置",
  confirmRegisterTitle: "确认登记主体",
  confirmPlacementTitle: "确认调整放置",
  confirmRegister: "确认登记",
  confirmPlacement: "确认调整放置",
  registerAck: "我已确认放置选择与当前目录发布",
  reviewQueue: "待审核事项",
  reviewEmpty: "当前没有待审核事项。",
  reviewLoading: "正在加载待审核事项",
  resolveTitle: "处理审核",
  confirmResolveTitle: "确认处理审核",
  confirmResolve: "确认处理",
  resolveAck: "我已确认按当前审核证据一次性处理，不会拆成部分写入",
  staleReview: "候选证据已过期，请刷新后重新确认。",
  proposalPanel: "定义修订",
  proposalNoMaterialize: "不会在此界面生成参数定义",
  proposalIntentRecorded: "发布意图已记录，不会在此界面生成参数定义。",
  changeKind: "变更类型",
  repositoryReference: "仓库引用",
  confirmCreateProposalTitle: "确认提出修订",
  confirmCreateProposal: "确认提出修订",
  confirmSubmitTitle: "确认提交修订",
  confirmSubmit: "确认提交",
  confirmWithdrawTitle: "确认撤回修订",
  confirmWithdraw: "确认撤回",
  confirmAcceptTitle: "确认接受修订",
  confirmAccept: "确认接受",
  confirmRejectTitle: "确认驳回修订",
  confirmReject: "确认驳回",
  proposalAck: "我已确认本次修订不会在此界面生成参数定义",
  selfApproval: "提交人不能接受自己的修订，需由其他平台管理员处理。",
  submitProposal: "提交修订",
  withdrawProposal: "撤回修订",
  acceptProposal: "接受修订",
  rejectProposal: "驳回修订"
} as const;

export const reviewReasonLabels = {
  unknown: "未能识别",
  ambiguous: "识别不唯一",
  "placement-conflict": "放置冲突",
  "retired-registration-observed": "观测到已退役登记"
} as const;

export const reviewResolutionLabels = {
  "register-subject": "登记主体",
  "restore-registration": "恢复登记",
  "mark-out-of-scope": "标为范围外",
  "open-definition-proposal": "打开定义修订"
} as const;

export const proposalStatusLabels = {
  draft: "草稿",
  submitted: "已提交",
  accepted: "已接受",
  rejected: "已驳回",
  withdrawn: "已撤回"
} as const;

export const proposalChangeKindLabels = {
  documentation: "文档",
  content: "内容",
  lifecycle: "生命周期"
} as const;

const CONFLICT_COPY: Record<CatalogConflictReason, string> = {
  "release-drift": "目录发布已变化，请刷新证据后重新确认。输入已保留。",
  "placement-conflict": "放置发生冲突，请刷新后重新确认。输入已保留。",
  "invalid-placement-parent": "所选父放置无效。审核项仍未处理。输入已保留。",
  "revision-conflict": "审核版本已变化，请刷新后重新确认。输入已保留。",
  "proposal-stale": "修订基于过期目录发布，请变基后重新确认。输入已保留。",
  "legacy-id-ambiguous": "旧标识不唯一，未披露候选。输入已保留。",
  "observation-ambiguous": "观测结果不唯一，请打开审核项。输入已保留。"
};

export function createGovernanceIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function fingerprintGovernanceDraft(value: unknown): string {
  return JSON.stringify(value);
}

export function canExecuteGovernanceAction(
  actor: CatalogActorKind,
  action: CatalogAuthorizedAction,
  state: CatalogDomainState
): boolean {
  return isCatalogActionEnabled(actor, action, state);
}

export function writeActionNeedsIfMatch(action: CatalogAuthorizedAction): boolean {
  return action !== "read" && action !== "register-subject" && action !== "create-proposal";
}

export function placementIntentFromChoice(
  choice: PlacementChoice
): CatalogRegisterSubjectRequest["placement"] {
  if (choice.mode === "use-default") {
    return { mode: "use-default" };
  }
  return {
    mode: "choose-parent",
    parentPlacementId: choice.parentPlacementId,
    displayName: choice.displayName
  };
}

export function proposalOutcomeMaterializesDefinition(): false {
  return false;
}

export function reviewItemGovernanceState(
  item: CatalogReviewItemResponse["item"],
  fallback: CatalogDomainState
): CatalogDomainState {
  if (item.candidateState.status === "stale") {
    return deriveCatalogDomainState({ reviewItem: item });
  }
  return fallback;
}

export function governanceConflictCopy(reason: CatalogConflictReason): string {
  return CONFLICT_COPY[reason];
}

export function governanceFailureMessage(state: CatalogDomainState | undefined): string {
  if (!state) {
    return "目录写入失败，请稍后重试。";
  }
  if (state.kind === "conflict") {
    return governanceConflictCopy(state.reason);
  }
  if (state.kind === "error") {
    if (state.reason === "proposal-self-approval-forbidden") {
      return governanceCopy.selfApproval;
    }
    if (state.reason === "forbidden") {
      return "当前身份不能执行该写入。";
    }
    if (state.reason === "catalog-not-ready") {
      return "目录发布尚未就绪，请稍后重试。";
    }
  }
  return "目录写入失败，请稍后重试。";
}

export function governanceDeniedMessage(reason: GovernanceDeniedReason): string {
  if (reason === "actor") {
    return governanceCopy.agentReadOnly;
  }
  if (reason === "missing-etag" || reason === "missing-release") {
    return "缺少目录发布或版本条件，未发送写入。";
  }
  return "当前状态禁止写入。";
}

export function withOptionalReason<T extends object>(
  body: T,
  reason: string
): T & { reason?: string } {
  const trimmed = reason.trim();
  return trimmed ? { ...body, reason: trimmed } : body;
}

export function prepareGovernanceWrite(
  input: PrepareGovernanceWriteInput
): PrepareGovernanceWriteResult {
  if (input.pendingSession?.pending) {
    return { status: "in-flight", session: input.pendingSession };
  }
  if (!canExecuteGovernanceAction(input.actor, input.action, input.state)) {
    return { status: "denied", reason: input.actor === "agent" ? "actor" : "state" };
  }
  if (input.action === "read") {
    return { status: "denied", reason: "state" };
  }
  if (!input.catalogReleaseId.trim()) {
    return { status: "denied", reason: "missing-release" };
  }
  const needsMatch = writeActionNeedsIfMatch(input.action);
  if (needsMatch && !input.ifMatch?.trim()) {
    return { status: "denied", reason: "missing-etag" };
  }
  const idempotencyKey = (input.createIdempotencyKey ?? createGovernanceIdempotencyKey)();
  const session: GovernanceWriteSession = {
    kind: input.action as GovernanceWriteKind,
    catalogReleaseId: input.catalogReleaseId,
    idempotencyKey,
    ifMatch: needsMatch ? input.ifMatch : undefined,
    fingerprint: input.draftFingerprint,
    pending: true
  };
  try {
    const context = needsMatch
      ? requireConditionalWriteContext({
          catalogReleaseId: input.catalogReleaseId,
          idempotencyKey,
          ifMatch: input.ifMatch ?? ""
        })
      : requireIdempotentWriteContext({
          catalogReleaseId: input.catalogReleaseId,
          idempotencyKey
        });
    return { status: "ready", session, context };
  } catch {
    return { status: "denied", reason: needsMatch ? "missing-etag" : "missing-release" };
  }
}

export async function executeGovernanceWrite<T>(
  input: PrepareGovernanceWriteInput & {
    draft: unknown;
    write: (context: CatalogIdempotentWriteContext | CatalogConditionalWriteContext) => Promise<T>;
  }
): Promise<GovernanceWriteExecution<T>> {
  const prepared = prepareGovernanceWrite(input);
  if (prepared.status === "denied") {
    return {
      outcome: "denied",
      reason: prepared.reason,
      session: null,
      draft: input.draft,
      silentRetry: false
    };
  }
  if (prepared.status === "in-flight") {
    return {
      outcome: "in-flight",
      session: prepared.session,
      draft: input.draft,
      silentRetry: false
    };
  }
  try {
    const result = await input.write(prepared.context);
    return {
      outcome: "success",
      result,
      session: { ...prepared.session, pending: false },
      draft: input.draft,
      silentRetry: false
    };
  } catch (error) {
    const domain = catalogStateFromFailure(error);
    return {
      outcome: "failure",
      error,
      domain,
      session: { ...prepared.session, pending: false },
      draft: input.draft,
      silentRetry: false
    };
  }
}

export function createGovernanceSubmitGate() {
  let inflight = false;
  let session: GovernanceWriteSession | null = null;

  return {
    isInFlight() {
      return inflight;
    },
    peekSession() {
      return session;
    },
    begin(input: Omit<PrepareGovernanceWriteInput, "pendingSession">): PrepareGovernanceWriteResult {
      const prepared = prepareGovernanceWrite({
        ...input,
        pendingSession: inflight ? session : null
      });
      if (prepared.status === "ready") {
        inflight = true;
        session = prepared.session;
      }
      return prepared;
    },
    succeed() {
      inflight = false;
      if (session) {
        session = { ...session, pending: false };
      }
    },
    fail() {
      inflight = false;
      if (session) {
        session = { ...session, pending: false };
      }
    },
    reset() {
      inflight = false;
      session = null;
    }
  };
}

export type GovernanceSubmitGate = ReturnType<typeof createGovernanceSubmitGate>;
