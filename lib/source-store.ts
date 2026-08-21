import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type StoredSource = {
  id: string;
  title: string;
  type: string;
  meta: string;
  color: string;
  content: string;
  segments: SourceSegment[];
  url?: string;
  originalFile?: { path: string; name: string; mime: string };
  createdAt: string;
};

export type SourceSegment = {
  id: string;
  label: string;
  text: string;
};

const dataDirectory = process.env.NOTA_DATA_DIR || "/data";
const writeQueues = new Map<string, Promise<void>>();

export function getDataDirectory() { return dataDirectory; }
export function normalizeNotebookId(value?: string | null) {
  const id = value?.trim() || "default";
  if (id !== "default" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("笔记本编号无效");
  return id;
}
export function getNotebookDataDirectory(notebookId?: string | null) {
  const id = normalizeNotebookId(notebookId);
  return id === "default" ? dataDirectory : join(dataDirectory, "notebooks", id);
}
function sourceStorePath(notebookId?: string | null) { return join(getNotebookDataDirectory(notebookId), "sources.json"); }

async function ensureStore(notebookId?: string | null) {
  await mkdir(dirname(sourceStorePath(notebookId)), { recursive: true });
}

export async function readSources(notebookId?: string | null): Promise<StoredSource[]> {
  const storePath = sourceStorePath(notebookId);
  await ensureStore(notebookId);
  try {
    const data = JSON.parse(await readFile(storePath, "utf8"));
    if (!Array.isArray(data)) return [];
    return data.map((source: StoredSource) => ({
      ...source,
      segments: Array.isArray(source.segments) && source.segments.length
        ? source.segments
        : chunkText(source.content || "", "正文"),
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeSourcesNow(sources: StoredSource[], notebookId?: string | null) {
  const storePath = sourceStorePath(notebookId);
  await ensureStore(notebookId);
  const temporaryPath = `${storePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(sources, null, 2), { mode: 0o600 });
  await rename(temporaryPath, storePath);
}

export async function mutateSources(update: (sources: StoredSource[]) => StoredSource[], notebookId?: string | null) {
  const id = normalizeNotebookId(notebookId);
  let result: StoredSource[] = [];
  const queue = writeQueues.get(id) || Promise.resolve();
  const next = queue.then(async () => {
    result = update(await readSources(id));
    await writeSourcesNow(result, id);
  });
  writeQueues.set(id, next.catch(() => undefined));
  await next;
  return result;
}

export function publicSource(source: StoredSource, notebookId?: string | null) {
  const id = normalizeNotebookId(notebookId);
  const { content: _content, segments: _segments, originalFile: _originalFile, ...metadata } = source;
  return {
    ...metadata,
    segmentCount: source.segments.length,
    originalUrl: source.url || (source.originalFile ? `/api/sources/file?id=${encodeURIComponent(source.id)}&notebookId=${encodeURIComponent(id)}` : undefined),
  };
}

export function sourceDetail(source: StoredSource, notebookId?: string | null) {
  return {
    ...publicSource(source, notebookId),
    segments: source.segments,
  };
}

export function chunkText(text: string, labelPrefix = "段落", maxChars = 1800): SourceSegment[] {
  const paragraphs = text.replace(/\r/g, "").split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const segments: SourceSegment[] = [];
  let current = "";
  const push = () => {
    if (!current.trim()) return;
    const index = segments.length + 1;
    segments.push({ id: `c${index}`, label: labelPrefix === "正文" && index === 1 ? "正文" : `${labelPrefix} ${index}`, text: current.trim() });
    current = "";
  };
  for (const paragraph of paragraphs.length ? paragraphs : [text]) {
    if (paragraph.length > maxChars) {
      push();
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        current = paragraph.slice(offset, offset + maxChars);
        push();
      }
    } else if (current && current.length + paragraph.length + 2 > maxChars) {
      push();
      current = paragraph;
    } else {
      current += `${current ? "\n\n" : ""}${paragraph}`;
    }
  }
  push();
  return segments;
}
