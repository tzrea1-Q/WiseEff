import { compileLogPattern, createLogPatternCache, type LogPatternCache } from "../../../server/modules/logs/adminPattern";

export const MAX_SKILL_FILE_GLOBS = 100;
export const MAX_FILE_GLOB_LENGTH = 256;
export const MAX_FILE_ROLE_LENGTH = 40;
export type SkillFileGlob = { glob: string; role?: string };

/** Bundle-relative, case-sensitive globs. RE2 keeps repeated wildcards linear-time. */
export function skillFileGlobPattern(glob: string): string {
  if (!glob || glob.length > MAX_FILE_GLOB_LENGTH || /[\\\x00-\x1f\x7f]/.test(glob) || /^[A-Za-z]:/.test(glob)
    || glob.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Expected a stable bundle-relative file glob");
  }
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        while (glob[i + 1] === "*") i++;
        if (glob[i + 1] === "/") { source += "(?:.*/)?"; i++; }
        else source += ".*";
      } else source += "[^/]*";
    } else if (char === "?") source += "[^/]";
    else if (char === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end < 0) throw new Error("Unclosed glob character class");
      let members = glob.slice(i + 1, end);
      const negated = members.startsWith("!") || members.startsWith("^");
      if (negated) members = members.slice(1);
      if (!members || /[\[\/]/.test(members)) throw new Error("Invalid glob character class");
      source += `[${negated ? "^/" : ""}${members.replace(/\^/g, "\\^")}]`;
      i = end;
    } else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  if (source.length + 2 > 4096) throw new Error("Expanded file glob exceeds 4096 characters");
  return `^${source}\\z`;
}

export function compileFileGlob(glob: string, cache?: LogPatternCache) {
  return compileLogPattern(skillFileGlobPattern(glob), "s", 4096, cache);
}

export function compileSkillFiles(files: readonly SkillFileGlob[] | undefined, cache = createLogPatternCache()) {
  if (files && files.length > MAX_SKILL_FILE_GLOBS) throw new Error(`At most ${MAX_SKILL_FILE_GLOBS} file globs are allowed`);
  if (files?.some(({ glob, role }) => glob.length > MAX_FILE_GLOB_LENGTH || (role?.length ?? 0) > MAX_FILE_ROLE_LENGTH)) {
    throw new Error("File glob or role exceeds its length limit");
  }
  const compiled = files?.map((file) => ({ ...file, pattern: compileFileGlob(file.glob, cache) }));
  return (path: string): { skillMatched: boolean; role: string | null } => {
    const first = compiled?.find(({ pattern }) => pattern.test(path));
    return { skillMatched: !compiled?.length || first !== undefined, role: first?.role?.trim() || null };
  };
}

export function matchSkillFile(files: readonly SkillFileGlob[] | undefined, path: string) {
  return compileSkillFiles(files)(path);
}
