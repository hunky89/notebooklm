import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { extractDocument, extractWebDocument } from "@/lib/document-parser";
import { getNotebookDataDirectory, mutateSources, normalizeNotebookId, publicSource, readSources, sourceDetail, type StoredSource } from "@/lib/source-store";
import { assertNotebookAccess } from "@/lib/notebook-store";
import { AuthError, requireRequestUser } from "@/lib/auth-store";
import { quotaLimits } from "@/lib/quota-store";
import { MAX_FILE_BYTES, MAX_FILE_LABEL, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/upload-limits";

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
  try {
    const user = await requireRequestUser(request);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const notebookId = normalizeNotebookId(params.get("notebookId"));
    await assertNotebookAccess(notebookId, user.id);
    const sources = await readSources(notebookId);
    if (!id) return Response.json({ sources: sources.map((source) => publicSource(source, notebookId)) });
    const source = sources.find((item) => item.id === id);
    if (!source) return Response.json({ error: "来源不存在" }, { status: 404 });
    return Response.json({ source: sourceDetail(source, notebookId) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const notebookId = normalizeNotebookId(new URL(request.url).searchParams.get("notebookId"));
    await assertNotebookAccess(notebookId, user.id, "edit");
    const existingCount = (await readSources(notebookId)).length;
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES) return Response.json({ error: `单次上传总大小不能超过 ${MAX_UPLOAD_LABEL}` }, { status: 413 });
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const { url } = await request.json() as { url?: string };
      if (!url?.trim()) return Response.json({ error: "网页链接不能为空" }, { status: 400 });
      if (existingCount >= quotaLimits.sourcesPerNotebook) return Response.json({ error: `每个笔记本最多 ${quotaLimits.sourcesPerNotebook} 个来源` }, { status: 429 });
      const page = await fetchWebPage(url.trim());
      const now = new Date().toISOString();
      const source: StoredSource = { id: crypto.randomUUID(), title: page.title, type: "WEB", meta: `网页 · ${page.segments.length} 个片段`, color: "mint", content: page.content, segments: page.segments, url: page.url, enabled: true, labels: [], version: 1, checksum: createHash("sha256").update(page.content).digest("hex"), createdAt: now, updatedAt: now, versions: [{ version: 1, createdAt: now }] };
      await mutateSources((sources) => [...sources, source], notebookId);
      return Response.json({ sources: [publicSource(source, notebookId)] });
    }

    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) return Response.json({ error: "请选择文件" }, { status: 400 });
    if (files.length > 8) return Response.json({ error: "每次最多上传 8 个文件" }, { status: 400 });
    if (existingCount + files.length > quotaLimits.sourcesPerNotebook) return Response.json({ error: `每个笔记本最多 ${quotaLimits.sourcesPerNotebook} 个来源` }, { status: 429 });
    const created: StoredSource[] = [];
    const errors: Array<{ name: string; error: string }> = [];
    for (const file of files) {
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过 ${MAX_FILE_LABEL} 限制`);
        const extracted = await extractDocument(file);
        if (extracted.content.trim().length < 20) throw new Error(`${file.name} 未提取到足够正文`);
        const extension = file.name.split(".").pop() || "file"; const style = sourceStyle(extension); const id = crypto.randomUUID(); const filesDirectory = join(getNotebookDataDirectory(notebookId), "files"); await mkdir(filesDirectory, { recursive: true });
        const storedPath = join(filesDirectory, `${id}.${extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "file"}`); const bytes = Buffer.from(await file.arrayBuffer()); await writeFile(storedPath, bytes, { mode: 0o600 });
        const now = new Date().toISOString(); const originalFile = { path: storedPath, name: file.name, mime: file.type || "application/octet-stream" };
        created.push({ id, title: file.name.slice(0, 180), ...style, meta: `已分析 · ${extracted.segments.length} 个片段`, content: extracted.content, segments: extracted.segments, enabled: true, labels: [], version: 1, checksum: createHash("sha256").update(bytes).digest("hex"), originalFile, createdAt: now, updatedAt: now, versions: [{ version: 1, createdAt: now, originalFile }] });
      } catch (error) { errors.push({ name: file.name, error: error instanceof Error ? error.message : "解析失败" }); }
    }
    if (!created.length) return Response.json({ error: errors[0]?.error || "文件导入失败", errors }, { status: 400 });
    await mutateSources((sources) => [...sources, ...created], notebookId);
    return Response.json({ sources: created.map((source) => publicSource(source, notebookId)), errors }, { status: errors.length ? 207 : 200 });
  } catch (error) { return routeError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireRequestUser(request); const body = await request.json() as { notebookId?: string; id?: string; enabled?: boolean; labels?: string[]; action?: string };
    const notebookId = normalizeNotebookId(body.notebookId); await assertNotebookAccess(notebookId, user.id, "edit");
    const current = await readSources(notebookId); const target = current.find((item) => item.id === body.id); if (!target) return Response.json({ error: "来源不存在" }, { status: 404 });
    let updated: StoredSource = { ...target, enabled: typeof body.enabled === "boolean" ? body.enabled : target.enabled !== false, labels: Array.isArray(body.labels) ? [...new Set(body.labels.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 20) : target.labels || [], updatedAt: new Date().toISOString() };
    if (body.action === "refresh") {
      if (!target.url) return Response.json({ error: "只有网页来源可以重新同步" }, { status: 400 });
      const page = await fetchWebPage(target.url); const checksum = createHash("sha256").update(page.content).digest("hex");
      if (checksum !== target.checksum) { const version = (target.version || 1) + 1; updated = { ...updated, title: page.title, content: page.content, segments: page.segments, checksum, version, meta: `网页 · ${page.segments.length} 个片段`, versions: [...(target.versions || [{ version: 1, checksum: target.checksum, createdAt: target.createdAt }]), { version, checksum, createdAt: new Date().toISOString() }] }; }
    }
    await mutateSources((items) => items.map((item) => item.id === updated.id ? updated : item), notebookId); return Response.json({ source: publicSource(updated, notebookId) });
  } catch (error) { return routeError(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const notebookId = normalizeNotebookId(params.get("notebookId"));
    await assertNotebookAccess(notebookId, user.id, "edit");
    if (!id) return Response.json({ error: "缺少来源编号" }, { status: 400 });
    const current = await readSources(notebookId);
    const target = current.find((item) => item.id === id);
    const sources = await mutateSources((items) => items.filter((item) => item.id !== id), notebookId);
    if (target?.originalFile?.path) await unlink(target.originalFile.path).catch(() => undefined);
    return Response.json({ sources: sources.map((source) => publicSource(source, notebookId)) });
  } catch (error) { return routeError(error); }
}

function routeError(error: unknown) {
  const status = error instanceof AuthError ? error.status : (error instanceof Error && error.message.startsWith("无权") ? 403 : 400);
  return Response.json({ error: error instanceof Error ? error.message : "请求失败" }, { status });
}
