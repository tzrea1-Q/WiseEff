import { selectControlOption } from "@/test/selectControlOption";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CATALOG_AUTHOR_PERSON_ID,
  CATALOG_ORGANIZATION_ID,
  CATALOG_RELEASE_ID,
  CATALOG_SUBJECT_ID,
  readyCatalogDocument,
  activeDefinition,
  registeredSubject,
  retiredSubject,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import type { CatalogActorKind } from "@/application/parameter-catalog/authority";

import { catalogApiFailure } from "@/application/parameter-catalog/errors";

import { PublicationDialog } from "./PublicationDialog";
import { PUBLICATION_JOB_STORAGE_KEY } from "./publicationJobStorage";
import { emptyPublicationDraft, publicationCopy } from "./publicationState";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function renderDialog(
  options: {
    actor?: CatalogActorKind;
    permissions?: readonly string[];
    publicationOutcome?: "queued" | "active" | "active-superseded" | "needs-rebase" | "policy-disabled" | "frozen";
    createIdempotencyKey?: () => string;
    paginate?: boolean;
    prepare?: (ports: ReturnType<typeof createMockCatalogPorts>) => void;
  } = {}
) {
  const ports = createMockCatalogPorts({
    publicationOutcome: options.publicationOutcome ?? "queued"
  });
  const createProposal = vi.spyOn(ports.governance, "createProposal");
  const createCandidate = vi.spyOn(ports.catalog, "createPublicationCandidate");
  const publish = vi.spyOn(ports.catalog, "publishPublicationCandidate");
  const getPublication = vi.spyOn(ports.catalog, "getPublication");
  const completed = vi.fn();
  if (options.paginate) {
    const subjects = ports.catalog.listSubjects.bind(ports.catalog);
    vi.spyOn(ports.catalog, "listSubjects").mockImplementation(async (query) => {
      const page = await subjects(query);
      return { ...page, items: query?.cursor ? [{ ...page.items[0], id: "subject-last-page", canonicalName: "最后一页主体" }] : page.items,
        hasMore: !query?.cursor, nextCursor: query?.cursor ? null : "subjects-page-2" };
    });
    vi.spyOn(ports.catalog, "listDefinitions");
  }
  options.prepare?.(ports);
  const element = (
    <PublicationDialog
      open
      actor={options.actor ?? "user"}
      sessionPermissions={options.permissions ?? ["catalog:author", "catalog:publish"]}
      domainState={ready}
      catalog={ports.catalog}
      governance={ports.governance}
      catalogReleaseId={CATALOG_RELEASE_ID}
      currentPersonId={CATALOG_AUTHOR_PERSON_ID}
      organizationId={CATALOG_ORGANIZATION_ID}
      publicationSurface={{
        publicationEnabled: true,
        lowRiskSingleActorPublish: false,
        policyRevision: 1,
        frozen: false,
        adopted: true,
        currentReleaseId: CATALOG_RELEASE_ID,
        authoringAllowed: (options.permissions ?? ["catalog:author", "catalog:publish"]).includes("catalog:author"),
        publishingAllowed: (options.permissions ?? ["catalog:author", "catalog:publish"]).includes("catalog:publish"),
        reviewHighRiskAllowed: false,
        blockers: []
      }}
      createIdempotencyKey={options.createIdempotencyKey ?? (() => "pub-key")}
      onOpenChange={vi.fn()}
      onCompleted={completed}
      onRefreshEvidence={vi.fn()}
    />
  );
  const view = render(element);
  return { ...view, ports, createProposal, createCandidate, publish, getPublication, completed,
    changeRelease: (catalogReleaseId: string) => view.rerender(cloneElement(element, { catalogReleaseId })) };
}

async function fillSupportedDefinition(user: ReturnType<typeof userEvent.setup>) {
  await selectControlOption(await screen.findByLabelText("已发布主体"), CATALOG_SUBJECT_ID);
  const propertyKey = screen.getByLabelText("属性键");
  const displayName = screen.getByLabelText("显示名称");
  const documentation = screen.getByLabelText("说明");
  const reason = screen.getByLabelText("草稿原因");
  await user.clear(propertyKey);
  await user.type(propertyKey, "iin_hold");
  await user.clear(displayName);
  await user.type(displayName, "保持电流");
  await user.clear(documentation);
  await user.type(documentation, "最小保持电流。");
  await user.clear(reason);
  await user.type(reason, "新增保持电流定义");
}

