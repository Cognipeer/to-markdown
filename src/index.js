import pdf2md from "@opendocsg/pdf2md";
import AdmZip from "adm-zip";
import { load } from "cheerio";
import { fromBuffer } from "file-type";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { convertToHtml } from "mammoth";
import { extension, lookup } from "mime-types";
import { parseBuffer } from "music-metadata";
import { parse } from "papaparse";
import { extname, isAbsolute, join } from "path";
import sharp from "sharp";
import TurndownService from "turndown";
import { read, utils } from "xlsx";
import { parseStringPromise } from "xml2js";

function formatMarkdown(text) {
  let lines = text.split("\n").map((line) => line.trim());
  let formattedLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (!line) continue;

    if (line.startsWith("**") && line.endsWith("**")) {
      line = "## " + line.replace(/^\*\*|\*\*$/g, "");
    } else if (/^[A-Z0-9][^.!?]{2,}[.!?]?$/.test(line) && line.length < 100) {
      line = "## " + line;
    }

    if (/^[•\-\*]\s/.test(line)) {
      line = "* " + line.replace(/^[•\-\*]\s+/, "");
    }

    if (!line.startsWith("#") && !line.startsWith("*")) {
      if (
        formattedLines.length > 0 &&
        !formattedLines[formattedLines.length - 1].startsWith("#") &&
        !formattedLines[formattedLines.length - 1].startsWith("*")
      ) {
        formattedLines[formattedLines.length - 1] += " " + line;
        continue;
      }
    }

    formattedLines.push(line);
  }

  return formattedLines
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/gm, "")
    .trim();
}

async function convertToMarkdown(input, options = {}) {
  let fileBuffer;
  let ext;

  if (typeof input === "string") {
    if (
      input.startsWith("data:") ||
      new RegExp("^[A-Za-z0-9+/]+={0,2}$").test(input)
    ) {
      try {
        const base64Data = input.split("base64,").pop();
        fileBuffer = Buffer.from(base64Data, "base64");

        let mimeType = input.startsWith("data:")
          ? input.split(";")[0].split(":")[1]
          : lookup(options.fileName || "");
        ext = mimeType ? "." + extension(mimeType) : null;

        if (!ext) {
          const fType = await fromBuffer(fileBuffer);

          if (fType) {
            ext = "." + fType.ext;
          }
        }
      } catch (err) {
        throw new Error(`Failed to convert base64: ${err.message}`);
      }
    } else {
      if (!existsSync(input)) {
        throw new Error("File not found: " + input);
      }

      fileBuffer = readFileSync(input);
      ext = options.forceExtension
        ? options.forceExtension.toLowerCase()
        : extname(input).toLowerCase();

      if (!ext || ext === "") {
        const fType = await fromBuffer(fileBuffer);
        if (fType) {
          ext = "." + fType.ext;
        } else {
          ext = ".txt";
        }
      }
    }
  } else if (Buffer.isBuffer(input)) {
    fileBuffer = input;
    ext = options.forceExtension ? options.forceExtension.toLowerCase() : null;

    if (!ext || ext === "") {
      const fType = await fromBuffer(fileBuffer);
      if (fType) {
        ext = "." + fType.ext;
      } else {
        ext = ".txt";
      }
    }
  } else {
    throw new Error(
      "Invalid input format. Must be a string (file path or base64) or Buffer"
    );
  }

  if (!ext) ext = ".txt";

  switch (ext) {
    case ".pdf":
      return await convertPdfToMarkdown(fileBuffer);

    case ".docx":
      return await convertDocxToMarkdown(fileBuffer);

    case ".html":
    case ".htm":
      return convertHtmlToMarkdown(fileBuffer);

    case ".txt":
      return convertTextFileToMarkdown(fileBuffer);

    case ".ipynb":
      return await convertIpynbToMarkdown(fileBuffer);

    case ".xml":
    case ".rss":
    case ".atom":
      return await convertRssAtomToMarkdown(fileBuffer);

    case ".xlsx":
    case ".xls":
      return await convertExcelToMarkdown(fileBuffer);

    case ".csv":
      return convertCsvToMarkdown(fileBuffer);

    case ".mp3":
    case ".wav":
      return await convertAudioToMarkdown(fileBuffer, ext);

    case ".pptx":
      return await convertPptxToMarkdown(fileBuffer);

    case ".zip":
      return await convertZipToMarkdown(fileBuffer, options);

    case ".jpg":
    case ".jpeg":
    case ".png":
    case ".gif":
      return await convertImageToMarkdown(fileBuffer, ext);

    default:
      if (options.url && options.url.includes("youtube.com")) {
        return convertYoutubeToMarkdown(fileBuffer, options.url);
      }

      if (options.url && options.url.includes("bing.com/search")) {
        return convertBingSerpToMarkdown(fileBuffer, options.url);
      }

      return convertTextFileToMarkdown(fileBuffer);
  }
}

