import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { CATALOG_AUTHOR_PERSON_ID, CATALOG_ORGANIZATION_ID, CATALOG_RELEASE_ID,
  catalogPublicationCandidate, catalogPublicationJob, registeredSubject } from "@/application/parameter-catalog/fixtures";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { ClaimedOwnerPublicationDialog } from "./ClaimedOwnerPublicationDialog";
import { SubjectIdentityPublicationDialog } from "./SubjectIdentityPublicationDialog";
import { clearStoredPublicationJob, writeStoredPublicationJob } from "./publicationJobStorage";
import { emptyPublicationDraft } from "./publicationState";

afterEach(() => { cleanup(); clearStoredPublicationJob(); });

it.each(["claimed owner", "subject identity"])("can refresh the same %s job after a status-read authorization failure", async (mode) => {
  const ownerDialog = mode === "claimed owner";
  const { catalog } = createMockCatalogPorts();
  const job = catalogPublicationJob;
  const read = vi.spyOn(catalog, "getPublication")
    .mockRejectedValueOnce(new WiseEffApiError("FORBIDDEN", "private details", {}, "req", 403))
    .mockResolvedValueOnce({ item: { ...job, status: "active", effective: true, currentness: "active", isCurrent: true } });
  vi.spyOn(catalog, "getPublicationCandidate").mockResolvedValue({ item: catalogPublicationCandidate });
  const enqueue = vi.spyOn(catalog, "publishPublicationCandidate");
  const onRefreshEvidence = vi.fn();
  const props = { catalog, catalogReleaseId: CATALOG_RELEASE_ID, currentPersonId: CATALOG_AUTHOR_PERSON_ID,
    organizationId: CATALOG_ORGANIZATION_ID, surface: null, onClose: vi.fn(), onRefreshEvidence };
  writeStoredPublicationJob({ jobId: job.id, candidateId: job.candidateId, catalogReleaseId: CATALOG_RELEASE_ID,
    idempotencyKey: "key", draft: emptyPublicationDraft(), userId: CATALOG_AUTHOR_PERSON_ID, organizationId: CATALOG_ORGANIZATION_ID,
    ...(ownerDialog ? { claimedOwners: true } : { subjectIdentityId: registeredSubject.id }) });
  render(ownerDialog ? <ClaimedOwnerPublicationDialog {...props} actor="org-admin" />
    : <SubjectIdentityPublicationDialog {...props} subject={registeredSubject} subjects={[registeredSubject]} />);
  expect(await screen.findByText(/无法读取发布状态/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: ownerDialog ? "刷新发布状态" : "刷新目录状态" }));
  await waitFor(() => expect(onRefreshEvidence).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/无法读取发布状态/)).not.toBeInTheDocument();
  expect(read.mock.calls).toEqual([[job.id], [job.id]]);
  expect(enqueue).not.toHaveBeenCalled();
});
