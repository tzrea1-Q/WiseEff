/**
 * User-facing Chinese copy for parameter admin / governance surfaces.
 * Keep code identifiers (spec, binding, …); only UI strings live here.
 */

export const PARAMETER_ADMIN_UI = {
  orgScope: "组织配置",
  projectScope: "项目运营",
  orgSubnavAria: "组织配置子视图",
  scopeNavAria: "参数管理后台配置范围",

  specLibrary: "参数定义库",
  specLibrarySearch: "搜索参数定义",
  specLibraryEmpty: "没有匹配的参数定义。",
  specLibraryLoading: "正在加载参数定义…",
  specLibraryBlurb:
    "按属性键与驱动维护可复用的参数定义；同名属性按驱动/模块区分。路径仅作定位参考。",
  specDetail: "参数定义详情",
  specDetailEyebrowEditable: "参数定义库 · 可编辑",
  specDetailEyebrowReadonly: "参数定义库 · 只读",
  specKey: "定义标识",
  specDocs: "参数说明",
  activateSpec: "激活定义",
  activateDraftSpec: "激活草稿定义",
  createDraftSpec: "创建草稿定义",
  saveAndActivate: "保存并激活",

  specReview: "定义匹配审核",
  specReviewQueue: "定义匹配审核队列",
  specReviewQueueBlurb:
    "导入 DTS 后，系统没能自动对上参数定义的属性会出现在这里。打开任务选定定义并批准即可；库里没有时，先新建并启用定义，再回来批准。",
  specReviewEmpty: "没有待确认的自动匹配。",
  specReviewNoFilterMatch: "没有匹配的审核任务。",
  specReviewDialogEyebrow: "定义匹配审核 · 审核决定",
  specReviewEvidence: "匹配依据",
  specReviewCandidates: "系统推荐定义",
  specReviewDecision: "审核决定",
  searchSpecLibrary: "搜索参数定义库",
  selectSpec: "选择参数定义",
  selectSpecPlaceholder: "请选择参数定义…",
  searchSpecPlaceholder: "按属性键、驱动或定义标识搜索",
  approveReasonPlaceholder: "说明为何选择该参数定义",
  specReviewApproved: "定义匹配审核已批准。",
  specReviewDismissed: "定义匹配审核已驳回。",
  specReviewApprovedAudit: "定义匹配审核已批准",
  specReviewDismissedAudit: "定义匹配审核已驳回",

  matchUnmatched: "未找到定义",
  matchAmbiguous: "匹配冲突",
  matchHasCandidates: "有多项匹配",

  moduleMapping: "驱动归属配置",
  moduleMappingManage: "驱动归属配置",
  moduleMappingBlurb:
    "维护业务模块，并把 DTS 驱动 / compatible / 器件实例归属到模块。下方「待归类驱动」来自已解析的项目参数，与定义匹配审核无关。",
  moduleDiscoveryCompatible: "待归类驱动（compatible）",
  moduleDiscoveryDriver: "待归类驱动（driver）",
  mappingRules: "归属规则",
  addMapping: "添加归属",
  deleteMapping: "删除归属",

  identityMapping: "节点对应确认",
  identityMappingGovernance: "节点对应确认",
  identityMappingBlurb: "确认迁移期未能自动对齐的参数节点对应关系。",
  identityMappingEmpty: "当前没有待处理的节点对应任务。",
  identityMappingLoading: "正在加载节点对应任务…",
  identityMappingLoadError: "无法加载节点对应任务。",
  identityMappingResolveError: "节点对应确认失败。",
  identityMappingReview: "节点对应审核",
  identityMappingCandidates: "候选拓扑节点",
  selectIdentityCandidate: "选择对应节点",
  confirmIdentityMapping: "确认对应",
  identityConfirmReason: "确认原因",
  identityConfirmReasonPlaceholder: "说明为何选择该节点",

  changeReview: "变更审阅",
  adminSubtitle:
    "组织配置与项目运营；子路由涵盖参数定义库、定义匹配审核、驱动归属、节点对应与批量导入",

  xiaozeSpecReview: "正在关注定义匹配审核队列与类型定义确认。",
  xiaozeIdentityMapping: "正在关注迁移期节点对应任务与无损确认。",
  xiaozeOrgDefault:
    "正在关注组织级参数定义库、定义匹配审核、驱动归属、批量导入与节点对应确认。",

  lifecycleDraft: "草稿",
  lifecycleActive: "已启用",
  lifecycleDeprecated: "已废弃",
  lifecycleNeedsReview: "待复核"
} as const;

export type SpecReviewMatchStatusUi =
  | typeof PARAMETER_ADMIN_UI.matchUnmatched
  | typeof PARAMETER_ADMIN_UI.matchAmbiguous
  | typeof PARAMETER_ADMIN_UI.matchHasCandidates;

/** Localize lifecycle / review-state enums for display; keep raw value as fallback. */
export function formatParameterSpecLifecycle(raw: string | null | undefined): string {
  switch ((raw ?? "").trim()) {
    case "draft":
      return PARAMETER_ADMIN_UI.lifecycleDraft;
    case "active":
      return PARAMETER_ADMIN_UI.lifecycleActive;
    case "deprecated":
      return PARAMETER_ADMIN_UI.lifecycleDeprecated;
    case "needs_review":
      return PARAMETER_ADMIN_UI.lifecycleNeedsReview;
    default:
      return raw?.trim() || "—";
  }
}
