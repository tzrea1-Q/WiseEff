import type { LogEvidence } from "@/domain/logs/types";

export function decodedValueText(value: unknown): string {
  if (value && typeof value === "object") {
    if ("value" in value) return `${decodedValueText(value.value)}${"meaning" in value ? ` (${String(value.meaning)})` : ""}${"unit" in value ? ` ${String(value.unit)}` : ""}`;
    if ("hex" in value) return String(value.hex);
  }
  return String(value);
}

export function DecodedFields({ events }: { events: LogEvidence["decodedFields"] }) {
  if (!events?.length) return null;
  return <div role="group" aria-label="解码字段" className="flex flex-wrap gap-1">
    {events.map((event, index) => <FieldTree key={index} fields={event.fields} source={`${event.file}:${event.line} · ${event.extractor}`} />)}
  </div>;
}

function FieldTree({ fields, source }: { fields: NonNullable<LogEvidence["decodedFields"]>[number]["fields"]; source: string }) {
  return <ul className="flex flex-wrap gap-1" aria-label={source}>
    {Object.entries(fields).map(([field, value]) => <li key={field} className="max-w-full">
      <span className="badge max-w-full whitespace-normal break-words font-mono" title={`${source} · ${field} = ${decodedValueText(value)}${value && typeof value === "object" && "raw" in value ? ` · raw=${value.raw}` : ""}`}>
        {field} = {decodedValueText(value)}
      </span>
      {value && typeof value === "object" && "fields" in value && value.fields
        ? <div className="ml-2 border-l border-[var(--border)] pl-2"><FieldTree fields={value.fields} source={`${source} · ${field}`} /></div> : null}
    </li>)}
  </ul>;
}
