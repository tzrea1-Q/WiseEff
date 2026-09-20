import { LoaderCircle, Search, X } from "lucide-react";
import { forwardRef, useRef, type FocusEventHandler, type KeyboardEventHandler, type MutableRefObject, type Ref } from "react";
import { cn } from "@/lib/utils";

export type SearchFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  clearable?: boolean;
  className?: string;
  name?: string;
  id?: string;
  autoFocus?: boolean;
  required?: boolean;
  form?: string;
  maxLength?: number;
  onFocus?: FocusEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onClear?: () => void;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    (ref as MutableRefObject<T | null>).current = value;
  }
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    value,
    onValueChange,
    placeholder,
    ariaLabel,
    disabled = false,
    loading = false,
    clearable = true,
    className,
    name,
    id,
    autoFocus,
    required,
    form,
    maxLength,
    onFocus,
    onBlur,
    onKeyDown,
    onClear
  },
  forwardedRef
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const label = ariaLabel?.trim() || placeholder?.trim() || "搜索";
  const showClear = clearable && value.length > 0 && !disabled;

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    assignRef(forwardedRef, node);
  };

  const clear = () => {
    onValueChange("");
    onClear?.();
    inputRef.current?.focus();
  };

  return (
    <div
      className={cn(
        "search-field",
        disabled && "search-field--disabled",
        loading && "search-field--loading",
        className
      )}
      aria-busy={loading || undefined}
    >
      <Search className="search-field__icon" size={16} aria-hidden="true" />
      <input
        ref={setRefs}
        id={id}
        name={name}
        form={form}
        type="search"
        className="search-field__input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        autoFocus={autoFocus}
        required={required}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {loading ? <LoaderCircle className="search-field__spinner" size={14} aria-hidden="true" /> : null}
      {showClear ? (
        <button type="button" className="search-field__clear" aria-label="清空输入" onClick={clear}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});
