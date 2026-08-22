import { AuthError, requireRequestUser } from "@/lib/auth-store";
import { readKnowledge } from "@/lib/knowledge-store";
import { assertNotebookAccess } from "@/lib/notebook-store";
import { createShare, getShareByToken } from "@/lib/share-store";
import { readSources } from "@/lib/source-store";
import { readTasks } from "@/lib/task-store";
import { readWorkspace } from "@/lib/workspace-store";

export async function GET(request: Request) { const token = new URL(request.url).searchParams.get("token") || ""; const share = /^[0-9a-f]{64}$/i.test(token) ? await getShareByToken(token) : null; return share ? Response.json({ snapshot: share.snapshot, expiresAt: share.expiresAt }) : Response.json({ error: "分享链接不存在或已过期" }, { status: 404 }); }
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request); const body = await request.json() as { notebookId?: string }; const { notebook } = await assertNotebookAccess(body.notebookId, user.id, "owner"); const [sources, knowledge, workspace, tasks] = await Promise.all([readSources(notebook.id), readKnowledge(notebook.id), readWorkspace(notebook.id), readTasks(notebook.id)]);
    const snapshot = { notebookName: notebook.name, summary: knowledge ? `# ${knowledge.summary.title}\n\n${knowledge.summary.overview}\n\n${knowledge.summary.points.map((point) => `- ${point.text}`).join("\n")}` : undefined, notes: workspace.notes.map(({ title, content }) => ({ title, content })), reports: tasks.filter((task) => task.status === "completed" && task.result?.markdown).map((task) => ({ title: task.title, markdown: task.result!.markdown! })), sourceTitles: sources.map((source) => source.title) };
    const { token, share } = await createShare(notebook.id, snapshot, user.id); return Response.json({ url: `/share?token=${encodeURIComponent(token)}`, expiresAt: share.expiresAt });
  } catch (error) { const message = error instanceof Error ? error.message : "分享失败"; return Response.json({ error: message }, { status: error instanceof AuthError ? error.status : message.startsWith("无权") ? 403 : 400 }); }
}
