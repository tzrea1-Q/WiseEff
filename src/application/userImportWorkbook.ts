import JSZip from "jszip";
import ZipEntries from "jszip/lib/zipEntries.js";
import * as XLSX from "xlsx";

const headings = ["姓名", "用户名", "初始密码", "职务", "组织角色"] as const;
const fields = ["name", "username", "password", "title", "roles"] as const;
export type UserImportRow = { row: number; name: string; username: string; password: string; title: string; roles: string };

export function buildUserImportTemplate(): Uint8Array {
  const book = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([[...headings]]);
  data["!cols"] = [20, 24, 24, 24, 36].map((wch) => ({ wch }));
  for (let row = 1; row <= 500; row++) for (let col = 0; col < headings.length; col++) {
    data[XLSX.utils.encode_cell({ r: row, c: col })] = { t: "s", v: "", z: "@" };
  }
  data["!ref"] = "A1:E501";
  XLSX.utils.book_append_sheet(book, data, "用户数据");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["填写说明", "只读取“用户数据”表；每行一人，保留五列表头，可调整列和工作表顺序。"],
    ["文本格式", "请使用文本格式填写，勿使用公式或合并单元格。姓名、用户名、初始密码和组织角色必填。"],
    ["字段", "姓名最多 100 字符；用户名 3–64 字符；密码 8–1024 字符；职务可留空，最多 100 字符。"],
    ["角色", "使用已有组织角色的中文名称；多个角色用中文分号（；）分隔。"],
    ["密码", "密码按原样使用，请通过安全渠道私下交付。填写示例为虚构数据，不参与导入。"],
    ["数量", "每次 1–500 人；修改源表后重新上传。"],
  ]), "填写说明");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["以下为虚构示例，请勿直接导入。"], [...headings], ["示例姓名", "example.user", "Example-1234", "工程师", "访客"]
  ]), "填写示例");
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", cellStyles: true }));
}

type ZipStream = {
  pause(): void;
  resume(): void;
  on(event: "data", callback: (chunk: Uint8Array) => void): ZipStream;
  on(event: "end", callback: () => void): ZipStream;
  on(event: "error", callback: (error: Error) => void): ZipStream;
};

async function inspectArchive(bytes: Uint8Array) {
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("文件超过 2 MiB 上限。");
  // JSZip's public file map collapses duplicate/sanitized names; inspect its raw directory before using that map.
  const directory = new ZipEntries({ decodeFileName: (value) => new TextDecoder().decode(value) });
  directory.load(bytes);
  if (directory.files.length > 256) throw new Error("工作簿包含过多文件。");
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  if (entries.length !== directory.files.length) throw new Error("工作簿包含重复文件名。");
  let total = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    await new Promise<void>((resolve, reject) => {
      const stream = (entry as typeof entry & { internalStream(type: "uint8array"): ZipStream }).internalStream("uint8array");
      let size = 0;
      stream.on("data", (chunk) => {
        size += chunk.byteLength; total += chunk.byteLength;
        if (size > 8 * 1024 * 1024 || total > 32 * 1024 * 1024) {
          stream.pause(); reject(new Error("工作簿解压后超过大小上限。"));
        }
      }).on("end", resolve).on("error", reject).resume();
    });
  }
}

export async function parseUserImportWorkbook(bytes: Uint8Array): Promise<{ rows: UserImportRow[]; errors: Array<{ row: number; field: string; message: string }> }> {
  try {
    await inspectArchive(bytes);
    const book = XLSX.read(bytes, { type: "array", cellFormula: true, cellDates: true, sheetStubs: true });
    const sheet = book.Sheets["用户数据"];
    if (!sheet || !sheet["!ref"]) throw new Error("缺少“用户数据”表。");
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    if (range.e.r >= 5000 || range.e.c > 1000) throw new Error("数据表范围超过上限。");
    if (sheet["!merges"]?.length) throw new Error("数据表不能包含合并单元格。");
    const columns = new Map<number, number>();
    let lastRow = range.e.r;
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      const pos = XLSX.utils.decode_cell(address);
      if (pos.r >= 5000 || pos.c > 1000) throw new Error("数据表范围超过上限。");
      lastRow = Math.max(lastRow, pos.r);
      if (pos.r === 0 && (cell.f || cell.F || (cell.t !== "s" && cell.t !== "z"))) throw new Error("表头必须为文本，不能使用公式。");
      if (pos.r === 0 && cell.v) {
        const index = headings.indexOf(String(cell.v) as typeof headings[number]);
        if (index < 0 || [...columns.values()].includes(index)) throw new Error("表头包含未知或重复列。");
        columns.set(pos.c, index);
      }
    }
    if (columns.size !== headings.length) throw new Error("表头缺少必需列。");
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      const pos = XLSX.utils.decode_cell(address);
      if (pos.r > 0 && !columns.has(pos.c) && (cell.f || cell.F || (cell.v !== undefined && cell.v !== ""))) throw new Error("数据表包含无表头的输入列。");
    }
    const rows: UserImportRow[] = [];
    const errors: Array<{ row: number; field: string; message: string }> = [];
    for (let r = 1; r <= lastRow; r++) {
      const values = ["", "", "", "", ""];
      let hasInput = false;
      for (const [col, index] of columns) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c: col })];
        if (!cell) continue;
        if (cell.f || cell.F) { errors.push({ row: r + 1, field: fields[index], message: "不能使用公式，请填写文本。" }); hasInput = true; }
        else if (cell.t !== "s" && cell.t !== "z") { errors.push({ row: r + 1, field: fields[index], message: "须使用文本单元格。" }); hasInput = true; }
        else { values[index] = String(cell.v ?? ""); if (values[index] !== "") hasInput = true; }
      }
      if (hasInput) {
        rows.push(Object.fromEntries([["row", r + 1], ...fields.map((field, i) => [field, values[i]])]) as UserImportRow);
      }
    }
    if (rows.length < 1 || rows.length > 500) throw new Error("数据表须包含 1–500 个非空行。");
    return { rows, errors };
  } catch (error) {
    if (error instanceof Error && /^(文件|工作簿|缺少|数据表|第 |表头)/.test(error.message)) throw error;
    throw new Error("无法读取工作簿；请使用未加密、未损坏的 XLSX 文件。");
  }
}
