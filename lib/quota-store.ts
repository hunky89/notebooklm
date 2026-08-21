import { join } from "node:path";
import { getDataDirectory } from "@/lib/source-store";
import { mutateJson, readJson } from "@/lib/json-store";

type UsageEntry = { userId: string; month: string; aiRequests: number; updatedAt: string };
const path = join(getDataDirectory(), "usage.json");
const month = () => new Date().toISOString().slice(0, 7);
export const quotaLimits = { notebooks: Number(process.env.NOTA_MAX_NOTEBOOKS || 20), sourcesPerNotebook: Number(process.env.NOTA_MAX_SOURCES || 50), aiRequestsPerMonth: Number(process.env.NOTA_MAX_AI_REQUESTS || 500) };
export async function getAiUsage(userId: string) { return (await readJson<UsageEntry[]>(path, [])).find((entry) => entry.userId === userId && entry.month === month())?.aiRequests || 0; }
export async function consumeAiRequest(userId: string, amount = 1) { let used = 0; await mutateJson(path, [] as UsageEntry[], (items) => { const key = month(); const current = items.find((entry) => entry.userId === userId && entry.month === key); used = (current?.aiRequests || 0) + amount; if (used > quotaLimits.aiRequestsPerMonth) throw new Error("本月 AI 请求额度已用完"); const next = { userId, month: key, aiRequests: used, updatedAt: new Date().toISOString() }; return [next, ...items.filter((entry) => !(entry.userId === userId && entry.month === key))].slice(0, 1000); }); return used; }