// PDF
async function convertPdfToMarkdown(buffer) {
  var result = await pdf2md(buffer);

  return result;
}

// DOCX
async function convertDocxToMarkdown(buffer) {
  try {
    const result = await convertToHtml({ buffer }, { styleMap: [] });
    const html = result.value || "";

    let markdown = htmlToMarkdown(html);
    markdown = formatMarkdown(markdown);

    return markdown;
  } catch (err) {
    throw new Error(`Failed to convert DOCX: ${err.message}`);
  }
}

// HTML
function convertHtmlToMarkdown(input) {
  try {
    let htmlContent;

    if (Buffer.isBuffer(input)) {
      htmlContent = input.toString("utf-8");
    } else if (typeof input === "string" && existsSync(input)) {
      htmlContent = readFileSync(input, "utf-8");
    } else if (typeof input === "string") {
      htmlContent = input;
    } else {
      throw new Error("Invalid HTML content");
    }

    let markdown = htmlToMarkdown(htmlContent);
    markdown = formatMarkdown(markdown);

    return markdown;
  } catch (err) {
    throw new Error(`Failed to convert HTML: ${err.message}`);
  }
}

function htmlToMarkdown(htmlString) {
  const $ = load(htmlString, {
    decodeEntities: true,
    normalizeWhitespace: true,
  });

  $("script, style").remove();
  $("*").each(function () {
    const element = $(this);
    if (element.text().trim() === "") {
      element.remove();
    }
  });

  const turndownOptions = {
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "*",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    keepHeaderLevels: true,
  };

  const turndownService = new TurndownService(turndownOptions);

  turndownService.addRule("heading", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: function (content, node) {
      const level = Number(node.nodeName.charAt(1));
      return "\n" + "#".repeat(level) + " " + content + "\n\n";
    },
  });

  turndownService.addRule("listItem", {
    filter: "li",
    replacement: function (content, node) {
      content = content.trim();
      return "* " + content + "\n";
    },
  });

  turndownService.addRule("tableConversion", {
    filter: "table",
    replacement: function (content, node, options) {
      let header = "";
      let rows = [];

      const trs = node.querySelectorAll("tr");
      if (trs.length === 0) {
        return "";
      }

      const firstRowCells = trs[0].querySelectorAll("th,td");
      const headers = Array.from(firstRowCells).map((cell) =>
        cell.textContent.trim().replace(/\|/g, "\\|")
      );
      header = "| " + headers.join(" | ") + " |";

      const underline = "| " + headers.map(() => "---").join(" | ") + " |";

      for (let i = 1; i < trs.length; i++) {
        const rowCells = trs[i].querySelectorAll("th,td");
        const rowValues = Array.from(rowCells).map((cell) =>
          cell.textContent.trim().replace(/\|/g, "\\|")
        );
        const rowText = "| " + rowValues.join(" | ") + " |";
        rows.push(rowText);
      }

      let tableMarkdown =
        "\n\n" + header + "\n" + underline + "\n" + rows.join("\n") + "\n\n";
      return tableMarkdown;
    },
  });

  let markdown = turndownService.turndown($.html());
  markdown = markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line)
    .join("\n\n")
    .trim();
  return markdown;
}

// TEXT
function convertTextFileToMarkdown(buffer) {
  try {
    return buffer.toString("utf-8").trim();
  } catch (err) {
    throw new Error(`Failed to convert text file: ${err.message}`);
  }
}

