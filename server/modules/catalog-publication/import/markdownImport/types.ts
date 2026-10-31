export type SubjectKind = "driver" | "node-type" | "configuration-schema";

export type ImportDiagnostic = {
  subjectHeading: string;
  definitionHeading: string;
  field: string;
  message: string;
  line: number;
};

export type SyntaxDiagnostic = ImportDiagnostic & {
  subjectLine?: number;
  definitionLine?: number;
};

export type Field = { name: string; value: string; line: number };
export type Definition = {
  heading: string;
  line: number;
  propertyKey: string;
  displayName: string;
  fields: Field[];
  documentation: string;
  documentationLine?: number;
};
export type Subject = {
  heading: string;
  line: number;
  kind: SubjectKind | null;
  selector: string;
  metadataLines: { text: string; line: number }[];
  definitions: Definition[];
};
export type SyntaxTree = { subjects: Subject[]; diagnostics: SyntaxDiagnostic[] };

export type ImportEntry = {
  subjectHeading: string;
  definitionHeading: string;
  selector: string;
  propertyKey: string;
  displayName: string;
  outcome: "create" | "revise" | "skip" | "conflict" | "error";
  revisionClass?: "documentation" | "semantic";
  diffs?: { field: string; oldValue: unknown; newValue: unknown }[];
  diagnostics: ImportDiagnostic[];
};

export function diagnostic(
  subject: Pick<Subject, "heading">,
  definition: Pick<Definition, "heading"> | null,
  field: string,
  message: string,
  line: number,
): ImportDiagnostic {
  return {
    subjectHeading: subject.heading,
    definitionHeading: definition?.heading ?? "",
    field,
    message,
    line,
  };
}
