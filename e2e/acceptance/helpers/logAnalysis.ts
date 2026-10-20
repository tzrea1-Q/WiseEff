import { expect, type Page } from "playwright/test";
import { prepareInteractionSurface } from "./interactionSurface";

/** A fresh lane and an existing history each offer exactly one upload entry. */
export async function openLogUploadDialog(page: Page) {
  await prepareInteractionSurface(page);
  const emptyUpload = page.getByRole("region", { name: "日志任务区", exact: true })
    .getByRole("button", { name: "上传日志", exact: true });
  const historyUpload = page.getByRole("group", { name: "工作台操作", exact: true })
    .getByRole("button", { name: "上传新日志", exact: true });
  const upload = emptyUpload.or(historyUpload);
  await expect(upload).toHaveCount(1);
  await expect(upload).toBeEnabled();
  await upload.click();
  const dialog = page.getByRole("dialog", { name: "上传日志", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("file-drop-zone-input")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "选择日志文件", exact: true })).toBeEnabled();
  return dialog;
}

export async function openLogReportAction(page: Page, label: string) {
  await prepareInteractionSurface(page);
  await page.getByRole("group", { name: "报告操作", exact: true }).getByRole("button", { name: "更多", exact: true }).click();
  const action = page.getByRole("menuitem", { name: label, exact: true });
  await expect(action).toBeEnabled();
  await action.click();
}
