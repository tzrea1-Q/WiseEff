import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { buildUserImportTemplate, parseUserImportWorkbook } from "./userImportWorkbook";

describe("user import workbook", () => {
  it("reads only the named data sheet and preserves physical rows and password text", async () => {
    const book = XLSX.read(buildUserImportTemplate(), { type: "array", cellStyles: true });
    const sheet = book.Sheets["用户数据"];
    expect([sheet.A2.z, sheet.E501.z]).toEqual(["@", "@"]);
    XLSX.utils.sheet_add_aoa(sheet, [["张三", "  ALICE  ", " 00001234 ", "工程师", "普通用户"]], { origin: "A4" });
    book.SheetNames.reverse();
    const { rows } = await parseUserImportWorkbook(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })));
    expect(rows).toEqual([{ row: 4, name: "张三", username: "  ALICE  ", password: " 00001234 ", title: "工程师", roles: "普通用户" }]);
  });

  it("rejects formulas and non-text values without echoing their contents", async () => {
    for (const cell of [{ t: "n", v: 12345678 }, { t: "s", v: "secret-cached", f: '"secret-cached"' }]) {
      const book = XLSX.read(buildUserImportTemplate(), { type: "array" });
      book.Sheets["用户数据"].C2 = cell;
      const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
      const result = await parseUserImportWorkbook(bytes);
      expect(result.errors).toEqual([expect.objectContaining({ row: 2, field: "password" })]);
      expect(JSON.stringify(result)).not.toContain("secret-cached");
    }
  });

  it("checks actual expansion of ignored ZIP entries before parsing", async () => {
    const zip = await JSZip.loadAsync(buildUserImportTemplate());
    zip.file("ignored.txt", "x".repeat(8 * 1024 * 1024 + 1));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    await expect(parseUserImportWorkbook(bytes)).rejects.toThrow(/解压后超过/);
  });

  it("rejects duplicate ZIP names rather than losing an entry during inspection", async () => {
    const zip = await JSZip.loadAsync(buildUserImportTemplate());
    zip.file("first-extra", "small"); zip.file("other-extra", "x".repeat(8 * 1024 * 1024 + 1));
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const source = new TextEncoder().encode("other-extra"), replacement = new TextEncoder().encode("first-extra");
    for (let i = 0; i <= bytes.length - source.length; i++) {
      if (source.every((byte, j) => bytes[i + j] === byte)) bytes.set(replacement, i);
    }
    await expect(parseUserImportWorkbook(bytes)).rejects.toThrow(/重复/);
  });

  it("rejects duplicate headers, merged input, excess rows and unheaded input", async () => {
    const write = (book: XLSX.WorkBook) => new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    const header = XLSX.read(buildUserImportTemplate(), { type: "array" });
    header.Sheets["用户数据"].B1 = { t: "s", v: "姓名" };
    await expect(parseUserImportWorkbook(write(header))).rejects.toThrow(/表头/);
    const merged = XLSX.read(buildUserImportTemplate(), { type: "array" });
    merged.Sheets["用户数据"]["!merges"] = [XLSX.utils.decode_range("A2:B2")];
    await expect(parseUserImportWorkbook(write(merged))).rejects.toThrow(/合并/);
    const extra = XLSX.read(buildUserImportTemplate(), { type: "array" });
    XLSX.utils.sheet_add_aoa(extra.Sheets["用户数据"], [["unexpected"]], { origin: "F2" });
    await expect(parseUserImportWorkbook(write(extra))).rejects.toThrow(/无表头/);
    const many = XLSX.read(buildUserImportTemplate(), { type: "array" });
    XLSX.utils.sheet_add_aoa(many.Sheets["用户数据"], Array.from({ length: 500 }, () => ["A", "abc", "12345678", "", "访客"]), { origin: "A2" });
    expect((await parseUserImportWorkbook(write(many))).rows).toHaveLength(500);
    XLSX.utils.sheet_add_aoa(many.Sheets["用户数据"], [["A", "abc", "12345678", "", "访客"]], { origin: "A502" });
    await expect(parseUserImportWorkbook(write(many))).rejects.toThrow(/1–500/);
    const boundary = XLSX.read(buildUserImportTemplate(), { type: "array" });
    XLSX.utils.sheet_add_aoa(boundary.Sheets["用户数据"], [["A", "abc", "12345678", "", "访客"]], { origin: "A5000" });
    expect((await parseUserImportWorkbook(write(boundary))).rows[0].row).toBe(5000);
    XLSX.utils.sheet_add_aoa(boundary.Sheets["用户数据"], [["A"]], { origin: "A5001" });
    await expect(parseUserImportWorkbook(write(boundary))).rejects.toThrow(/范围/);
  });
});
