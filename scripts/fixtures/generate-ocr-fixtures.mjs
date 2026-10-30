#!/usr/bin/env node
/**
 * Generates the small OCR test fixtures in src/__tests__/fixtures/ocr/.
 *
 *   node scripts/fixtures/generate-ocr-fixtures.mjs
 *
 * The fixtures are COMMITTED; CI never regenerates them (output is not
 * guaranteed to be byte-stable across fonts/platforms). Everything is built
 * with dependencies already in the package: @napi-rs/canvas (text bitmaps),
 * sharp (JPEG/WEBP/TIFF), adm-zip (DOCX/PPTX) and hand-written PDF/BMP
 * writers. Only the CCITT-G4 re-encode of multipage.tif needs python3 + PIL
 * (scripts/fixtures/g4_tiff.py); without python3 the TIFF stays Deflate.
 *
 * Bitmap text mixes Turkish and English lines so a real OCR engine (tesseract
 * tur+eng) has something meaningful to read.
 */
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import AdmZip from "adm-zip";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "src", "__tests__", "fixtures", "ocr");
mkdirSync(OUT, { recursive: true });

const FONT = "Arial, Helvetica, sans-serif";

export const TEXT = {
  policy: [
    "Şirket Güvenlik Politikası - İç Denetim Raporu 2026",
    "ğüşıöç ĞÜŞİÖÇ",
    "Quarterly Revenue Report Q3 2026",
  ],
  minutes: [
    "Yönetim Kurulu Toplantı Tutanağı",
    "Annual Compliance Review 2026",
    "Öğrenci İşleri ve Çalışma Grubu",
  ],
  invoice: [
    "Fatura No: 2026-0417 / Invoice 20260417",
    "Müşteri Memnuniyeti Anketi Sonuçları",
    "Total Amount Due: 12,480.00 EUR",
  ],
  stamp: [
    "Gizli Belge - Confidential Document",
    "Çağrı Merkezi Performans Özeti",
    "Customer Support Summary 2026",
  ],
  tiff1: ["Şirket Güvenlik Politikası - İç Denetim Raporu 2026", "ğüşıöç ĞÜŞİÖÇ", "Page One of Two"],
  tiff2: ["Quarterly Revenue Report Q3 2026", "Yıllık Faaliyet Raporu Özeti", "Page Two of Two"],
  slide1: ["Ürün Yol Haritası 2026", "Product Roadmap Overview"],
  slide2: ["Müşteri Başarı Metrikleri", "Customer Success Metrics Q3"],
  html1: ["Şirket Güvenlik Politikası - İç Denetim Raporu 2026", "Quarterly Revenue Report Q3 2026"],
  html2: ["Çalışma Grubu Değerlendirmesi", "Annual Compliance Review 2026"],
};

