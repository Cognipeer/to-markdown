import { describe, expect, it, vi } from "vitest";
import type { OCRHandlerContext } from "../types/index.ts";

vi.mock("../utils/pdfRender.js", () => ({
  renderPdfPageToPng: vi.fn(async (_buffer: Buffer, page: number) =>
    Buffer.from(`rendered-page-${page}`),
  ),
}));

const minimalPdf = Buffer.from(
  "%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
    "0000000058 00000 n \n0000000115 00000 n \n" +
    "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF",
);

describe("handler OCR integration", () => {
  it("convertPdfToMarkdown passes PDF page context to handler", async () => {
    const { convertPdfToMarkdown } = await import("../converters/pdf.ts");
    let receivedContext: OCRHandlerContext | undefined;

    const result = await convertPdfToMarkdown(
      minimalPdf,
      {
        provider: "handler",
        pdfMode: "always",
        handler: async (_buffer, context) => {
          receivedContext = context;
          return "pdf ocr text";
        },
      },
      "scan.pdf",
    );

    expect(result).toBe("pdf ocr text");
    expect(receivedContext).toMatchObject({
      page: 1,
      pageCount: 1,
      mimeType: "image/png",
      sourceExtension: ".pdf",
      fileName: "scan.pdf",
    });
  });
});
