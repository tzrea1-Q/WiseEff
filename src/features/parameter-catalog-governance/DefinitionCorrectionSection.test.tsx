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
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

import { DefinitionCorrectionSection } from "./DefinitionCorrectionSection";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

/**
 * Issue #847 decisions 12-17: identity correction publishes a replacement
 * identity and migrates an explicitly selected, authorized project manifest
 * through preview -> confirm -> execute -> continue.
 */
describe("DefinitionCorrectionSection", () => {
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
          version: 1,          createdAt: "2026-09-14T00:00:00Z",
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
    const continueReplacement = vi
      .spyOn(ports.catalog, "continueDefinitionReplacement")
      .mockResolvedValue({
        item: {
          id: "drep_1",
          status: "completed",
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
          etag: '"drep_1-v2"',
          version: 2,
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
              attemptCount: 2,
              registrationRequired: false
            },
            {
              projectId: "proj-b",
              projectName: "proj-b",
              status: "completed",
              blockerReason: null,
              oldBindingId: "bind-b",
              oldValueId: "val-b",
              newBindingId: "bind-b-new",
              newValueId: "val-b-new",
              valueKind: "number",
              compatible: true,
              attemptCount: 2,
              registrationRequired: false
            }
          ]
        }
      } as never);
    const view = render(
      <DefinitionCorrectionSection
        actor="org-admin"
        sessionPermissions={["catalog:author", "catalog:publish"]}
        domainState={ready}
        catalog={ports.catalog}
        catalogReleaseId={CATALOG_RELEASE_ID}
        definition={activeDefinition}
        subjects={[registeredSubject]}
        createIdempotencyKey={() => "idem-847-correction"}
      />
    );
    return { ...view, preview, execute, continueReplacement };
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
    const { preview, execute, continueReplacement } = renderDialog();

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
    // Preview is a catalog write route: it must carry the release pin and an
    // idempotency key, or the root API answers 409 revision-conflict.
    expect(preview.mock.calls[0]?.[1]).toMatchObject({
      catalogReleaseId: CATALOG_RELEASE_ID,
      idempotencyKey: "idem-847-correction"
    });

    const previewRegion = await screen.findByRole("region", { name: "纠错影响预览" });
    expect(within(previewRegion).getByText("可迁移")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认并执行迁移" }));
    const confirm = await screen.findByRole("dialog", { name: /确认执行身份纠错迁移/ });
    expect(within(confirm).getByText(/迁移不会自动弃用旧定义/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "确认执行" }));

    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    // Create is fenced with If-Match = the frozen preview fingerprint.
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      catalogReleaseId: CATALOG_RELEASE_ID,
      idempotencyKey: "idem-847-correction",
      ifMatch: "sha256:" + "a".repeat(64)
    });
    const result = await screen.findByRole("region", { name: "纠错执行结果" });
    expect(result).toHaveAttribute("data-correction-result", "blocked");
    // Partial progress is reported honestly, and the blocked project is retained.
    expect(within(result).getByText(/已完成 1/)).toBeInTheDocument();
    expect(within(result).getByText(/被阻止 1/)).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "继续处理被阻止的项目" });
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);
    // Continue is fenced on the replacement's own ETag version.
    await waitFor(() => expect(continueReplacement).toHaveBeenCalledTimes(1));
    expect(continueReplacement.mock.calls[0]?.[2]).toMatchObject({
      catalogReleaseId: CATALOG_RELEASE_ID,
      ifMatch: '"drep_1-v1"'
    });
  });

  it("retries the same command while the publication manager installs the successor release", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready" });
    vi.spyOn(ports.catalog, "previewDefinitionReplacement").mockResolvedValue({
      item: {
        previewId: "drpv_retry",
        previewFingerprint: "sha256:" + "b".repeat(64),
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
          propertyKey: "gpio-int-v3",
          revisionId: "drev_replacement_2"
        },
        catalogReleaseId: CATALOG_RELEASE_ID,
        impact: {
          selectedProjectCount: 1,
          compatibleProjectCount: 1,
          blockedProjectCount: 0,
          coupledDefinitionCount: 0,
          sourceFormatSupported: true,
          oldDefinitionLifecycle: "active",
          oldDefinitionCurrentReferenceCount: 1,
          targetRegistrationRequired: false
        },
        blockers: [],
        projects: [],
        expiresAt: null
      }
    } as never);
    const create = vi
      .spyOn(ports.catalog, "createDefinitionReplacement")
      .mockRejectedValueOnce(
        new WiseEffApiError("SERVICE_UNAVAILABLE", "Catalog is not ready.", { reason: "catalog-not-ready" }, "req-1")
      )
      .mockRejectedValueOnce(
        new WiseEffApiError("CONFLICT", "The catalog release changed.", { reason: "release-drift" }, "req-2")
      )
      .mockResolvedValue({ item: { id: "drep_retry", status: "completed", projects: [], etag: '"drep_retry-v1"', version: 1 } } as never);
    const refresh = vi.spyOn(ports.catalog, "getCatalog").mockResolvedValue({
      item: { catalogReleaseId: "crel_successor" }
    } as never);

    render(
      <DefinitionCorrectionSection
        actor="org-admin"
        sessionPermissions={["catalog:author", "catalog:publish"]}
        domainState={ready}
        catalog={ports.catalog}
        catalogReleaseId={CATALOG_RELEASE_ID}
        definition={activeDefinition}
        subjects={[registeredSubject]}
        createIdempotencyKey={() => "idem-847-activation"}
      />
    );

    await user.type(screen.getByLabelText("替代属性键"), "gpio-int-v3");
    await user.type(screen.getByLabelText("受影响项目编号"), "proj-a");
    await user.type(screen.getByLabelText("纠错原因"), "activation retry");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await screen.findByRole("region", { name: "纠错影响预览" });
    await user.click(screen.getByRole("button", { name: "确认并执行迁移" }));
    await user.click(await screen.findByRole("button", { name: "确认执行" }));

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3), { timeout: 20_000 });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 20_000 });
    // Same idempotent command every time; the release pin follows the manager.
    expect(create.mock.calls.map((call) => call[1]?.catalogReleaseId)).toEqual([
      CATALOG_RELEASE_ID,
      "crel_successor",
      "crel_successor"
    ]);
    for (const call of create.mock.calls) {
      expect(call[0]).toMatchObject({
        previewId: "drpv_retry",
        idempotencyKey: "idem-847-activation"
      });
      expect(call[1]).toMatchObject({
        idempotencyKey: "idem-847-activation",
        ifMatch: "sha256:" + "b".repeat(64)
      });
    }
    await vi.waitFor(
      () => {
        expect(screen.queryByRole("region", { name: "纠错执行结果" })).not.toBeNull();
      },
      { timeout: 20_000 }
    );
  }, 30_000);
});
