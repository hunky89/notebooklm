import { requireRequestUser, AuthError } from "@/lib/auth-store";
import { assertNotebookAccess } from "@/lib/notebook-store";
import { defaultSettings, mutateWorkspace, readWorkspace, type NotebookSettings } from "@/lib/workspace-store";

export async function GET(request: Request) {
  try { const user = await requireRequestUser(request); const { notebook } = await assertNotebookAccess(new URL(request.url).searchParams.get("notebookId"), user.id); return Response.json({ settings: (await readWorkspace(notebook.id)).settings }); }
  catch (error) { return fail(error); }
}
export async function PATCH(request: Request) {
  try {
    const user = await requireRequestUser(request); const body = await request.json() as Partial<NotebookSettings> & { notebookId?: string };
    const { notebook } = await assertNotebookAccess(body.notebookId, user.id, "edit");
    const settings: NotebookSettings = { ...defaultSettings, ...(await readWorkspace(notebook.id)).settings, ...body, language: String(body.language || "中文").slice(0, 30), audience: String(body.audience || "通用读者").slice(0, 120), style: String(body.style || "清晰、严谨").slice(0, 120), customInstructions: String(body.customInstructions || "").slice(0, 4000) };
    await mutateWorkspace(notebook.id, (data) => ({ ...data, settings })); return Response.json({ settings });
  } catch (error) { return fail(error); }
}
function fail(error: unknown) { return Response.json({ error: error instanceof Error ? error.message : "请求失败" }, { status: error instanceof AuthError ? error.status : 400 }); }
