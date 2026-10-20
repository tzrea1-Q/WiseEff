import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { AnalysisSkill, SkillAuthoringRepository, SkillWorkspaceRepository } from "./types";
import "./skill-workspace.css";

type PackageIssue = { path: string; message: string };
function packageErrors(cause: unknown): PackageIssue[] {
  if (cause instanceof WiseEffApiError) {
    if (Array.isArray(cause.details.issues)) return cause.details.issues.flatMap((issue: unknown) => {
      if (!issue || typeof issue !== "object") return [];
      const { path, message } = issue as { path?: unknown; message?: unknown };
      return [{ path: Array.isArray(path) ? path.join(".") : typeof path === "string" ? path : "", message: typeof message === "string" ? message : "内容无效" }];
    });
    if (Array.isArray(cause.details.problems)) return cause.details.problems.flatMap((problem: unknown) => {
      if (typeof problem !== "string") return [];
      const separator = problem.lastIndexOf(": ");
      return [{ path: separator < 0 ? "" : problem.slice(0, separator), message: separator < 0 ? problem : problem.slice(separator + 2) }];
    });
    return [{ path: "", message: cause.message }];
  }
  return [{ path: "", message: "导入技能包失败，请重试。" }];
}

export function ImportSkillPackageDialog({ repository, onDismiss, onNavigate, onImported }: {
  repository: Partial<SkillAuthoringRepository>; onDismiss: () => void; onNavigate: (path: string) => void; onImported: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [name, setName] = useState("");
  const [packageName, setPackageName] = useState("");
  const [nameError, setNameError] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [errors, setErrors] = useState<PackageIssue[]>([]);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<AnalysisSkill>();
  const fileRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (nameError && !pending) nameRef.current?.focus(); }, [nameError, pending]);
  return <ModalDialog open describedBy onDismiss={pending ? undefined : onDismiss} initialFocusRef={fileRef} className="skill-authoring-dialog modal-card--md">
    {({ titleId, descriptionId }) => <form className="skill-package-dialog-content" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (!file || pending || !repository.importSkillPackage) return;
      setPending(true); setErrors([]); setNameError("");
      void repository.importSkillPackage(file, status, name.trim() || undefined).then((skill) => { setCreated(skill); onImported(); })
        .catch((cause: unknown) => {
          if (cause instanceof WiseEffApiError) {
            if (typeof cause.details.packageName === "string") setPackageName(cause.details.packageName);
            const fieldErrors = cause.details.fieldErrors as { name?: string | string[] } | undefined;
            if (fieldErrors?.name) {
              setNameError(Array.isArray(fieldErrors.name) ? fieldErrors.name.join("；") : fieldErrors.name);
              if (typeof cause.details.nameSuggestion === "string") setName(cause.details.nameSuggestion);
              return;
            }
          }
          setErrors(packageErrors(cause));
        }).finally(() => setPending(false));
    }}>
      <h2 id={titleId}>导入技能包</h2>
      <p id={descriptionId} className="skill-package-intro">选择技能 ZIP 包。校验通过后创建技能；包内知识条目始终作为草稿导入并链接到技能。源码快照请在导入后单独上传。</p>
      {created ? <div role="status"><p>技能包校验通过，已导入「{created.name}」。</p>
        <Button asChild variant="link"><a href={`/log-admin/skills/${encodeURIComponent(created.id)}`} onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onNavigate(event.currentTarget.getAttribute("href")!); onDismiss(); }
        }}>打开技能工作区</a></Button></div> : <>
        <div className="grid gap-2"><Label htmlFor="skill-package-file">技能包 ZIP</Label>
          <Input id="skill-package-file" ref={fileRef} type="file" accept=".zip,application/zip" required disabled={pending} aria-invalid={errors.length > 0 || undefined}
            aria-describedby={errors.length ? "skill-package-errors" : undefined} onChange={(event) => { setFile(event.target.files?.[0]); setErrors([]); setNameError(""); setPackageName(""); }} /></div>
        <div className="grid gap-2"><Label htmlFor="skill-package-name">技能名称</Label>
          <Input id="skill-package-name" ref={nameRef} value={name} maxLength={120} disabled={pending} placeholder={packageName || "默认使用包内名称"}
            aria-invalid={!!nameError} aria-describedby={nameError ? "skill-package-name-error" : undefined} onChange={(event) => { setName(event.target.value); setNameError(""); }} />
          {nameError ? <p id="skill-package-name-error" role="alert" className="skill-package-error">{nameError}</p> : null}</div>
        <div className="grid gap-2"><Label htmlFor="skill-package-status">导入后的技能版本</Label>
          <SelectControl id="skill-package-status" ariaLabel="导入后的技能版本" value={status} disabled={pending}
            onValueChange={(value) => setStatus(value as "draft" | "published")} options={[{ value: "draft", label: "草稿（默认）" }, { value: "published", label: "发布" }]} /></div>
        {errors.length ? <div id="skill-package-errors" role="alert" className="skill-package-error"><p>技能包校验或导入失败，请检查后重试。</p><ul className="grid gap-2 break-words">{errors.map((error, index) => <li key={index} className="flex flex-wrap items-baseline gap-x-2">{error.path ? <span className="min-w-0 font-mono text-muted-foreground">{error.path}</span> : null}<span>{error.message}</span></li>)}</ul></div> : null}
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
    {({ titleId, descriptionId }) => <div className="skill-package-dialog-content"><h2 id={titleId}>导出技能包</h2>
      <p id={descriptionId} className="skill-package-intro">导出诊断流程、解析与信号规则、解析测试、关联知识和分析用例。源码快照需单独上传。</p>
      <div className="grid gap-2"><Label htmlFor="skill-package-revision">导出版本</Label><SelectControl id="skill-package-revision" ref={revisionRef} ariaLabel="导出版本" value={revision} disabled={pending}
        onValueChange={(value) => setRevision(value as "published" | "draft")} options={[{ value: "published", label: "当前发布版本（默认）", disabled: !published }, { value: "draft", label: "已保存草稿", disabled: !skill.draft }]} /></div>
      {dirty ? <p>未保存的更改不会导出；如需包含这些更改，请先保存草稿。</p> : null}
      {error ? <p role="alert" className="skill-package-error">{error}</p> : null}
      <div className="dialog-actions"><Button variant="outline" disabled={pending} onClick={onDismiss}>取消</Button><Button disabled={pending || !repository.exportSkillPackage} aria-busy={pending} onClick={() => {
        setPending(true); setError("");
        void repository.exportSkillPackage!(skill.id, revision).then((blob) => {
          const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
          anchor.href = url; anchor.download = `skill-${skill.id}-${revision}.zip`; anchor.click(); URL.revokeObjectURL(url); onDismiss();
        }).catch(() => setError("导出技能包失败，请重试。")).finally(() => setPending(false));
      }}>{pending ? "导出中…" : "下载技能包"}</Button></div>
    </div>}
  </ModalDialog>;
}
