import { useRef, useState, type ReactNode, type RefObject } from "react";
import { DropdownMenu } from "radix-ui";
import { Check, ChevronDown, ChevronLeft, Download, FolderOpen, Layers2, Plus } from "lucide-react";
import type { DtsConfigSet } from "@/application/ports/DtsStructuredRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { RowActionMenu } from "@/components/common/RowActionMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { InspectorLevel } from "./workbenchInspectorModel";

export type WorkbenchCommandBarProps = {
  primaryAction?: ReactNode;
  onOpenInspector?: (level: InspectorLevel) => void;
  createConfigSetOpen?: boolean;
  onCreateConfigSetOpenChange?: (open: boolean) => void;
  project: {
    id: string;
    name: string;
    code: string;
    statusLabel: string;
  };
  onLeave: () => void;
  configSets: DtsConfigSet[];
  selectedConfigSet: DtsConfigSet | null;
  configSetsLoading: boolean;
  configSetsError: string;
  onSelectConfigSet: (configSetId: string) => void;
  canAdmin: boolean;
  canSyncFile: boolean;
  onInspectorToggle: () => void;
  candidateFileInputRef: RefObject<HTMLInputElement | null>;
  onCandidateFileChange: (file: File) => void;
  pendingAction: string | null;
  onOpenActivity: () => void;
  onExportConfigSet: () => void;
  onSyncFile: () => void;
  syncLabel: string;
  syncBlocked: boolean;
  /** Returns null on success, a message for field validation errors, or undefined to keep the dialog open. */
  onCreateConfigSet: (name: string) => Promise<string | null | undefined>;
};


