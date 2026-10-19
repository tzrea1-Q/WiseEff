import type { LogDomain } from "@/domain/logs/types";
import type { AnalysisSkill } from "@/features/log-skills/types";

export const mockLogSkills: LogDomain[] = [{
  id: "skill-charging", name: "充电诊断", description: "充电链路日志分析", status: "active",
  currentRevision: { id: "skill-charging-v1", number: 1, publishedAt: "2026-10-18T00:00:00.000Z" },
  hasDraft: false, analyses7d: 3, helpfulRate7d: 0.8,
  createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z"
}];

export function mockSkillWorkspace(id: string): AnalysisSkill | null {
  const skill = mockLogSkills.find((item) => item.id === id);
  if (!skill) return null;
  return { id: skill.id, name: skill.name, description: skill.description, status: skill.status, createdAt: skill.createdAt, updatedAt: skill.updatedAt,
    currentRevision: { id: "skill-charging-v1", skillId: id, number: 1, status: "published",
    spec: { schemaVersion: "skill/v1", description: skill.description }, contentHash: "seed", createdByUserId: null,
    publishedByUserId: null, createdAt: skill.createdAt, publishedAt: skill.currentRevision!.publishedAt }, draft: null };
}