/** Draw lines of text on a white canvas; shrinks the font until the longest line fits. */
function drawText(lines, { width = 1400, fontPx = 46, pad = 40, height } = {}) {
  const probe = createCanvas(10, 10).getContext("2d");
  let px = fontPx;
  for (; px > 14; px -= 2) {
    probe.font = `${px}px ${FONT}`;
    if (Math.max(...lines.map((l) => probe.measureText(l).width)) <= width - 2 * pad) break;
  }
  const lineH = Math.round(px * 1.7);
  const h = height ?? pad * 2 + lines.length * lineH;
  const canvas = createCanvas(width, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, h);
  ctx.fillStyle = "#000000";
  ctx.font = `${px}px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  lines.forEach((l, i) => ctx.fillText(l, pad, pad + px + i * lineH));
  return canvas;
}

const png = (c) => c.toBuffer("image/png");
const jpeg = (c, q = 85) => c.toBuffer("image/jpeg", q);
const write = (name, buf) => {
  writeFileSync(join(OUT, name), buf);
  console.log(`${name}: ${(buf.length / 1024).toFixed(1)} KB`);
  if (buf.length > 200 * 1024) throw new Error(`${name} exceeds 200 KB`);
};

// ---------------------------------------------------------------------------
// Minimal PDF writer
// ---------------------------------------------------------------------------
class Pdf {
  constructor() {
    this.objs = []; // index = id-1; Buffer
    this.pages = [];
    this.catalogId = this.reserve();
    this.pagesId = this.reserve();
    this.helvId = this.add(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    );
  }
  reserve() {
    this.objs.push(null);
    return this.objs.length;
  }
  set(id, content) {
    this.objs[id - 1] = Buffer.isBuffer(content) ? content : Buffer.from(content, "latin1");
  }
  add(content) {
    const id = this.reserve();
    this.set(id, content);
    return id;
  }
  stream(dict, data) {
    return Buffer.concat([
      Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"),
      data,
      Buffer.from("\nendstream", "latin1"),
    ]);
  }
  /**
   * @param {{w:number,h:number,content:string,fonts?:string,images?:Array<[string,number]>}} p
   */
  addPage({ w, h, content, fonts = "", images = [] }) {
    const contentId = this.add(this.stream("", Buffer.from(content, "latin1")));
    const xo = images.length ? `/XObject << ${images.map(([n, id]) => `/${n} ${id} 0 R`).join(" ")} >>` : "";
    const pageId = this.add(
      `<< /Type /Page /Parent ${this.pagesId} 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${contentId} 0 R ` +
        `/Resources << /Font << /F1 ${this.helvId} 0 R ${fonts} >> ${xo} >> >>`,
    );
    this.pages.push(pageId);
    return pageId;
  }
  addJpeg(canvas, q = 80) {
    const data = jpeg(canvas, q);
    return this.add(
      this.stream(
        `/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        data,
      ),
    );
  }
  build() {
    this.set(this.catalogId, `<< /Type /Catalog /Pages ${this.pagesId} 0 R >>`);
    this.set(
      this.pagesId,
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map((p) => `${p} 0 R`).join(" ")}] >>`,
    );
    const parts = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    const offsets = [];
    let pos = parts[0].length;
    this.objs.forEach((o, i) => {
      offsets.push(pos);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
      parts.push(b);
      pos += b.length;
    });
    let xref = `xref\n0 ${this.objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${this.objs.length + 1} /Root ${this.catalogId} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, "latin1"));
    return Buffer.concat(parts);
  }
}

const pdfEsc = (s) => s.replace(/[\\()]/g, "\\$&");
const A4 = { w: 595, h: 842 };

/** Native-text page (Helvetica 12pt, WinAnsi: ASCII only). */
function nativePage(pdf, title, paragraphs) {
  let y = 780;
  let c = `BT /F1 20 Tf 50 ${y} Td (${pdfEsc(title)}) Tj ET\n`;
  y -= 40;
  for (const p of paragraphs) {
    c += `BT /F1 12 Tf 50 ${y} Td 16 TL (${pdfEsc(p)}) Tj ET\n`;
    y -= 24;
  }
  pdf.addPage({ ...A4, content: c });
}

/** Full-page scan: text drawn into a 2x bitmap, placed edge to edge. */
function scanPage(pdf, lines, extraContent = "") {
  const canvas = drawText(lines, { width: A4.w * 2, height: A4.h * 2, fontPx: 40, pad: 60 });
  const img = pdf.addJpeg(canvas, 80);
  pdf.addPage({
    ...A4,
    content: `q ${A4.w} 0 0 ${A4.h} 0 0 cm /Im0 Do Q\n${extraContent}`,
    images: [["Im0", img]],
  });
}

