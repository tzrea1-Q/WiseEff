import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FieldInfoTip } from "./FieldInfoTip";
import {
  VALUE_SHAPE_OPTIONS,
  coerceValueShapeKind,
  inferCellFieldsFromExample,
  needsCellFields,
  shapeStateForNewKind,
  shapeStateFromValue,
  valueFromShapeState,
  type ValueShapeKind,
} from "./valueShapeEditor";

export type ValueShapeFieldDescriptions = {
  valueShape?: string;
  bits?: string;
  cellsPerGroup?: string;
  bytesLength?: string;
  units?: string;
};

export type ValueShapeUnitsField = {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
};

export type ValueShapeFieldsProps = {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** create fills defaults; edit preserves absent keys on load/round-trip. */
  mode: "create" | "edit";
  disabled?: boolean;
  /** Optional class for each field wrapper (create dialog uses organization-driver-schema-dialog__field). */
  fieldClassName?: string;
  descriptions?: ValueShapeFieldDescriptions;
  /** Illustrative example text; changing it auto-fills cell layout when kind needs it. */
  exampleValueText?: string;
  propertyKey?: string;
  /** When set, rendered to the right of cellsPerGroup (or alone when kind has no cell fields). */
  units?: ValueShapeUnitsField;
};

function FieldLabel({
  htmlFor,
  label,
  description
}: {
  htmlFor: string;
  label: string;
  description?: string;
}) {
  return (
    <span className="def-field-label-row">
      <label htmlFor={htmlFor}>{label}</label>
      {description ? <FieldInfoTip label={label} description={description} /> : null}
    </span>
  );
}

function FieldShell({
  className,
  children
}: {
  className: string;
  children: ReactNode;
}) {
  return <div className={className}>{children}</div>;
}

