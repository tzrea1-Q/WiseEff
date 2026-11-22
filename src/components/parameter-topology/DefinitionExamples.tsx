type Examples = { dtsExamples?: readonly string[]; examples?: readonly unknown[] };

export function DefinitionExamples({ dtsExamples, examples, jsonLabel = "示例", showLabel = true }: Examples & {
  jsonLabel?: string;
  showLabel?: boolean;
}) {
  const entries = dtsExamples?.length ? dtsExamples : examples?.map((example) => JSON.stringify(example));
  if (!entries?.length) return null;
  const label = dtsExamples?.length ? "DTS 示例" : jsonLabel;
  return <div className="definition-example-list">
    {showLabel ? <strong>{label}</strong> : null}
    {entries.map((text, index) => <pre key={index} className="parameter-value-content definition-example-source"
      role="region" aria-label={`${label} ${index + 1}`}
      tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Long examples need keyboard scrolling. */}><code>{text}</code></pre>)}
  </div>;
}
