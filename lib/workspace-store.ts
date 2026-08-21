import { join } from "node:path";
import { getNotebookDataDirectory } from "@/lib/source-store";
import { mutateJson, readJson, writeJson } from "@/lib/json-store";
import type { CitationRef } from "@/lib/knowledge-store";

export type NotebookSettings = { language: string; answerLength: "short" | "balanced" | "detailed"; audience: string; style: string; strictCitations: boolean; allowGeneralKnowledge: boolean; customInstructions: string };
export type Note = { id: string; title: string; content: string; citations: CitationRef[]; createdBy: string; createdAt: string; updatedAt: string };
export type ConversationMessage = { id: string; role: "user" | "assistant"; text: string; citations?: Array<CitationRef & { marker?: string; sourceTitle?: string; locator?: string; snippet?: string }>; createdAt: string };
export type Conversation = { id: string; title: string; messages: ConversationMessage[]; selectedSourceIds: string[]; createdBy: string; createdAt: string; updatedAt: string };
export type SourceGuide = { sourceId: string; generatedAt: string; summary: string; topics: string[]; entities: string[]; outline: string[]; suggestedQuestions: string[] };
export type WorkspaceData = { settings: NotebookSettings; notes: Note[]; conversations: Conversation[]; guides: SourceGuide[] };

export const defaultSettings: NotebookSettings = { language: "中文", answerLength: "balanced", audience: "通用读者", style: "清晰、严谨", strictCitations: true, allowGeneralKnowledge: false, customInstructions: "" };
const fallback: WorkspaceData = { settings: defaultSettings, notes: [], conversations: [], guides: [] };
function pathFor(notebookId: string) { return join(getNotebookDataDirectory(notebookId), "workspace.json"); }

export async function readWorkspace(notebookId: string) {
  const data = await readJson(pathFor(notebookId), fallback);
  return { ...fallback, ...data, settings: { ...defaultSettings, ...(data.settings || {}) }, notes: data.notes || [], conversations: data.conversations || [], guides: data.guides || [] };
}
export async function writeWorkspace(notebookId: string, data: WorkspaceData) { await writeJson(pathFor(notebookId), data); }
export async function mutateWorkspace(notebookId: string, update: (data: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>) {
  return mutateJson(pathFor(notebookId), fallback, async (data) => update({ ...fallback, ...data, settings: { ...defaultSettings, ...(data.settings || {}) }, notes: data.notes || [], conversations: data.conversations || [], guides: data.guides || [] }));
}
