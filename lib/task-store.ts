import { join } from "node:path";
import { getNotebookDataDirectory } from "@/lib/source-store";
import { mutateJson, readJson } from "@/lib/json-store";

export type TaskType = "research" | "report" | "infographic";
export type TaskStatus = "queued" | "running" | "completed" | "failed";
export type WorkspaceTask = {
  id: string;
  type: TaskType;
  status: TaskStatus;
  title: string;
  mode?: "fast" | "deep";
  format?: string;
  query?: string;
  result?: { markdown?: string; imageSvg?: string; sources?: Array<{ id: string; title: string }> };
  error?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

function pathFor(notebookId: string) { return join(getNotebookDataDirectory(notebookId), "tasks.json"); }
export async function readTasks(notebookId: string) { return readJson<WorkspaceTask[]>(pathFor(notebookId), []); }
export async function createTask(notebookId: string, task: WorkspaceTask) { await mutateJson(pathFor(notebookId), [] as WorkspaceTask[], (items) => [task, ...items].slice(0, 200)); return task; }
export async function updateTask(notebookId: string, taskId: string, patch: Partial<WorkspaceTask>) {
  let updated: WorkspaceTask | undefined;
  await mutateJson(pathFor(notebookId), [] as WorkspaceTask[], (items) => items.map((item) => item.id === taskId ? (updated = { ...item, ...patch, updatedAt: new Date().toISOString() }) : item));
  return updated;
}
export async function deleteTask(notebookId: string, taskId: string) { await mutateJson(pathFor(notebookId), [] as WorkspaceTask[], (items) => items.filter((item) => item.id !== taskId)); }