function buildPdfs() {
  // mixed: native / scan / native
  {
    const pdf = new Pdf();
    nativePage(pdf, "Operations Handbook - Native Page 1", [
      "This first page carries a regular text layer so no OCR is required here.",
      "The quick brown fox jumps over the lazy dog while the auditors review the plan.",
      "Revenue grew steadily during the third quarter of the fiscal year 2026.",
    ]);
    scanPage(pdf, TEXT.policy);
    nativePage(pdf, "Operations Handbook - Native Page 3", [
      "The last page is native text again, placed after the scanned page.",
      "Page ordering must be preserved when only the middle page is recognised.",
      "Closing remarks: all figures are illustrative test data only.",
    ]);
    write("mixed.pdf", pdf.build());
  }
  // scan: two image-only pages
  {
    const pdf = new Pdf();
    scanPage(pdf, TEXT.minutes);
    scanPage(pdf, TEXT.invoice);
    write("scan.pdf", pdf.build());
  }
  // stamp: scanned page + ~20 char native text layer
  {
    const pdf = new Pdf();
    scanPage(pdf, TEXT.stamp, "BT /F1 8 Tf 40 24 Td (Sayfa 1 / Ref 2026) Tj ET\n");
    write("stamp.pdf", pdf.build());
  }
  // garbled: scanned page + a Type3 text layer without ToUnicode whose glyph
  // names are uniE0xx, i.e. text extraction yields private-use characters.
  {
    const pdf = new Pdf();
    const glyphs = 7;
    const procs = [];
    for (let i = 0; i < glyphs; i++) {
      procs.push(pdf.add(pdf.stream("", Buffer.from(`600 0 0 0 500 700 d1\n${50 + i * 10} 0 ${400 - i * 10} 700 re f`, "latin1"))));
    }
    const names = Array.from({ length: glyphs }, (_, i) => `/uniE0${(i + 1).toString(16).padStart(2, "0").toUpperCase()}`);
    const fontId = pdf.add(
      `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] /FontMatrix [0.001 0 0 0.001 0 0] ` +
        `/CharProcs << ${names.map((n, i) => `${n} ${procs[i]} 0 R`).join(" ")} >> ` +
        `/Encoding << /Type /Encoding /Differences [1 ${names.join(" ")}] >> ` +
        `/FirstChar 1 /LastChar ${glyphs} /Widths [${Array(glyphs).fill(600).join(" ")}] /Resources << >> >>`,
    );
    const codes = Array.from({ length: 40 }, (_, i) => `\\${String((i % glyphs) + 1).padStart(3, "0")}`).join("");
    const canvas = drawText(TEXT.policy, { width: A4.w * 2, height: A4.h * 2, fontPx: 40, pad: 60 });
    const img = pdf.addJpeg(canvas, 80);
    pdf.addPage({
      ...A4,
      content: `q ${A4.w} 0 0 ${A4.h} 0 0 cm /Im0 Do Q\nBT 3 Tr /F3 9 Tf 40 30 Td (${codes}) Tj ET\n`,
      fonts: `/F3 ${fontId} 0 R`,
      images: [["Im0", img]],
    });
    nativePage(pdf, "Garbled fixture - native page 2", [
      "The second page is a clean native page next to the garbled first one.",
      "Only the first page has a text layer that is unreadable private-use text.",
    ]);
    write("garbled.pdf", pdf.build());
  }
}

