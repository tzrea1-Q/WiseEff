export type KnowledgeExtractionOutcome =
  | { status: "succeeded"; text: string }
  | { status: "failed"; reason: string };

export type KnowledgeExtractionInput = {
  fileName: string;
  contentType: string;
  bytes: Buffer;
};

/**
 * Text-extraction seam for file-form knowledge entries. The service depends on
 * this interface only; the default implementation dispatches on content type
 * (PDF via pdf-parse, Word .docx via mammoth, plain text passthrough) and
 * records failures honestly instead of throwing.
 */
export interface KnowledgeTextExtractor {
  extract(input: KnowledgeExtractionInput): Promise<KnowledgeExtractionOutcome>;
}

const MAX_EXTRACTED_TEXT_CHARS = 500_000;

function normalizeExtractedText(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
  return normalized.length > MAX_EXTRACTED_TEXT_CHARS ? normalized.slice(0, MAX_EXTRACTED_TEXT_CHARS) : normalized;
}

function failureReason(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return fallback;
}

async function extractPdfText(bytes: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocxText(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value ?? "";
}

export function createDefaultKnowledgeTextExtractor(): KnowledgeTextExtractor {
  return {
    async extract(input) {
      try {
        if (input.contentType === "text/plain" || input.contentType === "text/markdown") {
          return { status: "succeeded", text: normalizeExtractedText(input.bytes.toString("utf8")) };
        }
        if (input.contentType === "application/pdf") {
          return { status: "succeeded", text: normalizeExtractedText(await extractPdfText(input.bytes)) };
        }
        if (input.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          return { status: "succeeded", text: normalizeExtractedText(await extractDocxText(input.bytes)) };
        }
        if (input.contentType === "application/msword") {
          return {
            status: "failed",
            reason: "Legacy .doc binaries are not supported for text extraction; convert the document to .docx and replace the file."
          };
        }
        return { status: "failed", reason: `Unsupported content type for text extraction: ${input.contentType}.` };
      } catch (error) {
        return { status: "failed", reason: failureReason(error, "Text extraction failed for an unknown reason.") };
      }
    }
  };
}
