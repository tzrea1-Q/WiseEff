import { useId, useMemo, useState } from "react";
import { parseDocument, stringify } from "yaml";
import { parsingSpecSchema, logSkillSpecSchema } from "@wiseeff/dto-schemas";
import { matchSkillFile } from "@/domain/logs/fileApplicability";
import { Textarea } from "@/components/ui/textarea";
import { ViewSwitch } from "@/components/ui/view-switch";
import { TabPanel } from "@/components/ui/tab-panel";
import { ExtractorBuilder } from "./ExtractorBuilder";
import { FormatProfileForm } from "./FormatProfileForm";
import { FileApplicabilitySection } from "./FileApplicabilitySection";
import type { SkillWorkspaceRepository, SkillSample, SkillSpec } from "./types";

export function parseParsingYaml(text: string): { value?: unknown; error?: string } {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) return { error: document.errors.map((error) => `第 ${error.linePos?.[0].line ?? 1} 行：代码格式无效，请检查缩进与符号。`).join("\n") };
  try { return { value: document.toJS({ maxAliasCount: 0 }) }; }
  catch { return { error: "第 1 行：代码包含不支持的引用，请展开后重试。" }; }
}

export function boundedSamplePreview(content: string) {
  const bytes = new TextEncoder().encode(content);
  if (bytes.length <= 1024 * 1024) return { content, truncated: false };
  const prefix = new TextDecoder().decode(bytes.subarray(0, 1024 * 1024));
  return { content: prefix.slice(0, Math.max(0, prefix.lastIndexOf("\n"))), truncated: true };
}

export function ParsingSection({ skillId, yaml, onChange, disabled, repository, sample, files, onFilesChange, selectedLine, onLineSelect, profile, onProfileChange, onProfileValidityChange }: {
  skillId: string; yaml: string; onChange: (text: string) => void; disabled: boolean; repository?: Partial<SkillWorkspaceRepository>;
  sample?: SkillSample | null; files?: SkillSpec["files"]; onFilesChange?: (files: SkillSpec["files"]) => void;
  selectedLine?: number | null; onLineSelect?: (line: number) => void;
  profile?: SkillSpec["formatProfile"]; onProfileChange?: (profile: SkillSpec["formatProfile"]) => void; onProfileValidityChange?: (valid: boolean) => void;
}) {
  const id = useId();
  const [view, setView] = useState("form");
  const [section, setSection] = useState("files");
  const parsed = parseParsingYaml(yaml);
  const previewPath = sample?.contentFilePath ?? sample?.fileName ?? "";
  const filesValid = logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", files }).success;
  const skillMatched = filesValid && !!sample && matchSkillFile(files, previewPath).skillMatched;
  const validation = parsingSpecSchema.safeParse(parsed.value);
  const storedPreview = useMemo(() => boundedSamplePreview(sample?.content ?? ""), [sample]);
  return <section className="skill-section skill-parsing" aria-label="样例与解析"><h2>样例与解析</h2>
    <div className="skill-parsing-toolbar"><ViewSwitch variant="tabs" ariaLabel="解析配置" value={section} onValueChange={(value) => { setSection(value); setView("form"); }} items={[
      { value: "files", label: "适用文件", id: `${id}-files`, panelId: `${id}-files-panel` },
      { value: "format", label: "基础格式", id: `${id}-format`, panelId: `${id}-format-panel` },
      { value: "extractors", label: "抽取规则", id: `${id}-extractors`, panelId: `${id}-extractors-panel` }
    ]} /><ViewSwitch variant="tabs" ariaLabel="解析视图" value={view} onValueChange={setView} items={[
      { value: "form", label: "表单", id: `${id}-form`, panelId: `${id}-form-panel` },
      { value: "code", label: "代码视图", id: `${id}-code`, panelId: `${id}-code-panel` }
    ]} /></div>
    <TabPanel id={`${id}-${view}-panel`} aria-labelledby={`${id}-${view}`}>
      <TabPanel id={`${id}-files-panel`} aria-labelledby={`${id}-files`} hidden={view !== "form" || section !== "files"}>
        <FileApplicabilitySection spec={{ schemaVersion: "skill/v1", files }} onChange={(spec) => onFilesChange?.(spec.files)} disabled={disabled || !onFilesChange} sample={sample ?? null} />
      </TabPanel>
      <TabPanel id={`${id}-format-panel`} aria-labelledby={`${id}-format`} hidden={view === "form" && section !== "format"}>
        {onProfileChange ? <FormatProfileForm skillId={skillId} profile={profile} onChange={onProfileChange} disabled={disabled} repository={repository} sample={sample ?? null}
          view={view === "code" ? "code" : "form"} previewEnabled={skillMatched} onValidityChange={onProfileValidityChange} /> : <p>暂无基础格式配置。</p>}
      </TabPanel>
      <TabPanel id={`${id}-extractors-panel`} aria-labelledby={`${id}-extractors`} hidden={view !== "form" || section !== "extractors"}>
        <ExtractorBuilder skillId={skillId} parsing={validation.success ? validation.data : null} onChange={(value) => onChange(stringify(value))}
          disabled={disabled} repository={repository} sampleText={storedPreview.content} selectedLine={selectedLine} onLineSelect={onLineSelect} timestampPattern={profile?.timestampPattern} />
      </TabPanel>
      <div hidden={view !== "code"}>
        <label htmlFor={`${id}-parsing-yaml`}>代码视图 · YAML</label>
        <div className="skill-yaml-editor">
          <pre aria-hidden="true">{yaml.split("\n").map((_, i) => i + 1).join("\n")}</pre>
          <Textarea id={`${id}-parsing-yaml`} spellCheck={false} wrap="off" disabled={disabled} value={yaml} aria-invalid={!!parsed.error}
            aria-describedby={parsed.error ? `${id}-yaml-error` : undefined} onScroll={(event) => {
              const gutter = event.currentTarget.previousElementSibling; if (gutter) gutter.scrollTop = event.currentTarget.scrollTop;
            }} onChange={(event) => onChange(event.target.value)} />
        </div>
      </div>
    </TabPanel>
    <TabPanel id={`${id}-${view === "form" ? "code" : "form"}-panel`} aria-labelledby={`${id}-${view === "form" ? "code" : "form"}`} hidden />
    {parsed.error ? <p id={`${id}-yaml-error`} role="alert">{parsed.error}</p> : null}
  </section>;
}