// IPYNB
async function convertIpynbToMarkdown(buffer) {
  try {
    const jsonData = JSON.parse(buffer.toString("utf-8"));
    let mdOutput = [];
    let title = null;

    if (jsonData.cells) {
      for (const cell of jsonData.cells) {
        const cellType = cell.cell_type;
        const sourceLines = cell.source || [];
        if (cellType === "markdown") {
          const mdContent = sourceLines.join("");
          mdOutput.push(mdContent);
          if (!title) {
            for (let line of sourceLines) {
              if (line.startsWith("# ")) {
                title = line.replace("# ", "").trim();
                break;
              }
            }
          }
        } else if (cellType === "code") {
          mdOutput.push("```python\n" + sourceLines.join("") + "\n```");
        } else if (cellType === "raw") {
          mdOutput.push("```\n" + sourceLines.join("") + "\n```");
        }
      }
    }

    let markdown = mdOutput.join("\n\n");
    markdown = formatMarkdown(markdown);

    return markdown;
  } catch (err) {
    throw new Error(`Failed to convert IPYNB: ${err.message}`);
  }
}

// RSS/ATOM
async function convertRssAtomToMarkdown(buffer) {
  try {
    const xmlContent = buffer.toString("utf-8");
    const result = await parseStringPromise(xmlContent);

    if (result.rss && result.rss.channel && result.rss.channel[0]) {
      const channel = result.rss.channel[0];
      let md = "";

      if (channel.title) {
        md += `# ${channel.title[0]}\n`;
      }

      if (channel.description) {
        md += `${channel.description[0]}\n\n`;
      }

      if (channel.item) {
        for (const item of channel.item) {
          if (item.title) {
            md += `## ${item.title[0]}\n`;
          }
          if (item.pubDate) {
            md += `Published on: ${item.pubDate[0]}\n`;
          }
          if (item.description) {
            md += `\n${item.description[0]}\n\n`;
          }
        }
      }

      md = formatMarkdown(md);

      return md;
    } else if (result.feed) {
      const feed = result.feed;
      let md = "";

      if (feed.title) {
        md += `# ${feed.title[0]}\n`;
      }

      if (feed.subtitle) {
        md += `${feed.subtitle[0]}\n\n`;
      }

      if (feed.entry) {
        for (const entry of feed.entry) {
          if (entry.title) {
            md += `## ${entry.title[0]}\n`;
          }
          if (entry.updated) {
            md += `Updated on: ${entry.updated[0]}\n`;
          }
          if (entry.summary) {
            md += `\n${entry.summary[0]}\n\n`;
          } else if (entry.content) {
            md += `\n${entry.content[0]._ || entry.content[0]}\n\n`;
          }
        }
      }

      md = formatMarkdown(md);

      return md;
    }

    //TODO : Add XML Conversion

    return formatMarkdown(xmlContent);
  } catch (err) {
    throw new Error(`Failed to convert RSS/ATOM: ${err.message}`);
  }
}

// EXCEL (xlsx, xls)
async function convertExcelToMarkdown(buffer) {
  try {
    const wb = read(buffer, { type: "buffer" });

    let md = "";

    wb.SheetNames.forEach((sheetName) => {
      md += `## ${sheetName}\n\n`;

      const ws = wb.Sheets[sheetName];
      const json = utils.sheet_to_json(ws, { header: 1 });

      md += arrayToMarkdownTable(json) + "\n\n";
    });

    return formatMarkdown(md);
  } catch (err) {
    throw new Error(`Failed to convert Excel: ${err.message}`);
  }
}

function convertCsvToMarkdown(buffer) {
  try {
    const text = buffer.toString("utf-8");
    const result = parse(text, { delimiter: ",", skipEmptyLines: true });
    const data = result.data;

    return formatMarkdown(arrayToMarkdownTable(data));
  } catch (err) {
    throw new Error(`Failed to convert CSV: ${err.message}`);
  }
}

function arrayToMarkdownTable(data) {
  if (!data || data.length === 0) {
    return "";
  }

  const header = data[0];
  const rows = data.slice(1);

  let md = "| " + header.join(" | ") + " |\n";
  md += "| " + header.map(() => "---").join(" | ") + " |\n";

  for (const row of rows) {
    md += "| " + row.join(" | ") + " |\n";
  }

  return md;
}