async function confirm(label: string) {
  const user = userEvent.setup();
  const dialog = await screen.findByRole("dialog", { name: /确认/ });
  await user.click(within(dialog).getByRole("checkbox"));
  await user.click(within(dialog).getByRole("button", { name: label }));
}

describe("PublicationDialog", () => {
  it("keeps creation separate from editing and has no permanent evidence refresh action", async () => {
    renderDialog();
    await screen.findByLabelText("已发布主体");
    expect(screen.getAllByRole("radio").map((item) => item.getAttribute("value"))).toEqual(["create-definition", "create-subject"]);
    expect(screen.queryByRole("button", { name: "刷新证据" })).not.toBeInTheDocument();
  });

  it("retries a failed subject load without discarding entered fields", async () => {
    renderDialog({ prepare: (ports) => {
      const read = ports.catalog.listSubjects.bind(ports.catalog);
      vi.spyOn(ports.catalog, "listSubjects").mockRejectedValueOnce(new Error("offline")).mockImplementation(read);
    } });
    const user = userEvent.setup();
    await screen.findByText("主体列表加载失败，请稍后重试。");
    await user.type(screen.getByLabelText("显示名称"), "重试时保留");
    await user.click(screen.getByRole("button", { name: "重试", exact: true }));
    await waitFor(() => expect(screen.queryByText("主体列表加载失败，请稍后重试。")).not.toBeInTheDocument());
    await selectControlOption(screen.getByLabelText("已发布主体"), CATALOG_SUBJECT_ID);
    expect(screen.getByLabelText("显示名称")).toHaveValue("重试时保留");
  });
  it("only offers active owners with writable registration and does not fetch existing definitions", async () => {
    const { ports } = renderDialog({ prepare: (ports) => {
      const owner = { ...retiredSubject, id: "retired-owner", canonicalName: "退役主体" };
      const registrationRetired = { ...registeredSubject, id: "retired-registration-owner", canonicalName: "退役登记主体", registration: { status: "retired" as const, id: "registration-retired" } };
      vi.spyOn(ports.catalog, "listSubjects").mockResolvedValue({ items: [registeredSubject, owner, registrationRetired], totalCount: 3, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
      vi.spyOn(ports.catalog, "listDefinitions");
    } });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("已发布主体"));
    expect(await screen.findByRole("listbox")).toHaveClass("select-menu--modal");
    expect(screen.queryByRole("option", { name: "退役主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "退役登记主体" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("radio", { name: "修订定义" })).not.toBeInTheDocument();
    expect(ports.catalog.listDefinitions).not.toHaveBeenCalled();
  });

  it("allows creating a new subject when the current directory has no subjects", async () => {
    const { createCandidate } = renderDialog({ prepare: (ports) => {
      const page = { items: [], totalCount: 0, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID };
      vi.spyOn(ports.catalog, "listSubjects").mockResolvedValue(page);
      vi.spyOn(ports.catalog, "listDefinitions").mockResolvedValue(page);
    } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "新增主体" }));
    await user.type(screen.getByLabelText("选择器"), "vendor,new");
    await user.type(screen.getByLabelText("属性键"), "new-value");
    await user.type(screen.getByLabelText("显示名称"), "新参数");
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await waitFor(() => expect(createCandidate).toHaveBeenCalledOnce());
  });

  it("allows creating a definition under an active unregistered owner", async () => {
    const { createCandidate } = renderDialog({ prepare: (ports) => {
      vi.spyOn(ports.catalog, "listSubjects").mockResolvedValue({ items: [unregisteredSubject], totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
      vi.spyOn(ports.catalog, "listDefinitions").mockResolvedValue({ items: [{ ...activeDefinition, registration: { status: "unregistered" } }], totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
    } });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await waitFor(() => expect(createCandidate).toHaveBeenCalledOnce());
  });

  it.each(["create-definition", "revise-definition"] as const)("blocks restored %s writes without converting the stored task", async (mode) => {
    window.localStorage.setItem(PUBLICATION_JOB_STORAGE_KEY, JSON.stringify({
      jobId: "job-restored", candidateId: "candidate-restored", catalogReleaseId: CATALOG_RELEASE_ID,
      userId: CATALOG_AUTHOR_PERSON_ID, organizationId: CATALOG_ORGANIZATION_ID, idempotencyKey: "restored",
      draft: { ...emptyPublicationDraft(), mode, subjectId: retiredSubject.id, definitionId: activeDefinition.id, propertyKey: "old-key", displayName: "保留的显示名", reason: "恢复的草稿" }
    }));
    const { createCandidate, publish } = renderDialog({ prepare: (ports) => {
      vi.spyOn(ports.catalog, "listSubjects").mockResolvedValue({ items: [retiredSubject], totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: CATALOG_RELEASE_ID });
      vi.mocked(ports.catalog.getPublication).mockResolvedValue({ item: { id: "job-restored", candidateId: "candidate-restored", status: "cancelled", attemptCount: 0, effective: false, isCurrent: false, currentness: null, failure: null } });
    } });
    if (mode === "create-definition") {
      expect(await screen.findByDisplayValue("保留的显示名")).toBeVisible();
      expect(await screen.findByText(/请重新选择有效/)).toBeVisible();
      expect(screen.getByLabelText("已发布主体")).toHaveAttribute("data-value", retiredSubject.id);
      expect(screen.getByRole("button", { name: "重新预览" })).toBeDisabled();
      await waitFor(() => expect(screen.getByRole("button", { name: "发布到目录" })).toBeDisabled());
    } else {
      await screen.findByRole("dialog", { name: "历史发布任务" });
      expect(screen.getByText(/此处仅跟踪已有发布任务/)).toBeVisible();
      expect(screen.queryByLabelText("属性键")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "预览发布" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "发布到目录" })).not.toBeInTheDocument();
      expect(screen.queryByText(publicationCopy.authorRequired)).not.toBeInTheDocument();
    }
    expect(createCandidate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("发布预览")).not.toBeInTheDocument();
    if (mode === "revise-definition") {
      await userEvent.click(await screen.findByRole("button", { name: "结束跟踪并开始新增" }));
      expect(await screen.findByRole("dialog", { name: "向已发布主体新增定义" })).toBeVisible();
      expect(screen.getByLabelText("属性键")).toHaveValue("");
      expect(window.localStorage.getItem(PUBLICATION_JOB_STORAGE_KEY)).toBeNull();
      expect(createCandidate).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    }
  });

  it("includes subjects beyond the first API page", async () => {
    const { ports } = renderDialog({ paginate: true });
    await selectControlOption(await screen.findByLabelText("已发布主体"), "subject-last-page");
    expect(screen.getByLabelText("已发布主体")).toHaveAttribute("data-value", "subject-last-page");
    expect(ports.catalog.listSubjects).toHaveBeenCalledWith(expect.objectContaining({ cursor: "subjects-page-2" }));
    expect(ports.catalog.listDefinitions).not.toHaveBeenCalled();
  });
  it("completes a new publication after finishing a successful legacy revision task", async () => {
    window.localStorage.setItem(PUBLICATION_JOB_STORAGE_KEY, JSON.stringify({
      jobId: "job-old", candidateId: "candidate-old", catalogReleaseId: CATALOG_RELEASE_ID,
      userId: CATALOG_AUTHOR_PERSON_ID, organizationId: CATALOG_ORGANIZATION_ID, idempotencyKey: "old",
      draft: { ...emptyPublicationDraft(), mode: "revise-definition", definitionId: activeDefinition.id }
    }));
    const { completed } = renderDialog({ publicationOutcome: "active", prepare: (ports) => {
      vi.mocked(ports.catalog.getPublication).mockResolvedValue({ item: {
        id: "job-old", candidateId: "candidate-old", status: "active", attemptCount: 1,
        effective: true, isCurrent: true, currentness: "active", failure: null
      } });
    } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "结束跟踪并开始新增" }));
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await user.click(await screen.findByRole("button", { name: "发布到目录" }));
    await confirm("确认发布");
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(2));
    expect(window.localStorage.getItem(PUBLICATION_JOB_STORAGE_KEY)).toBeNull();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(PUBLICATION_JOB_STORAGE_KEY);
  });

  it("hides publish without catalog:publish and does not offer digest or git inputs", async () => {
    renderDialog({ actor: "org-admin", permissions: ["catalog:author"] });
    expect(await screen.findByRole("dialog", { name: "向已发布主体新增定义" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "发布到目录" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeVisible();
    expect(screen.queryByLabelText(/摘要|仓库|Git|digest|release version|内部编号/i)).not.toBeInTheDocument();
    expect(screen.getByText(/不必填写内部编号/)).toBeVisible();
  });

  it("saves a draft through existing Proposal resources then previews a typed ChangeSet", async () => {
    const { createProposal, createCandidate } = renderDialog({
      actor: "org-admin",
      permissions: ["catalog:author", "catalog:publish"]
    });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(createProposal).toHaveBeenCalledTimes(1));
    expect(createProposal.mock.calls[0]?.[0]).toMatchObject({
      requestedChange: { kind: "create-definition", propertyKey: "iin_hold" }
    });
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await waitFor(() => expect(createCandidate).toHaveBeenCalledTimes(1));
    expect(createCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        changeSet: [
          expect.objectContaining({
            op: "create-definition",
            subjectId: CATALOG_SUBJECT_ID,
            propertyKey: "iin_hold"
          })
        ]
      }),
      { catalogReleaseId: CATALOG_RELEASE_ID }
    );
    expect(await screen.findByText("低风险仍需发布权限确认。单人策略未开启时不能自行批准。")).toBeVisible();
    expect(screen.getByLabelText("发布预览")).toHaveTextContent("新增定义");
  });

  it("publishes once with idempotencyKey and shows queued processing", async () => {
    const { publish } = renderDialog({ createIdempotencyKey: () => "pub-once" });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await screen.findByLabelText("发布预览");
    await user.click(screen.getByRole("button", { name: "发布到目录" }));
    await confirm("确认发布");
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[1]).toEqual({ idempotencyKey: "pub-once" });
    expect(await screen.findByText(/发布已入队/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "发布到目录" }));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("renders active-superseded as historical success", async () => {
    renderDialog({ publicationOutcome: "active-superseded" });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await user.click(await screen.findByRole("button", { name: "发布到目录" }));
    await confirm("确认发布");
    expect(await screen.findByText(/曾经成功/)).toBeVisible();
    expect(screen.getByText(/曾经成功/).closest("[data-tone]")).toHaveAttribute("data-tone", "success");
  });

  it("keeps the filled definition after needs-rebase", async () => {
    renderDialog({ publicationOutcome: "needs-rebase" });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await user.click(await screen.findByRole("button", { name: "发布到目录" }));
    await confirm("确认发布");
    expect(await screen.findByRole("button", { name: "重新预览" })).toBeVisible();
    expect(screen.getByLabelText("属性键")).toHaveValue("iin_hold");
    expect(screen.getByLabelText("显示名称")).toHaveValue("保持电流");
  });

  it("blocks republish after needs-rebase until a new candidate and idempotency key exist", async () => {
    let keySerial = 0;
    const { createCandidate, publish } = renderDialog({
      publicationOutcome: "needs-rebase",
      createIdempotencyKey: () => `key-${++keySerial}`
    });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await user.click(await screen.findByRole("button", { name: "发布到目录" }));
    await confirm("确认发布");
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[1]).toEqual({ idempotencyKey: "key-1" });
    expect(await screen.findByRole("button", { name: "发布到目录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新预览" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "重新预览" }));
    await confirm("确认预览");
    await waitFor(() => expect(createCandidate).toHaveBeenCalledTimes(2));
    const firstCandidate = await createCandidate.mock.results[0]?.value;
    const secondCandidate = await createCandidate.mock.results[1]?.value;
    expect(firstCandidate.item.id).not.toBe(secondCandidate.item.id);
    await user.click(await screen.findByRole("button", { name: "发布到目录" }));
    await confirm("确认发布");
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(publish.mock.calls[1]?.[0]).not.toBe(publish.mock.calls[0]?.[0]);
    expect(publish.mock.calls[1]?.[1]).toEqual({ idempotencyKey: "key-2" });
  });

  it("blocks publish of a stale preview until the operator re-previews with a new key", async () => {
    let keySerial = 0;
    const { createCandidate, publish } = renderDialog({
      createIdempotencyKey: () => `stale-${++keySerial}`
    });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await screen.findByLabelText("发布预览");
    await user.type(screen.getByLabelText("说明"), "补充约束。");
    expect(await screen.findByRole("button", { name: "发布到目录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重新预览" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "重新预览" }));
    await confirm("确认预览");
    await waitFor(() => expect(createCandidate).toHaveBeenCalledTimes(2));
    await user.click(await screen.findByRole("button", { name: "发布到目录" }));
    await confirm("确认发布");
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[1]).toEqual({ idempotencyKey: "stale-1" });
  });

  it("previews a new driver as high risk without a published subjectId", async () => {
    const { createCandidate } = renderDialog({
      actor: "org-admin",
      permissions: ["catalog:author", "catalog:publish"]
    });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("新增主体"));
    expect(await screen.findByRole("dialog", { name: "新增主体及首批定义" })).toBeVisible();
    await selectControlOption(screen.getByLabelText("主体类型"), "driver");
    await user.type(screen.getByLabelText("选择器"), "acme,aux");
    await user.clear(screen.getByLabelText("属性键"));
    await user.type(screen.getByLabelText("属性键"), "vbat");
    await user.clear(screen.getByLabelText("显示名称"));
    await user.type(screen.getByLabelText("显示名称"), "辅助电池");
    await user.clear(screen.getByLabelText("说明"));
    await user.type(screen.getByLabelText("说明"), "辅助电池电压。");
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await waitFor(() => expect(createCandidate).toHaveBeenCalledTimes(1));
    const body = createCandidate.mock.calls[0]?.[0] as { changeSet: Array<Record<string, unknown>> };
    expect(body.changeSet[0]).toMatchObject({
      op: "create-subject-with-definitions",
      kind: "driver"
    });
    expect(JSON.stringify(body.changeSet[0])).not.toMatch(/csub_acme|subjectId/i);
    expect(await screen.findByText(/新驱动可能改变节点类型回退匹配/)).toBeVisible();
    expect(screen.getByLabelText("发布预览")).toHaveTextContent("高");
  });

  it("keeps catalog success visible when registration followup fails", async () => {
    const { ports } = renderDialog({
      actor: "org-admin",
      permissions: ["catalog:author", "catalog:publish"],
      publicationOutcome: "active"
    });
    const register = vi.spyOn(ports.governance, "createRegistration").mockRejectedValueOnce(
      catalogApiFailure("placement-conflict")
    );
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("新增主体"));
    await user.type(screen.getByLabelText("选择器"), "acme,aux");
    await user.clear(screen.getByLabelText("属性键"));
    await user.type(screen.getByLabelText("属性键"), "vbat");
    await user.clear(screen.getByLabelText("显示名称"));
    await user.type(screen.getByLabelText("显示名称"), "辅助电池");
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await user.click(await screen.findByRole("button", { name: "发布到目录" }));
    await confirm("确认发布");
    expect(await screen.findByText(/目录发布已生效/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "登记到本组织" }));
    expect(await screen.findByText(/组织登记失败/)).toBeVisible();
    expect(screen.getByText(/目录发布已生效/)).toBeVisible();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("preserves fields and invalidates the previous preview when the directory version changes", async () => {
    const { changeRelease, createCandidate } = renderDialog({ prepare: (ports) => {
      vi.spyOn(ports.catalog, "listSubjects").mockImplementation(async (query) => ({
        items: [{ ...registeredSubject, membership: { ...registeredSubject.membership, catalogReleaseId: query?.catalogReleaseId ?? CATALOG_RELEASE_ID } }],
        totalCount: 1, hasMore: false, nextCursor: null, catalogReleaseId: query?.catalogReleaseId ?? CATALOG_RELEASE_ID
      }));
    } });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    await screen.findByLabelText("发布预览");
    changeRelease("crel_newer");
    await waitFor(() => expect(screen.getByRole("button", { name: "发布到目录" })).toBeDisabled());
    expect(screen.getByLabelText("显示名称")).toHaveValue("保持电流");
    expect(screen.getByLabelText("属性键")).toHaveValue("iin_hold");
    expect(screen.getByRole("button", { name: "重新预览" })).toBeVisible();
    expect(createCandidate).toHaveBeenCalledTimes(1);
  });

  it("does not use unpublished-empty copy for a permission miss when published subjects exist", async () => {
    renderDialog({ permissions: [] });
    expect(await screen.findByRole("dialog", { name: "向已发布主体新增定义" })).toBeVisible();
    expect(screen.queryByText(publicationCopy.unpublishedEmpty)).not.toBeInTheDocument();
    expect(screen.getByText(publicationCopy.authorRequired)).toBeVisible();
    expect(screen.queryByLabelText("属性键")).not.toBeInTheDocument();
  });

  it("keeps input for policy-disabled and freeze refusals", async () => {
    const { unmount } = renderDialog({ publicationOutcome: "policy-disabled" });
    const user = userEvent.setup();
    await fillSupportedDefinition(user);
    await user.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    expect(await screen.findByText(/策略已关闭/)).toBeVisible();
    expect(screen.getByLabelText("属性键")).toHaveValue("iin_hold");
    unmount();

    renderDialog({ publicationOutcome: "frozen" });
    const nextUser = userEvent.setup();
    await fillSupportedDefinition(nextUser);
    await nextUser.click(screen.getByRole("button", { name: "预览发布" }));
    await confirm("确认预览");
    expect(await screen.findByText(/冻结/)).toBeVisible();
    expect(screen.getByLabelText("显示名称")).toHaveValue("保持电流");
  });

  it("restores a saved job after reopen", async () => {
    window.localStorage.setItem(
      PUBLICATION_JOB_STORAGE_KEY,
      JSON.stringify({
        jobId: "cjob_01KPAGE_1",
        candidateId: "ccand_01KPAGE_1",
        catalogReleaseId: CATALOG_RELEASE_ID,
        userId: CATALOG_AUTHOR_PERSON_ID,
        organizationId: CATALOG_ORGANIZATION_ID,
        idempotencyKey: "pub-restore",
        draft: {
          subjectId: CATALOG_SUBJECT_ID,
          propertyKey: "iin_hold",
          displayName: "保持电流",
          documentation: "最小保持电流。",
          valueType: "integer",
          minimum: "0",
          maximum: "",
          unit: "mA",
          examples: "",
          reason: "恢复"
        }
      })
    );
    const ports = createMockCatalogPorts({ publicationOutcome: "queued" });
    ports.catalog.getPublication = vi.fn(async () => ({
      item: {
        id: "cjob_01KPAGE_1",
        candidateId: "ccand_01KPAGE_1",
        status: "queued",
        attemptCount: 0,
        effective: false,
        isCurrent: false,
        currentness: null,
        failure: null
      }
    }));
    render(
      <PublicationDialog
        open
        actor="user"
        sessionPermissions={["catalog:author", "catalog:publish"]}
        domainState={ready}
        catalog={ports.catalog}
        governance={ports.governance}
        catalogReleaseId={CATALOG_RELEASE_ID}
        currentPersonId={CATALOG_AUTHOR_PERSON_ID}
        organizationId={CATALOG_ORGANIZATION_ID}
        publicationSurface={{
          publicationEnabled: true,
          lowRiskSingleActorPublish: false,
          policyRevision: 1,
          frozen: false,
          adopted: true,
          currentReleaseId: CATALOG_RELEASE_ID,
          authoringAllowed: true,
          publishingAllowed: true,
          reviewHighRiskAllowed: false,
          blockers: []
        }}
        onOpenChange={vi.fn()}
      />
    );
    expect(await screen.findByLabelText("属性键")).toHaveValue("iin_hold");
    await waitFor(() => expect(ports.catalog.getPublication).toHaveBeenCalledWith("cjob_01KPAGE_1"));
    window.localStorage.removeItem(PUBLICATION_JOB_STORAGE_KEY);
  });
});