// ---------------------------------------------------------------------------
// Raster formats
// ---------------------------------------------------------------------------
async function buildRaster() {
  const sample = drawText(TEXT.policy, { width: 1400, fontPx: 46 });
  write("sample.png", png(sample));
  write("sample.webp", await sharp(png(sample)).webp({ quality: 85 }).toBuffer());

  // EXIF orientation 6: stored pixels are rotated 90 deg CCW; a viewer rotates
  // them 90 deg CW. Without autorotation the text appears sideways.
  const upright = png(drawText(TEXT.minutes, { width: 1300, fontPx: 46 }));
  write(
    "rotated.jpg",
    await sharp(upright).rotate(270).jpeg({ quality: 85 }).withMetadata({ orientation: 6 }).toBuffer(),
  );

  // BMP: hand-written 8-bit grayscale palette, bottom-up, uncompressed.
  {
    const c = drawText(TEXT.invoice, { width: 880, fontPx: 32, pad: 20 });
    const raw = await sharp(png(c)).greyscale().raw().toBuffer();
    const w = c.width;
    const h = c.height;
    const rowSize = Math.ceil(w / 4) * 4;
    const dataSize = rowSize * h;
    const offBits = 14 + 40 + 256 * 4;
    const buf = Buffer.alloc(offBits + dataSize);
    buf.write("BM", 0, "latin1");
    buf.writeUInt32LE(buf.length, 2);
    buf.writeUInt32LE(offBits, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22);
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(8, 28);
    buf.writeUInt32LE(0, 30);
    buf.writeUInt32LE(dataSize, 34);
    buf.writeInt32LE(2835, 38);
    buf.writeInt32LE(2835, 42);
    buf.writeUInt32LE(256, 46);
    for (let i = 0; i < 256; i++) {
      const o = 54 + i * 4;
      buf[o] = buf[o + 1] = buf[o + 2] = i;
    }
    for (let y = 0; y < h; y++) {
      raw.copy(buf, offBits + (h - 1 - y) * rowSize, y * w, y * w + w);
    }
    write("sample.bmp", buf);
  }

  // multipage.tif: 2 bilevel pages (Deflate via sharp, then G4 via PIL if available)
  {
    const page = async (lines) =>
      sharp(png(drawText(lines, { width: 1400, fontPx: 46, height: 320 }))).greyscale().png().toBuffer();
    const a = await page(TEXT.tiff1);
    const b = await page(TEXT.tiff2);
    let tif = await sharp([a, b], { join: { animated: true } }).threshold(128).tiff({ compression: "deflate", bitdepth: 1 }).toBuffer();
    try {
      const tmp = mkdtempSync(join(tmpdir(), "tm-g4-"));
      writeFileSync(join(tmp, "in.tif"), tif);
      execFileSync("python3", [join(here, "g4_tiff.py"), join(tmp, "in.tif"), join(tmp, "out.tif")], { stdio: "pipe" });
      tif = readFileSync(join(tmp, "out.tif"));
      rmSync(tmp, { recursive: true, force: true });
      console.log("multipage.tif re-encoded as CCITT G4");
    } catch (e) {
      console.warn("python3/PIL unavailable, multipage.tif stays Deflate:", e.message);
    }
    write("multipage.tif", tif);
  }
}

// ---------------------------------------------------------------------------
// Office / HTML
// ---------------------------------------------------------------------------
const W = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function logoPng() {
  const c = createCanvas(16, 16);
  const x = c.getContext("2d");
  x.fillStyle = "#1f4e79";
  x.fillRect(0, 0, 16, 16);
  x.fillStyle = "#f2b134";
  x.fillRect(4, 4, 8, 8);
  return png(c);
}

