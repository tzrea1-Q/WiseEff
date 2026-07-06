# Parameter Excel Export Fix

## Goal

Replace the placeholder HTML-as-`.xls` export on the parameters workbench with a real `.xlsx` workbook so Chinese headers and cell values open correctly in Excel, Numbers, and other spreadsheet apps.

## Problem

1. The original HTML table blob caused garbled Chinese in Excel.
2. SpreadsheetML `.xls` XML opens as raw tags in macOS Numbers because Numbers does not parse that legacy XML dialect.

## Approach

- Add `xlsx` (SheetJS) and generate a real Office Open XML `.xlsx` file.
- Rename the misleading **示例** column to **推荐值** and format update times as `MM-DD HH:mm` to match the workbench table.
- Export the same filtered row set; filename becomes `{projectCode}-project-parameters.xlsx`.

## Files

| Action | Path |
| --- | --- |
| Add | `src/application/parameters/exportProjectParametersExcel.ts` |
| Add | `src/application/parameters/exportProjectParametersExcel.test.ts` |
| Update | `src/ParametersPage.tsx` |
| Update | `src/App.test.tsx` |
| Update | `src/ParametersPage.test.tsx` |

## Tasks

- [x] Write export module + unit tests (encoding, headers, filtering contract)
- [x] Wire ParametersPage TopBar button to the module
- [x] Update integration tests
- [ ] Run `npm test -- src/application/parameters/exportProjectParametersExcel.test.ts src/App.test.tsx src/ParametersPage.test.tsx --run`
- [ ] Run `npm run build`

## Verification

```bash
npm test -- src/application/parameters/exportProjectParametersExcel.test.ts src/App.test.tsx src/ParametersPage.test.tsx --run
npm run build
```

Manual: open `/parameters`, filter modules, click **导出 Excel**, confirm Chinese headers (参数名称, 模块, …) and risk labels (高/中/低) are readable in Excel.

## Git & PR Workflow

Branch: `feat/parameter-excel-export` from `main`. Parent agent opens PR after verification.

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| Repository maps | `AGENTS.md`, `ARCHITECTURE.md` | No change |
| Planning | `docs/PLANS.md` | No change |
| Product specs | `docs/product-specs/*` | No change |
| Architecture | `docs/design-docs/*` | No change |
| Quality/testing | `docs/design-docs/testing-strategy.md` | No change |
| Frontend | `docs/FRONTEND.md` | No change |
| Security/reliability | `docs/SECURITY.md`, `docs/RELIABILITY.md` | No change |
| Runbooks | `docs/runbooks/*` | No change |
| References | `docs/references/*` | No change |
| Chinese docs | `docs/zh-CN/*` | No change |

## Documentation Update Gate

All rows marked **No change** — export behavior fix only; no API, env, or product-spec delta.
