/** Turn server proof codes into actionable workbench copy without changing the API contract. */
export function sourceReviewReason(reason?: string): string {
  switch (reason) {
    case "candidate-changes-multiple-bindings":
      return "候选同时修改多个参数绑定；当前批量审核提交尚未开放。";
    case "canonical-batch-writer-unavailable":
      return "已证明多个参数绑定的来源差异；批量审核提交尚未开放。";
    case "dts-batch-source-proof-failed":
      return "DTS 批量来源差异无法逐项证明；请核对目标属性和文件内容。";
    case "candidate-changed-unbound-or-non-target-bytes":
    case "dts-render-not-byte-exact":
      return "候选还修改了目标参数以外的内容；请拆分或重新准备候选。";
    case "source-membership-drift":
      return "配置集成员或文件版本已变化，请刷新后重新准备来源变更。";
    case "candidate-base-is-stale":
    case "candidate-base-is-not-a-pinned-source":
      return "候选基版本已不是当前固定来源，请刷新并重新上传候选。";
    case "candidate-json-invalid":
      return "候选 JSON 无法解析，请修正文件后重新上传。";
    case "unsupported-source-format":
      return "当前来源格式不受支持；来源审核仅支持 DTS 和 JSON。";
    case "candidate-is-not-reviewable":
      return "当前候选状态不能提交审核，请刷新候选状态。";
    case undefined:
      return "当前来源快照不允许提交审核。";
    default:
      return "来源校验未通过，请刷新并重新准备候选；若仍失败，请联系管理员。";
  }
}
