import { useId, useState } from "react";
import type { DtsValueType } from "@/application/ports/DtsStructuredRepository";
import { shouldShowFieldError } from "@/components/common/fieldValidation";
import {
  classifyDtsValue,
  formatBytes,
  formatPhandleList,
  formatStringList,
  formatU32Array,
  parseBytesValue,
  parsePhandleLabels,
  parseStringListValues,
  parseU32Cells,
  validateDtsValue,
} from "@/domain/dts/dtsValueClient";

export type StructuredValueChange = {
  rawText: string;
  valueType: DtsValueType;
  normalizedValue: string;
  valid: boolean;
  error?: string;
};

export type StructuredValueEditorProps = {
  propertyName: string;
  valueType: DtsValueType;
  rawText: string;
  onChange: (next: StructuredValueChange) => void;
  availableLabels?: readonly string[];
  disabled?: boolean;
  showErrors?: boolean;
  id?: string;
};

export function StructuredValueEditor({
  propertyName,
  valueType,
  rawText,
  onChange,
  availableLabels = [],
  disabled = false,
  showErrors = false,
  id,
}: StructuredValueEditorProps) {
  const reactId = useId();
  const baseId = id ?? `dts-value-${reactId}`;
  const [touched, setTouched] = useState(false);
  const classified = classifyDtsValue(rawText, propertyName);
  const previewNormalized =
    valueType === "bool" && rawText.trim() === ""
      ? "true"
      : valueType === "empty" && rawText.trim() === ""
        ? "empty"
        : classified.normalizedValue;

  const emit = (nextRaw: string, override?: Partial<StructuredValueChange>) => {
    const validated = validateDtsValue(nextRaw, propertyName, valueType);
    onChange({
      rawText: nextRaw,
      valueType: override?.valueType ?? validated.valueType,
      normalizedValue: override?.normalizedValue ?? validated.normalizedValue,
      valid: override?.valid ?? validated.valid,
      error: override?.error ?? validated.error,
    });
  };

  return (
    <div className="structured-value-editor" data-value-type={valueType}>
      {valueType === "u32-array" ? (
        <U32ArrayEditor
          baseId={baseId}
          rawText={rawText}
          disabled={disabled}
          showErrors={showErrors}
          touched={touched}
          onTouched={() => setTouched(true)}
          onCellsChange={(cells) => emit(formatU32Array(cells))}
        />
      ) : null}

      {valueType === "bytes" ? (
        <BytesEditor
          baseId={baseId}
          rawText={rawText}
          disabled={disabled}
          showErrors={showErrors}
          touched={touched}
          onTouched={() => setTouched(true)}
          onChangeValue={(width, bytes) => emit(formatBytes(width, bytes))}
        />
      ) : null}

      {valueType === "string-list" ? (
        <StringListEditor
          baseId={baseId}
          rawText={rawText}
          disabled={disabled}
          onChangeValues={(values) => emit(formatStringList(values))}
        />
      ) : null}

      {valueType === "phandle-list" ? (
        <PhandleListEditor
          baseId={baseId}
          rawText={rawText}
          availableLabels={availableLabels}
          disabled={disabled}
          onChangeLabels={(labels) => emit(formatPhandleList(labels))}
        />
      ) : null}

      {valueType === "bool" ? (
        <BoolEditor
          baseId={baseId}
          rawText={rawText}
          disabled={disabled}
          onChangePresent={(present) => {
            if (present) {
              emit("", {
                valueType: "bool",
                normalizedValue: "true",
                valid: true,
              });
              return;
            }
            onChange({
              rawText: "",
              valueType: "bool",
              normalizedValue: "true",
              valid: false,
              error: "布尔属性已关闭（需保留空 RHS 才表示 true）",
            });
          }}
        />
      ) : null}

      {valueType === "empty" ? (
        <p className="structured-value-empty-note" id={`${baseId}-empty`}>
          empty 空属性（只读）— 规范化值为 empty
        </p>
      ) : null}

      {valueType === "mixed" ? (
        <MixedEditor
          baseId={baseId}
          rawText={rawText}
          disabled={disabled}
          showErrors={showErrors}
          touched={touched}
          onTouched={() => setTouched(true)}
          onChangeRaw={(next) => emit(next)}
        />
      ) : null}

      <div
        className="structured-value-normalized-preview"
        aria-label="规范化预览"
        id={`${baseId}-normalized`}
      >
        {previewNormalized}
      </div>
    </div>
  );
}

