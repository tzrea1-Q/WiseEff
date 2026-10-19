import type { LogDomain } from "@/domain/logs/types";

export const mockLogSkills: LogDomain[] = [{
  id: "skill-charging", name: "充电诊断", description: "充电链路日志分析", status: "active",
  currentRevision: { id: "skill-charging-v1", number: 1, publishedAt: "2026-10-18T00:00:00.000Z" },
  hasDraft: false, analyses7d: 3, helpfulRate7d: 0.8,
  createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z"
}];
