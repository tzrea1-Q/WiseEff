import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_DTS_EXAMPLES } from "@/domain/parameter-catalog/dtsExamples";

import { publicationCopy, publicationDtsExampleError, type PublicationValueSchema } from "./publicationState";

export function DtsExamplesEditor({ examples = [], onChange, propertyKey, schema }: {
  examples?: readonly string[];
  onChange: (examples: readonly string[]) => void;
  propertyKey: string;
  schema?: PublicationValueSchema;
}) {
  const id = useId();
  return <div className="definition-editor__field definition-editor__field--full" role="group" aria-labelledby={id}>
    <span id={id} className="definition-editor__field-label">{publicationCopy.dtsExamples}</span>
    {examples.map((text, index) => {
      const error = text && schema ? publicationDtsExampleError(text, propertyKey, schema) : undefined;
      const errorId = `${id}-error-${index}`;
      return <div key={index} className="definition-editor__field">
        <Textarea aria-label={`${publicationCopy.dtsExamples} ${index + 1}`} rows={3} spellCheck={false}
          className="definition-example-source" value={text} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(examples.map((value, position) => position === index ? event.target.value : value))} />
        {error ? <small id={errorId}>{error}</small> : null}
        <div><Button type="button" variant="outline" size="sm" aria-label={`移除第 ${index + 1} 个 DTS 示例`}
          onClick={() => onChange(examples.filter((_, position) => position !== index))}>移除</Button></div>
      </div>;
    })}
    <div><Button type="button" variant="outline" size="sm" disabled={examples.length >= MAX_DTS_EXAMPLES}
      onClick={() => onChange([...examples, ""])}>添加 DTS 示例</Button></div>
  </div>;
}
