// PDF text extraction via unpdf (a bundler-friendly pdf.js distribution that runs in
// Node with no worker setup). We pull positioned text items per page and reconstruct
// visual lines — far more reliable for columnar statements than naive text joining.
import { getDocumentProxy } from "unpdf";
import { groupItemsToLines, type PositionedItem } from "@/server/lib/pdf/lines";

export interface ExtractedPdf {
  pages: string[][]; // lines per page
  lines: string[]; // all lines, in reading order
  text: string; // lines joined with "\n"
  pageCount: number;
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  const pdf = await getDocumentProxy(bytes);
  const pages: string[][] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items: PositionedItem[] = [];
    for (const it of content.items) {
      // TextItem has `str` + `transform`; TextMarkedContent does not.
      const anyIt = it as { str?: unknown; transform?: number[] };
      if (typeof anyIt.str === "string" && anyIt.str.trim() !== "" && anyIt.transform) {
        items.push({ str: anyIt.str, x: anyIt.transform[4], y: anyIt.transform[5] });
      }
    }
    pages.push(groupItemsToLines(items));
  }

  const lines = pages.flat();
  return { pages, lines, text: lines.join("\n"), pageCount: pdf.numPages };
}
