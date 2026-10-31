import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { selectControlOption } from "@/test/selectControlOption";
import type { PropsWithChildren } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";

import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import {
  CATALOG_RELEASE_ID,
  activeDefinition,
  readyCatalogDocument,
  registeredSubject,
  retiredSubject,
  unregisteredSubject
} from "@/application/parameter-catalog/fixtures";
import { catalogStateFromFailure, deriveCatalogDomainState } from "@/application/parameter-catalog/states";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

import { DefinitionEditorBody } from "./DefinitionEditorBody";
import { publicationCopy } from "./publicationState";
import { createMockKnowledgeRepository } from "@/infrastructure/mock/mockKnowledgeRepository";

const ready = deriveCatalogDomainState({ document: readyCatalogDocument });

function EditorDialog({ children }: PropsWithChildren) {
  return <ModalDialog open className="confirm-dialog" onDismiss={() => undefined}>
    {({ titleId }) => <><h2 id={titleId}>编辑定义</h2>{children}</>}
  </ModalDialog>;
}

/**
 * Issue #847 decisions 12-17: identity correction publishes a replacement
 * identity and migrates an explicitly selected, authorized project manifest
 * through preview -> confirm -> execute -> continue.
 */
describe("DefinitionEditorBody", () => {
  it("links an existing governable draft without adding it to published related knowledge", async () => {
    const repository = createMockKnowledgeRepository({ userId: "k1333-owner", canManage: false });
    const entry = await repository.createMarkdown({ title: "待关联知识", tags: [], contentMarkdown: "说明" });
    const add = vi.spyOn(repository, "addDefinitionReference").mockRejectedValueOnce(new Error("network"));
    renderDialog({
      load: async (id) => (await repository.relatedToDefinition(id)).items,
      onOpenEntry: vi.fn(),
      link: {
        search: async (q) => (await repository.list({ governable: true, q })).items.map((e) => ({ entryId: e.id, title: e.title })),
        add: async (entryId, definitionId) => { await repository.addDefinitionReference(entryId, definitionId); }
      }
    });
    const user = userEvent.setup();
    await user.click(screen.getByText("相关知识", { selector: "summary" }));
    await user.click(screen.getByRole("button", { name: "关联已有知识" }));
    const picker = await screen.findByRole("dialog", { name: "关联已有知识" });
    await user.click(await within(picker).findByRole("button", { name: "待关联知识" }));
    expect(await within(picker).findByRole("alert")).toHaveTextContent("关联失败");
    await user.click(within(picker).getByRole("button", { name: "待关联知识" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(entry.id, activeDefinition.id));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "关联已有知识" })).not.toBeInTheDocument());
    expect(screen.getByText("暂无引用该定义的已发布知识条目。")).toBeVisible();
    await repository.publish(entry.id);
    await user.click(screen.getByRole("button", { name: "关联已有知识" }));
    const reopened = await screen.findByRole("dialog", { name: "关联已有知识" });
    await user.type(within(reopened).getByRole("searchbox", { name: "搜索已有知识" }), "没有匹配");
    await user.click(within(reopened).getByRole("button", { name: "搜索" }));
    expect(await within(reopened).findByText("没有可关联的知识条目，请调整搜索条件。")).toBeVisible();
    await user.clear(within(reopened).getByRole("searchbox", { name: "搜索已有知识" }));
    await user.click(within(reopened).getByRole("button", { name: "搜索" }));
    await user.click(await within(reopened).findByRole("button", { name: "待关联知识" }));
    expect(await screen.findByRole("button", { name: /待关联知识/ })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "关联已有知识" })).not.toBeInTheDocument();
  });

  it("keeps the existing related list read-only when linking is not permitted", async () => {
    renderDialog({ load: async () => [], onOpenEntry: vi.fn() });
    await userEvent.click(screen.getByText("相关知识", { selector: "summary" }));
    expect(screen.queryByRole("button", { name: "关联已有知识" })).not.toBeInTheDocument();
  });

  it("lets a platform administrator preview identity correction without selecting an unrelated project", async () => {
    const user = userEvent.setup();
    const { preview } = renderDialog(undefined, undefined, { actor: "platform-admin", projects: [] });
    await user.type(screen.getByLabelText("属性键"), "-corrected");
    await user.type(screen.getByLabelText("修改原因"), "纠正尚未使用的定义身份");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ projectIds: [] }), expect.anything()));
  });

  it("labels the zero-project preview as a global reference check and confirms correction without a migration table", async () => {
    const user = userEvent.setup();
    const { preview } = renderDialog(undefined, undefined, { actor: "platform-admin", projects: [] });
    const response = await preview.getMockImplementation()!({} as never, {} as never);
    preview.mockResolvedValue({ item: { ...response.item, projects: [], blockers: [], impact: {
      ...response.item.impact, selectedProjectCount: 0, compatibleProjectCount: 0, blockedProjectCount: 0,
      oldDefinitionCurrentReferenceCount: 0
    } } });
    await user.type(screen.getByLabelText("属性键"), "-corrected");
    await user.type(screen.getByLabelText("修改原因"), "纠正尚未使用的定义身份");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    expect(await screen.findByText("全平台当前引用")).toBeVisible();
    expect(screen.queryByRole("table", { name: "项目迁移预览" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认并执行纠错" }));
    expect(screen.getByRole("dialog", { name: "确认执行身份纠错" })).toHaveTextContent("无需迁移项目");
  });

  it("offers independent retirement only with a fresh authoritative zero-reference result", async () => {
    const user = userEvent.setup(), retire = vi.fn();
    const { catalog, preview, execute } = renderDialog(undefined, undefined, { actor: "platform-admin", projects: [], onRetireDefinition: retire });
    const frozen = (await preview.getMockImplementation()!({} as never, {} as never)).item;
    preview.mockResolvedValue({ item: { ...frozen, impact: { ...frozen.impact, selectedProjectCount: 0 } } });
    const completed = { ...(await execute.getMockImplementation()!({} as never, {} as never)).item, status: "completed" as const,
      projects: [], retirementEvidence: { scope: "platform" as const, authoritative: true as const, remainingCurrentReferenceCount: 0 } };
    execute.mockResolvedValue({ item: completed });
    vi.spyOn(catalog, "getDefinitionReplacement").mockResolvedValue({ item: { ...completed,
      retirementEvidence: { ...completed.retirementEvidence, remainingCurrentReferenceCount: 1 } } });
    await user.type(screen.getByLabelText("属性键"), "-corrected");
    await user.type(screen.getByLabelText("修改原因"), "纠正未使用身份");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await user.click(await screen.findByRole("button", { name: "确认并执行纠错" }));
    await user.click(within(screen.getByRole("dialog", { name: "确认执行身份纠错" })).getByRole("button", { name: "确认执行" }));
    await user.click(await screen.findByRole("button", { name: "单独退役旧定义" }));
    expect(retire).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("旧定义已有当前项目引用");
    expect(screen.queryByRole("button", { name: "单独退役旧定义" })).not.toBeInTheDocument();
  });

  it("preserves a colliding identity and links to the existing Definition", async () => {
    const user = userEvent.setup();
    const { preview } = renderDialog(undefined, undefined, { actor: "platform-admin", projects: [] });
    preview.mockRejectedValue(new WiseEffApiError("CONFLICT", "Identity exists", { reason: "candidate-stale",
      replacement: "target-identity-conflict", existingDefinitionId: "pdef_existing", subjectId: "csub_existing" }, "req-collision"));
    const key = screen.getByLabelText("属性键");
    await user.clear(key); await user.type(key, "occupied_key");
    await user.type(screen.getByLabelText("修改原因"), "纠正身份");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目标身份已存在");
    expect(key).toHaveValue("occupied_key");
    expect(screen.getByRole("link", { name: "查看已有定义" })).toHaveAttribute("href", "?subjectId=csub_existing&definitionId=pdef_existing");
  });

  it("shows published examples and lets the operator clear unit and examples together", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");
    render(<DefinitionEditorBody authoringAllowed publishingAllowed history={<div />} actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={ready} catalog={ports.catalog}
      catalogReleaseId={CATALOG_RELEASE_ID} definition={{ ...activeDefinition, currentRevision: {
        ...activeDefinition.currentRevision, unit: { kind: "symbol", symbol: "mA" }, examples: [100, 200]
      } }} subjects={[registeredSubject]} />);
    expect(screen.getByLabelText(publicationCopy.examples)).toHaveValue("[100,200]");
    await user.clear(screen.getByLabelText("单位"));
    await user.clear(screen.getByLabelText(publicationCopy.examples));
    expect(screen.getByText(/本次将移除：单位、示例/)).toBeVisible();
    await user.type(screen.getByLabelText("修改原因"), "清除错误的单位与示例");
    await user.click(screen.getByRole("button", { name: "保存内容修订" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith({ changeSet: [expect.objectContaining({
      content: expect.objectContaining({ unit: null, examples: null })
    })] }, expect.anything()));
  });

  it("retains invalid example text and round-trips string examples without coercion", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");
    render(<DefinitionEditorBody authoringAllowed publishingAllowed history={<div />} actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={ready} catalog={ports.catalog}
      catalogReleaseId={CATALOG_RELEASE_ID} definition={{ ...activeDefinition, currentRevision: {
        ...activeDefinition.currentRevision, valueShape: { kind: "json-schema", schema: { type: "string" } },
        examples: ["with,comma", "", "123"]
      } }} subjects={[registeredSubject]} />);
    const examples = screen.getByLabelText(publicationCopy.examples);
    expect(examples).toHaveValue('["with,comma","","123"]');
    fireEvent.change(examples, { target: { value: "[invalid" } });
    await user.type(screen.getByLabelText("修改原因"), "更新示例");
    await user.click(screen.getByRole("button", { name: "保存内容修订" }));
    expect(screen.getByText(`${publicationCopy.invalidExamples}当前输入已保留。`)).toBeVisible();
    expect(examples).toHaveValue("[invalid");
    expect(preview).not.toHaveBeenCalled();
    fireEvent.change(examples, { target: { value: '["with,comma","","123","new"]' } });
    await user.click(screen.getByRole("button", { name: "保存内容修订" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith({ changeSet: [expect.objectContaining({
      content: expect.objectContaining({ examples: ["with,comma", "", "123", "new"] })
    })] }, expect.anything()));
  });

  it("accepts a multiline DTS property statement in the definition editor", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const preview = vi.spyOn(ports.catalog, "createPublicationCandidate");
    render(<DefinitionEditorBody authoringAllowed publishingAllowed history={<div />} actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={ready} catalog={ports.catalog}
      catalogReleaseId={CATALOG_RELEASE_ID} definition={{ ...activeDefinition, propertyKey: "trx_plim", currentRevision: {
        ...activeDefinition.currentRevision, valueShape: { kind: "json-schema", schema: { type: "array", items: { type: "string" } } }
      } }} subjects={[registeredSubject]} />);
    fireEvent.change(screen.getByLabelText(publicationCopy.examples), { target: { value: 'trx_plim =\n "5017", "-1", "6|9|10", "3|4";' } });
    await user.type(screen.getByLabelText("修改原因"), "补充 DTS 示例");
    await user.click(screen.getByRole("button", { name: "保存内容修订" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith({ changeSet: [expect.objectContaining({
      content: expect.objectContaining({ examples: [["5017", "-1", "6|9|10", "3|4"]] })
    })] }, expect.anything()));
  });

  it.each([true, false])("preserves complete multiline published documentation with authoring=%s", (authoringAllowed) => {
    const documentation = `first documentation line ${"x".repeat(300)}\nlast documentation line`;
    const ports = createMockCatalogPorts({ scenario: "ready" });
    render(<DefinitionEditorBody authoringAllowed={authoringAllowed} publishingAllowed actor="org-admin" history={null}
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={ready}
      catalog={ports.catalog} catalogReleaseId={CATALOG_RELEASE_ID}
      definition={{ ...activeDefinition, currentRevision: { ...activeDefinition.currentRevision, documentation } }}
      subjects={[registeredSubject]} />);
    const content = screen.getByLabelText("已发布参数说明");
    expect(content.textContent).toBe(documentation);
  });

  it.each([
    ["retired subject", { subjects: [retiredSubject] }],
    ["retired definition", { definition: { ...activeDefinition, lifecycle: "retired" } }],
    ["deprecated definition", { definition: { ...activeDefinition, lifecycle: "deprecated" } }],
    ["retired definition registration", { definition: { ...activeDefinition, registration: { ...registeredSubject.registration, status: "retired", id: "registration-retired" } } }],
    ["retired subject registration", { subjects: [{ ...registeredSubject, registration: { ...registeredSubject.registration, status: "retired", id: "registration-retired" } }] }],
    ["missing subject evidence", { subjects: [] }],
    ["loading", { domainState: deriveCatalogDomainState({ inFlight: true }) }],
    ["read failure", { domainState: catalogStateFromFailure(new Error("offline")) }],
    ["conflicting evidence", { domainState: catalogStateFromFailure(new WiseEffApiError("CONFLICT", "stale", { reason: "revision-conflict" }, "req-stale")) }],
    ["missing author permission", { sessionPermissions: [] }]
  ] satisfies [string, Partial<Parameters<typeof DefinitionEditorBody>[0]>][])("keeps complete details and history read-only for %s", async (_name, overrides) => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const preview = vi.spyOn(ports.catalog, "previewDefinitionReplacement");
    const publish = vi.spyOn(ports.catalog, "createPublicationCandidate");
    render(<DefinitionEditorBody authoringAllowed publishingAllowed actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={ready}
      catalog={ports.catalog} catalogReleaseId={CATALOG_RELEASE_ID} definition={activeDefinition}
      subjects={[registeredSubject]} history={<p>保留的变更历史</p>} {...overrides} />);
    const details = screen.getByRole("region", { name: "定义详情" });
    expect(details).toHaveTextContent(activeDefinition.subject.canonicalName);
    expect(details).toHaveTextContent(activeDefinition.currentRevision.displayName);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "主体" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存内容修订" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预演影响" })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /查看历史/ }));
    expect(screen.getByText("保留的变更历史")).toBeVisible();
    expect(preview).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("allows an author to preview an active unregistered definition without publication authority", async () => {
    const user = userEvent.setup();
    const { preview } = renderDialog(undefined, undefined, {
      sessionPermissions: ["catalog:author"],
      domainState: { kind: "unregistered", catalogReleaseId: CATALOG_RELEASE_ID, subjectId: unregisteredSubject.id, writesEnabled: false },
      definition: { ...activeDefinition, registration: { status: "unregistered" } }, subjects: [unregisteredSubject]
    });
    await user.type(screen.getByLabelText("显示名"), "更新");
    await user.type(screen.getByLabelText("修改原因"), "补充说明");
    expect(screen.getByRole("button", { name: "保存内容修订" })).toBeDisabled();
    await user.type(screen.getByLabelText("属性键"), "-new");
    await user.click(screen.getByRole("checkbox", { name: "项目 A" }));
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await waitFor(() => expect(preview).toHaveBeenCalledOnce());
    expect(await screen.findByRole("button", { name: "确认并执行迁移" })).toBeDisabled();
  });

  it("revokes an open migration confirmation when refreshed subject evidence becomes retired", async () => {
    const user = userEvent.setup();
    const { catalog, rerender, execute } = renderDialog();
    await user.type(screen.getByLabelText("属性键"), "-new");
    await user.type(screen.getByLabelText("修改原因"), "修正身份");
    await user.click(screen.getByRole("checkbox", { name: "项目 A" }));
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await user.click(await screen.findByRole("button", { name: "确认并执行迁移" }));
    expect(screen.getByRole("dialog", { name: "确认执行身份纠错迁移" })).toBeVisible();
    const props: Parameters<typeof DefinitionEditorBody>[0] = {
      authoringAllowed: true, publishingAllowed: true, actor: "org-admin",
      sessionPermissions: ["catalog:author", "catalog:publish"], domainState: ready, catalog,
      catalogReleaseId: CATALOG_RELEASE_ID, definition: activeDefinition,
      subjects: [retiredSubject], history: <div />
    };
    rerender(<DefinitionEditorBody {...props} />);
    expect(screen.queryByRole("dialog", { name: "确认执行身份纠错迁移" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "定义详情" })).toHaveTextContent(activeDefinition.subject.canonicalName);
    rerender(<DefinitionEditorBody {...props} subjects={[registeredSubject]} />);
    expect(screen.queryByRole("dialog", { name: "确认执行身份纠错迁移" })).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps an unavailable correction target labelled and blocks its preview after refresh", async () => {
    const user = userEvent.setup();
    const target = { ...registeredSubject, id: "target-subject", canonicalName: "target-subject-name" };
    const { catalog, rerender, preview } = renderDialog(undefined, undefined, { subjects: [registeredSubject, target] });
    await selectControlOption(screen.getByLabelText("主体"), target.id);
    await user.type(screen.getByLabelText("修改原因"), "纠正主体");
    await user.click(screen.getByRole("checkbox", { name: "项目 A" }));
    rerender(<DefinitionEditorBody authoringAllowed publishingAllowed actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={ready}
      catalog={catalog} catalogReleaseId={CATALOG_RELEASE_ID} definition={activeDefinition}
      subjects={[registeredSubject, { ...target, registration: { status: "retired", id: "target-registration" } }]}
      history={<div />} projects={[{ id: "proj-a", name: "项目 A" }]} />);
    expect(screen.getByLabelText("主体")).toHaveTextContent("target-subject-name（当前不可用）");
    expect(screen.getByRole("button", { name: "预演影响" })).toBeDisabled();
    expect(preview).not.toHaveBeenCalled();
  });

  function renderDialog(relatedKnowledge?: Parameters<typeof DefinitionEditorBody>[0]["relatedKnowledge"], createIdempotencyKey = () => "idem-847-correction", overrides: Partial<Parameters<typeof DefinitionEditorBody>[0]> = {}) {
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
      <DefinitionEditorBody
        authoringAllowed
        publishingAllowed
        history={<div />}
        actor="org-admin"
        sessionPermissions={["catalog:author", "catalog:publish"]}
        domainState={ready}
        catalog={ports.catalog}
        catalogReleaseId={CATALOG_RELEASE_ID}
        definition={activeDefinition}
        relatedKnowledge={relatedKnowledge}
        subjects={[registeredSubject]}
        projects={[{ id: "proj-a", name: "项目 A" }, { id: "proj-b", name: "项目 B" }]}
        createIdempotencyKey={createIdempotencyKey}
        {...overrides}
      />,
      { wrapper: EditorDialog }
    );
    return { ...view, catalog: ports.catalog, preview, execute, continueReplacement };
  }

  it("loads published knowledge by exact Definition identity and opens the entry", async () => {
    const load = vi.fn(async () => [{ entryId: "kb-903", title: "定义关联知识", excerpt: "", updatedAt: "2026-09-29T00:00:00Z" }]);
    const onOpenEntry = vi.fn();
    renderDialog({ load, onOpenEntry });
    expect(await screen.findByText("定义关联知识")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith(activeDefinition.id);
    const disclosure = screen.getByText("相关知识", { selector: "summary" }).closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByLabelText("显示名").compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "定义关联知识" })).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("相关知识", { selector: "summary" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "定义关联知识" }));
    expect(onOpenEntry).toHaveBeenCalledWith("kb-903");
  });

  it("reports dirty and pending state and follows content publication to completion", async () => {
    const user = userEvent.setup();
    const ports = createMockCatalogPorts({ scenario: "ready", publicationOutcome: "queued" });
    const read = vi.spyOn(ports.catalog, "getPublication").mockRejectedValueOnce(new Error("temporary transport failure")).mockResolvedValue({ item: {
      id: "job-content", candidateId: "candidate-content", status: "active", attemptCount: 1,
      effective: true, isCurrent: true, currentness: "active", failure: null
    } });
    const state = vi.fn();
    render(<DefinitionEditorBody authoringAllowed publishingAllowed history={<div />} actor="org-admin"
      sessionPermissions={["catalog:author", "catalog:publish"]} domainState={ready} catalog={ports.catalog}
      catalogReleaseId={CATALOG_RELEASE_ID} definition={activeDefinition} subjects={[registeredSubject]}
      onEditorStateChange={state} />);
    expect(screen.queryByRole("group", { name: "受影响项目" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("显示名"), "更新");
    await user.type(screen.getByLabelText("修改原因"), "补充显示名称");
    expect(state).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    await user.click(screen.getByRole("button", { name: "保存内容修订" }));
    expect(await screen.findByRole("region", { name: "内容修订结果" })).toHaveTextContent("发布已入队");
    expect(screen.getByRole("button", { name: "刷新发布状态" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("当前输入已保留"), { timeout: 3000 });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "刷新发布状态" })).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(state).toHaveBeenLastCalledWith({ dirty: false, pending: false });
  });

  it("requires a reason for an exact Definition semantic revision without policyTarget or migration", async () => {
    const user = userEvent.setup();
    const { catalog, preview, execute, continueReplacement } = renderDialog();
    const createCandidate = vi.spyOn(catalog, "createPublicationCandidate");
    const publishCandidate = vi.spyOn(catalog, "publishPublicationCandidate");
    const save = screen.getByRole("button", { name: "保存内容修订" });

    await user.type(screen.getByLabelText("最大值"), "32");
    expect(save).toBeDisabled();
    await user.click(save);
    expect(createCandidate).not.toHaveBeenCalled();
    expect(publishCandidate).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("修改原因"), "   ");
    expect(save).toBeDisabled();
    await user.click(save);
    expect(createCandidate).not.toHaveBeenCalled();
    expect(publishCandidate).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("修改原因"));
    await user.type(screen.getByLabelText("修改原因"), "限制允许的中断数量");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(publishCandidate).toHaveBeenCalledTimes(1));

    expect(createCandidate).toHaveBeenCalledTimes(1);
    expect(createCandidate).toHaveBeenCalledWith(
      {
        changeSet: [{
          op: "revise-definition",
          definitionId: activeDefinition.id,
          class: "semantic",
          content: {
            displayName: activeDefinition.currentRevision.displayName,
            documentation: activeDefinition.currentRevision.documentation,
            examples: null,
            unit: "us",
            valueSchema: { type: "integer", maximum: 32 }
          }
        }]
      },
      { catalogReleaseId: CATALOG_RELEASE_ID }
    );
    const change = createCandidate.mock.calls[0][0].changeSet[0];
    expect(change).not.toHaveProperty("policyTarget");
    expect(change).toHaveProperty("content");
    if ("content" in change) expect(change.content).not.toHaveProperty("policyTarget");
    const candidate = await createCandidate.mock.results[0].value;
    expect(publishCandidate).toHaveBeenCalledWith(
      candidate.item.id,
      { idempotencyKey: "idem-847-correction" },
      { catalogReleaseId: CATALOG_RELEASE_ID }
    );
    expect(preview).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(continueReplacement).not.toHaveBeenCalled();
  });

  it("resets editor input and reason when a different Definition is selected", async () => {
    const user = userEvent.setup();
    const { catalog, rerender, preview, execute } = renderDialog();
    const createCandidate = vi.spyOn(catalog, "createPublicationCandidate");
    const nextDefinition: typeof activeDefinition = {
      ...activeDefinition,
      id: "pdef_next_selected",
      propertyKey: "next-property",
      currentRevision: {
        ...activeDefinition.currentRevision,
        id: "drev_next_selected",
        definitionId: "pdef_next_selected",
        displayName: "新定义",
        documentation: "新定义的说明",
        unit: { kind: "symbol", symbol: "mA" },
        valueShape: { kind: "json-schema", schema: { type: "integer", minimum: 2, maximum: 8 } }
      }
    };

    await user.type(screen.getByLabelText("显示名"), "旧输入");
    await user.type(screen.getByLabelText("说明"), "旧说明");
    await user.type(screen.getByLabelText("最大值"), "64");
    await user.type(screen.getByLabelText("属性键"), "-old-edit");
    await user.click(screen.getByRole("checkbox", { name: "项目 A" }));
    await user.type(screen.getByLabelText("修改原因"), "旧审计原因");

    rerender(
      <DefinitionEditorBody
        authoringAllowed
        publishingAllowed
        history={<div />}
        actor="org-admin"
        sessionPermissions={["catalog:author", "catalog:publish"]}
        domainState={ready}
        catalog={catalog}
        catalogReleaseId={CATALOG_RELEASE_ID}
        definition={nextDefinition}
        subjects={[registeredSubject]}
        createIdempotencyKey={() => "idem-847-correction"}
      />
    );

    expect(screen.getByLabelText("属性键")).toHaveValue("next-property");
    expect(screen.getByLabelText("显示名")).toHaveValue("新定义");
    expect(screen.getByLabelText("说明")).toHaveValue("新定义的说明");
    expect(screen.getByLabelText("单位")).toHaveValue("mA");
    expect(screen.getByLabelText("取值形状")).toHaveAttribute("data-value", "integer");
    expect(screen.getByLabelText("最小值")).toHaveValue("2");
    expect(screen.getByLabelText("最大值")).toHaveValue("8");
    expect(screen.queryByRole("group", { name: "受影响项目" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("修改原因")).toHaveValue("");
    const save = screen.getByRole("button", { name: "保存内容修订" });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(createCandidate).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires an identity change, a project manifest and a reason before previewing", async () => {
    const user = userEvent.setup();
    const { preview } = renderDialog();

    await user.click(screen.getByText("更多信息"));
    expect(screen.getByText(/策略使用量暂不可用/)).toBeInTheDocument();

    // Nothing changed yet: the content path is offered and the migration path is not.
    expect(screen.getByRole("button", { name: "保存内容修订" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "预演影响" })).not.toBeInTheDocument();
    expect(screen.getByText("未做任何修改。")).toBeInTheDocument();

    // An identity change turns the editor into the migration composer, but the
    // manifest and the reason are still required.
    await user.clear(screen.getByLabelText("属性键"));
    await user.type(screen.getByLabelText("属性键"), "gpio-int-v2");
    const button = screen.getByRole("button", { name: "预演影响" });
    expect(button).toBeDisabled();
    expect(preview).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: "项目 A" }));
    await user.type(screen.getByLabelText("修改原因"), "identity was mis-authored");
    expect(button).toBeEnabled();
  });

  it("previews the exact manifest, confirms once, and reports per-project outcomes with a continue path", async () => {
    const user = userEvent.setup();
    const { preview, execute, continueReplacement } = renderDialog();

    await user.clear(screen.getByLabelText("属性键"));
    await user.type(screen.getByLabelText("属性键"), "gpio-int-v2");
    await user.click(screen.getByRole("checkbox", { name: "项目 A" }));
    await user.click(screen.getByRole("checkbox", { name: "项目 B" }));
    await user.type(screen.getByLabelText("修改原因"), "identity was mis-authored");
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
    expect(screen.getByLabelText("属性键")).toBeDisabled();
    for (const label of ["主体", "取值形状"]) {
      const trigger = screen.getByRole("combobox", { name: label });
      expect(trigger).toHaveAttribute("disabled");
      expect(trigger).toHaveAttribute("data-disabled");
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    }
    expect(screen.getByRole("checkbox", { name: "项目 A" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "返回修改" }));
    expect(screen.getByLabelText("属性键")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "确认并执行迁移" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "预演影响" }));

    await user.click(screen.getByRole("button", { name: "确认并执行迁移" }));
    const confirm = await screen.findByRole("dialog", { name: /确认执行身份纠错迁移/ });
    expect(within(confirm).getByText(/迁移不会自动退役旧定义/)).toBeInTheDocument();
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

  it("uses a fresh execution key for a new preview after a failed execution", async () => {
    const user = userEvent.setup();
    let key = 0;
    const { preview, execute } = renderDialog(undefined, () => `attempt-${++key}`);
    execute.mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "Preview expired", { reason: "revision-conflict" }, "req-expired"));
    await user.type(screen.getByLabelText("属性键"), "-first");
    await user.click(screen.getByRole("checkbox", { name: "项目 A" }));
    await user.type(screen.getByLabelText("修改原因"), "修正身份");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await user.click(await screen.findByRole("button", { name: "确认并执行迁移" }));
    await user.click(await screen.findByRole("button", { name: "确认执行" }));
    await screen.findByRole("alert");
    expect(execute).toHaveBeenCalledTimes(1);
    const original = await preview.mock.results[0].value;
    preview.mockResolvedValue({ item: { ...original.item, previewId: "preview-new", previewFingerprint: "sha256:" + "b".repeat(64) } });
    await user.click(screen.getByRole("button", { name: "返回修改" }));
    await user.type(screen.getByLabelText("属性键"), "-second");
    await user.click(screen.getByRole("button", { name: "预演影响" }));
    await user.click(await screen.findByRole("button", { name: "确认并执行迁移" }));
    await user.click(await screen.findByRole("button", { name: "确认执行" }));
    await screen.findByRole("region", { name: "纠错执行结果" });
    expect(execute.mock.calls[1][0]).toMatchObject({ previewId: "preview-new", idempotencyKey: "attempt-4" });
    expect(execute.mock.calls[0][0]).toMatchObject({ idempotencyKey: "attempt-2" });
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
      <DefinitionEditorBody
        authoringAllowed
        publishingAllowed
        history={<div />}
        actor="org-admin"
        sessionPermissions={["catalog:author", "catalog:publish"]}
        domainState={ready}
        catalog={ports.catalog}
        catalogReleaseId={CATALOG_RELEASE_ID}
        definition={activeDefinition}
        subjects={[registeredSubject]}
        projects={[{ id: "proj-a", name: "项目 A" }]}
        createIdempotencyKey={() => "idem-847-activation"}
      />,
      { wrapper: EditorDialog }
    );

    await user.type(screen.getByLabelText("属性键"), "gpio-int-v3");
    await user.click(screen.getByRole("checkbox", { name: "项目 A" }));
    await user.type(screen.getByLabelText("修改原因"), "activation retry");
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

  it.each([null, 0])("keeps identity facts, policy count %s and on-demand history readable without authoring", async (policyCount) => {
    const user = userEvent.setup();
    const onRequestHistory = vi.fn();
    render(
      <DefinitionEditorBody
        authoringAllowed={false}
        history={<ol aria-label="定义时间线"><li>目录发布</li></ol>}
        onRequestHistory={onRequestHistory}
        actor="org-admin"
        sessionPermissions={[]}
        domainState={ready}
        catalog={createMockCatalogPorts({ scenario: "ready" }).catalog}
        catalogReleaseId={CATALOG_RELEASE_ID}
        definition={{ ...activeDefinition, usageSummary: { ...activeDefinition.usageSummary, policyCount } }}
        subjects={[registeredSubject]}
      />,
      { wrapper: EditorDialog }
    );

    const detail = screen.getByRole("region", { name: "定义详情" });
    expect(detail).toHaveTextContent(activeDefinition.subject.id);
    expect(detail).toHaveTextContent(activeDefinition.id);
    expect(detail).toHaveTextContent(`修订 #${activeDefinition.currentRevision.revisionNumber}`);
    expect(detail).toHaveTextContent(activeDefinition.currentRevision.displayName);
    expect(detail).toHaveTextContent("整数");
    expect(detail).toHaveTextContent("us");
    expect(screen.queryByRole("button", { name: "保存内容修订" })).not.toBeInTheDocument();

    expect(screen.getByText(policyCount === null ? /策略使用量暂不可用/ : /策略 0/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /查看历史/ }));
    expect(onRequestHistory).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "定义时间线" })).toHaveTextContent("目录发布");
  });
});
