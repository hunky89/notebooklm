import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chunkText, type SourceSegment } from "@/lib/source-store";

const MAX_CONTENT_CHARS = 160_000;
PDFParse.setWorker(pathToFileURL(join(process.cwd(), "node_modules/pdf-parse/dist/worker/pdf.worker.mjs")).href);

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(value: string) {
  return decodeEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function finish(segments: SourceSegment[]) {
  const limited: SourceSegment[] = [];
  let total = 0;
  for (const segment of segments) {
    if (total >= MAX_CONTENT_CHARS) break;
    const text = segment.text.trim().slice(0, MAX_CONTENT_CHARS - total);
    if (text) limited.push({ ...segment, text });
    total += text.length;
  }
  return { segments: limited, content: limited.map((item) => `${item.label}\n${item.text}`).join("\n\n") };
}

async function parsePptx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const segments: SourceSegment[] = [];
  for (let index = 0; index < slides.length; index += 1) {
    const xml = await zip.file(slides[index])!.async("string");
    const text = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) => decodeEntities(match[1])).join("\n").trim();
    if (text) segments.push({ id: `slide-${index + 1}`, label: `第 ${index + 1} 张幻灯片`, text });
  }
  return finish(segments);
}

async function parseXlsx(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const shared = sharedXml
    ? [...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) => [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeEntities(item[1])).join(""))
    : [];
  const sheets = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const segments: SourceSegment[] = [];
  for (let index = 0; index < sheets.length; index += 1) {
    const xml = await zip.file(sheets[index])!.async("string");
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
      const cells = [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
        const reference = cell[1].match(/r="([^"]+)"/)?.[1] || "";
        const raw = cell[2].match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || [...cell[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((item) => item[1]).join("");
        const value = /t="s"/.test(cell[1]) ? shared[Number(raw)] ?? raw : decodeEntities(raw);
        return value ? `${reference}: ${value}` : "";
      }).filter(Boolean);
      return cells.join(" | ");
    }).filter(Boolean);
    if (rows.length) segments.push({ id: `sheet-${index + 1}`, label: `工作表 ${index + 1}`, text: rows.join("\n") });
  }
  return finish(segments);
}

async function parseEpub(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.keys(zip.files).filter((name) => /\.(xhtml|html|htm)$/i.test(name)).sort();
  const segments: SourceSegment[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const html = await zip.file(entries[index])!.async("string");
    const text = stripHtml(html);
    if (text) segments.push(...chunkText(text, `章节 ${index + 1}`).map((item, chunkIndex) => ({ ...item, id: `chapter-${index + 1}-${chunkIndex + 1}` })));
  }
  return finish(segments);
}

export async function extractDocument(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension === "pdf") {
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      return finish(result.pages.map((page) => ({ id: `page-${page.num}`, label: `第 ${page.num} 页`, text: page.text })));
    } finally { await parser.destroy(); }
  }
  if (extension === "docx") {
    const text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    return finish(chunkText(text, "段落"));
  }
  if (extension === "pptx") return parsePptx(bytes);
  if (extension === "xlsx") return parseXlsx(bytes);
  if (extension === "epub") return parseEpub(bytes);
  const decoded = new TextDecoder().decode(bytes);
  if (["html", "htm"].includes(extension)) return finish(chunkText(stripHtml(decoded), "网页段落"));
  if (extension === "rtf") {
    const text = decoded.replace(/\\par[d]?/g, "\n").replace(/\\'[0-9a-f]{2}/gi, " ").replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "");
    return finish(chunkText(text, "段落"));
  }
  if (extension === "json") {
    let text = decoded;
    try { text = JSON.stringify(JSON.parse(decoded), null, 2); } catch { /* retain source text */ }
    return finish(chunkText(text, "数据块"));
  }
  if (extension === "csv") {
    const lines = decoded.split(/\r?\n/);
    return finish(Array.from({ length: Math.ceil(lines.length / 80) }, (_, index) => ({ id: `rows-${index * 80 + 1}-${Math.min((index + 1) * 80, lines.length)}`, label: `第 ${index * 80 + 1}–${Math.min((index + 1) * 80, lines.length)} 行`, text: lines.slice(index * 80, (index + 1) * 80).join("\n") })));
  }
  if (["txt", "md"].includes(extension)) return finish(chunkText(decoded, extension === "md" ? "章节" : "段落"));
  throw new Error(`${file.name} 暂不支持正文解析；请上传 PDF、DOCX、PPTX、XLSX、EPUB、Markdown、文本、CSV、HTML、RTF 或 JSON`);
}

export function extractWebDocument(raw: string, contentType: string) {
  const text = contentType.includes("text/html") ? stripHtml(raw) : raw;
  return finish(chunkText(text, "网页段落"));
}
