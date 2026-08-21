import { AuthError, requireRequestUser } from "@/lib/auth-store";
import { readKnowledge } from "@/lib/knowledge-store";
import { assertNotebookAccess } from "@/lib/notebook-store";
import { readSources } from "@/lib/source-store";
import { readTasks } from "@/lib/task-store";
import { readWorkspace } from "@/lib/workspace-store";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request); const params = new URL(request.url).searchParams; const { notebook } = await assertNotebookAccess(params.get("notebookId"), user.id); const [sources, knowledge, workspace, tasks] = await Promise.all([readSources(notebook.id), readKnowledge(notebook.id), readWorkspace(notebook.id), readTasks(notebook.id)]); const safeName = notebook.name.replace(/[^\p{L}\p{N}_.-]+/gu, "-");
    if (params.get("format") === "json") return new Response(JSON.stringify({ notebook, sources: sources.map(({ content, ...source }) => ({ ...source, content })), knowledge, workspace, tasks }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${safeName}.json"` } });
    const markdown = [`# ${notebook.name}`, `\n## 来源\n${sources.map((source) => `- ${source.title} (${source.type})`).join("\n")}`, knowledge ? `\n## ${knowledge.summary.title}\n${knowledge.summary.overview}\n${knowledge.summary.points.map((point) => `- ${point.text}`).join("\n")}` : "", ...workspace.notes.map((note) => `\n## 笔记：${note.title}\n${note.content}`), ...tasks.filter((task) => task.status === "completed" && task.result?.markdown).map((task) => `\n## ${task.title}\n${task.result!.markdown}`)].join("\n");
    return new Response(markdown, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${safeName}.md"` } });
  } catch (error) { const message = error instanceof Error ? error.message : "导出失败"; return Response.json({ error: message }, { status: error instanceof AuthError ? error.status : message.startsWith("无权") ? 403 : 400 }); }
}