export function ValueShapeFields({
  value,
  onChange,
  mode,
  disabled = false,
  fieldClassName = "organization-driver-schema-dialog__field",
  descriptions,
  exampleValueText = "",
  propertyKey = "property",
  units
}: ValueShapeFieldsProps) {
  const valueShapeId = useId();
  const bitsId = useId();
  const cellsPerGroupId = useId();
  const bytesLengthId = useId();
  const unitsId = useId();
  const [inferError, setInferError] = useState<string | null>(null);
  const skipInitialEffect = useRef(true);
  const prevExampleRef = useRef(exampleValueText);
  const prevKindRef = useRef<ValueShapeKind | null>(null);

  const state = shapeStateFromValue(value);
  const kind = state.kind;
  const showCellFields = needsCellFields(kind);

  const emit = (nextState: ReturnType<typeof shapeStateFromValue>) => {
    onChange(valueFromShapeState(nextState, mode));
  };

  const setKind = (nextKind: ValueShapeKind) => {
    if (nextKind === kind) return;
    setInferError(null);
    emit(shapeStateForNewKind(nextKind));
  };

  // Auto-infer cell layout when the operator changes the example or switches into a
  // cell kind. Skip the first run so open→save does not invent missing keys (SE-23).
  useEffect(() => {
    if (skipInitialEffect.current) {
      skipInitialEffect.current = false;
      prevExampleRef.current = exampleValueText;
      prevKindRef.current = kind;
      return;
    }

    const exampleChanged = exampleValueText !== prevExampleRef.current;
    const kindChanged = kind !== prevKindRef.current;
    prevExampleRef.current = exampleValueText;
    prevKindRef.current = kind;

    if (disabled || !needsCellFields(kind)) {
      setInferError(null);
      return;
    }

    const shouldInfer =
      (exampleChanged && exampleValueText.trim().length > 0) ||
      (kindChanged && exampleValueText.trim().length > 0);
    if (!shouldInfer) return;

    const result = inferCellFieldsFromExample(exampleValueText, propertyKey);
    if (!result.ok) {
      setInferError(result.error);
      return;
    }

    const current = shapeStateFromValue(value);
    const nextBits = kind === "u32-array" ? 32 : result.bits;
    if (current.bits === nextBits && current.cellsPerGroup === result.cellsPerGroup) {
      setInferError(null);
      return;
    }

    setInferError(null);
    onChange(
      valueFromShapeState(
        {
          ...current,
          bits: nextBits,
          cellsPerGroup: result.cellsPerGroup,
        },
        mode,
      ),
    );
  }, [disabled, exampleValueText, kind, mode, onChange, propertyKey, value]);

  const unitsField =
    units != null ? (
      <FieldShell className={fieldClassName}>
        <FieldLabel htmlFor={unitsId} label="单位" description={descriptions?.units} />
        <input
          id={unitsId}
          aria-label="单位"
          value={units.value}
          readOnly={units.readOnly}
          aria-readonly={units.readOnly || undefined}
          disabled={disabled || units.readOnly}
          onChange={(event) => units.onChange(event.target.value)}
        />
      </FieldShell>
    ) : null;

  return (
    <div className="param-admin-value-shape-layout">
      {inferError ? (
        <span className="form-error param-admin-value-shape-infer-error" role="status">
          {inferError}
        </span>
      ) : null}

      <div className="param-admin-value-shape-row">
        <FieldShell className={fieldClassName}>
          <FieldLabel
            htmlFor={valueShapeId}
            label="值形状 valueShape"
            description={descriptions?.valueShape}
          />
          <select
            id={valueShapeId}
            aria-label="值形状 valueShape"
            value={kind}
            disabled={disabled}
            onChange={(event) => setKind(coerceValueShapeKind(event.target.value))}
          >
            {VALUE_SHAPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldShell>

        {showCellFields ? (
          <FieldShell className={fieldClassName}>
            <FieldLabel htmlFor={bitsId} label="bits" description={descriptions?.bits} />
            <input
              id={bitsId}
              aria-label="bits"
              type="number"
              min={8}
              step={8}
              value={state.bits ?? ""}
              placeholder={mode === "edit" ? "未设置" : undefined}
              disabled={disabled || kind === "u32-array"}
              onChange={(event) => {
                setInferError(null);
                const raw = event.target.value.trim();
                emit({
                  ...state,
                  bits: raw === "" ? null : Number(raw) || 32,
                });
              }}
            />
          </FieldShell>
        ) : null}
      </div>

      {showCellFields ? (
        <div className="param-admin-value-shape-row">
          <FieldShell className={fieldClassName}>
            <FieldLabel
              htmlFor={cellsPerGroupId}
              label="cellsPerGroup"
              description={descriptions?.cellsPerGroup}
            />
            <input
              id={cellsPerGroupId}
              aria-label="cellsPerGroup"
              type="number"
              min={1}
              value={state.cellsPerGroup ?? ""}
              placeholder="留空 = 列宽不约束"
              disabled={disabled}
              onChange={(event) => {
                setInferError(null);
                const raw = event.target.value.trim();
                emit({
                  ...state,
                  cellsPerGroup: raw === "" ? null : Math.max(1, Number(raw) || 1),
                });
              }}
            />
          </FieldShell>
          {unitsField}
        </div>
      ) : null}

      {kind === "bytes" ? (
        <div className="param-admin-value-shape-row">
          <FieldShell className={fieldClassName}>
            <FieldLabel
              htmlFor={bytesLengthId}
              label="bytes.length"
              description={descriptions?.bytesLength}
            />
            <input
              id={bytesLengthId}
              aria-label="bytes.length"
              type="number"
              min={0}
              value={state.bytesLength ?? ""}
              placeholder={mode === "edit" ? "未设置" : undefined}
              disabled={disabled}
              onChange={(event) => {
                const raw = event.target.value.trim();
                emit({
                  ...state,
                  bytesLength: raw === "" ? null : Math.max(0, Number(raw) || 0),
                });
              }}
            />
          </FieldShell>
          {unitsField}
        </div>
      ) : null}

      {!showCellFields && kind !== "bytes" && unitsField ? (
        <div className="param-admin-value-shape-row">{unitsField}</div>
      ) : null}
    </div>
  );
}
