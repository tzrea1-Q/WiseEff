import type { KeyboardEvent, ReactNode } from "react";
import { RadioGroup, Tabs } from "radix-ui";

import "./view-switch.css";

type ViewSwitchItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
};

type ViewSwitchProps = {
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
} & (
  | { variant: "section" | "toggle"; items: ViewSwitchItem[] }
  | { variant: "tabs"; items: (ViewSwitchItem & { id: string; panelId: string })[] }
);

function handleSectionRovingFocus(event: KeyboardEvent<HTMLButtonElement>) {
  const parent = event.currentTarget.parentElement;
  if (!parent) return;
  const buttons = [...parent.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const current = buttons.indexOf(event.currentTarget);
  if (current < 0) return;
  let next: number;
  switch (event.key) {
    case "Home":
      next = 0;
      break;
    case "End":
      next = buttons.length - 1;
      break;
    case "ArrowRight":
      next = (current + 1) % buttons.length;
      break;
    case "ArrowLeft":
      next = (current - 1 + buttons.length) % buttons.length;
      break;
    default:
      return;
  }
  event.preventDefault();
  buttons[next]?.focus();
}

export function ViewSwitch({ variant, ariaLabel, value, onValueChange, items }: ViewSwitchProps) {
  if (variant === "toggle") {
    return (
      <RadioGroup.Root className="view-switch view-switch--toggle" aria-label={ariaLabel}
        value={value} onValueChange={onValueChange}>
        {items.map((item) => (
          <RadioGroup.Item key={item.value} value={item.value} className="view-switch__item" disabled={item.disabled}
            title={item.title}>
            {item.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    );
  }
  if (variant === "tabs") {
    return (
      <Tabs.Root value={value} onValueChange={onValueChange} activationMode="manual">
        <Tabs.List className="view-switch view-switch--tabs" aria-label={ariaLabel}>
          {items.map((item) => (
            <Tabs.Trigger key={item.value} value={item.value} id={item.id} aria-controls={item.panelId}
              className="view-switch__item" disabled={item.disabled} title={item.title}>
              {item.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>
    );
  }
  return (
    <nav className={`view-switch view-switch--${variant}`} aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className="view-switch__item"
          disabled={item.disabled}
          title={item.title}
          aria-current={item.value === value ? "page" : undefined}
          onClick={() => onValueChange(item.value)}
          onKeyDown={handleSectionRovingFocus}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
