import type { ExportArtifact, ExportRecord } from "./types";
import { buildStoreZip } from "./zip-store";

const ENCODER = new TextEncoder();

export function formatXlsx(records: readonly ExportRecord[]): ExportArtifact {
  const sheetRows: string[][] = [
    ["tweetId", "handle", "displayName", "capturedAt", "surface", "permalink", "text", "mediaUrls"]
  ];
  for (const record of records) {
    sheetRows.push([
      record.tweetId ?? "",
      record.handle ?? "",
      record.displayName ?? "",
      record.capturedAt,
      record.surface,
      record.permalink ?? "",
      record.text,
      record.media.map((media) => media.url).join("|")
    ]);
  }

  const sheetXml = buildSheetXml(sheetRows);
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tweets" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const archive = buildStoreZip([
    { filename: "[Content_Types].xml", data: ENCODER.encode(contentTypesXml) },
    { filename: "_rels/.rels", data: ENCODER.encode(rootRelsXml) },
    { filename: "xl/_rels/workbook.xml.rels", data: ENCODER.encode(workbookRelsXml) },
    { filename: "xl/workbook.xml", data: ENCODER.encode(workbookXml) },
    { filename: "xl/worksheets/sheet1.xml", data: ENCODER.encode(sheetXml) }
  ]);

  return {
    filename: "tweets.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data: archive
  };
}

function buildSheetXml(rows: readonly string[][]): string {
  const xmlRows: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const cells: string[] = [];
    for (let c = 0; c < row.length; c++) {
      const value = row[c] ?? "";
      const cellRef = `${columnLetter(c)}${r + 1}`;
      cells.push(`<c r="${cellRef}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`);
    }
    xmlRows.push(`<row r="${r + 1}">${cells.join("")}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows.join("")}</sheetData></worksheet>`;
}

function stripInvalidXmlChars(value: string): string {
  let output = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const allowed =
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (allowed) {
      output += char;
    }
  }
  return output;
}

function columnLetter(index: number): string {
  let label = "";
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

function escapeXml(value: string): string {
  // XML 1.0 forbids most C0 controls outright; leaving one in produces a workbook that
  // Excel refuses to open with a generic "unreadable content" error.
  return stripInvalidXmlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