export function WorkbenchCommandBar({
  primaryAction, project, onLeave, configSets, selectedConfigSet, configSetsLoading,
  configSetsError, onSelectConfigSet, canAdmin, canSyncFile, onInspectorToggle,
  onOpenInspector, candidateFileInputRef, onCandidateFileChange,
  pendingAction, onOpenActivity, onExportConfigSet,
  onCreateConfigSet, onSyncFile, syncLabel, syncBlocked,
  createConfigSetOpen: controlledCreateOpen, onCreateConfigSetOpenChange
}: WorkbenchCommandBarProps) {
  const [localCreateOpen, setLocalCreateOpen] = useState(false);
  const createOpen = controlledCreateOpen ?? localCreateOpen;
  const setCreateOpen = (open: boolean) => {
    setLocalCreateOpen(open);
    onCreateConfigSetOpenChange?.(open);
  };
  const nameRef = useRef<HTMLInputElement | null>(null);
  const schemeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const creating = pendingAction === "create-config-set";
  const openDetails = (level: InspectorLevel) => onOpenInspector ? onOpenInspector(level) : onInspectorToggle();
  return <>
    <header className="configuration-workbench__command" aria-label="配置命令栏">
      <Button type="button" variant="ghost" size="sm" onClick={onLeave}><ChevronLeft aria-hidden="true" />项目清单</Button>
      <strong className="configuration-workbench__project" title={project.name}>{project.name}</strong>
      <div className="configuration-workbench__config-select">
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <Button ref={schemeTriggerRef} type="button" size="sm" variant="ghost" aria-label="配置"
              title={`配置：${selectedConfigSet?.name === "default" ? "默认配置" : selectedConfigSet?.name ?? "选择或新建"}`}
              aria-busy={pendingAction === "export-config-set"}
              data-value={selectedConfigSet?.id ?? ""} disabled={configSetsLoading || Boolean(configSetsError) || (!canAdmin && configSets.length === 0)}>
              <Layers2 className="configuration-workbench__scheme-symbol" aria-hidden="true" />
              <span className="configuration-workbench__scheme-name">{configSetsLoading ? "正在加载…"
                : selectedConfigSet ? selectedConfigSet.name === "default" ? "默认配置" : selectedConfigSet.name
                  : canAdmin ? "选择或新建" : "暂无配置"}</span><ChevronDown className="size-3" aria-hidden="true" />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="row-action-menu__content configuration-workbench__scheme-menu" align="start"
              onCloseAutoFocus={(event) => { if (createOpen) event.preventDefault(); }}>
              {configSets.length > 0 ? <DropdownMenu.RadioGroup value={selectedConfigSet?.id ?? ""}
                aria-label="切换配置" onValueChange={(value) => { if (value !== selectedConfigSet?.id) onSelectConfigSet(value); }}>
                {configSets.map((item) => <DropdownMenu.RadioItem key={item.id} value={item.id} data-value={item.id}
                  disabled={pendingAction !== null}
                  className="row-action-menu__item button-size-sm" title={item.name === "default" ? "默认配置" : item.name}>
                  <span className="configuration-workbench__scheme-name">{item.name === "default" ? "默认配置" : item.name}</span>
                  <span className="configuration-workbench__scheme-mark" aria-hidden="true"><DropdownMenu.ItemIndicator><Check /></DropdownMenu.ItemIndicator></span>
                </DropdownMenu.RadioItem>)}
              </DropdownMenu.RadioGroup> : null}
              {configSets.length > 0 && (canAdmin || selectedConfigSet) ? <DropdownMenu.Separator className="configuration-workbench__scheme-separator" /> : null}
              {canAdmin ? <DropdownMenu.Item className="row-action-menu__item button-size-sm"
                disabled={pendingAction !== null}
                onSelect={() => { schemeTriggerRef.current?.focus(); setNameError(""); setCreateOpen(true); }}><Plus aria-hidden="true" />新建配置…</DropdownMenu.Item> : null}
              {selectedConfigSet ? <DropdownMenu.Item className="row-action-menu__item button-size-sm"
                onSelect={() => { schemeTriggerRef.current?.focus(); openDetails("config-set"); }}><FolderOpen aria-hidden="true" />{canAdmin ? "文件管理" : "查看文件"}</DropdownMenu.Item> : null}
              {canAdmin && selectedConfigSet ? <DropdownMenu.Item className="row-action-menu__item button-size-sm"
                disabled={pendingAction !== null}
                onSelect={onExportConfigSet}><Download aria-hidden="true" />{pendingAction === "export-config-set" ? "正在导出…" : "导出当前配置"}</DropdownMenu.Item> : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="configuration-workbench__command-actions">
        <RowActionMenu label="配置工作台操作" triggerLabel="更多" items={[
          ...(canSyncFile ? [{id:"sync",label:syncLabel,disabled:syncBlocked,onSelect:onSyncFile}] : []),
          {id:"activity",label:"项目活动",onSelect:onOpenActivity}
        ]} />
        {primaryAction}
      </div>
      <input ref={candidateFileInputRef} type="file" accept=".dts,.dtsi,.json,text/plain,application/json" hidden
        aria-hidden="true" onChange={(event)=>{const file=event.target.files?.[0];event.target.value="";if(file)onCandidateFileChange(file);}} />
    </header>
    <ModalDialog open={createOpen} onDismiss={creating ? undefined : ()=>setCreateOpen(false)}
      className="submission-dialog configuration-workbench__create-config-dialog"
      backdropClassName="param-admin-modal-backdrop" describedBy initialFocusRef={nameRef}>
      {({titleId,descriptionId})=><>
        <div className="submission-dialog-head"><div><h2 id={titleId}>新建配置</h2>
          <p id={descriptionId}>为一组共同使用的配置文件命名，创建后选择文件。</p></div>
          <Button type="button" variant="ghost" size="icon" aria-label="关闭" disabled={creating} onClick={()=>setCreateOpen(false)}>×</Button>
        </div>
        <form className="configuration-workbench__create-config-form" onSubmit={async(event)=>{
          event.preventDefault();
          const result=await onCreateConfigSet(name);
          if(result === null){setName("");setNameError("");setCreateOpen(false);}
          else if(typeof result === "string")setNameError(result);
        }}>
          <label>配置名称<Input ref={nameRef} value={name} aria-invalid={Boolean(nameError)}
            aria-describedby={nameError ? "workbench-config-set-name-error" : undefined}
            onChange={(event)=>{setName(event.target.value);setNameError("");}} placeholder="例如：量产配置" /></label>
          {nameError ? <p className="field-error" id="workbench-config-set-name-error" role="alert">{nameError}</p> : null}
          <div className="dialog-actions"><Button type="button" variant="outline" disabled={creating} onClick={()=>setCreateOpen(false)}>取消</Button>
            <Button type="submit" disabled={pendingAction !== null}>{creating ? "创建中…" : "创建配置"}</Button></div>
        </form>
      </>}
    </ModalDialog>
  </>;
}
