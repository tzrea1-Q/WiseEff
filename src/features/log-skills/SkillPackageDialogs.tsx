import { useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { AnalysisSkill, SkillAuthoringRepository, SkillWorkspaceRepository } from "./types";
import "./skill-workspace.css";

function packageErrors(cause: unknown): string[] {
  if (cause instanceof WiseEffApiError) {
    if (Array.isArray(cause.details.problems)) return cause.details.problems.filter((problem): problem is string => typeof problem === "string");
    if (Array.isArray(cause.details.issues)) return cause.details.issues.flatMap((issue: unknown) => {
      if (!issue || typeof issue !== "object") return [];
      const { path, message } = issue as { path?: unknown; message?: unknown };
      return [`${Array.isArray(path) ? path.join(".") : typeof path === "string" ? path : ""}: ${typeof message === "string" ? message : "内容无效"}`];
    });
    if (cause.code === "CONFLICT") return ["已存在同名技能，请修改包内 SKILL.md 的名称后重试。"];
    return [cause.message];
  }
  return ["导入技能包失败，请重试。"];
}

export function ImportSkillPackageDialog({ repository, onDismiss, onNavigate, onImported }: {
  repository: Partial<SkillAuthoringRepository>; onDismiss: () => void; onNavigate: (path: string) => void; onImported: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<AnalysisSkill>();
  const fileRef = useRef<HTMLInputElement>(null);
  return <ModalDialog open describedBy onDismiss={pending ? undefined : onDismiss} initialFocusRef={fileRef} className="skill-authoring-dialog modal-card--md">
    {({ titleId, descriptionId }) => <form noValidate onSubmit={(event) => {
      event.preventDefault();
      if (!file || pending || !repository.importSkillPackage) return;
      setPending(true); setErrors([]);
      void repository.importSkillPackage(file, status).then((skill) => { setCreated(skill); onImported(); })
        .catch((cause: unknown) => setErrors(packageErrors(cause))).finally(() => setPending(false));
    }}>
      <h2 id={titleId}>导入技能包</h2>
      <p id={descriptionId}>选择技能 ZIP 包。校验通过后创建技能；包内知识条目始终作为草稿导入并链接到技能。源码快照请在导入后单独上传。</p>
      {created ? <div role="status"><p>技能包校验通过，已导入「{created.name}」。</p>
        <Button asChild variant="link"><a href={`/log-admin/skills/${encodeURIComponent(created.id)}`} onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(event.currentTarget.getAttribute("href")!); onDismiss(); }
        }}>打开技能工作区</a></Button></div> : <>
        <div className="grid gap-2"><Label htmlFor="skill-package-file">技能包 ZIP</Label>
          <Input id="skill-package-file" ref={fileRef} type="file" accept=".zip,application/zip" required disabled={pending} aria-invalid={errors.length > 0 || undefined}
            aria-describedby={errors.length ? "skill-package-errors" : undefined} onChange={(event) => { setFile(event.target.files?.[0]); setErrors([]); }} /></div>
        <div className="grid gap-2"><Label htmlFor="skill-package-status">导入后的技能版本</Label>
          <SelectControl id="skill-package-status" ariaLabel="导入后的技能版本" value={status} disabled={pending}
            onValueChange={(value) => setStatus(value as "draft" | "published")} options={[{ value: "draft", label: "草稿（默认）" }, { value: "published", label: "发布" }]} /></div>
        {errors.length ? <div id="skill-package-errors" role="alert"><p>技能包校验或导入失败，请检查后重试。</p><ul className="break-words">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div> : null}
      </>}
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={pending} onClick={onDismiss}>{created ? "关闭" : "取消"}</Button>
        {!created ? <Button type="submit" disabled={!file || pending || !repository.importSkillPackage} aria-busy={pending}>{pending ? "校验并导入中…" : "校验并导入"}</Button> : null}</div>
    </form>}
  </ModalDialog>;
}

export function ExportSkillPackageDialog({ skill, dirty, repository, onDismiss }: {
  skill: AnalysisSkill; dirty: boolean; repository: Partial<SkillWorkspaceRepository>; onDismiss: () => void;
}) {
  const published = skill.currentRevision.status === "published";
  const [revision, setRevision] = useState<"published" | "draft">(published ? "published" : "draft");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const revisionRef = useRef<HTMLButtonElement>(null);
  return <ModalDialog open describedBy initialFocusRef={revisionRef} onDismiss={pending ? undefined : onDismiss} className="skill-authoring-dialog modal-card--md">
    {({ titleId, descriptionId }) => <><h2 id={titleId}>导出技能包</h2>
      <p id={descriptionId}>导出诊断流程、解析与信号规则、解析测试、关联知识和分析用例。源码快照需单独上传。</p>
      <div className="grid gap-2"><Label htmlFor="skill-package-revision">导出版本</Label><SelectControl id="skill-package-revision" ref={revisionRef} ariaLabel="导出版本" value={revision} disabled={pending}
        onValueChange={(value) => setRevision(value as "published" | "draft")} options={[{ value: "published", label: "当前发布版本（默认）", disabled: !published }, { value: "draft", label: "已保存草稿", disabled: !skill.draft }]} /></div>
      {dirty ? <p>未保存的更改不会导出；如需包含这些更改，请先保存草稿。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions"><Button variant="outline" disabled={pending} onClick={onDismiss}>取消</Button><Button disabled={pending || !repository.exportSkillPackage} aria-busy={pending} onClick={() => {
        setPending(true); setError("");
        void repository.exportSkillPackage!(skill.id, revision).then((blob) => {
          const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
          anchor.href = url; anchor.download = `skill-${skill.id}-${revision}.zip`; anchor.click(); URL.revokeObjectURL(url); onDismiss();
        }).catch(() => setError("导出技能包失败，请重试。")).finally(() => setPending(false));
      }}>{pending ? "导出中…" : "下载技能包"}</Button></div>
    </>}
  </ModalDialog>;
}
