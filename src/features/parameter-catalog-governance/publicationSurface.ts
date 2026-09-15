import type { CatalogPublicationSurfaceResponse } from "@/infrastructure/http/parameterCatalogDtos";

export type PublicationSurfaceItem = CatalogPublicationSurfaceResponse["item"];

/**
 * The server's publication surface is the authority for whether this session can
 * author or publish definitions. Row actions must mirror it; a control that the
 * server would refuse is not a security boundary (issue #847 story 36).
 */
export function publicationSurfaceAllowsAuthoring(
  surface: PublicationSurfaceItem | null | undefined
): boolean {
  return surface?.authoringAllowed === true;
}

export function publicationSurfaceAllowsPublishing(
  surface: PublicationSurfaceItem | null | undefined
): boolean {
  return surface?.publishingAllowed === true;
}

export const publicationSurfaceCopy = {
  title: "发布状态",
  history: "发布记录",
  historyEmpty: "当前组织还没有可见的发布任务。",
  nextStep: "下一步",
  policyDisabled: "实例发布策略已关闭。日常编写入口仍可查看，但不能预览或发布。",
  frozen: "目录发布处于维护冻结。请等待解冻，不要在本页解除运维 freeze。",
  notAdopted: "当前目录尚未完成接管。需要运维按手册执行 inspect/adopt，本页不能代替接管。",
  capabilityMissing: "当前会话缺少目录编写或发布权限。",
  notAuthorized: "当前身份不能发起目录发布。",
  authorOnly: "可以保存草稿并预览，但发布需要 catalog:publish。",
  reviewRequired: "高风险变更需要另一位具备 catalog:review-high-risk 的人员批准。",
  ready: "策略已启用，目录已接管。按权限编写、预览并发布。",
  noOps: "本页不提供提权、改策略表、解除 freeze 或数据库 provisioning。",
  fetchFailed: "无法读取发布状态，编写和发布已暂停。"
} as const;

export function publicationSurfaceMessage(surface: PublicationSurfaceItem): {
  tone: "info" | "warning" | "danger";
  message: string;
  next: string;
} {
  if (surface.blockers.includes("publication-not-authorized")) {
    return { tone: "warning", message: publicationSurfaceCopy.notAuthorized, next: publicationSurfaceCopy.noOps };
  }
  if (surface.blockers.includes("catalog-not-adopted")) {
    return { tone: "warning", message: publicationSurfaceCopy.notAdopted, next: "由运维按操作员手册执行 inspect 与 adopt。" };
  }
  if (surface.blockers.includes("publication-frozen")) {
    return { tone: "warning", message: publicationSurfaceCopy.frozen, next: "等待升级或维护完成后由拥有冻结的操作员解冻。" };
  }
  if (surface.blockers.includes("publication-policy-disabled")) {
    return { tone: "warning", message: publicationSurfaceCopy.policyDisabled, next: "由受控运维入口启用 publication_enabled，不要在本页改策略。" };
  }
  if (surface.blockers.includes("publication-capability-missing")) {
    return { tone: "info", message: publicationSurfaceCopy.capabilityMissing, next: "请具备权限的管理员授予真实 capability，而不是默认 admin。" };
  }
  if (surface.authoringAllowed && !surface.publishingAllowed) {
    return { tone: "info", message: publicationSurfaceCopy.authorOnly, next: publicationSurfaceCopy.reviewRequired };
  }
  return { tone: "info", message: publicationSurfaceCopy.ready, next: publicationSurfaceCopy.noOps };
}
