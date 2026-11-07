import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { buildUserImportTemplate, parseUserImportWorkbook } from "./userImportWorkbook";

describe("user import workbook", () => {
  it("accepts XLSX and rejects other spreadsheet formats regardless of filename", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["姓名", "用户名", "初始密码", "职务", "组织角色"], ["张三", "alice", "12345678", "", "访客"]]), "用户数据");
    const write = (bookType: XLSX.BookType) => new Uint8Array(XLSX.write(book, { type: "array", bookType }));
    expect((await parseUserImportWorkbook(write("xlsx"))).rows).toHaveLength(1);
    for (const format of ["xlsm", "xlsb", "ods"] as const) {
      await expect(parseUserImportWorkbook(write(format))).rejects.toThrow(/XLSX/);
    }
    const disguised = await JSZip.loadAsync(write("xlsm"));
    const types = await disguised.file("[Content_Types].xml")!.async("string");
    disguised.file("[Content_Types].xml", types.replace("</Types>", '<Override PartName="/xl/decoy.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'));
    disguised.file("xl/decoy.xml", "<workbook/>");
    await expect(parseUserImportWorkbook(await disguised.generateAsync({ type: "uint8array" }))).rejects.toThrow(/XLSX/);
  });

  it("reads reordered columns and includes hidden and filtered physical rows", async () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["组织角色", "初始密码", "职务", "姓名", "用户名"],
      ["访客", " 00000001 ", "", "甲", "first"],
      [],
      ["管理员", " 00000002 ", "工程师", "乙", "second"]
    ]);
    sheet["!rows"] = [{}, { hidden: true }];
    sheet["!autofilter"] = { ref: "A1:E4" };
    XLSX.utils.book_append_sheet(book, sheet, "用户数据");
    const result = await parseUserImportWorkbook(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" })));
    expect(result.rows).toEqual([
      { row: 2, name: "甲", username: "first", password: " 00000001 ", title: "", roles: "访客" },
      { row: 4, name: "乙", username: "second", password: " 00000002 ", title: "工程师", roles: "管理员" }
    ]);
  });

  it("rejects an empty template and corrupt or encrypted archives", async () => {
    await expect(parseUserImportWorkbook(buildUserImportTemplate())).rejects.toThrow(/1–500/);
    await expect(parseUserImportWorkbook(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toThrow(/无法读取/);
    const encrypted = buildUserImportTemplate().slice();
    const invalidCrc = buildUserImportTemplate().slice();
    for (let i = 0; i < encrypted.length - 10; i++) {
      if (encrypted[i] === 0x50 && encrypted[i + 1] === 0x4b && encrypted[i + 2] === 0x01 && encrypted[i + 3] === 0x02) {
        encrypted[i + 8] |= 1;
        invalidCrc[i + 16] ^= 1;
        break;
      }
    }
    await expect(parseUserImportWorkbook(encrypted)).rejects.toThrow(/无法读取/);
    await expect(parseUserImportWorkbook(invalidCrc)).rejects.toThrow(/无法读取/);
  });

  it("accepts 256 ZIP entries and rejects 257 before workbook parsing", async () => {
    const book = XLSX.read(buildUserImportTemplate(), { type: "array" });
    XLSX.utils.sheet_add_aoa(book.Sheets["用户数据"], [["A", "abc", "12345678", "", "访客"]], { origin: "A2" });
    const zip = await JSZip.loadAsync(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    const count = Object.keys(zip.files).length;
    for (let i = 0; i < 256 - count; i++) zip.file(`padding-${i}`, "", { createFolders: false });
    const atLimit = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    expect((await parseUserImportWorkbook(atLimit)).rows).toHaveLength(1);
    zip.file("one-extra", "");
    await expect(parseUserImportWorkbook(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }))).rejects.toThrow(/过多文件/);
  });

  it("accepts exactly 2 MiB and rejects larger files", async () => {
    const book = XLSX.read(buildUserImportTemplate(), { type: "array" });
    XLSX.utils.sheet_add_aoa(book.Sheets["用户数据"], [["A", "abc", "12345678", "", "访客"]], { origin: "A2" });
    const zip = await JSZip.loadAsync(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    zip.file("padding", "", { createFolders: false });
    const overhead = (await zip.generateAsync({ type: "uint8array", compression: "STORE" })).byteLength;
    zip.file("padding", new Uint8Array(2 * 1024 * 1024 - overhead), { createFolders: false });
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
    expect(bytes.byteLength).toBe(2 * 1024 * 1024);
    expect((await parseUserImportWorkbook(bytes)).rows).toHaveLength(1);
    const overLimit = new Uint8Array(bytes.length + 1); overLimit.set(bytes);
    await expect(parseUserImportWorkbook(overLimit)).rejects.toThrow(/2 MiB/);
  });

  it("accepts 32 MiB actual expansion and rejects one more byte across entries", async () => {
    const book = XLSX.read(buildUserImportTemplate(), { type: "array" });
    XLSX.utils.sheet_add_aoa(book.Sheets["用户数据"], [["A", "abc", "12345678", "", "访客"]], { origin: "A2" });
    const zip = await JSZip.loadAsync(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    let remaining = 32 * 1024 * 1024;
    for (const entry of Object.values(zip.files)) if (!entry.dir) remaining -= (await entry.async("uint8array")).length;
    for (let i = 0; remaining > 0; i++) {
      const size = Math.min(7 * 1024 * 1024, remaining);
      zip.file(`expanded-${i}`, new Uint8Array(size), { createFolders: false }); remaining -= size;
    }
    const atLimit = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    expect((await parseUserImportWorkbook(atLimit)).rows).toHaveLength(1);
    zip.file("expanded-extra", "x");
    await expect(parseUserImportWorkbook(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }))).rejects.toThrow(/解压后超过/);
  }, 30000);
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
