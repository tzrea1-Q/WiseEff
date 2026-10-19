import type { SkillSpec } from "./types";

export type Register = NonNullable<NonNullable<SkillSpec["parsing"]>["registers"]>[string];
export type RegisterField = Register["fields"][number];
export type RegisterTableRow = { line: number; text: string; field?: RegisterField; reason?: string };
export const MAX_REGISTER_PASTE_BYTES = 64 * 1024;
export const MAX_REGISTER_PASTE_LINES = 512;

export function registerPasteIssue(text: string): string | null {
  if (text.length > MAX_REGISTER_PASTE_BYTES || new TextEncoder().encode(text).length > MAX_REGISTER_PASTE_BYTES) return "粘贴内容不能超过 64 KiB，请分批导入。";
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n" && ++lines > MAX_REGISTER_PASTE_LINES) return "粘贴内容不能超过 512 行，请分批导入。";
  return null;
}

export function parseRegisterBits(text: string): [number, number] | null {
  const match = /^\[?\s*(\d+)(?:\s*[:-]\s*(\d+))?\s*\]?$/.exec(text.trim());
  if (!match || text.includes("[") !== text.includes("]")) return null;
  const hi = Number(match[1]), lo = Number(match[2] ?? match[1]);
  return hi >= lo && hi <= 63 ? [hi, lo] : null;
}

export function parseRegisterTable(text: string, width: number): RegisterTableRow[] {
  const limit = registerPasteIssue(text);
  if (limit) return [{ line: 1, text: "", reason: limit }];
  const names = new Set<string>(), used = new Set<number>();
  return text.split(/\r?\n/).flatMap((text, index) => {
    const trimmed = text.trim();
    if (!trimmed || /^\|?[\s:|-]+\|?$/.test(trimmed)) return [];
    const cells = trimmed.replace(/^\||\|$/g, "").split(/\t|[|,]| {2,}/).map((cell) => cell.trim());
    if (/^(?:bits?|位(?:段)?|位范围)$/i.test(cells[0]) && /^(?:name|field|字段|名称)$/i.test(cells[1] ?? "")) return [];
    const row: RegisterTableRow = { line: index + 1, text };
    const bits = parseRegisterBits(cells[0]);
    if (!bits) row.reason = "位范围无法识别，请使用 7、7:5、[7:5] 或 7-5。";
    else if (bits[0] >= width) row.reason = `位范围超出 ${width} 位寄存器。`;
    else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cells[1] ?? "")) row.reason = "缺少有效字段名称（字母、数字或下划线，不能以数字开头）。";
    else if (names.has(cells[1])) row.reason = "字段名称重复。";
    else if (Array.from({ length: bits[0] - bits[1] + 1 }, (_, offset) => bits[1] + offset).some((bit) => used.has(bit))) row.reason = "位范围与前面的有效行重叠。";
    else {
      row.field = { bits, name: cells[1], ...(cells.slice(2).join(" ") ? { description: cells.slice(2).join(" ") } : {}) };
      names.add(cells[1]);
      for (let bit = bits[1]; bit <= bits[0]; bit++) used.add(bit);
    }
    return [row];
  });
}
