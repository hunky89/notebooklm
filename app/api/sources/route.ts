import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractDocument, extractWebDocument } from "@/lib/document-parser";
import { getNotebookDataDirectory, mutateSources, normalizeNotebookId, publicSource, readSources, sourceDetail, type StoredSource } from "@/lib/source-store";
import { assertNotebook } from "@/lib/notebook-store";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function sourceStyle(extension: string) {
  const type = extension.toUpperCase();
  if (type === "PDF") return { type, color: "coral" };
  if (["DOC", "DOCX", "TXT", "MD", "CSV", "RTF", "JSON", "HTML"].includes(type)) return { type, color: "blue" };
  if (["PPT", "PPTX"].includes(type)) return { type: "PPTX", color: "coral" };
  if (["XLS", "XLSX"].includes(type)) return { type: "XLSX", color: "mint" };
  if (type === "EPUB") return { type, color: "violet" };
  return { type: type.slice(0, 5) || "FILE", color: "mint" };
}

function isPrivateAddress(address: string) {
  const value = address.toLowerCase();
  if (value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

async function validatePublicUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只支持 HTTP 或 HTTPS 网页");
  if (url.username || url.password) throw new Error("网页链接不能包含登录凭据");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("不支持本地地址");
  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new Error("不支持私有网络地址");
    return;
  }
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("网页地址不可访问");
}

async function readLimitedResponse(response: Response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 2_500_000) throw new Error("网页内容过大");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_500_000) {
      await reader.cancel();
      throw new Error("网页内容过大");
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(data);
}

async function fetchWebPage(rawUrl: string) {
  let current = new URL(rawUrl);
  for (let redirects = 0; redirects < 4; redirects += 1) {
    await validatePublicUrl(current);
    const response = await fetch(current, { redirect: "manual", headers: { "User-Agent": "NotaResearchBot/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("网页重定向无效");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`网页返回 ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) throw new Error("该链接不是可解析的网页");
    const raw = await readLimitedResponse(response);
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || current.hostname;
    const extracted = extractWebDocument(raw, contentType);
    if (extracted.content.length < 80) throw new Error("未能提取到足够的网页正文");
    return { url: current.toString(), title: title.slice(0, 180), ...extracted };
  }
  throw new Error("网页重定向次数过多");
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const notebookId = normalizeNotebookId(params.get("notebookId"));
  await assertNotebook(notebookId);
  const sources = await readSources(notebookId);
  if (!id) return Response.json({ sources: sources.map((source) => publicSource(source, notebookId)) });
  const source = sources.find((item) => item.id === id);
  if (!source) return Response.json({ error: "来源不存在" }, { status: 404 });
  return Response.json({ source: sourceDetail(source, notebookId) });
}

export async function POST(request: Request) {
  try {
    const notebookId = normalizeNotebookId(new URL(request.url).searchParams.get("notebookId"));
    await assertNotebook(notebookId);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES) return Response.json({ error: "单次上传不能超过 20MB" }, { status: 413 });
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const { url } = await request.json() as { url?: string };
      if (!url?.trim()) return Response.json({ error: "网页链接不能为空" }, { status: 400 });
      const page = await fetchWebPage(url.trim());
      const source: StoredSource = { id: crypto.randomUUID(), title: page.title, type: "WEB", meta: `网页 · ${page.segments.length} 个片段`, color: "mint", content: page.content, segments: page.segments, url: page.url, createdAt: new Date().toISOString() };
      await mutateSources((sources) => [...sources, source], notebookId);
      return Response.json({ sources: [publicSource(source, notebookId)] });
    }

    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) return Response.json({ error: "请选择文件" }, { status: 400 });
    if (files.length > 8) return Response.json({ error: "每次最多上传 8 个文件" }, { status: 400 });
    const created: StoredSource[] = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过 8MB 限制`);
      const extracted = await extractDocument(file);
      if (extracted.content.trim().length < 20) throw new Error(`${file.name} 未提取到足够正文`);
      const extension = file.name.split(".").pop() || "file";
      const style = sourceStyle(extension);
      const id = crypto.randomUUID();
      const filesDirectory = join(getNotebookDataDirectory(notebookId), "files");
      await mkdir(filesDirectory, { recursive: true });
      const storedPath = join(filesDirectory, `${id}.${extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "file"}`);
      await writeFile(storedPath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
      created.push({ id, title: file.name.slice(0, 180), ...style, meta: `已分析 · ${extracted.segments.length} 个片段`, content: extracted.content, segments: extracted.segments, originalFile: { path: storedPath, name: file.name, mime: file.type || "application/octet-stream" }, createdAt: new Date().toISOString() });
    }
    await mutateSources((sources) => [...sources, ...created], notebookId);
    return Response.json({ sources: created.map((source) => publicSource(source, notebookId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "资料导入失败";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const notebookId = normalizeNotebookId(params.get("notebookId"));
  await assertNotebook(notebookId);
  if (!id) return Response.json({ error: "缺少来源编号" }, { status: 400 });
  const current = await readSources(notebookId);
  const target = current.find((item) => item.id === id);
  const sources = await mutateSources((items) => items.filter((item) => item.id !== id), notebookId);
  if (target?.originalFile?.path) await unlink(target.originalFile.path).catch(() => undefined);
  return Response.json({ sources: sources.map((source) => publicSource(source, notebookId)) });
}
