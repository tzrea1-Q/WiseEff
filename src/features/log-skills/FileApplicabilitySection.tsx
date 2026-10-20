import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { logSkillSpecSchema } from "@wiseeff/dto-schemas";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/admin/DataTable";
import { compileFileGlob, compileSkillFiles, MAX_SKILL_FILE_GLOBS, MAX_FILE_GLOB_LENGTH, MAX_FILE_ROLE_LENGTH } from "@/domain/logs/fileApplicability";
import type { SkillSample, SkillSpec } from "./types";

export function FileApplicabilitySection({ spec, onChange, disabled, sample }: {
  spec: SkillSpec; onChange: (spec: SkillSpec) => void; disabled: boolean; sample: SkillSample | null;
}) {
  const id = useId();
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const files = spec.files ?? [];
  const validation = logSkillSpecSchema.safeParse(spec);
  const issues = validation.success ? [] : validation.error.issues.filter((issue) => issue.path[0] === "files");
  const update = (next: NonNullable<SkillSpec["files"]>) => onChange({ ...spec, files: next });
  const updateRole = (index: number, role: string) => update(files.map((file, i) => i === index ? { glob: file.glob, ...(role ? { role } : {}) } : file));
  const move = (index: number, offset: number) => {
    const next = [...files];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next);
  };
  const inventory = sample?.files ?? (sample ? [{ path: sample.fileName, status: "analyzed" }] : []);
  const assign = issues.length ? null : compileSkillFiles(files);
  const patterns = issues.length ? [] : files.map(({ glob }) => compileFileGlob(glob));
  const previewFiles = issues.length ? [] : inventory.map((file) => ({ ...file, ...assign!(file.path), ruleIndex: patterns.findIndex((pattern) => pattern.test(file.path)) }));
  return <section className="skill-section" aria-label="适用文件">
    <p>按日志包内的相对路径区分大小写匹配，支持 *、**、? 和字符组。角色取第一条匹配规则；留空列表表示适用全部文件。</p>
    {files.map((file, index) => <div key={index} className="skill-file-glob-row">
      <label className="skill-file-glob-input">通配模式<Input aria-label={`通配模式 ${index + 1}`} value={file.glob} placeholder="charger/**" maxLength={MAX_FILE_GLOB_LENGTH} disabled={disabled}
        aria-invalid={issues.some((issue) => issue.path[1] === index && issue.path[2] === "glob")} aria-describedby={issues.length ? `${id}-errors` : undefined}
        onChange={(event) => update(files.map((item, i) => i === index ? { ...item, glob: event.target.value } : item))} /></label>
      <label className="skill-file-role-input">文件角色（可选）<Input aria-label={`文件角色 ${index + 1}`} value={file.role ?? ""} placeholder="可选角色" maxLength={MAX_FILE_ROLE_LENGTH} disabled={disabled}
        aria-invalid={issues.some((issue) => issue.path[1] === index && issue.path[2] === "role")} aria-describedby={issues.length ? `${id}-errors` : undefined}
        onChange={(event) => updateRole(index, event.target.value)} /></label>
      <div className="skill-rule-actions">
        <Button variant="ghost" size="icon-sm" disabled={disabled || index === 0} aria-label={`上移文件规则 ${index + 1}`} title="上移" onClick={() => move(index, -1)}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-sm" disabled={disabled || index === files.length - 1} aria-label={`下移文件规则 ${index + 1}`} title="下移" onClick={() => move(index, 1)}><ArrowDown /></Button>
        <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`删除文件规则 ${index + 1}`} title="删除" onClick={() => setDeleteIndex(index)}><Trash2 /></Button>
      </div>
      <div className="skill-file-role-suggestions" role="group" aria-label={`文件规则 ${index + 1} 的建议角色`}><span>建议角色</span>
        {["主日志", "内核", "充电", "配置"].map((role) => <Button key={role} variant="outline" size="xs" disabled={disabled} aria-pressed={file.role === role}
          aria-label={`文件规则 ${index + 1} 使用角色${role}`} onClick={() => updateRole(index, role)}>{role}</Button>)}
      </div>
    </div>)}
    <Button className="skill-rule-add" variant="outline" disabled={disabled || files.length >= MAX_SKILL_FILE_GLOBS} onClick={() => update([...files, { glob: "" }])}>添加文件规则</Button>
    {issues.length ? <p id={`${id}-errors`} role="alert" className="skill-rule-error">{issues.map((issue) => typeof issue.path[1] === "number"
      ? `第 ${issue.path[1] + 1} 条文件规则的${issue.path[2] === "role" ? "文件角色" : "通配模式"}无效，请检查输入。` : "文件规则无效，请检查规则数量和输入内容。").join("；")}</p> : null}
    <section aria-label="适用文件预览" aria-live="polite"><h3>样例文件匹配预览</h3>
      {!sample ? <p>请在右侧上传样例日志或日志包，查看每个文件的匹配状态和角色。</p> : issues.length ? <p>请先修正文件规则，再查看匹配预览。</p>
        : !previewFiles.length ? <p>样例中暂无可预览的文件。</p> : <DataTable fluid ariaLabel="样例文件匹配结果" tableClassName="table-fixed" rows={previewFiles} rowKey={(file) => file.path} columns={[
          { key: "path", header: "路径", className: "whitespace-normal break-all", render: (file) => file.path },
          { key: "match", header: "匹配状态", className: "whitespace-normal", render: (file) => <span title={file.ruleIndex >= 0 ? `匹配规则 ${file.ruleIndex + 1}：${files[file.ruleIndex].glob}` : undefined}>
            {file.skillMatched ? "已匹配" : "未匹配 · 仅通用分析"}{file.role ? <> · <Badge variant="outline">{file.role}</Badge></> : null}{file.status === "skipped" ? " · 已跳过" : ""}</span> }
        ]} />}
    </section>
    <ConfirmDialog open={deleteIndex !== null} title="删除文件规则" description="删除后将重新匹配样例文件与角色；保存草稿后生效。" tone="danger" confirmLabel="删除规则"
      onCancel={() => setDeleteIndex(null)} onConfirm={() => { update(files.filter((_, index) => index !== deleteIndex)); setDeleteIndex(null); }} />
  </section>;
}
