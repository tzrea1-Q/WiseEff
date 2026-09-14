import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import {
  CATALOG_RELEASE_ID,
  activeDefinition,
  readyCatalogDocument,
  registeredSubject
} from "@/application/parameter-catalog/fixtures";
import { deriveCatalogDomainState } from "@/application/parameter-catalog/states";

import { DefinitionCorrectionDialog } from "./DefinitionCorrectionDialog";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

/**
 * Issue #847 decisions 12-17: identity correction publishes a replacement
 * identity and migrates an explicitly selected, authorized project manifest
 * through preview -> confirm -> execute -> continue.
 */
describe("DefinitionCorrectionDialog", () => {
  function renderDialog() {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const preview = vi
      .spyOn(ports.catalog, "previewDefinitionReplacement")
      .mockResolvedValue({
        item: {
          previewId: "drep_prev_1",
          previewFingerprint: "sha256:" + "a".repeat(64),
          organizationId: "org_acme",
          oldIdentity: {
            definitionId: activeDefinition.id,
            subjectId: activeDefinition.subject.id,
            subjectName: activeDefinition.subject.canonicalName,
            propertyKey: activeDefinition.propertyKey,
            revisionId: activeDefinition.currentRevision.id
          },
          newIdentity: {
            definitionId: "pdef_replacement",
            subjectId: registeredSubject.id,
            subjectName: registeredSubject.canonicalName,
            propertyKey: "gpio-int-v2",
            revisionId: "drev_replacement_1"
          },
          catalogReleaseId: CATALOG_RELEASE_ID,
          impact: {
            selectedProjectCount: 2,
            compatibleProjectCount: 1,
            blockedProjectCount: 1,
            coupledDefinitionCount: 0,
            sourceFormatSupported: true,
            oldDefinitionLifecycle: "active",
            oldDefinitionCurrentReferenceCount: 2,
            targetRegistrationRequired: false
          },
          blockers: [],
          projects: [],
          expiresAt: null
        }
      } as never);
    const execute = vi
      .spyOn(ports.catalog, "createDefinitionReplacement")
      .mockResolvedValue({
        item: {
          id: "drep_1",
          status: "blocked",
          organizationId: "org_acme",
          oldIdentity: {
            definitionId: activeDefinition.id,
            subjectId: activeDefinition.subject.id,
            subjectName: activeDefinition.subject.canonicalName,
            propertyKey: activeDefinition.propertyKey,
            revisionId: activeDefinition.currentRevision.id
          },
          newIdentity: {
            definitionId: "pdef_replacement",
            subjectId: registeredSubject.id,
            subjectName: registeredSubject.canonicalName,
            propertyKey: "gpio-int-v2",
            revisionId: "drev_replacement_1"
          },
          previewFingerprint: "sha256:" + "a".repeat(64),
          catalogReleaseId: CATALOG_RELEASE_ID,
          candidateId: "ccand_1",
          publicationJobId: "cjob_1",
          authorizationId: "cauth_1",
          reason: "identity was mis-authored",
          etag: '"drep_1-v1"',
          version: 1,
          createdAt: "2026-09-14T00:00:00Z",
          projects: [
            {
              projectId: "proj-a",
              projectName: "proj-a",
              status: "completed",
              blockerReason: null,
              oldBindingId: "bind-a",
              oldValueId: "val-a",
              newBindingId: "bind-a-new",
              newValueId: "val-a-new",
              valueKind: "number",
              compatible: true,
              attemptCount: 1,
              registrationRequired: false
            },
            {
              projectId: "proj-b",
              projectName: "proj-b",
              status: "blocked",
              blockerReason: "incompatible-value",
              oldBindingId: "bind-b",
              oldValueId: "val-b",
              newBindingId: null,
              newValueId: null,
              valueKind: "number",
              compatible: false,
              attemptCount: 1,
              registrationRequired: false
            }
          ]
        }
      } as never);
    const view = render(
      <DefinitionCorrectionDialog
        open
        actor="org-admin"
        sessionPermissions={["catalog:author", "catalog:publish"]}
        domainState={ready}
        catalog={ports.catalog}
        catalogReleaseId={CATALOG_RELEASE_ID}
        definition={activeDefinition}
        subjects={[registeredSubject]}
        createIdempotencyKey={() => "idem-847-correction"}
        onOpenChange={vi.fn()}
      />
    );
    return { ...view, preview, execute };
  }

  it("requires an explicit project selection and a reason before previewing", async () => {
    const user = userEvent.setup();
    const { preview } = renderDialog();
    const button = screen.getByRole("button", { name: "预演影响" });

    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText("受影响项目编号"), "proj-a, proj-b");
    expect(button).toBeEnabled();
    expect(preview).not.toHaveBeenCalled();

    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("纠错原因");
    expect(preview).not.toHaveBeenCalled();
  });

  it("previews the exact manifest, confirms once, and reports per-project outcomes with a continue path", async () => {
    const user = userEvent.setup();
    const { preview, execute } = renderDialog();

    await user.clear(screen.getByLabelText("替代属性键"));
    await user.type(screen.getByLabelText("替代属性键"), "gpio-int-v2");
    await user.type(screen.getByLabelText("受影响项目编号"), "proj-a, proj-b");
    await user.type(screen.getByLabelText("纠错原因"), "identity was mis-authored");
    await user.click(screen.getByRole("button", { name: "预演影响" }));

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(preview.mock.calls[0]?.[0]).toMatchObject({
      oldDefinitionId: activeDefinition.id,
      newPropertyKey: "gpio-int-v2",
      projectIds: ["proj-a", "proj-b"]
    });

    const previewRegion = await screen.findByRole("region", { name: "纠错影响预览" });
    expect(within(previewRegion).getByText("可迁移")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认并执行迁移" }));
    const confirm = await screen.findByRole("dialog", { name: /确认执行身份纠错迁移/ });
    expect(within(confirm).getByText(/迁移不会自动弃用旧定义/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "确认执行" }));

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const result = await screen.findByRole("region", { name: "纠错执行结果" });
    expect(result).toHaveAttribute("data-correction-result", "blocked");
    // Partial progress is reported honestly, and the blocked project is retained.
    expect(within(result).getByText(/已完成 1/)).toBeInTheDocument();
    expect(within(result).getByText(/被阻止 1/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续处理被阻止的项目" })).toBeEnabled();
  });
});
