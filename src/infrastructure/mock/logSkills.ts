import type { LogDomain } from "@/domain/logs/types";
import type { AnalysisSkill, SkillSample, SkillTemplate, SourceSnapshot } from "@/features/log-skills/types";

export const mockSkillTemplates: SkillTemplate[] = [
  ["generic-text", "通用文本日志"], ["linux-dmesg", "Linux 内核 dmesg"],
  ["android-logcat", "Android logcat"], ["json-lines", "JSON Lines"]
].map(([id, label]) => ({ id, label, description: "演示模式仅供查看。", spec: { schemaVersion: "skill/v1" } }));

const sampleContent = "INFO charging started\nERROR charging timeout code=E_TIMEOUT";
export const mockSkillSample: SkillSample = { id: "sample-charging", skillId: "skill-charging", fileName: "charging.log",
  sizeBytes: sampleContent.length, sha256: "seed", encoding: "utf-8", lineCount: 2, uploadedByUserId: null,
  createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z",
  content: sampleContent, truncated: false };
// Workspace authoring is API-only; the mock source section has no uploaded archives.
export const mockSourceSnapshots: SourceSnapshot[] = [];

export const mockLogSkills: LogDomain[] = [{
  id: "skill-charging", name: "充电诊断", description: "充电链路日志分析", status: "active",
  currentRevision: { id: "skill-charging-v1", number: 1, publishedAt: "2026-10-18T00:00:00.000Z" },
  hasDraft: false, analyses7d: 3, helpfulRate7d: 0.8,
  createdAt: "2026-10-18T00:00:00.000Z", updatedAt: "2026-10-18T00:00:00.000Z"
}];

export function mockSkillWorkspace(id: string): AnalysisSkill | null {
  const skill = mockLogSkills.find((item) => item.id === id);
  if (!skill) return null;
  return { id: skill.id, skillKey: "charging", budgetCaps: { stepBudget: 6, tokenBudget: 8000 }, name: skill.name, description: skill.description, status: skill.status, createdAt: skill.createdAt, updatedAt: skill.updatedAt,
    currentRevision: { id: "skill-charging-v1", skillId: id, number: 1, status: "published",
    spec: { schemaVersion: "skill/v1", description: skill.description, parsing: { schemaVersion: "parsing/v1", extractors: [
      { id: "charge_current", pattern: "charge_current_ma=(?P<current>\\d+)", fields: { current: { type: "uint" } } }
    ] } }, contentHash: "seed", createdByUserId: null,
    publishedByUserId: null, createdAt: skill.createdAt, publishedAt: skill.currentRevision!.publishedAt }, draft: null };
}
