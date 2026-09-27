import type { ParameterFileSourcePreview } from "@/application/ports/ParameterFileRepository";

type Receipt = NonNullable<ParameterFileSourcePreview["request"]>;

export function permitsFreshBatchRequest(receipt: Receipt | undefined): boolean {
  return !receipt || (receipt.kind === "batch"
    && (receipt.status === "rejected" || receipt.status === "withdrawn"));
}

export function candidateReceiptMessage(receipt: Receipt): string {
  if (receipt.status === "pending" || receipt.status === "approved") {
    return `已有${receipt.kind === "batch" ? "批量" : "单目标"}审核请求 ${receipt.id}（${receipt.status}），不能重复提交。`;
  }
  return receipt.kind === "single"
    ? `单目标请求 ${receipt.id} 已${receipt.status === "rejected" ? "驳回" : "撤回"}；原候选没有新的可提交选择。`
    : `批量请求 ${receipt.id} 已${receipt.status === "rejected" ? "驳回" : "撤回"}；须重新获取来源和冲突证明后才能提交新请求。`;
}
