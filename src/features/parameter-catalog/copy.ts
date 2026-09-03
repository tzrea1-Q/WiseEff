import type { CatalogAuthorizedAction } from "@/application/parameter-catalog/authority";
import type {
  CatalogConflictReason,
  CatalogEmptyReason,
  CatalogRetiredTarget
} from "@/application/parameter-catalog/states";
import type { CatalogApiFailureReason } from "@wiseeff/dto-schemas";

export const catalogPageLabel = "参数定义目录";
export const catalogListLabel = "目录列表";
export const catalogDetailLabel = "定义详情";
export const catalogTimelineLabel = "定义时间线";
export const catalogReleaseLabel = "目录发布";
export const catalogSearchLabel = "搜索参数定义";
export const catalogSearchSubmitLabel = "搜索";
export const catalogSearchClearLabel = "清除搜索";
export const catalogRefreshLabel = "刷新";
export const catalogSubjectsLabel = "主体列表";
export const catalogDefinitionsLabel = "参数定义列表";
export const catalogReviewWorkLabel = "待审核事项";
export const catalogSelectDefinitionHint = "选择一项参数定义以查看身份、修订与时间线。";
export const catalogLoadingLabel = "正在加载目录";
export const catalogStaleLoadingLabel = "正在刷新目录发布，写入已暂停";
export const catalogUnregisteredHint = "该主体尚未登记。可阅读目录内容，放置尚未建立。";
export const catalogWritesPausedHint = "当前状态禁止写入";

export const catalogStateBadges = {
  ready: "就绪",
  loading: "加载中",
  error: "失败",
  empty: "空",
  unregistered: "未登记",
  retired: "已退役",
  conflict: "冲突"
} as const;

export const catalogEmptyMessages = {
  "no-registrations": "当前发布中没有主体登记。",
  "no-definitions": "当前没有参数定义。",
  "no-review-work": "当前没有待审核事项。",
  "no-filter-match": "没有符合筛选条件的结果。"
} as const satisfies Record<CatalogEmptyReason, string>;

export const catalogRetiredMessages = {
  subject: "该主体已退役，历史记录仍可阅读，禁止新增操作。",
  definition: "该定义已退役或已弃用，历史记录仍可阅读，禁止新增操作。",
  registration: "该登记已退役，历史记录仍可阅读，禁止新增操作。",
  "legacy-surface": "旧版入口已退役，仅保留历史阅读。"
} as const satisfies Record<CatalogRetiredTarget, string>;

export const catalogActionLabels = {
  read: "查看",
  "register-subject": "登记主体",
  "retire-registration": "退役登记",
  "restore-registration": "恢复登记",
  "update-placement": "调整放置",
  "resolve-review-item": "处理审核",
  "create-proposal": "提出定义修订",
  "submit-proposal": "提交修订",
  "withdraw-proposal": "撤回修订",
  "accept-proposal": "接受修订",
  "reject-proposal": "驳回修订"
} as const satisfies Record<CatalogAuthorizedAction, string>;

export const catalogSubjectTypeLabels = {
  driver: "驱动",
  "node-type": "节点类型"
} as const;

export const catalogLifecycleLabels = {
  active: "现行",
  deprecated: "已弃用",
  retired: "已退役"
} as const;

export const catalogRegistrationLabels = {
  unregistered: "未登记",
  active: "已登记",
  retired: "已退役"
} as const;

export const catalogTimelineKindLabels = {
  "catalog-publication": "目录发布",
  history: "授权历史",
  audit: "授权审计"
} as const;

export const catalogTimelineChangeLabels = {
  introduced: "首次纳入",
  content: "内容",
  documentation: "文档",
  lifecycle: "生命周期"
} as const;

export const catalogSheetTabs = {
  detail: "详情",
  timeline: "时间线"
} as const;

export function catalogErrorCopy(reason: CatalogApiFailureReason | "unknown"): string {
  switch (reason) {
    case "catalog-not-ready":
      return "目录发布尚未就绪，请稍后重试。";
    case "subject-not-published":
      return "该主体未出现在当前目录发布中。";
    case "definition-not-found":
      return "未找到该参数定义。";
    case "forbidden":
      return "当前范围不可见该目录项。";
    case "release-drift":
      return "目录发布已变化，请刷新后重新确认。";
    default:
      return "目录加载失败，请稍后重试。";
  }
}

export function catalogConflictCopy(_reason: CatalogConflictReason): string {
  return "目录发布或放置发生冲突，请刷新证据后重新确认。";
}

export function catalogActionDisabledCopy(kind: string): string {
  switch (kind) {
    case "loading":
      return catalogStaleLoadingLabel;
    case "error":
      return "目录不可用，无法执行写入。";
    case "empty":
      return "当前没有可操作的目录项。";
    case "retired":
      return "已退役或已弃用，禁止新增操作。";
    case "conflict":
      return "目录发布冲突，请刷新证据后重新确认。";
    case "unregistered":
      return "主体尚未登记。";
    default:
      return catalogWritesPausedHint;
  }
}
