import { useId, useState } from "react";
import type { DtsValueType } from "@/application/ports/DtsStructuredRepository";
import { shouldShowFieldError } from "@/components/common/fieldValidation";
import { Textarea } from "@/components/ui/textarea";
import { formatStringList, validateDtsValue } from "@/domain/dts/dtsValueClient";
import { validateDtsValueAgainstSchema } from "@/domain/dts/dtsValueSchema";
import { RELOAD_DELETE_PROPERTY_TOKEN } from "@/domain/dtsReload/valueShape";
import type { StructuredEditorState } from "@/domain/dts/structuredEditorState";

export type StructuredValueChange = {
  rawText: string;
  valueType: DtsValueType;
  normalizedValue: string;
  valid: boolean;
  error?: string;
  present?: boolean;
  editorState?: StructuredEditorState;
};

export type StructuredValueEditorProps = {
  propertyName: string;
  valueType: DtsValueType;
  rawText: string;
  onChange: (next: StructuredValueChange) => void;
  disabled?: boolean;
  showErrors?: boolean;
  id?: string;
  present?: boolean;
  editorState?: StructuredEditorState;
  valueSchema?: unknown;
};

export function StructuredValueEditor(props: StructuredValueEditorProps) {
  return <RawValueEditor key={props.propertyName} {...props} />;
}

function RawValueEditor({
  propertyName, valueType, rawText, onChange, disabled = false,
  showErrors = false, id, present, editorState, valueSchema
}: StructuredValueEditorProps) {
  const reactId = useId();
  const baseId = id ?? `dts-value-${reactId}`;
  const [touched, setTouched] = useState(false);
  // Preserve input from the retired typed editor until the user edits or discards it.
  const text = editorState?.kind === "string-input"
    ? formatStringList(editorState.text.split(/\r\n|\r|\n/))
    : editorState?.kind === "numeric-input" ? editorState.text
      : present === false ? RELOAD_DELETE_PROPERTY_TOKEN : rawText;
  const validation = validateDtsValue(rawText, propertyName);
  const error = editorState ? "已恢复旧版未确认输入，请核对原文后编辑或撤销。"
    : present === false ? undefined
      : validation.error ?? (validation.valid ? validateDtsValueAgainstSchema(propertyName, rawText, valueSchema) : undefined);
  const show = shouldShowFieldError(error, { touched, submitted: showErrors });
  const errorId = `${baseId}-error`;

  return <div className="structured-value-editor">
    <label className="structured-value-mixed" htmlFor={baseId}>
      <span>DTS 原文</span>
      <Textarea id={baseId} className="parameter-admin-code-editor" aria-label="DTS 原文"
        value={text} rows={12} spellCheck={false} disabled={disabled}
        aria-invalid={show || undefined} aria-describedby={`${baseId}-help${show ? ` ${errorId}` : ""}`}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          const next = event.target.value;
          const deleting = next.trim() === RELOAD_DELETE_PROPERTY_TOKEN;
          const raw = deleting ? "" : next;
          const result = validateDtsValue(raw, propertyName);
          const schemaError = !deleting && result.valid ? validateDtsValueAgainstSchema(propertyName, raw, valueSchema) : undefined;
          onChange({ rawText: raw, valueType: deleting ? valueType : result.valueType,
            normalizedValue: result.normalizedValue, present: !deleting,
            valid: deleting || (result.valid && !schemaError), error: deleting ? undefined : result.error ?? schemaError });
        }} />
    </label>
    <p className="muted" id={`${baseId}-help`}>填写属性右侧的 DTS 原文。布尔或空属性留空；删除属性填写 /delete-property/。</p>
    {show ? <p className="field-error" id={errorId} role="status">{error}</p> : null}
  </div>;
}
