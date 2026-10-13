import { CircleHelp } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type FieldInfoTipProps = {
  label: string;
  description: string;
};

/**
 * Compact ⓘ control for form labels. Hover/focus shows the field description.
 * Renders as a non-button span so it can live inside `<label>` without nested interactives.
 * Includes its own TooltipProvider so unit tests and non-App shells work without a root provider.
 */
export function FieldInfoTip({ label, description }: FieldInfoTipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="param-admin-field-info-tip"
            tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- The tooltip icon inside a label needs keyboard focus to expose its help text. */}
            role="img"
            aria-label={`${label}帮助`}
          >
            <CircleHelp size={14} strokeWidth={2} aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          sideOffset={6}
          className="param-admin-field-info-tip__content z-[calc(var(--z-toast)+var(--z-dropdown))] whitespace-normal text-left leading-relaxed"
        >
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
