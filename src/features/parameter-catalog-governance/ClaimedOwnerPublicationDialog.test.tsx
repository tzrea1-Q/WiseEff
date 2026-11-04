import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { catalogPublicationCandidate, catalogPublicationJob, CATALOG_RELEASE_ID,
  CATALOG_AUTHOR_PERSON_ID, CATALOG_ORGANIZATION_ID } from "@/application/parameter-catalog/fixtures";
import { ClaimedOwnerPublicationDialog } from "./ClaimedOwnerPublicationDialog";
import { PUBLICATION_JOB_STORAGE_KEY } from "./publicationJobStorage";
import type { PublicationSurfaceItem } from "./publicationSurface";

afterEach(() => { cleanup(); window.localStorage.removeItem(PUBLICATION_JOB_STORAGE_KEY); });
const candidate = { ...catalogPublicationCandidate, riskClass: "high" as const,
  impactSummary: { addedDefinitionCount: 0, changedDefinitionCount: 0, addedSubjectCount: 0,
    ownerPublicationOnly: true,
    ownerDeclarations: [{ subjectId: "child", subjectName: "battery_checker", ownerSubjectId: "driver", ownerName: "huawei,batt_info" }] } };
const surface: PublicationSurfaceItem = { publicationEnabled: true, lowRiskSingleActorPublish: false,
  policyRevision: 2, frozen: false, adopted: true, currentReleaseId: CATALOG_RELEASE_ID,
  authoringAllowed: true, publishingAllowed: true, reviewHighRiskAllowed: true, blockers: [] };

function setup(options: { noChange?: boolean; surface?: PublicationSurfaceItem; release?: string; failure?: boolean } = {}) {
  const { catalog } = createMockCatalogPorts();
  catalog.previewClaimedOwners = vi.fn(async () => {
    if (options.failure) throw new Error("unavailable");
    return { item: { candidate: options.noChange ? null : candidate, noChange: Boolean(options.noChange) } };
  });
  catalog.publishPublicationCandidate = vi.fn(async () => ({ item: { ...catalogPublicationJob, candidateId: candidate.id,
    status: "active" as const, effective: true, isCurrent: true, currentness: "active" as const } }));
  catalog.getPublicationCandidate = vi.fn(async () => ({ item: candidate }));
  const refresh = vi.fn();
  const props = { catalog, catalogReleaseId: options.release ?? CATALOG_RELEASE_ID, currentPersonId: CATALOG_AUTHOR_PERSON_ID,
    organizationId: CATALOG_ORGANIZATION_ID, actor: "org-admin" as const, surface: options.surface ?? surface,
    runtimeMode: "api", onClose: vi.fn(), onRefreshEvidence: refresh };
  const view = render(<ClaimedOwnerPublicationDialog {...props} />);
  return { catalog, refresh, props, ...view };
}
async function confirm(title: string) {
  const dialog = screen.getByRole("dialog", { name: title === "确认预览" ? "确认预览发布候选" : "确认发布到目录" });
  const checkbox = within(dialog).getByRole("checkbox");
  await userEvent.click(checkbox);
  await userEvent.click(within(dialog).getByRole("button", { name: title }));
}
async function preview() {
  await userEvent.click(screen.getByRole("button", { name: "预览待发布归属" }));
  await confirm("确认预览");
}

it("shows exact claims, requires explicit confirmation, and waits for effective publication", async () => {
  const { catalog, refresh } = setup();
  expect(catalog.previewClaimedOwners).not.toHaveBeenCalled();
  await preview();
  expect(await screen.findByRole("table", { name: "待发布的子节点归属" })).toHaveTextContent("battery_checker");
  expect(screen.getByRole("table")).toHaveTextContent("huawei,batt_info");
  expect(catalog.publishPublicationCandidate).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "确认发布归属" }));
  expect(catalog.publishPublicationCandidate).not.toHaveBeenCalled();
  await confirm("确认发布");
  await waitFor(() => expect(catalog.publishPublicationCandidate).toHaveBeenCalledTimes(1));
  expect(catalog.previewClaimedOwners).toHaveBeenCalledWith({ catalogReleaseId: CATALOG_RELEASE_ID });
  expect(await screen.findByText(/归属发布已生效/)).toBeVisible();
  expect(refresh).toHaveBeenCalled();
});

it("does not create or publish an empty successor", async () => {
  const { catalog } = setup({ noChange: true });
  await preview();
  expect(await screen.findByText("没有待发布的已认领归属，无需创建新版本。")).toBeVisible();
  expect(screen.queryByRole("button", { name: "确认发布归属" })).not.toBeInTheDocument();
  expect(catalog.publishPublicationCandidate).not.toHaveBeenCalled();
});

