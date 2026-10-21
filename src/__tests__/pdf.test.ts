import { readFileSync } from "fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { extractPdfPages } from "../index.ts";
import { renderPdfPageToPng } from "../utils/pdfRender.ts";

// Share of dark pixels in a rendered page: ~0 for a blank page.
const darkShare = async (png: Buffer): Promise<number> => {
  const { data } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (const v of data) if (v < 128) dark++;
  return dark / data.length;
};

// Builds a PDF with a correct xref table from object bodies (object 1 must be the catalog).
const buildPdf = (objects: string[]): Buffer => {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
};

describe("renderPdfPageToPng", () => {
  it("draws a CCITT G4 compressed scan instead of a blank page", async () => {
    // Black-and-white scanners store pages as CCITT G4 images. The fixture is a synthetic page
    // (no real document): a 1-bit image of two text lines, `tiffcp -c g4`, then `tiff2pdf`.
    const pdf = readFileSync(new URL("./fixtures/ccitt-g4.pdf", import.meta.url));
    const png = await renderPdfPageToPng(pdf, 1, 1);
    expect(await darkShare(png)).toBeGreaterThan(0.005);
  });

  it("draws a digital page whose text sits inside a clipping path", async () => {
    const content = "q 0 0 300 120 re W n BT /F1 48 Tf 20 40 Td (Hello PDF) Tj ET Q";
    const pdf = buildPdf([
      "<</Type/Catalog/Pages 2 0 R>>",
      "<</Type/Pages/Kids[3 0 R]/Count 1>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 120]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
      "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
      `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    ]);
    const png = await renderPdfPageToPng(pdf, 1, 2);
    expect(await darkShare(png)).toBeGreaterThan(0.01);
  });
});

describe("extractPdfPages", () => {
  it("returns the text layer of each page, empty for a page without one", async () => {
    const text = "BT /F1 12 Tf 20 40 Td (First page) Tj ET";
    const pdf = buildPdf([
      "<</Type/Catalog/Pages 2 0 R>>",
      "<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 80]/Resources<</Font<</F1 5 0 R>>>>/Contents 6 0 R>>",
      "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 80]>>",
      "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
      `<</Length ${text.length}>>\nstream\n${text}\nendstream`,
    ]);
    expect(await extractPdfPages(pdf)).toEqual(["First page", ""]);
  });

  it("rejects a buffer that is not a PDF", async () => {
    await expect(extractPdfPages(Buffer.from("not a pdf"))).rejects.toThrow();
  });
});