function U32ArrayEditor({
  baseId,
  rawText,
  disabled,
  showErrors,
  touched,
  onTouched,
  onCellsChange,
}: {
  baseId: string;
  rawText: string;
  disabled: boolean;
  showErrors: boolean;
  touched: boolean;
  onTouched: () => void;
  onCellsChange: (cells: string[]) => void;
}) {
  const cells = (() => {
    const parsed = parseU32Cells(rawText);
    return parsed.length > 0 ? parsed : [""];
  })();

  const updateCell = (index: number, value: string) => {
    const next = cells.map((c, i) => (i === index ? value : c));
    onCellsChange(next);
  };

  return (
    <div className="structured-value-u32-matrix" role="group" aria-label="u32-array cells">
      {cells.map((cell, index) => {
        const cellError = validateCellToken(cell);
        const show = shouldShowFieldError(cellError, { touched, submitted: showErrors });
        return (
          <label key={`${baseId}-cell-${index}`} className="structured-value-cell">
            <span className="sr-only">cell {index + 1}</span>
            <input
              aria-label={`cell ${index + 1}`}
              aria-invalid={show ? "true" : "false"}
              disabled={disabled}
              value={cell}
              onBlur={onTouched}
              onChange={(event) => updateCell(index, event.target.value)}
            />
            {show ? <span className="field-error">{cellError}</span> : null}
          </label>
        );
      })}
      <button
        type="button"
        disabled={disabled}
        aria-label="添加 cell"
        onClick={() => onCellsChange([...cells, "0"])}
      >
        添加 cell
      </button>
    </div>
  );
}

function BytesEditor({
  baseId,
  rawText,
  disabled,
  showErrors,
  touched,
  onTouched,
  onChangeValue,
}: {
  baseId: string;
  rawText: string;
  disabled: boolean;
  showErrors: boolean;
  touched: boolean;
  onTouched: () => void;
  onChangeValue: (width: number, bytes: string[]) => void;
}) {
  const parsed = parseBytesValue(rawText);
  const bytes = parsed.bytes.length > 0 ? parsed.bytes : [""];
  const width = parsed.width || 8;

  return (
    <div className="structured-value-bytes" role="group" aria-label="bytes editor">
      <label>
        位宽
        <input
          type="number"
          aria-label="bits width"
          min={8}
          step={8}
          disabled={disabled}
          value={width}
          onChange={(event) => onChangeValue(Number(event.target.value) || 8, bytes)}
        />
      </label>
      {bytes.map((byte, index) => {
        const cellError = validateCellToken(byte);
        const show = shouldShowFieldError(cellError, { touched, submitted: showErrors });
        return (
          <label key={`${baseId}-byte-${index}`}>
            <span className="sr-only">byte {index + 1}</span>
            <input
              aria-label={`byte ${index + 1}`}
              aria-invalid={show ? "true" : "false"}
              disabled={disabled}
              value={byte}
              onBlur={onTouched}
              onChange={(event) => {
                const next = bytes.map((b, i) => (i === index ? event.target.value : b));
                onChangeValue(width, next);
              }}
            />
            {show ? <span className="field-error">{cellError}</span> : null}
          </label>
        );
      })}
      <button
        type="button"
        disabled={disabled}
        aria-label="添加 byte"
        onClick={() => onChangeValue(width, [...bytes, "0x00"])}
      >
        添加 byte
      </button>
    </div>
  );
}