it("keeps a queued job pending, restores it after reopening, and only completes on an effective receipt", async () => {
  const view = setup();
  const queued = { ...catalogPublicationJob, candidateId: candidate.id, status: "queued" as const,
    effective: false, isCurrent: false, currentness: null };
  vi.mocked(view.catalog.publishPublicationCandidate).mockResolvedValue({ item: queued });
  view.catalog.getPublication = vi.fn(async () => ({ item: queued }));
  await preview();
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "确认发布归属" }));
  await confirm("确认发布");
  await waitFor(() => expect(view.catalog.getPublication).toHaveBeenCalledWith(queued.id));
  expect(screen.queryByText(/归属发布已生效/)).not.toBeInTheDocument();
  expect(view.refresh).not.toHaveBeenCalled();
  expect(JSON.parse(window.localStorage.getItem(PUBLICATION_JOB_STORAGE_KEY)!)).toMatchObject({ claimedOwners: true });
  view.unmount();
  vi.mocked(view.catalog.getPublication).mockResolvedValue({ item: { ...queued,
    status: "active", effective: true, isCurrent: true, currentness: "active" } });
  render(<ClaimedOwnerPublicationDialog {...view.props} />);
  expect(await screen.findByText(/归属发布已生效/)).toBeVisible();
  expect(view.catalog.publishPublicationCandidate).toHaveBeenCalledTimes(1);
  expect(view.catalog.getPublicationCandidate).toHaveBeenCalledWith(candidate.id);
  await waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
  expect(window.localStorage.getItem(PUBLICATION_JOB_STORAGE_KEY)).toBeNull();
});

it("blocks frozen authoring and stale candidates without changing policy", async () => {
  const view = setup();
  await preview();
  await screen.findByRole("table");
  view.rerender(<ClaimedOwnerPublicationDialog {...view.props} catalogReleaseId="crel_other" />);
  expect(screen.getByRole("button", { name: "确认发布归属" })).toBeDisabled();
  view.rerender(<ClaimedOwnerPublicationDialog {...view.props}
    surface={{ ...surface, frozen: true, authoringAllowed: false, publishingAllowed: false,
      reviewHighRiskAllowed: false, blockers: ["publication-frozen"] }} />);
  expect(screen.getByRole("button", { name: "预览待发布归属" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "确认发布归属" })).toBeDisabled();
});

it("permits a reviewer to inspect a frozen candidate without generating a new one", async () => {
  const { catalog } = setup({ surface: { ...surface, authoringAllowed: false } });
  await userEvent.click(screen.getByText("审核已有归属候选"));
  await userEvent.type(screen.getByLabelText("候选编号"), candidate.id);
  await userEvent.click(screen.getByRole("button", { name: "读取待审核候选" }));
  expect(await screen.findByRole("table")).toHaveTextContent("battery_checker");
  expect(catalog.previewClaimedOwners).not.toHaveBeenCalled();
  expect(catalog.getPublicationCandidate).toHaveBeenCalledWith(candidate.id);
});

it("shows preview failures and keeps publication unavailable", async () => {
  const { catalog } = setup({ failure: true });
  await preview();
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(catalog.publishPublicationCandidate).not.toHaveBeenCalled();
});

it("invalidates the previous preview when a mixed candidate or failed read is offered", async () => {
  const { catalog } = setup();
  await preview();
  await screen.findByRole("table");
  expect(screen.getByRole("button", { name: "确认发布归属" })).toBeEnabled();
  vi.mocked(catalog.getPublicationCandidate).mockResolvedValue({ item: { ...candidate,
    impactSummary: { ...candidate.impactSummary, changedDefinitionCount: 1, ownerPublicationOnly: false } } });
  await userEvent.click(screen.getByText("审核已有归属候选"));
  await userEvent.type(screen.getByLabelText("候选编号"), "mixed-candidate");
  await userEvent.click(screen.getByRole("button", { name: "读取待审核候选" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "确认发布归属" })).toBeDisabled();
  vi.mocked(catalog.getPublicationCandidate).mockRejectedValue(new Error("unavailable"));
  await userEvent.click(screen.getByRole("button", { name: "读取待审核候选" }));
  expect(screen.getByRole("button", { name: "确认发布归属" })).toBeDisabled();
  expect(catalog.publishPublicationCandidate).not.toHaveBeenCalled();
});
