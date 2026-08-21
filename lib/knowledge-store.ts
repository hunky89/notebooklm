import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getNotebookDataDirectory, normalizeNotebookId } from "@/lib/source-store";

export type CitationRef = { sourceId: string; segmentId: string };
export type CitedText = { text: string; citations: CitationRef[] };
export type MindNode = { label: string; note?: string; citations: CitationRef[]; children: MindNode[] };
export type KnowledgeArtifacts = {
  generatedAt: string;
  sourceSignature: string;
  summary: { title: string; overview: string; points: CitedText[] };
  mindmap: MindNode;
  cards: Array<{ question: string; answer: string; citations: CitationRef[] }>;
  wiki: Array<{ title: string; content: string; citations: CitationRef[] }>;
};

const writeQueues = new Map<string, Promise<void>>();

export async function readKnowledge(notebookId?: string | null): Promise<KnowledgeArtifacts | null> {
  const storePath = join(getNotebookDataDirectory(notebookId), "knowledge.json");
  try { return JSON.parse(await readFile(storePath, "utf8")) as KnowledgeArtifacts; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeKnowledge(value: KnowledgeArtifacts, notebookId?: string | null) {
  const id = normalizeNotebookId(notebookId);
  const directory = getNotebookDataDirectory(id);
  const storePath = join(directory, "knowledge.json");
  const queue = writeQueues.get(id) || Promise.resolve();
  const next = queue.then(async () => {
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${storePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporaryPath, storePath);
  });
  writeQueues.set(id, next.catch(() => undefined));
  await next;
}
