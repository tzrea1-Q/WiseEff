import { selectControlOption } from "@/test/selectControlOption";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_ORGANIZATION_ID,
  CATALOG_PLACEMENT_ID,
  CATALOG_REGISTRATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_REVIEW_ITEM_ID,
  CATALOG_SUBJECT_ID,
  CATALOG_MODULE_ID,
  catalogReviewItem,
  unregisteredSubject,
  readyCatalogDocument
} from "@/application/parameter-catalog/fixtures";
import { catalogApiFailure } from "@/application/parameter-catalog/errors";
import { createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogReviewItemResponse } from "@/infrastructure/http/parameterCatalogDtos";

import { ReviewResolutionDialog, type ReviewResolutionDialogProps } from "./ReviewResolutionDialog";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function item(
  overrides: Partial<CatalogReviewItemResponse["item"]> = {}
): CatalogReviewItemResponse["item"] {
  return {
    ...catalogReviewItem,
    ...overrides
  };
}

function renderDialog(options: {
  actor?: CatalogActorKind;
  reviewItem?: CatalogReviewItemResponse["item"];
  repository?: ReturnType<typeof createMockParameterCatalogGovernanceRepository>;
  createIdempotencyKey?: () => string;
  props?: Partial<ReviewResolutionDialogProps>;
} = {}) {
  const repository = options.repository ?? createMockParameterCatalogGovernanceRepository();
  const resolveReviewItem = vi.spyOn(repository, "resolveReviewItem");
  const createRegistration = vi.spyOn(repository, "createRegistration");
  const createProposal = vi.spyOn(repository, "createProposal");
  const onContinueDefinition = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ReviewResolutionDialog
      open
      actor={options.actor ?? "org-admin"}
      domainState={ready}
      repository={repository}
      organizationId={CATALOG_ORGANIZATION_ID}
      catalogReleaseId={CATALOG_RELEASE_ID}
      item={options.reviewItem ?? item()}
      placementOptions={[{ id: CATALOG_PLACEMENT_ID, displayName: "根放置" }]}
      moduleOptions={[{ id: CATALOG_MODULE_ID, displayName: "充电驱动", kind: "driver-group" }]}
      subjects={(options.reviewItem ?? item()).candidates.map((candidate) => ({ ...unregisteredSubject, id: candidate.subjectId }))}
      onContinueDefinition={onContinueDefinition}
      defaultRegistrationId={CATALOG_REGISTRATION_ID}
      createIdempotencyKey={options.createIdempotencyKey ?? (() => "key-resolve")}
      onOpenChange={onOpenChange}
      {...options.props}
    />
  );
  return { repository, resolveReviewItem, createRegistration, createProposal, onContinueDefinition, onOpenChange };
}

async function confirmResolve() {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByLabelText("原因")).toBeEnabled());
  const target = screen.queryByRole("combobox", { name: "审核登记目标模块" });
  if (target) await selectControlOption(target, CATALOG_MODULE_ID);
  await user.type(screen.getByLabelText("原因"), "按证据处理");
  await user.click(screen.getByRole("button", { name: "继续确认" }));
  const confirm = await screen.findByRole("dialog", { name: "确认处理审核" });
  await user.click(within(confirm).getByRole("checkbox"));
  await user.click(within(confirm).getByRole("button", { name: "确认处理" }));
  return user;
}

