import { Fragment, useId, type KeyboardEvent, type ReactNode } from "react";
import { RadioGroup, Tabs } from "radix-ui";

import "./view-switch.css";

type ViewSwitchItem = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
};

type PageSwitchItem = ViewSwitchItem & { group?: string };

type ViewSwitchProps = {
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
} & (
  | { variant: "section" | "toggle" | "toggle-outline"; items: ViewSwitchItem[] }
  | { variant: "page"; items: PageSwitchItem[] }
  | { variant: "tabs"; items: (ViewSwitchItem & { id: string; panelId: string })[] }
);

function handleNavigationRovingFocus(event: KeyboardEvent<HTMLButtonElement>) {
  const nav = event.currentTarget.closest("nav");
  if (!nav) return;
  const buttons = [...nav.querySelectorAll<HTMLButtonElement>("button.view-switch__item:not(:disabled)")];
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
  const captionId = useId();
  if (variant === "toggle" || variant === "toggle-outline") {
    return (
      <RadioGroup.Root className={`view-switch view-switch--toggle${variant === "toggle-outline" ? " view-switch--toggle-outline" : ""}`} aria-label={ariaLabel}
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
  const renderDestination = (item: ViewSwitchItem) => (
    <button
      key={item.value}
      type="button"
      className="view-switch__item"
      disabled={item.disabled}
      title={item.title}
      aria-current={item.value === value ? "page" : undefined}
      onClick={() => onValueChange(item.value)}
      onKeyDown={handleNavigationRovingFocus}
    >
      {item.label}
    </button>
  );

  const groups: { caption?: string; items: PageSwitchItem[] }[] = [];
  if (variant === "page") {
    for (const item of items) {
      const previous = groups.at(-1);
      if (previous && previous.caption === item.group) {
        previous.items.push(item);
      } else {
        groups.push({ caption: item.group, items: [item] });
      }
    }
  }

  return (
    <nav className={`view-switch view-switch--${variant}`} aria-label={ariaLabel}>
      {variant === "page" ? groups.map(({ caption, items: groupItems }, index) => {
        const id = `${captionId}-${index}`;
        const key = groupItems[0].value;
        const buttons = groupItems.map(renderDestination);
        return caption ? (
          <div className="view-switch__group" key={key} role="group" aria-labelledby={id}>
            <span className="view-switch__caption" id={id}>{caption}</span>
            {buttons}
          </div>
        ) : <Fragment key={key}>{buttons}</Fragment>;
      }) : items.map(renderDestination)}
    </nav>
  );
}
