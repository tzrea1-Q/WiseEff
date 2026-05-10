import type { ComparisonRow } from "../types";

function escapeExcelCell(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type ExportOptions = {
  returnString?: boolean;
};

export function exportComparisonRowsAsExcel(
  rows: ComparisonRow[],
  baseProjectCode: string,
  targetProjectCode: string,
  options: ExportOptions = {}
): string | void {
  const headers = ["参数键", "参数含义", "模块", baseProjectCode, targetProjectCode, "重要性", "状态"];
  const tableRows = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeExcelCell(row.key)}</td>
          <td>${escapeExcelCell(row.description)}</td>
          <td>${escapeExcelCell(row.module)}</td>
          <td>${escapeExcelCell(row.baseValue)}</td>
          <td>${escapeExcelCell(row.targetValue)}</td>
          <td>${escapeExcelCell(row.risk)}</td>
          <td>${row.status === "drift" ? "存在差异" : "已同步"}</td>
        </tr>`
    )
    .join("");
  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <caption>${escapeExcelCell(`${baseProjectCode} vs ${targetProjectCode} 项目参数对比`)}</caption>
          <thead><tr>${headers.map((header) => `<th>${escapeExcelCell(header)}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>`;

  if (options.returnString || typeof window === "undefined") {
    return html;
  }

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${baseProjectCode}-vs-${targetProjectCode}-parameter-comparison.xls`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