describe("ReviewResolutionDialog", () => {
  it("shows readable source evidence and defaults to an executable action when registration has no candidate", () => {
    renderDialog({ reviewItem: item({ reason: "unknown", candidates: [], allowedResolutions: ["register-subject", "open-definition-proposal", "mark-out-of-scope"], sourceSummary: { status: "available", evidenceCount: 1, projectName: "电源项目", fileName: "board.dts", nodeLocator: "/soc/power", compatible: "acme,power" } }) });
    const evidence = screen.getByRole("region", { name: "审核依据" });
    expect(evidence).toHaveTextContent("电源项目");
    expect(evidence).toHaveTextContent("board.dts");
    expect(evidence).toHaveTextContent("/soc/power");
    expect(screen.getByRole("radio", { name: "登记主体" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "登记主体" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "记录定义修订意向" })).toBeChecked();
    expect(screen.getByRole("link", { name: "查看来源识别" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "前往模块管理准备目标" })).toBeVisible();
    expect(screen.getByLabelText("原因")).toBeRequired();
    expect(screen.getByText("请填写处理原因后继续确认。")).toBeVisible();
  });

  it("automatically checks evidence on open without a permanent refresh button", async () => {
    const refresh = vi.fn().mockResolvedValue(item());
    renderDialog({ reviewItem: item({ allowedResolutions: ["register-subject", "mark-out-of-scope"] }), props: { moduleOptions: [], onRefreshEvidence: refresh } });
    expect(screen.getByRole("radio", { name: "登记主体" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "标为范围外" })).toBeChecked();
    expect(screen.getByText(/缺少同类型目标模块/)).toBeVisible();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "刷新证据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });

  it("uses verified candidate metadata without depending on a separate subject-list page", async () => {
    const { resolveReviewItem } = renderDialog({ reviewItem: item({ candidates: [{ subjectId: CATALOG_SUBJECT_ID, canonicalName: "southchip,sc8562", kind: "driver", evidence: ["兼容标识精确匹配"] }] }), props: { subjects: [] } });
    expect(screen.getByText("主体：southchip,sc8562")).toBeVisible();
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem.mock.calls[0]?.[2].resolution).toMatchObject({ type: "register-subject", subjectId: CATALOG_SUBJECT_ID });
  });

  it("does not accept an arbitrary default registration identifier as a restoration candidate", async () => {
    const { resolveReviewItem } = renderDialog({ reviewItem: item({ candidates: [], allowedResolutions: ["restore-registration"] }) });
    expect(screen.queryByRole("textbox", { name: "登记标识" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "恢复登记" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("原因"), "核对后恢复");
    expect(screen.getByRole("button", { name: "继续确认" })).toBeDisabled();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });

  it("requires choosing a verified restoration candidate when several registrations match", async () => {
    const otherId = "sreg_other";
    const { resolveReviewItem } = renderDialog({ reviewItem: item({ allowedResolutions: ["restore-registration"], restorableRegistrations: [
      { id: CATALOG_REGISTRATION_ID, subjectId: CATALOG_SUBJECT_ID, canonicalName: "southchip,sc8562", placementDisplayName: "充电驱动" },
      { id: otherId, subjectId: "csub_other", canonicalName: "acme,power", placementDisplayName: "电源驱动" }
    ] }), props: { defaultRegistrationId: undefined } });
    const target = screen.getByRole("combobox", { name: "选择待恢复登记" });
    expect(target).toHaveAttribute("data-value", "");
    await userEvent.type(screen.getByLabelText("原因"), "核实原有登记后恢复");
    expect(screen.getByRole("button", { name: "继续确认" })).toBeDisabled();
    await selectControlOption(target, otherId);
    await userEvent.click(screen.getByRole("button", { name: "继续确认" }));
    const confirm = screen.getByRole("dialog", { name: "确认处理审核" });
    expect(confirm).toHaveTextContent("acme,power；原归属：电源驱动");
    await userEvent.click(within(confirm).getByRole("checkbox"));
    await userEvent.click(within(confirm).getByRole("button", { name: "确认处理" }));
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem.mock.calls[0]?.[2].resolution).toEqual({ type: "restore-registration", registrationId: otherId });
  });

  it("guards Escape and cancel without losing the draft, and distinguishes returning to editing from discarding", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ reviewItem: item({ allowedResolutions: ["mark-out-of-scope"] }) });
    await user.type(screen.getByLabelText("原因"), "已核对原始文件");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    await user.click(screen.getByRole("button", { name: "返回修改" }));
    expect(screen.getByLabelText("原因")).toHaveValue("已核对原始文件");
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("dialog", { name: "放弃未保存的审核处理？" })).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("原因")).toHaveValue("已核对原始文件");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders embedded without a second modal and shares its draft guard with the container", async () => {
    const user = userEvent.setup();
    const onLeaveGuardChange = vi.fn();
    const { onOpenChange } = renderDialog({ reviewItem: item({ allowedResolutions: ["mark-out-of-scope"] }), props: { embedded: true, onLeaveGuardChange } });
    expect(screen.getByRole("region", { name: "处理审核" })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "处理审核" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("原因"), "待完成的审核理由");
    const guard = onLeaveGuardChange.mock.calls.at(-1)?.[0] as () => boolean;
    act(() => expect(guard()).toBe(false));
    expect(await screen.findByRole("dialog", { name: "放弃未保存的审核处理？" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses the existing navigation guard to preserve a draft before leaving the page", async () => {
    renderDialog({ reviewItem: item({ allowedResolutions: ["mark-out-of-scope"] }) });
    await userEvent.type(screen.getByLabelText("原因"), "草稿仍需保留");
    let decision!: boolean | Promise<boolean>;
    act(() => { decision = requestSettingsLeave(); });
    expect(await screen.findByRole("dialog", { name: "放弃未保存的审核处理？" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(await decision).toBe(false);
    expect(screen.getByLabelText("原因")).toHaveValue("草稿仍需保留");
  });

  it("reuses discard approval when the container synchronously clears the selected-review URL", async () => {
    let navigationDecision: boolean | Promise<boolean> | undefined;
    const onOpenChange = vi.fn(() => { navigationDecision = requestSettingsLeave(); });
    renderDialog({ reviewItem: item({ allowedResolutions: ["mark-out-of-scope"] }), props: { embedded: true, onOpenChange } });
    await userEvent.type(screen.getByLabelText("原因"), "即将放弃的审核草稿");
    await userEvent.click(screen.getByRole("button", { name: "返回待审核事项" }));
    await userEvent.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigationDecision).toBe(true);
    expect(screen.queryByRole("dialog", { name: "放弃未保存的审核处理？" })).not.toBeInTheDocument();
  });

  it("prevents duplicate submission and closing while the resolve command is pending", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    let finish!: () => void;
    const originalResolve = repository.resolveReviewItem.bind(repository);
    repository.resolveReviewItem = (...args) => new Promise((resolve) => { finish = () => { void originalResolve(...args).then(resolve); }; });
    const { resolveReviewItem, onOpenChange } = renderDialog({ repository, reviewItem: item({ allowedResolutions: ["mark-out-of-scope"] }) });
    const user = await confirmResolve();
    const confirmation = screen.getByRole("dialog", { name: "确认处理审核" });
    expect(within(confirmation).getByRole("button", { name: "处理中…" })).toBeDisabled();
    expect(within(confirmation).getByRole("button", { name: "返回修改" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(resolveReviewItem).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByRole("region", { name: "审核处理回执" })).toBeVisible();
  });

  it("does not imply an unknown source already has a definition to edit after recording a proposal", async () => {
    const { onContinueDefinition } = renderDialog({ reviewItem: item({ candidates: [], allowedResolutions: ["open-definition-proposal"] }) });
    await confirmResolve();
    const receipt = await screen.findByRole("region", { name: "审核处理回执" });
    expect(receipt).toHaveTextContent("尚无唯一匹配主体");
    expect(screen.queryByRole("button", { name: "前往定义目录继续编辑" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "前往参数定义管理" }));
    expect(onContinueDefinition).toHaveBeenCalledWith({ proposalId: expect.any(String), subjectId: undefined, propertyKey: "gpio-int" });
    expect(within(receipt).getByRole("link", { name: "查看处理记录" })).toHaveAttribute("href", `/audit?kind=parameter-catalog-governance&targetId=${CATALOG_REVIEW_ITEM_ID}`);
  });

  it("allows completion and definition continuation to navigate after the write has succeeded", async () => {
    const completion = vi.fn(() => requestSettingsLeave());
    const continuation = vi.fn(() => requestSettingsLeave());
    const close = vi.fn(() => requestSettingsLeave());
    renderDialog({ reviewItem: item({ allowedResolutions: ["open-definition-proposal"] }), props: { onCompleted: completion, onContinueDefinition: continuation, onOpenChange: close } });
    await confirmResolve();
    await screen.findByRole("region", { name: "审核处理回执" });
    expect(completion).toHaveReturnedWith(true);
    await userEvent.click(screen.getByRole("button", { name: "前往定义目录继续编辑" }));
    expect(continuation).toHaveReturnedWith(true);
    await userEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(close).toHaveReturnedWith(true);
    expect(screen.queryByRole("dialog", { name: "放弃未保存的审核处理？" })).not.toBeInTheDocument();
  });

  it("shows loading as loading, preserves entered text, and never reports it as a permission denial", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const props: ReviewResolutionDialogProps = { open: true, actor: "org-admin", domainState: ready, repository, organizationId: CATALOG_ORGANIZATION_ID, catalogReleaseId: CATALOG_RELEASE_ID, item: item({ allowedResolutions: ["mark-out-of-scope"] }), onOpenChange: vi.fn() };
    const { rerender } = render(<ReviewResolutionDialog {...props} />);
    await userEvent.type(screen.getByLabelText("原因"), "保留这个审核草稿");
    rerender(<ReviewResolutionDialog {...props} domainState={{ kind: "loading", writesEnabled: false, stale: false, catalogReleaseId: CATALOG_RELEASE_ID }} />);
    expect(screen.getByText(/正在读取目录和审核依据/)).toBeVisible();
    expect(screen.queryByText(/仅可阅读/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("原因")).toHaveValue("保留这个审核草稿");
    expect(screen.getByLabelText("原因")).toBeDisabled();
  });

  it("confirms the source and business impact then shows a readable result and return path", async () => {
    const { onOpenChange } = renderDialog({ reviewItem: item({ allowedResolutions: ["mark-out-of-scope"], sourceSummary: { status: "available", evidenceCount: 1, projectName: "电源项目", fileName: "board.dts", compatible: "acme,power" } }), props: { embedded: true } });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("原因"), "不属于本次目录管理范围");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    const confirmation = screen.getByRole("dialog", { name: "确认处理审核" });
    expect(confirmation).toHaveTextContent("acme,power · 电源项目 · board.dts");
    expect(confirmation).toHaveTextContent("保留识别证据和处理记录");
    expect(confirmation).not.toHaveTextContent("部分写入");
    await user.click(within(confirmation).getByRole("checkbox"));
    await user.click(within(confirmation).getByRole("button", { name: "确认处理" }));
    const receipt = await screen.findByRole("region", { name: "审核处理回执" });
    expect(receipt).toHaveTextContent("已标为范围外");
    expect(receipt).toHaveTextContent("不属于本次目录管理范围");
    await user.click(screen.getByRole("button", { name: "返回待审核事项" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog", { name: "放弃未保存的审核处理？" })).not.toBeInTheDocument();
  });

  it("discloses every project and file in a grouped review before confirming the full impact", async () => {
    renderDialog({ reviewItem: item({ allowedResolutions: ["mark-out-of-scope"], sources: [
      { status: "available", evidenceCount: 1, projectName: "电源项目", fileName: "power.dts", nodeLocator: "/power", compatible: "acme,power" },
      { status: "available", evidenceCount: 1, projectName: "备用项目", fileName: "backup.dts", nodeLocator: "/backup/power", compatible: "acme,power" }
    ] }) });
    await userEvent.click(screen.getByText("本次处理覆盖 2 个来源，展开核对全部范围"));
    const evidence = screen.getByRole("region", { name: "审核依据" });
    expect(evidence).toHaveTextContent("备用项目");
    expect(evidence).toHaveTextContent("backup.dts");
    expect(evidence).toHaveTextContent("/backup/power");
    await userEvent.type(screen.getByLabelText("原因"), "两个来源均不纳入管理范围");
    await userEvent.click(screen.getByRole("button", { name: "继续确认" }));
    const confirmation = screen.getByRole("dialog", { name: "确认处理审核" });
    expect(confirmation).toHaveTextContent("此次处理覆盖以下全部 2 个来源");
    expect(confirmation).toHaveTextContent("电源项目 · power.dts · /power");
    expect(confirmation).toHaveTextContent("备用项目 · backup.dts · /backup/power");
  });

  it("requires an explicit candidate and reason instead of accepting the first ambiguous subject", async () => {
    const user = userEvent.setup();
    const selectedSubjectId = "csub_explicit_selection";
    const { resolveReviewItem, createRegistration } = renderDialog({
      reviewItem: item({
        candidates: [
          { subjectId: CATALOG_SUBJECT_ID, evidence: ["first candidate"] },
          { subjectId: selectedSubjectId, evidence: ["second candidate"] }
        ],
        allowedResolutions: ["register-subject"]
      })
    });
    const proceed = screen.getByRole("button", { name: "继续确认" });

    expect(screen.queryByRole("button", { name: /接受第一个|accept first/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("原因"), "按证据选择主体");
    expect(proceed).toBeDisabled();
    await user.click(proceed);
    expect(screen.queryByRole("dialog", { name: "确认处理审核" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();

    const candidates = screen.getByRole("combobox", { name: "选择候选主体" });
    expect(candidates).toHaveAttribute("data-value", "");
    await selectControlOption(candidates, selectedSubjectId);
    await user.clear(screen.getByLabelText("原因"));
    await user.type(screen.getByLabelText("原因"), "   ");
    expect(proceed).toBeDisabled();
    await user.click(proceed);
    expect(resolveReviewItem).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("原因"));
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      CATALOG_REVIEW_ITEM_ID,
      {
        resolution: {
          type: "register-subject",
          subjectId: selectedSubjectId,
          placement: { mode: "use-default" },
          destinationModuleId: CATALOG_MODULE_ID
        },
        reason: "按证据处理"
      },
      { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "key-resolve", ifMatch: "etag-1" }
    );
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it("submits one atomic resolveReviewItem command with release, ETag, and idempotency", async () => {
    const { resolveReviewItem, createRegistration } = renderDialog({
      reviewItem: item({ allowedResolutions: ["register-subject"] })
    });
    expect(screen.queryByRole("radio", { name: "选择父放置" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "审核登记目标模块" })).toHaveAttribute("data-value", "");
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem).toHaveBeenCalledWith(
      CATALOG_ORGANIZATION_ID,
      CATALOG_REVIEW_ITEM_ID,
      {
        resolution: {
          type: "register-subject",
          subjectId: CATALOG_SUBJECT_ID,
          placement: { mode: "use-default" },
          destinationModuleId: CATALOG_MODULE_ID
        },
        reason: "按证据处理"
      },
      {
        catalogReleaseId: CATALOG_RELEASE_ID,
        idempotencyKey: "key-resolve",
        ifMatch: "etag-1"
      }
    );
    expect(createRegistration).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("does not write with a blank review reason %j", async (reason) => {
    const user = userEvent.setup();
    const { resolveReviewItem } = renderDialog();
    if (reason) await user.type(screen.getByLabelText("原因"), reason);

    const proceed = screen.getByRole("button", { name: "继续确认" });
    expect(proceed).toBeDisabled();
    await user.click(proceed);
    expect(screen.queryByRole("dialog", { name: "确认处理审核" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });

  it("keeps mark-out-of-scope available without choosing an ambiguous subject", async () => {
    const { resolveReviewItem } = renderDialog({
      reviewItem: item({
        candidates: [
          { subjectId: CATALOG_SUBJECT_ID, evidence: ["first candidate"] },
          { subjectId: "csub_other_candidate", evidence: ["second candidate"] }
        ],
        allowedResolutions: ["register-subject", "mark-out-of-scope"]
      })
    });
    await userEvent.setup().click(screen.getByRole("radio", { name: "标为范围外" }));
    await confirmResolve();

    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem.mock.calls[0]?.[2]).toEqual({
      resolution: { type: "mark-out-of-scope" },
      reason: "按证据处理"
    });
  });

  it("does not create a Registration or Proposal as a partial second command", async () => {
    const { resolveReviewItem, createRegistration, createProposal, onContinueDefinition } = renderDialog({
      reviewItem: item({ allowedResolutions: ["open-definition-proposal"] })
    });
    await userEvent.setup().click(screen.getByRole("radio", { name: "记录定义修订意向" }));
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem.mock.calls[0]?.[2]).toEqual({
      resolution: { type: "open-definition-proposal" },
      reason: "按证据处理"
    });
    expect(createRegistration).not.toHaveBeenCalled();
    expect(createProposal).not.toHaveBeenCalled();
    expect(await screen.findByRole("region", { name: "审核处理回执" })).toHaveTextContent("定义修订意向已记录，尚未发布。");
    await userEvent.click(screen.getByRole("button", { name: "前往定义目录继续编辑" }));
    expect(onContinueDefinition).toHaveBeenCalledWith({ subjectId: CATALOG_SUBJECT_ID, propertyKey: "gpio-int", proposalId: expect.any(String) });
  });

  it("restores a Registration without sending a Placement payload", async () => {
    const { resolveReviewItem } = renderDialog({
      reviewItem: item({ allowedResolutions: ["restore-registration"], restorableRegistrations: [{ id: CATALOG_REGISTRATION_ID, subjectId: CATALOG_SUBJECT_ID, canonicalName: "southchip,sc8562", placementDisplayName: "充电驱动" }] })
    });
    await confirmResolve();
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledTimes(1));
    expect(resolveReviewItem.mock.calls[0]?.[2]).toEqual({
      resolution: {
        type: "restore-registration",
        registrationId: CATALOG_REGISTRATION_ID
      },
      reason: "按证据处理"
    });
  });

  it("preserves resolution input on revision conflict without retrying", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    vi.spyOn(repository, "resolveReviewItem").mockRejectedValue(
      catalogApiFailure("revision-conflict", { catalogReleaseId: CATALOG_RELEASE_ID })
    );
    const { resolveReviewItem } = renderDialog({
      repository,
      reviewItem: item({ allowedResolutions: ["mark-out-of-scope"] })
    });
    await confirmResolve();
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveAttribute("data-preserve-input", "true");
    expect(banner).toHaveAttribute("data-silent-retry", "false");
    expect(screen.getByLabelText("原因")).toHaveValue("按证据处理");
    expect(screen.getByRole("radio", { name: "标为范围外" })).toBeChecked();
    expect(screen.getByRole("button", { name: "继续确认" })).toBeDisabled();
    expect(resolveReviewItem).toHaveBeenCalledTimes(1);
  });

  it("blocks conflicting writes through a pending and failed refresh, then requires confirmation with fresh evidence", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const resolve = vi.spyOn(repository, "resolveReviewItem").mockRejectedValueOnce(
      catalogApiFailure("revision-conflict", { catalogReleaseId: CATALOG_RELEASE_ID }));
    let rejectRefresh!: (reason: Error) => void;
    const current = item({ allowedResolutions: ["mark-out-of-scope"] });
    const fresh = { ...current, etag: "etag-2" };
    const refresh = vi.fn().mockResolvedValue(fresh).mockResolvedValueOnce(current).mockResolvedValueOnce(current)
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectRefresh = reject; }));
    function Harness() {
      const [reviewItem, setReviewItem] = useState(item({ allowedResolutions: ["mark-out-of-scope"] }));
      return <ReviewResolutionDialog open actor="org-admin" domainState={ready} repository={repository}
        organizationId={CATALOG_ORGANIZATION_ID} catalogReleaseId={CATALOG_RELEASE_ID} item={reviewItem}
        onOpenChange={vi.fn()} onRefreshEvidence={async () => {
          const fresh = await refresh();
          setReviewItem(fresh);
          return fresh;
        }} />;
    }
    render(<Harness />);
    const user = await confirmResolve();
    const proceed = screen.getByRole("button", { name: "继续确认" });
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(screen.getByText("正在核对最新审核依据…")).toBeVisible();
    expect(proceed).toBeDisabled();
    act(() => { rejectRefresh(new Error("offline")); });
    expect(await screen.findByText(/暂时无法核对最新审核依据/)).toBeVisible();
    expect(screen.getByLabelText("原因")).toHaveValue("按证据处理");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText(/审核依据或可用目标已变化/)).toBeVisible();
    expect(screen.queryByText(/暂时无法核对最新审核依据/)).not.toBeInTheDocument();
    expect(proceed).toBeEnabled();
    expect(resolve).toHaveBeenCalledTimes(1);
    await user.click(proceed);
    const confirm = await screen.findByRole("dialog", { name: "确认处理审核" });
    await user.click(within(confirm).getByRole("checkbox"));
    await user.click(within(confirm).getByRole("button", { name: "确认处理" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect(resolve.mock.calls[1]?.[3]).toMatchObject({ catalogReleaseId: CATALOG_RELEASE_ID, ifMatch: "etag-2" });
  });

  it("rechecks before confirmation, pauses for changed evidence, and preserves the draft on return", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const resolve = vi.spyOn(repository, "resolveReviewItem");
    const current = item({ allowedResolutions: ["mark-out-of-scope"] });
    const changed = { ...current, etag: "new-evidence", sourceSummary: { status: "available" as const, evidenceCount: 2, fileName: "changed.dts" } };
    const refresh = vi.fn().mockResolvedValue(changed).mockResolvedValueOnce(current);
    function Harness() {
      const [reviewItem, setReviewItem] = useState(current);
      return <ReviewResolutionDialog open actor="org-admin" domainState={ready} repository={repository}
        organizationId={CATALOG_ORGANIZATION_ID} catalogReleaseId={CATALOG_RELEASE_ID} item={reviewItem}
        onOpenChange={vi.fn()} onRefreshEvidence={async () => { const next = await refresh(); setReviewItem(next); return next; }} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("原因")).toBeEnabled());
    await user.type(screen.getByLabelText("原因"), "保留已填写原因");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    expect(await screen.findByText(/审核依据或可用目标已变化/)).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "确认处理审核" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("原因")).toHaveValue("保留已填写原因");
    await user.click(screen.getByRole("button", { name: "继续确认" }));
    expect(await screen.findByRole("dialog", { name: "确认处理审核" })).toHaveTextContent("changed.dts");
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(4));
    expect(screen.queryByRole("dialog", { name: "确认处理审核" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("原因")).toHaveValue("保留已填写原因");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(refresh).toHaveBeenCalledTimes(4);
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(screen.getByLabelText("原因")).toBeEnabled());
    visibility.mockRestore();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses Agent resolution and stale candidates without writing", () => {
    const { resolveReviewItem } = renderDialog({ actor: "agent" });
    expect(screen.getByText(/仅可阅读/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "继续确认" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });

  it("blocks resolution when review evidence is stale", () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const resolveReviewItem = vi.spyOn(repository, "resolveReviewItem");
    render(
      <ReviewResolutionDialog
        open
        actor="org-admin"
        domainState={ready}
        repository={repository}
        organizationId={CATALOG_ORGANIZATION_ID}
        catalogReleaseId={CATALOG_RELEASE_ID}
        item={item({
          candidateState: {
            status: "stale",
            capturedRelease: { id: "crel_old", digest: "sha256:old" },
            currentRelease: { id: CATALOG_RELEASE_ID, digest: "sha256:abc" }
          }
        })}
        onOpenChange={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-silent-retry", "false");
    expect(screen.queryByRole("button", { name: "继续确认" })).not.toBeInTheDocument();
    expect(resolveReviewItem).not.toHaveBeenCalled();
  });
});
