import { AuthError, requireRequestUser } from "@/lib/auth-store";
import { askMiniMax } from "@/lib/minimax";
import { assertNotebookAccess } from "@/lib/notebook-store";
import { readSources } from "@/lib/source-store";
import { createTask, deleteTask, readTasks, updateTask, type TaskType, type WorkspaceTask } from "@/lib/task-store";
import { consumeAiRequest } from "@/lib/quota-store";

function sourceContext(sources: Awaited<ReturnType<typeof readSources>>) {
  return sources.filter((source) => source.enabled !== false).slice(0, 15).map((source, index) => `## [S${index + 1}] ${source.title}\n${source.content.slice(0, 5500)}`).join("\n\n");
}
function escapeXml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!); }
function infographicSvg(title: string, markdown: string) {
  const points = markdown.replace(/[#*_`]/g, "").split("\n").map((item) => item.replace(/^[-\d.\s]+/, "").trim()).filter((item) => item.length > 12).slice(0, 6);
  const height = 260 + Math.max(points.length, 1) * 116;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}"><rect width="1200" height="${height}" fill="#f5f7f1"/><rect x="60" y="48" width="1080" height="${height - 96}" rx="34" fill="#fff" stroke="#dce5da"/><text x="110" y="130" fill="#183d2d" font-family="Arial,sans-serif" font-size="44" font-weight="700">${escapeXml(title.slice(0, 34))}</text><text x="110" y="174" fill="#718078" font-family="Arial,sans-serif" font-size="20">Nota · 基于已选资料生成</text>${points.map((point, index) => { const y = 245 + index * 116; const wrapped = point.length > 55 ? [point.slice(0, 55), point.slice(55, 105)] : [point]; return `<circle cx="132" cy="${y}" r="25" fill="${["#335f4b", "#d56f54", "#648b82", "#816b91"][index % 4]}"/><text x="132" y="${y + 8}" text-anchor="middle" fill="#fff" font-family="Arial" font-size="22" font-weight="700">${index + 1}</text><text x="180" y="${y - (wrapped.length - 1) * 14}" fill="#263b32" font-family="Arial,sans-serif" font-size="24">${wrapped.map((line, lineIndex) => `<tspan x="180" dy="${lineIndex ? 34 : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`; }).join("")}</svg>`;
}

async function runTask(notebookId: string, task: WorkspaceTask) {
  await updateTask(notebookId, task.id, { status: "running" });
  try {
    await consumeAiRequest(task.createdBy, task.mode === "deep" ? 2 : 1);
    const sources = (await readSources(notebookId)).filter((source) => source.enabled !== false);
    if (!sources.length) throw new Error("请先选择至少一个来源");
    const context = sourceContext(sources);
    let markdown = "";
    if (task.type === "research") {
      let plan = "";
      if (task.mode === "deep") plan = await askMiniMax([{ role: "system", content: "你是深度研究规划师。" }, { role: "user", content: `围绕“${task.query}”制定研究计划，列出需要核验的子问题、来源冲突和证据缺口。\n\n${context}` }], { temperature: 0.2, maxTokens: 1800 });
      markdown = await askMiniMax([{ role: "system", content: "你是严谨的研究员。只使用给定资料；每个关键结论使用 [S1] 形式标注来源。明确区分事实、推断、冲突和资料缺口。" }, { role: "user", content: `${task.mode === "deep" ? `研究计划：\n${plan}\n\n` : ""}研究问题：${task.query}\n输出完整研究报告，包含执行摘要、证据、不同观点、风险与后续问题。\n\n${context}` }], { temperature: 0.3, maxTokens: task.mode === "deep" ? 6500 : 3500 });
    } else {
      const format = task.format || "研究简报";
      markdown = await askMiniMax([{ role: "system", content: "你是专业报告编辑。所有事实来自给定资料，并用 [S1] 形式标注来源。" }, { role: "user", content: `生成一份“${format}”。主题：${task.query || "当前笔记本核心内容"}。结构清晰，可直接交付。\n\n${context}` }], { temperature: 0.35, maxTokens: 5200 });
    }
    const result = task.type === "infographic" ? { markdown, imageSvg: infographicSvg(task.title, markdown), sources: sources.map(({ id, title }) => ({ id, title })) } : { markdown, sources: sources.map(({ id, title }) => ({ id, title })) };
    await updateTask(notebookId, task.id, { status: "completed", result });
  } catch (error) { await updateTask(notebookId, task.id, { status: "failed", error: error instanceof Error ? error.message : "任务失败" }); }
}

export async function GET(request: Request) {
  try { const user = await requireRequestUser(request); const params = new URL(request.url).searchParams; const { notebook } = await assertNotebookAccess(params.get("notebookId"), user.id); const tasks = await readTasks(notebook.id); const id = params.get("id"); return Response.json(id ? { task: tasks.find((item) => item.id === id) || null } : { tasks }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request); const body = await request.json() as { notebookId?: string; type?: TaskType; mode?: "fast" | "deep"; format?: string; query?: string; title?: string };
    const { notebook } = await assertNotebookAccess(body.notebookId, user.id, "edit"); if (!body.type || !["research", "report", "infographic"].includes(body.type)) return Response.json({ error: "任务类型无效" }, { status: 400 });
    const now = new Date().toISOString(); const task: WorkspaceTask = { id: crypto.randomUUID(), type: body.type, status: "queued", title: String(body.title || (body.type === "research" ? `${body.mode === "deep" ? "深度" : "快速"}研究` : body.type === "infographic" ? "信息图" : body.format || "报告")).slice(0, 120), mode: body.mode, format: String(body.format || "").slice(0, 60), query: String(body.query || "").slice(0, 2000), createdBy: user.id, createdAt: now, updatedAt: now };
    await createTask(notebook.id, task); queueMicrotask(() => { void runTask(notebook.id, task); }); return Response.json({ task }, { status: 202 });
  } catch (error) { return fail(error); }
}
export async function DELETE(request: Request) { try { const user = await requireRequestUser(request); const params = new URL(request.url).searchParams; const { notebook } = await assertNotebookAccess(params.get("notebookId"), user.id, "edit"); await deleteTask(notebook.id, params.get("id") || ""); return Response.json({ ok: true }); } catch (error) { return fail(error); } }
function fail(error: unknown) { const message = error instanceof Error ? error.message : "请求失败"; return Response.json({ error: message }, { status: error instanceof AuthError ? error.status : message.startsWith("无权") ? 403 : 400 }); }
