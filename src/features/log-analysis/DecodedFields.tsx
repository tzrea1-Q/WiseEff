import type { LogEvidence } from "@/domain/logs/types";

export function decodedValueText(value: unknown): string {
  if (value && typeof value === "object") {
    if ("value" in value) return decodedValueText(value.value);
    if ("hex" in value) return String(value.hex);
  }
  return String(value);
}

export function DecodedFields({ events }: { events: LogEvidence["decodedFields"] }) {
  if (!events?.length) return null;
  return <div role="group" aria-label="解码字段" className="flex flex-wrap gap-1">
    {events.flatMap((event, index) => Object.entries(event.fields).map(([field, value]) =>
      <span className="badge max-w-full truncate font-mono" key={`${index}-${field}`} title={`${event.file}:${event.line} · ${event.extractor} · ${field} = ${decodedValueText(value)}`}>
        {field} = {decodedValueText(value)}
      </span>))}
  </div>;
}
