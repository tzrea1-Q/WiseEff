import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";

import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import { renderMarkdownPreview } from "@/domain/knowledge/markdown";
import type { KnowledgeEntry, KnowledgeParameterReference } from "@/domain/knowledge/types";
import { definitionReferenceLifecycleLabels } from "@/domain/knowledge/types";
import { presentError } from "@/infrastructure/http/presentError";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SearchField } from "@/components/common/SearchField";
import { Button } from "@/components/ui/button";
import { KnowledgeParameterReferenceChips, referenceDisplayName } from "./KnowledgeParameterReferenceChips";

export type KnowledgeEditorSubmit = {
  title: string;
  tags: string[];
  contentMarkdown: string;
  /** Present when editing; undefined when creating. */
  expectedHeadRevisionNumber?: number;
};

/** One exact canonical Definition returned by CatalogRead. */
export type KnowledgeDefinitionPickerOption = {
  definitionId: string;
  propertyKey: string;
  displayName: string | null;
  driverModule: string | null;
  lifecycle: "active" | "deprecated" | "retired";
};

export type KnowledgeDefinitionPickerPage = {
  items: KnowledgeDefinitionPickerOption[];
  nextCursor: string | null;
  catalogReleaseId: string;
};

/**
 * Reference editing seam: add/remove are immediate audited API calls (not
 * part of the save payload) and resolve to the entry's updated reference list.
 * Absent when the caller cannot search definitions (`parameter:view`).
 */
export type KnowledgeParameterReferencePicker = {
  search: (q: string, cursor?: string, catalogReleaseId?: string) => Promise<KnowledgeDefinitionPickerPage>;
  onAdd: (entryId: string, definitionId: string) => Promise<KnowledgeParameterReference[]>;
  onRemove: (entryId: string, reference: KnowledgeParameterReference) => Promise<KnowledgeParameterReference[]>;
};

export type KnowledgeEntryEditorDialogProps = {
  open: boolean;
  /** null creates a new markdown entry; an entry edits it in place. */
  entry: KnowledgeEntry | null;
  onSubmit: (input: KnowledgeEditorSubmit) => Promise<void>;
  parameterReferencePicker?: KnowledgeParameterReferencePicker;
  onClose: () => void;
};

export function parseTagsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，;；\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

/**
 * Split edit/preview markdown editor (design D17). Saves carry the expected
 * head revision so a concurrent save surfaces as a readable conflict instead
 * of a silent overwrite. Parameter-definition references are edited here too,
 * as immediate audited calls independent of the markdown save.
 */
