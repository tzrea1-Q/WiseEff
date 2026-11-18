export const MAX_PROCEDURE_CHECKS = 16;
export const PROCEDURE_CHECK_ID = /^[\w.-]{1,48}$/;
export const MAX_PROCEDURE_CHECK_DESCRIPTION = 240;

export type ProcedureCheck = { id: string; description: string; required: boolean };

/** Recognize the checklist format in top-level headings and task items outside code fences. */
export function parseProcedureChecks(procedure = ""): ProcedureCheck[] {
  const checks: ProcedureCheck[] = [];
  let inChecks = false;
  let fence: string | undefined;
  for (const line of procedure.split(/\r\n|\n|\r/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1].startsWith(fence) && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(line);
    if (heading && heading[1].length <= 2) {
      inChecks = heading[1] === "##" && /^(?:检查项|Checks)(?:[ \t]+#+)?[ \t]*$/.test(heading[2] ?? "");
      continue;
    }
    if (!inChecks) continue;
    const item = /^- \[ \][ \t]+`([^`]+)`[ \t]+(.+)$/.exec(line);
    if (!item) continue;
    const [, id, text] = item;
    const description = text.trim();
    const suffix = /(?:（必查）|\(required\))$/.exec(description);
    checks.push({ id, description: suffix ? description.slice(0, suffix.index).trimEnd() : description, required: Boolean(suffix) });
  }
  return checks;
}