function buildDocx() {
  const img1 = png(drawText(TEXT.policy, { width: 1200, fontPx: 40 }));
  const img2 = png(drawText(TEXT.invoice, { width: 1200, fontPx: 40 }));
  const logo = logoPng();
  const inline = (id, rid, name, descr, cx, cy) =>
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${id}" name="${W(name)}"${descr ? ` descr="${W(descr)}"` : ""}/>` +
    `<wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr>` +
    `<pic:cNvPr id="${id}" name="${W(name)}"${descr ? ` descr="${W(descr)}"` : ""}/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const para = (inner) => `<w:p>${inner}</w:p>`;
  const text = (t) => `<w:r><w:t xml:space="preserve">${W(t)}</w:t></w:r>`;
  const body =
    para(inline(1, "rId10", "logo.png", "", 190500, 190500) + text(" Cognipeer Test Report")) +
    para(text("Introduction paragraph before the first picture.")) +
    para(inline(2, "rId11", "policy.png", "Scanned security policy page", 5486400, 1371600)) +
    para(text("Text between the two pictures.")) +
    para(inline(3, "rId12", "invoice.png", "Invoice summary screenshot", 5486400, 1371600)) +
    para(inline(4, "rId10", "logo.png", "", 190500, 190500) + text(" End of document"));
  const zip = new AdmZip();
  const add = (n, d) => zip.addFile(n, Buffer.isBuffer(d) ? d : Buffer.from(d, "utf8"));
  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  add(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      [
        ["rId10", "media/logo.png"],
        ["rId11", "media/policy.png"],
        ["rId12", "media/invoice.png"],
      ]
        .map(([id, t]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${t}"/>`)
        .join("") +
      `</Relationships>`,
  );
  add(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`,
  );
  add("word/media/logo.png", logo);
  add("word/media/policy.png", img1);
  add("word/media/invoice.png", img2);
  write("images.docx", zip.toBuffer());
}

function buildPptx() {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const RT = (t) => `${R}/${t}`;
  const rels = (items) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${RT(type)}" Target="${target}"/>`).join("") +
    `</Relationships>`;
  const slide = (title, body, rid, name, descr) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="457200" y="274320"/><a:ext cx="8229600" cy="685800"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${W(title)}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="457200" y="1097280"/><a:ext cx="8229600" cy="640080"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${body.map((b) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${W(b)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>` +
    `<p:pic><p:nvPicPr><p:cNvPr id="4" name="${W(name)}" descr="${W(descr)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="457200" y="1920240"/><a:ext cx="8229600" cy="1920240"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  const fills = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`.repeat(3);
  const theme =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${A}" name="Fixture"><a:themeElements>` +
    `<a:clrScheme name="c"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
    `<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>` +
    ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"].map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${c}"/></a:accent${i + 1}>`).join("") +
    `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="f"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="x"><a:fillStyleLst>${fills}</a:fillStyleLst><a:lnStyleLst>${`<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`.repeat(3)}</a:lnStyleLst>` +
    `<a:effectStyleLst>${`<a:effectStyle><a:effectLst/></a:effectStyle>`.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fills}</a:bgFillStyleLst></a:fmtScheme>` +
    `</a:themeElements></a:theme>`;
  const master =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
  const layout =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="obj"><p:cSld name="Title and Content"><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const pres =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst>` +
    `<p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
  const ct =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
    `<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`;
  const zip = new AdmZip();
  const add = (n, d) => zip.addFile(n, Buffer.isBuffer(d) ? d : Buffer.from(d, "utf8"));
  add("[Content_Types].xml", ct);
  add("_rels/.rels", rels([["rId1", "officeDocument", "ppt/presentation.xml"]]));
  add("ppt/presentation.xml", pres);
  add(
    "ppt/_rels/presentation.xml.rels",
    rels([
      ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
      ["rId2", "slide", "slides/slide1.xml"],
      ["rId3", "slide", "slides/slide2.xml"],
    ]),
  );
  add("ppt/slideMasters/slideMaster1.xml", master);
  add(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    rels([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rId2", "theme", "../theme/theme1.xml"],
    ]),
  );
  add("ppt/slideLayouts/slideLayout1.xml", layout);
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]));
  add("ppt/theme/theme1.xml", theme);
  add(
    "ppt/slides/slide1.xml",
    slide("Product Roadmap 2026", ["Native slide text on slide one.", "Ürün yol haritası özeti"], "rId2", "roadmap.png", "Roadmap chart screenshot"),
  );
  add(
    "ppt/slides/slide2.xml",
    slide("Customer Success", ["Native slide text on slide two.", "Müşteri başarı metrikleri"], "rId2", "metrics.png", "Customer metrics table scan"),
  );
  for (const n of [1, 2]) {
    add(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      rels([
        ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
        ["rId2", "image", `../media/image${n}.png`],
      ]),
    );
  }
  add("ppt/media/image1.png", png(drawText(TEXT.slide1, { width: 1200, fontPx: 48 })));
  add("ppt/media/image2.png", png(drawText(TEXT.slide2, { width: 1200, fontPx: 48 })));
  write("slides.pptx", zip.toBuffer());
}

function buildHtml() {
  const uri = (lines) => `data:image/png;base64,${png(drawText(lines, { width: 1000, fontPx: 38 })).toString("base64")}`;
  const html =
    `<!DOCTYPE html>\n<html lang="tr">\n<head><meta charset="utf-8"><title>Images fixture</title></head>\n<body>\n` +
    `<h1>Embedded images</h1>\n<p>First paragraph before the images.</p>\n` +
    `<p><img src="${uri(TEXT.html1)}" alt="Embedded scan one"></p>\n` +
    `<p>Text between the images.</p>\n` +
    `<p><img src="${uri(TEXT.html2)}" alt="Embedded scan two"></p>\n` +
    `<p><img src="https://example.com/assets/remote-logo.png" alt="Remote logo"></p>\n` +
    `<p>Closing paragraph.</p>\n</body>\n</html>\n`;
  write("images.html", Buffer.from(html, "utf8"));
}

buildPdfs();
await buildRaster();
buildDocx();
buildPptx();
buildHtml();
