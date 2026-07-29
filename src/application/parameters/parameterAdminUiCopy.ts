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

  moduleMapping: "模块归属",
  moduleMappingManage: "模块归属",
  moduleMappingBlurb: "业务分类 → 驱动组 → 器件实例 / 逻辑节点。在树里维护已归属模块。",
  moduleTreeTitle: "模块树",
  moduleTreeSubnav: "归属树",
  moduleDiscoveryCompatible: "未登记驱动",
  moduleDiscoveryCompatibleEmpty: "当前没有未登记的驱动。",
  moduleQueueSubnavAria: "模块归属子视图",
  moduleQueueBanner: "有未登记的驱动",
  moduleQueueBannerAction: "去处理未登记驱动",
  classifyCompatible: "归类",
  classifyCompatibleBulk: "批量归类",
  dismissCompatible: "忽略",
  restoreCompatible: "恢复忽略",
  classifyDialogEyebrow: "模块归属 · 归类 compatible",
  classifyDialogTitle: "归类到业务分类",
  classifyDialogBulkTitle: "批量归类到业务分类",
  classifyTargetBusiness: "目标业务分类",
  classifyDriverGroupName: "驱动组名称",
  classifyPreview: "影响预览",
  classifyApply: "确认归类",
  classifyBlocked: "存在阻断冲突，无法归类",
  driverRegistryRegisterDialogTitle: "登记驱动",
  driverRegistryRegister: "登记驱动",
  claimDriver: "认领登记",
  driverRegistryDisplayName: "显示名称",
  driverRegistryBusinessCategory: "业务分类",
  driverRegistryCompatibles: "compatible（每行一条）",
  driverRegistryNotes: "备注",
  driverRegistryNotYetObserved: "未实测",
  driverRegistryCoverageCovered: "已覆盖",
  driverRegistryCoverageOverlay: "组织覆盖",
  driverRegistryCoverageShadowed: "已被平台覆盖遮蔽",
  driverRegistryCoverageUncovered: "未覆盖",
  moduleAttributionHideNotYetObserved: "隐藏未实测",
  moduleAttributionOnlyUncoveredParse: "只看解析未覆盖",
  moduleAttributionCoveragePartial: "解析 {covered}/{total}",
  moduleAttributionCoverageCovered: "解析已覆盖",
  moduleAttributionCoverageOverlay: "解析组织覆盖",
  moduleAttributionCoverageShadowed: "解析已被遮蔽",
  moduleAttributionCoverageUncovered: "解析未覆盖",
  authorOverlaySchema: "编写解析 schema",
  organizationDriverSchemaDialogTitle: "编写组织解析 schema",
  organizationDriverSchemaDisplayName: "显示名称",
  organizationDriverSchemaNotes: "备注",
  organizationDriverSchemaProperties: "关联参数定义",
  organizationDriverSchemaPropertyKey: "属性键",
  organizationDriverSchemaValueShape: "值类型",
  organizationDriverSchemaUnits: "单位",
  organizationDriverSchemaDocumentation: "说明",
  organizationDriverSchemaAddProperty: "添加参数定义",
  organizationDriverSchemaSaveActivate: "保存并激活",
  organizationDriverSchemaEmptyLinks: "尚未关联参数定义。点击下方按钮从定义库选用或新建。",
  organizationDriverSchemaPendingCreate: "保存时写入定义库",
  organizationDriverSchemaRemoveLink: "移除",
  organizationDriverSchemaPickerTitle: "选择参数定义",
  organizationDriverSchemaPickerBlurb:
    "点击表格行或「选用」选中一条定义，再点「使用所选」带回；也可新建定义。",
  organizationDriverSchemaPickerConfirm: "使用所选",
  organizationDriverSchemaPickerBack: "返回",
  organizationDriverSchemaCreateTitle: "新建参数定义",
  organizationDriverSchemaCreateConfirm: "创建并选用",
  organizationDriverSchemaLinkExisting: "选用已有定义",
  organizationDriverSchemaCreateNew: "新建定义",
  organizationDriverSchemaSelectSpec: "参数定义",
  organizationDriverSchemaMode: "来源",
  queueColCompatible: "compatible",
  queueColBindings: "影响参数",
  queueColProjects: "涉及项目",
  queueColSuggested: "建议驱动组",
  queueColActions: "操作",
  specModulePrediction: "预测模块",

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
    "组织配置与项目运营；子路由涵盖参数定义库、定义匹配审核、模块归属、节点对应与批量导入",

  xiaozeSpecReview: "正在关注定义匹配审核队列与类型定义确认。",
  xiaozeIdentityMapping: "正在关注迁移期节点对应任务与无损确认。",
  xiaozeOrgDefault:
    "正在关注组织级参数定义库、定义匹配审核、模块归属、批量导入与节点对应确认。",

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
