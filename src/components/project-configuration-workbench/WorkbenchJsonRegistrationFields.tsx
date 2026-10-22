import { useEffect, useState } from "react";
import type { ParameterCatalogRepository, CatalogDefinitionListResponse, CatalogSubjectListResponse } from "@/application/ports/ParameterCatalogRepository";
import { listAllCanonicalPages } from "@/application/parameter-catalog/listAllCanonicalPages";
import { jsonLeafPaths, type JsonRegistrationSelection } from "@/application/project-configuration/jsonRegistration";
import type { ParameterFileRepository, ProjectParameterFile } from "@/application/ports/ParameterFileRepository";
import { SelectControl, type SelectOption } from "@/components/common/SelectControl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";

function SearchPicker({ label, value, options, onChange, disabled }: {
  label: string; value: string | null; options: Array<SelectOption & { search: string }>;
  onChange: (value: string) => void; disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter((option) => option.search.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selected = options.find((option) => option.value === value);
  return <div>
    <Input type="search" aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} />
    <SelectControl ariaLabel={label} value={value === null ? "" : `choice:${value}`} disabled={disabled} placeholder={`选择${label}`} onValueChange={(next) => onChange(next.slice(7))}
      options={[...(selected && !filtered.includes(selected) ? [{ ...selected, hidden: true }] : []), ...filtered].map((item) => ({ ...item, value: `choice:${item.value}` }))} />
    {search && !filtered.length ? <p role="status">没有匹配项。</p> : null}
  </div>;
}

export function WorkbenchJsonRegistrationFields({ projectId, file, existingFile, catalog, files, value, onChange }: {
  projectId: string; file: File | null; existingFile?: ProjectParameterFile;
  catalog?: Pick<ParameterCatalogRepository, "listSubjects" | "listSubjectDefinitions">;
  files?: Pick<ParameterFileRepository, "downloadVersion">;
  value: JsonRegistrationSelection; onChange: (value: JsonRegistrationSelection) => void;
}) {
  const [specs, setSpecs] = useState<CatalogSubjectListResponse["items"]>([]);
  const [definitions, setDefinitions] = useState<CatalogDefinitionListResponse["items"]>([]);
  const [paths, setPaths] = useState<ReturnType<typeof jsonLeafPaths>>([]);
  const [specError, setSpecError] = useState(""), [definitionError, setDefinitionError] = useState(""), [pathError, setPathError] = useState("");
  const [specLoading, setSpecLoading] = useState(true), [definitionLoading, setDefinitionLoading] = useState(false), [pathLoading, setPathLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const spec = specs.find((item) => item.canonicalName === value.configurationSchemaId);
  useEffect(() => {
    let cancelled = false;
    setSpecLoading(true); setSpecError("");
    void (async () => {
      if (!catalog) throw new Error("配置规范读取服务不可用。");
      const items = await listAllCanonicalPages((query) => catalog.listSubjects(query), { registration: "active", subjectLifecycle: "active" });
      if (!cancelled) setSpecs(items.filter((item) => item.type === "configuration-schema" && item.registration.status === "active" && item.membership.status === "active"));
    })().catch((error) => { if (!cancelled) setSpecError(presentError(error, "无法加载配置规范。")); })
      .finally(() => { if (!cancelled) setSpecLoading(false); });
    return () => { cancelled = true; };
  }, [catalog, retry]);
  useEffect(() => {
    let cancelled = false;
    setDefinitions([]); setDefinitionError("");
    if (!spec || !catalog) { setDefinitionLoading(false); return; }
    setDefinitionLoading(true);
    void listAllCanonicalPages((query) => catalog.listSubjectDefinitions(spec.id, query), { catalogReleaseId: spec.membership.catalogReleaseId, lifecycle: "active" })
      .then((items) => { if (!cancelled) setDefinitions(items.filter((item) => item.subject.id === spec.id && item.lifecycle === "active")); })
      .catch((error) => { if (!cancelled) setDefinitionError(presentError(error, "无法加载参数定义，可手动填写映射。")); })
      .finally(() => { if (!cancelled) setDefinitionLoading(false); });
    return () => { cancelled = true; };
  }, [catalog, spec, retry]);
  useEffect(() => {
    let cancelled = false;
    setPaths([]); setPathError(""); setPathLoading(true);
    void (async () => {
      let text: string;
      if (file) text = await file.text();
      else {
        if (!files || !existingFile?.currentVersionId) throw new Error("文件当前版本不可用，请重新选择文件。");
        const result = await files.downloadVersion(projectId, existingFile.id, existingFile.currentVersionId);
        text = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
      }
      const items = jsonLeafPaths(text);
      if (!cancelled) setPaths(items);
    })().catch((error) => { if (!cancelled) setPathError(presentError(error, "无法读取 JSON 字段，请检查文件。")); })
      .finally(() => { if (!cancelled) setPathLoading(false); });
    return () => { cancelled = true; };
  }, [existingFile?.id, existingFile?.currentVersionId, file, files, projectId, retry]);
  const updateRow = (index: number, patch: Partial<JsonRegistrationSelection["mappings"][number]>) => onChange({ ...value,
    fallbackMappings: undefined, mappings: value.mappings.map((row, i) => i === index ? { ...row, ...patch } : row) });
  return <div className="workbench-member-addition-dialog__registration">
    <SelectControl ariaLabel="配置规范" value={value.configurationSchemaId} disabled={specLoading} placeholder="选择配置规范"
      options={[{ value: "", label: "不登记参数" }, ...specs.map((item) => ({ value: item.canonicalName, label: item.canonicalName }))]}
      onValueChange={(configurationSchemaId) => onChange({ configurationSchemaId, mappings: configurationSchemaId ? [{ definitionId: "", pointer: null }] : [] })} />
    {specLoading ? <p role="status">正在加载配置规范…</p> : specError ? <p role="alert">{specError}</p> : !specs.length ? <p role="status">当前组织没有可用的配置规范。</p> : null}
    {value.configurationSchemaId ? <>
      {definitionLoading || pathLoading ? <p role="status">正在加载参数定义与 JSON 字段…</p> : null}
      {pathError ? <p role="alert">{pathError}</p> : null}
      {definitionError ? <><p role="alert">{definitionError}</p><label>字段映射<Textarea aria-label="字段映射" placeholder="参数定义 ID = /字段路径" rows={3}
        value={value.fallbackMappings ?? value.mappings.filter((row) => row.definitionId && row.pointer !== null).map((row) => `${row.definitionId} = ${row.pointer}`).join("\n")}
        onChange={(event) => onChange({ ...value, fallbackMappings: event.target.value })} /></label></> : <>
        {!definitionLoading && !definitions.length ? <p role="status">该配置规范没有可登记的参数定义。</p> : null}
        {value.mappings.map((row, index) => <fieldset key={index}><legend>字段映射 {index + 1}</legend>
          <div className="workbench-member-addition-dialog__columns">
            <SearchPicker label={`参数定义 ${index + 1}`} value={row.definitionId} disabled={definitionLoading} onChange={(definitionId) => updateRow(index, { definitionId })}
              options={definitions.map((item) => ({ value: item.id, label: item.currentRevision.displayName ? `${item.currentRevision.displayName}（${item.propertyKey}）` : item.propertyKey,
                search: `${item.currentRevision.displayName} ${item.propertyKey}`, disabled: value.mappings.some((other, i) => i !== index && other.definitionId === item.id) }))} />
            <SearchPicker label={`JSON 字段 ${index + 1}`} value={row.pointer} disabled={pathLoading || Boolean(pathError)} onChange={(pointer) => updateRow(index, { pointer })}
              options={paths.map((item) => ({ value: item.pointer, label: `${item.pointer || "（根值）"}：${item.preview}`, search: `${item.pointer} ${item.preview}` }))} />
          </div>
          <Button type="button" variant="ghost" onClick={() => onChange({ ...value, mappings: value.mappings.filter((_, i) => i !== index) })}>移除映射 {index + 1}</Button>
        </fieldset>)}
        <Button type="button" variant="outline" disabled={definitionLoading || !definitions.length} onClick={() => onChange({ ...value, mappings: [...value.mappings, { definitionId: "", pointer: null }] })}>添加字段映射</Button>
      </>}
    </> : null}
    {specError || definitionError || pathError ? <Button type="button" variant="outline" onClick={() => setRetry((current) => current + 1)}>重新加载选项</Button> : null}
  </div>;
}
