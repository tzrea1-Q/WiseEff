import { logSkillRevisionDtoSchema } from "@wiseeff/dto-schemas";
import type { SkillSpec } from "./types";

export type FormatProfile = NonNullable<SkillSpec["formatProfile"]>;
const schema = logSkillRevisionDtoSchema.shape.spec.shape.formatProfile;

export function formatProfileCode(profile: SkillSpec["formatProfile"]): string {
  return profile === undefined ? "" : JSON.stringify(profile, null, 2);
}

export function parseFormatProfileCode(text: string): { profile?: FormatProfile; error?: string } {
  try {
    const value: unknown = text.trim() ? JSON.parse(text) : undefined;
    const result = schema.safeParse(value);
    return result.success ? { profile: result.data } : { error: result.error.issues.map((issue) => `${issue.path.join(".") || "formatProfile"}: ${issue.message}`).join("\n") };
  } catch (error) {
    return { error: `基础格式 JSON 无法解析：${error instanceof Error ? error.message : String(error)}` };
  }
}
