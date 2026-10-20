import { compileSkillFiles, MAX_SKILL_FILE_GLOBS } from "../../../src/domain/logs/fileApplicability";
import { runInNewContext } from "node:vm";
import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "./objectStore";
import { requireLogAdminDomains } from "./policy";
import { getLogSkillSample } from "./skillSamplesService";
import { logSkillSpecSchema } from "./skillSpec";

export { skillFilePreviewRequestSchema, skillFilePreviewResponseSchema } from "./skillSpec";

export const FILE_PREVIEW_LIMITS = { maxMs: 100, paths: 2000 } as const;

export function previewSkillFiles(files: unknown, paths: readonly string[], options: { maxMs?: number } = {}) {
  const reject = (path: (string | number)[], message: string) => ({ valid: false, issues: [{ path, message }], files: [] });
  if (Array.isArray(files) && files.length > MAX_SKILL_FILE_GLOBS) return reject(["files"], `At most ${MAX_SKILL_FILE_GLOBS} file globs are allowed`);
  if (paths.length > FILE_PREVIEW_LIMITS.paths) return reject(["sample", "files"], "Sample file count exceeds the preview limit");
  const maxMs = Math.max(0, Math.min(options.maxMs ?? FILE_PREVIEW_LIMITS.maxMs, FILE_PREVIEW_LIMITS.maxMs));
  const timedOut = () => reject(["files"], "File applicability preview exceeded its execution deadline");
  if (maxMs === 0) return timedOut();
  const preview = () => {
    const parsed = logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", files });
    if (!parsed.success) return { valid: false, issues: parsed.error.issues.map(({ path, message }) => ({ path, message })), files: [] };
    const matchFile = compileSkillFiles(parsed.data.files);
    return { valid: true, issues: [], files: paths.map((path) => ({ path, ...matchFile(path) })) };
  };
  try {
    // Bound validation, compilation and matching, including work within one glob.
    return runInNewContext("preview()", { preview }, { timeout: Math.ceil(maxMs) }) as ReturnType<typeof preview>;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return timedOut();
    throw error;
  }
}

export async function previewLogSkillFiles(db: Database, store: ObjectStore, auth: AuthContext, skillId: string, input: { files?: unknown }) {
  requireLogAdminDomains(auth);
  const sample = await getLogSkillSample(db, store, auth, skillId);
  return previewSkillFiles(input.files, sample?.files.map(({ path }) => path) ?? []);
}