// Audio (mp3,wav)
async function convertAudioToMarkdown(buffer, ext) {
  try {
    const metadata = await parseBuffer(buffer);
    let md = "";

    if (metadata.common.title) md += `Title: ${metadata.common.title}\n`;
    if (metadata.common.artist) md += `Artist: ${metadata.common.artist}\n`;
    if (metadata.format.duration)
      md += `Duration: ${metadata.format.duration} sec\n`;

    // TODO: Add speech-to-text transcription

    return formatMarkdown(md);
  } catch (err) {
    throw new Error(`Failed to convert audio: ${err.message}`);
  }
}

// PPTX
async function convertPptxToMarkdown(buffer) {
  try {
    const tempPath = join(__dirname, "temp_pptx.zip");
    writeFileSync(tempPath, buffer);

    const zip = new AdmZip(tempPath);
    const entries = zip.getEntries();

    let md = "";

    for (const entry of entries) {
      if (entry.entryName.startsWith("ppt/slides/slide")) {
        const slideXml = entry.getData().toString("utf-8");
        const slideMd = await extractTextFromSlideXml(slideXml);

        md += `\n\n<!-- ${entry.entryName} -->\n` + slideMd + "\n";
      }
    }

    unlinkSync(tempPath);

    return formatMarkdown(md);
  } catch (err) {
    throw new Error(`Failed to convert PPTX: ${err.message}`);
  }
}

async function extractTextFromSlideXml(xml) {
  const result = await parseStringPromise(xml);
  const texts = [];

  function traverse(obj) {
    if (!obj) return;
    if (obj["a:t"]) {
      texts.push(obj["a:t"].join(" "));
    }
    for (let k in obj) {
      if (typeof obj[k] === "object") {
        traverse(obj[k]);
      }
    }
  }

  traverse(result);

  return texts.join(" ");
}

// ZIP
async function convertZipToMarkdown(buffer, options) {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    let md = `Content from the zip file:\n\n`;

    for (const entry of entries) {
      if (!entry.isDirectory) {
        const content = entry.getData();
        const fileName = entry.entryName;

        const subMd = await convertToMarkdown(content, {
          fileName,
          ...options,
        });

        md += `## File: ${fileName}\n\n${subMd}\n\n`;
      }
    }
    return formatMarkdown(md);
  } catch (err) {
    throw new Error(`Failed to convert ZIP: ${err.message}`);
  }
}

// Image (jpg, png...)
async function convertImageToMarkdown(buffer, ext) {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    let md = "";

    if (metadata.width && metadata.height) {
      md += `ImageSize: ${metadata.width}x${metadata.height}\n`;
    }

    // TODO: Add OCR for image text extraction

    return formatMarkdown(md);
  } catch (err) {
    throw new Error(`Failed to convert image: ${err.message}`);
  }
}

function convertYoutubeToMarkdown(buffer, url) {
  const html = buffer.toString("utf-8");
  const $ = load(html);

  let md = "# YouTube\n";

  const title = $("title").text();
  if (title) {
    md += `\n## ${title}\n`;
  }

  const desc = $('meta[name="description"]').attr("content");
  if (desc) {
    md += `\n### Description\n${desc}\n`;
  }

  // TODO: Add Youtube API for transcript

  return formatMarkdown(md);
}

// BingSerp
function convertBingSerpToMarkdown(buffer, url) {
  const html = buffer.toString("utf-8");
  const $ = load(html);
  const query = new URL(url).searchParams.get("q") || "";

  let md = `## A Bing search for '${query}' found the following results:\n\n`;

  $(".b_algo").each((i, elem) => {
    let part = $(elem).text().trim();
    md += part + "\n\n";
  });

  return formatMarkdown(md);
}

async function saveToMarkdownFile(content, fileName, outputDir = "output") {
  try {
    const outputPath = isAbsolute(outputDir)
      ? outputDir
      : join(process.cwd(), outputDir);

    if (!existsSync(outputPath)) {
      mkdirSync(outputPath, { recursive: true });
    }

    const mdFileName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
    const filePath = join(outputPath, mdFileName);

    writeFileSync(filePath, content, "utf-8");
    return filePath;
  } catch (err) {
    throw new Error(`Failed to save markdown file: ${err.message}`);
  }
}

export default {
  convertToMarkdown,
  saveToMarkdownFile,
};
