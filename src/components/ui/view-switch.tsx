import type { ReactNode } from "react";
import { RadioGroup, Tabs } from "radix-ui";

import "./view-switch.css";

type ViewSwitchItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type ViewSwitchProps = {
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
} & (
  | { variant: "section" | "toggle"; items: ViewSwitchItem[] }
  | { variant: "tabs"; items: (ViewSwitchItem & { id: string; panelId: string })[] }
);

export function ViewSwitch({ variant, ariaLabel, value, onValueChange, items }: ViewSwitchProps) {
  if (variant === "toggle") {
    return (
      <RadioGroup.Root className="view-switch view-switch--toggle" aria-label={ariaLabel}
        value={value} onValueChange={onValueChange}>
        {items.map((item) => (
          <RadioGroup.Item key={item.value} value={item.value} className="view-switch__item" disabled={item.disabled}>
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
              className="view-switch__item" disabled={item.disabled}>
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
          aria-current={item.value === value ? "page" : undefined}
          onClick={() => onValueChange(item.value)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const buttons = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
            const current = buttons.indexOf(event.currentTarget);
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
              : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next].focus();
          }}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