export function KnowledgeEntryEditorDialog({
  open,
  entry,
  onSubmit,
  parameterReferencePicker,
  onClose
}: KnowledgeEntryEditorDialogProps) {
  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<KnowledgeRevisionConflictError | null>(null);
  const [references, setReferences] = useState<KnowledgeParameterReference[]>([]);
  const [specQuery, setSpecQuery] = useState("");
  const [specOptions, setSpecOptions] = useState<KnowledgeDefinitionPickerOption[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [catalogReleaseId, setCatalogReleaseId] = useState<string | null>(null);
  const [specSearchRan, setSpecSearchRan] = useState(false);
  const [specSearching, setSpecSearching] = useState(false);
  const [referenceError, setReferenceError] = useState("");
  const [referencePendingSpecId, setReferencePendingSpecId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(entry?.title ?? "");
      setTagsText(entry?.tags.join(", ") ?? "");
      setContent(entry?.contentMarkdown ?? "");
      setError("");
      setConflict(null);
      setPending(false);
      setReferences(entry?.parameterReferences ?? []);
      setSpecQuery("");
      setSpecOptions([]);
      setNextCursor(null);
      setCatalogReleaseId(null);
      setSpecSearchRan(false);
      setSpecSearching(false);
      setReferenceError("");
      setReferencePendingSpecId(null);
    }
  }, [open, entry]);

  const previewHtml = useMemo(() => renderMarkdownPreview(content), [content]);
  const referencedDefinitionIds = useMemo(() => new Set(references
    .filter((reference) => reference.kind === "definition")
    .map((reference) => reference.definitionId)), [references]);
  const showReferenceSection = Boolean(parameterReferencePicker);

  const runSpecSearch = async () => {
    if (!parameterReferencePicker) return;
    const q = specQuery.trim();
    setSpecSearching(true);
    setReferenceError("");
    try {
      const page = await parameterReferencePicker.search(q);
      setSpecOptions(page.items);
      setNextCursor(page.nextCursor);
      setCatalogReleaseId(page.catalogReleaseId);
      setSpecSearchRan(true);
    } catch (searchError) {
      setReferenceError(presentError(searchError, "参数定义检索失败，请稍后重试。"));
    } finally {
      setSpecSearching(false);
    }
  };

  const loadMoreDefinitions = async () => {
    if (!parameterReferencePicker || !nextCursor || !catalogReleaseId) return;
    setSpecSearching(true);
    setReferenceError("");
    try {
      const page = await parameterReferencePicker.search(specQuery.trim(), nextCursor, catalogReleaseId);
      if (page.catalogReleaseId !== catalogReleaseId) throw new Error("目录发布已变化，请重新检索。");
      setSpecOptions((current) => [...current, ...page.items.filter((item) =>
        !current.some((existing) => existing.definitionId === item.definitionId))]);
      setNextCursor(page.nextCursor);
    } catch (searchError) {
      setReferenceError(presentError(searchError, "后续定义加载失败，请重新检索。"));
    } finally {
      setSpecSearching(false);
    }
  };

  const addReference = async (definitionId: string) => {
    if (!parameterReferencePicker || !entry) return;
    setReferencePendingSpecId(definitionId);
    setReferenceError("");
    try {
      setReferences(await parameterReferencePicker.onAdd(entry.id, definitionId));
    } catch (addError) {
      setReferenceError(presentError(addError, "添加引用失败，请稍后重试。"));
    } finally {
      setReferencePendingSpecId(null);
    }
  };

  const removeReference = async (reference: KnowledgeParameterReference) => {
    if (!parameterReferencePicker || !entry) return;
    setReferencePendingSpecId(reference.kind === "definition" ? reference.definitionId : reference.specId);
    setReferenceError("");
    try {
      setReferences(await parameterReferencePicker.onRemove(entry.id, reference));
    } catch (removeError) {
      setReferenceError(presentError(removeError, "移除引用失败，请稍后重试。"));
    } finally {
      setReferencePendingSpecId(null);
    }
  };

  const submit = async () => {
    if (!title.trim()) {
      setError("请填写条目标题。");
      return;
    }
    setPending(true);
    setError("");
    setConflict(null);
    try {
      await onSubmit({
        title: title.trim(),
        tags: parseTagsInput(tagsText),
        contentMarkdown: content,
        ...(entry ? { expectedHeadRevisionNumber: entry.headRevisionNumber } : {})
      });
      onClose();
    } catch (submitError) {
      if (submitError instanceof KnowledgeRevisionConflictError) {
        setConflict(submitError);
      } else {
        setError(presentError(submitError, "保存失败，请稍后重试。"));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onDismiss={pending ? undefined : onClose}
      className="knowledge-editor-dialog flex max-h-[min(920px,calc(100dvh-48px))] w-[min(1080px,calc(100vw-48px))] flex-col gap-4 overflow-hidden rounded-xl bg-card p-5 shadow-xl"
      backdropClassName="knowledge-modal-backdrop"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <div>
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {entry ? "编辑知识条目" : "新建 Markdown 条目"}
            </h2>
            <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
              {entry
                ? `每次保存都会产生新的不可变修订(当前修订 #${entry.headRevisionNumber})。`
                : "新条目以草稿创建;发布后才进入检索。"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="条目标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="条目标题"
              className="h-9 min-w-64 flex-1 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              aria-label="标签(逗号分隔)"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
              placeholder="标签,逗号分隔(可含项目标签)"
              className="h-9 w-72 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2">
            <textarea
              aria-label="Markdown 内容"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="以 Markdown 撰写知识内容…"
              className="min-h-64 w-full resize-none rounded-md border border-border bg-background p-3 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div
              aria-label="预览"
              role="region"
              className="knowledge-markdown-preview min-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: previewHtml || "<p class='text-muted-foreground'>预览区</p>" }}
            />
          </div>

          {showReferenceSection ? (
            <section
              className="flex shrink-0 flex-col gap-2 rounded-md border border-border bg-muted/10 p-3"
              aria-label="关联参数定义"
              data-testid="knowledge-reference-picker"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-foreground">关联参数定义</span>
                <span className="text-xs text-muted-foreground">
                  {entry ? "添加/移除立即生效并写入审计；引用绑定定义本体，退役后仍保留。" : "先创建草稿,再关联参数定义。"}
                </span>
              </div>

              {entry ? (
                <>
                  <KnowledgeParameterReferenceChips
                    references={references}
                    onRemove={(reference) => void removeReference(reference)}
                    removePendingSpecId={referencePendingSpecId}
                  />
                  {references.length === 0 ? (
                    <p className="text-xs text-muted-foreground">尚未关联参数定义。</p>
                  ) : null}

                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runSpecSearch();
                    }}
                  >
                    <SearchField
                      className="knowledge-spec-search"
                      ariaLabel="检索参数定义"
                      value={specQuery}
                      onValueChange={(value) => {
                        setSpecQuery(value);
                        setSpecOptions([]);
                        setSpecSearchRan(false);
                        setNextCursor(null);
                        setCatalogReleaseId(null);
                      }}
                      placeholder="按属性键 / 模块检索参数定义"
                      loading={specSearching}
                    />
                    <Button type="submit" variant="outline" size="sm" disabled={specSearching} aria-busy={specSearching || undefined}>
                      <Search data-icon="inline-start" />
                      检索定义
                    </Button>
                  </form>

                  {specSearchRan ? (
                    <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1" aria-label="参数定义检索结果">
                      {specOptions.map((option) => {
                        const alreadyReferenced = referencedDefinitionIds.has(option.definitionId);
                        const name = referenceDisplayName(option);
                        return (
                          <li
                            key={option.definitionId}
                            className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-1.5"
                          >
                            <span className="min-w-0 truncate text-sm text-foreground">
                              {name}
                              {option.driverModule ? (
                                <span className="ml-1 text-xs text-muted-foreground">· {option.driverModule}</span>
                              ) : null}
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({definitionReferenceLifecycleLabels[option.lifecycle]})
                              </span>
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={alreadyReferenced || option.lifecycle === "retired" || referencePendingSpecId === option.definitionId}
                              aria-busy={referencePendingSpecId === option.definitionId || undefined}
                              onClick={() => void addReference(option.definitionId)}
                            >
                              <Plus data-icon="inline-start" />
                              {alreadyReferenced ? "已关联" : option.lifecycle === "retired" ? "不可关联" : "关联"}
                            </Button>
                          </li>
                        );
                      })}
                      {!specSearching && specOptions.length === 0 ? (
                        <li className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                          没有匹配的参数定义。
                        </li>
                      ) : null}
                    </ul>
                  ) : null}
                  {nextCursor ? (
                    <Button type="button" variant="outline" size="sm" disabled={specSearching}
                      onClick={() => void loadMoreDefinitions()}>
                      加载更多定义
                    </Button>
                  ) : null}

                  {referenceError ? (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                      {referenceError}
                    </p>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {conflict ? (
            <div className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-950" role="alert">
              保存冲突:当前条目已被其他保存更新到修订 #{conflict.currentHeadRevisionNumber}
              (你基于修订 #{conflict.expectedHeadRevisionNumber})。请复制你的改动,刷新条目后重试。
            </div>
          ) : null}
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
              取消
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={pending} aria-busy={pending || undefined}>
              {pending ? "保存中…" : entry ? "保存为新修订" : "创建草稿"}
            </Button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
