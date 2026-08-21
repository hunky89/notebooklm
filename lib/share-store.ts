import { createHash } from "node:crypto";
import { join } from "node:path";
import { getDataDirectory } from "@/lib/source-store";
import { mutateJson, readJson } from "@/lib/json-store";

export type SharedSnapshot = { notebookName: string; summary?: string; notes: Array<{ title: string; content: string }>; reports: Array<{ title: string; markdown: string }>; sourceTitles: string[] };
type Share = { id: string; tokenHash: string; notebookId: string; snapshot: SharedSnapshot; createdBy: string; createdAt: string; expiresAt: string };
const path = join(getDataDirectory(), "shares.json");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createShare(notebookId: string, snapshot: SharedSnapshot, createdBy: string) { const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""); const now = new Date(); const share: Share = { id: crypto.randomUUID(), tokenHash: hash(token), notebookId, snapshot, createdBy, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 86400_000).toISOString() }; await mutateJson(path, [] as Share[], (items) => [share, ...items].slice(0, 500)); return { share, token }; }
export async function getShareByToken(token: string) { const item = (await readJson<Share[]>(path, [])).find((share) => share.tokenHash === hash(token)); return item && new Date(item.expiresAt).getTime() > Date.now() ? item : null; }
