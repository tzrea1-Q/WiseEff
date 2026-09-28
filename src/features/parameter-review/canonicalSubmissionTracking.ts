import type {
  CatalogValueChangeRequestDto
} from "@/infrastructure/http/parameterCatalogDtos";

export type CanonicalRequestStatus = CatalogValueChangeRequestDto["status"];

export type CanonicalRequest = CatalogValueChangeRequestDto;

export const canonicalStatusLabels: Record<CanonicalRequestStatus, string> = {
  pending: "待审核",
  approved: "已批准",
  rejected: "已驳回",
  withdrawn: "已撤回"
};

export const canonicalTerminalStatuses = new Set<CanonicalRequestStatus>([
  "approved",
  "rejected",
  "withdrawn"
]);

export function isCanonicalPending(request: Pick<CanonicalRequest, "status">) {
  return request.status === "pending";
}

export function isCanonicalHistory(request: Pick<CanonicalRequest, "status">) {
  return canonicalTerminalStatuses.has(request.status);
}

export function canonicalRequestSourceText(request: Pick<CanonicalRequest, "sourceFormat" | "sourceTarget" | "targetValue">) {
  return request.sourceFormat === "json" && request.sourceTarget
    ? request.sourceTarget.sourceText
    : request.targetValue;
}

export function canonicalRequestActionLabel(request: Pick<CanonicalRequest, "action">) {
  return request.action === "delete" ? "删除属性" : "设置属性";
}