function StringListEditor({
  baseId,
  rawText,
  disabled,
  onChangeValues,
}: {
  baseId: string;
  rawText: string;
  disabled: boolean;
  onChangeValues: (values: string[]) => void;
}) {
  const values = parseStringListValues(rawText);

  return (
    <div className="structured-value-string-list" role="group" aria-label="string-list">
      {values.map((value, index) => (
        <div key={`${baseId}-str-${index}`} className="structured-value-string-row">
          <input
            aria-label={`字符串 ${index + 1}`}
            disabled={disabled}
            value={value}
            onChange={(event) => {
              const next = values.map((v, i) => (i === index ? event.target.value : v));
              onChangeValues(next);
            }}
          />
          <button
            type="button"
            disabled={disabled || values.length <= 1}
            aria-label={`移除字符串 ${index + 1}`}
            onClick={() => onChangeValues(values.filter((_, i) => i !== index))}
          >
            移除
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled}
        aria-label="添加字符串"
        onClick={() => onChangeValues([...values, ""])}
      >
        添加字符串
      </button>
    </div>
  );
}

function PhandleListEditor({
  baseId,
  rawText,
  availableLabels,
  disabled,
  onChangeLabels,
}: {
  baseId: string;
  rawText: string;
  availableLabels: readonly string[];
  disabled: boolean;
  onChangeLabels: (labels: string[]) => void;
}) {
  const selected = parsePhandleLabels(rawText);
  const labels = Array.from(new Set([...availableLabels, ...selected]));

  const toggle = (label: string) => {
    if (selected.includes(label)) {
      onChangeLabels(selected.filter((item) => item !== label));
      return;
    }
    onChangeLabels([...selected, label]);
  };

  return (
    <div className="structured-value-phandle-list" role="group" aria-label="phandle-list">
      {labels.map((label) => (
        <label key={`${baseId}-ph-${label}`}>
          <input
            type="checkbox"
            aria-label={label}
            disabled={disabled}
            checked={selected.includes(label)}
            onChange={() => toggle(label)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

function BoolEditor({
  baseId,
  rawText,
  disabled,
  onChangePresent,
}: {
  baseId: string;
  rawText: string;
  disabled: boolean;
  onChangePresent: (present: boolean) => void;
}) {
  // Track local present state: starts true when rawText is empty (bool property present).
  const [present, setPresent] = useState(rawText.trim() === "");

  return (
    <label className="structured-value-bool">
      <input
        id={`${baseId}-bool`}
        type="checkbox"
        role="checkbox"
        aria-label="布尔开关"
        disabled={disabled}
        checked={present}
        onChange={(event) => {
          const next = event.target.checked;
          setPresent(next);
          onChangePresent(next);
        }}
      />
      <span>布尔属性（空 RHS = true）</span>
    </label>
  );
}

function MixedEditor({
  baseId,
  rawText,
  disabled,
  showErrors,
  touched,
  onTouched,
  onChangeRaw,
}: {
  baseId: string;
  rawText: string;
  disabled: boolean;
  showErrors: boolean;
  touched: boolean;
  onTouched: () => void;
  onChangeRaw: (raw: string) => void;
}) {
  const validated = validateDtsValue(rawText, "mixed_prop", "mixed");
  const show = shouldShowFieldError(validated.error, { touched, submitted: showErrors });

  return (
    <label className="structured-value-mixed">
      <span className="sr-only">mixed 原始值</span>
      <textarea
        id={`${baseId}-mixed`}
        className="parameter-admin-code-editor"
        aria-label="mixed 原始值"
        aria-invalid={show ? "true" : "false"}
        disabled={disabled}
        value={rawText}
        rows={4}
        onBlur={onTouched}
        onChange={(event) => onChangeRaw(event.target.value)}
      />
      {show ? <span className="field-error">{validated.error}</span> : null}
    </label>
  );
}

function validateCellToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return "单元不能为空";
  if (/^&[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return null;
  if (/^-?0[xX][0-9A-Fa-f]+$/.test(trimmed)) return null;
  if (/^-?\d+$/.test(trimmed)) return null;
  return "非法单元";
}
