import { AuthError, requireRequestUser } from "@/lib/auth-store";
import { askMiniMax } from "@/lib/minimax";
import { assertNotebookAccess } from "@/lib/notebook-store";
import { readSources } from "@/lib/source-store";
import { mutateWorkspace, readWorkspace, type SourceGuide } from "@/lib/workspace-store";
import { consumeAiRequest } from "@/lib/quota-store";

export async function GET(request: Request) {
  try { const user = await requireRequestUser(request); const params = new URL(request.url).searchParams; const { notebook } = await assertNotebookAccess(params.get("notebookId"), user.id); const guides = (await readWorkspace(notebook.id)).guides; const sourceId = params.get("sourceId"); return Response.json(sourceId ? { guide: guides.find((item) => item.sourceId === sourceId) || null } : { guides }); }
  catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request); const body = await request.json() as { notebookId?: string; sourceId?: string };
    const { notebook } = await assertNotebookAccess(body.notebookId, user.id, "edit"); await consumeAiRequest(user.id); const source = (await readSources(notebook.id)).find((item) => item.id === body.sourceId);
    if (!source) return Response.json({ error: "来源不存在" }, { status: 404 });
    const raw = await askMiniMax([{ role: "system", content: "你是资料分析师，只输出合法 JSON。" }, { role: "user", content: `为下面来源生成 Source Guide。格式：{"summary":"...","topics":["..."],"entities":["..."],"outline":["..."],"suggestedQuestions":["..."]}。主题最多8个、实体最多12个、目录最多12项、建议问题5个。\n\n${source.title}\n${source.content.slice(0, 30000)}` }], { temperature: 0.2, maxTokens: 2600 });
    const start = raw.indexOf("{"); const end = raw.lastIndexOf("}"); if (start < 0 || end < start) throw new Error("来源指南生成失败"); const parsed = JSON.parse(raw.slice(start, end + 1));
    const list = (value: unknown, limit: number) => Array.isArray(value) ? value.map(String).map((item) => item.slice(0, 240)).slice(0, limit) : [];
    const guide: SourceGuide = { sourceId: source.id, generatedAt: new Date().toISOString(), summary: String(parsed.summary || "").slice(0, 3000), topics: list(parsed.topics, 8), entities: list(parsed.entities, 12), outline: list(parsed.outline, 12), suggestedQuestions: list(parsed.suggestedQuestions, 5) };
    await mutateWorkspace(notebook.id, (data) => ({ ...data, guides: [guide, ...data.guides.filter((item) => item.sourceId !== source.id)] })); return Response.json({ guide });
  } catch (error) { return fail(error); }
}
function fail(error: unknown) { return Response.json({ error: error instanceof Error ? error.message : "请求失败" }, { status: error instanceof AuthError ? error.status : 500 }); }
