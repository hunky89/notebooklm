import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDirectory, getNotebookDataDirectory, normalizeNotebookId } from "@/lib/source-store";

export type NotebookRole = "owner" | "editor" | "viewer";
export type NotebookMember = { userId: string; role: NotebookRole };
export type Notebook = { id: string; name: string; ownerId?: string; members?: NotebookMember[]; createdAt: string; updatedAt: string };

const storePath = join(getDataDirectory(), "notebooks.json");
let writeQueue: Promise<void> = Promise.resolve();
const defaultNotebook: Notebook = { id: "default", name: "AI 产品研究", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: new Date().toISOString() };

async function writeNotebooksNow(notebooks: Notebook[]) {
  await mkdir(getDataDirectory(), { recursive: true });
  const temporaryPath = `${storePath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(notebooks, null, 2), { mode: 0o600 });
  await rename(temporaryPath, storePath);
}

export async function readNotebooks(): Promise<Notebook[]> {
  try {
    const value = JSON.parse(await readFile(storePath, "utf8"));
    return Array.isArray(value) && value.length ? value : [defaultNotebook];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeNotebooksNow([defaultNotebook]);
    return [defaultNotebook];
  }
}

export async function mutateNotebooks(update: (items: Notebook[]) => Notebook[]) {
  let result: Notebook[] = [];
  writeQueue = writeQueue.then(async () => {
    result = update(await readNotebooks());
    await writeNotebooksNow(result);
  });
  await writeQueue;
  return result;
}

export async function claimLegacyNotebooks(userId: string) {
  return mutateNotebooks((items) => items.map((item) => item.ownerId ? item : { ...item, ownerId: userId, members: [{ userId, role: "owner" as const }] }));
}

export function notebookRole(notebook: Notebook, userId: string): NotebookRole | null {
  if (notebook.ownerId === userId) return "owner";
  return notebook.members?.find((item) => item.userId === userId)?.role || null;
}

export async function readNotebooksForUser(userId: string) {
  return (await readNotebooks()).filter((item) => notebookRole(item, userId));
}

export async function assertNotebook(notebookId?: string | null) {
  const id = normalizeNotebookId(notebookId);
  const notebook = (await readNotebooks()).find((item) => item.id === id);
  if (!notebook) throw new Error("笔记本不存在");
  return notebook;
}

export async function assertNotebookAccess(notebookId: string | null | undefined, userId: string, required: "view" | "edit" | "owner" = "view") {
  const notebook = await assertNotebook(notebookId);
  const role = notebookRole(notebook, userId);
  const allowed = required === "view" ? Boolean(role) : required === "edit" ? role === "owner" || role === "editor" : role === "owner";
  if (!allowed) throw new Error("无权访问此笔记本");
  return { notebook, role: role! };
}

export async function removeNotebookData(notebookId: string) {
  const id = normalizeNotebookId(notebookId);
  if (id === "default") throw new Error("默认笔记本不能删除");
  await rm(getNotebookDataDirectory(id), { recursive: true, force: true });
}
