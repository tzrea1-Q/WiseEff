# 批量参数导入 — 手工验收样例

用于 `/parameter-admin` → **批量参数导入** 向导的自测文件。目标项目建议选 **Aurora 量产平台（AUR-Prod）**，与种子参数库一致。

| 文件 | 格式 | 行数 | 说明 |
|------|------|------|------|
| `mixed-batch.json` | JSON 数组 | 12 | 9 条已有参数更新 + 3 条新增候选 |
| `mixed-batch-en.csv` | CSV（英文列名） | 12 | 与 JSON 同批数据 |
| `mixed-batch-zh.csv` | CSV（中文列名） | 12 | 宽表模板列名 + 高/中/低 风险别名 |
| `mixed-batch-zh.xlsx` | XLSX | 12 | 与中文 CSV 同批数据，可直接拖放上传 |
| `charging-thermal-fragment.dts` | DTS 片段 | 8+ | 字符串列表、cell 数组、标量等多种 DTS 赋值形态 |

## 快速步骤

1. 本地启动：`npm run dev:all`（API 模式，需 `.env` 中 smoke token）。
2. 打开 `http://127.0.0.1:5173/parameter-admin` → **批量参数导入**。
3. 选择目标项目 **AUR-Prod**，上传上表任一文件，或粘贴 JSON / DTS 内容。
4. 逐步完成解析 → 逐条核对 → 批次预览；**Step 5 确认应用会写库**，试跑可在 Step 4 停止。

## 样例设计要点

- **已有参数**：`fast_charge_current_limit_ma`、`charge_voltage_limit_mv`、`battery_temp_target_c` 等来自 `src/config/power-management.json`。
- **不变项**：`usb_pd_profile_limit_w` 在样例中与库内推荐值相同，预览应归入「不变」。
- **新增候选**：`aurora_pack_balancing_window_s`、`thermal_guard_hysteresis_c`、`nebula_debug_charge_boost_ma` 需 Step 3 **预填并创建**。
- **DTS 片段**：属性名采用 device-tree 风格（如 `fast-charge-profile-matrix`），与库内 `dts_*` 参数名不同，多数会走新增/待补全模块路径。

## 重新生成 XLSX

```bash
npx tsx scripts/generate-parameter-import-sample-xlsx.ts
```
