import { assertNotebookAccess, mutateNotebooks, readNotebooksForUser, removeNotebookData, type Notebook } from "@/lib/notebook-store";
import { AuthError, requireRequestUser } from "@/lib/auth-store";
import { quotaLimits } from "@/lib/quota-store";

function cleanName(value: unknown) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("笔记本名称不能为空");
  return name.slice(0, 60);
}

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    return Response.json({ notebooks: await readNotebooksForUser(user.id) });
  } catch (error) { return authError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    if ((await readNotebooksForUser(user.id)).length >= quotaLimits.notebooks) return Response.json({ error: `最多创建 ${quotaLimits.notebooks} 个笔记本` }, { status: 429 });
    const body = await request.json() as { name?: string };
    const now = new Date().toISOString();
    const notebook: Notebook = { id: crypto.randomUUID(), name: cleanName(body.name), ownerId: user.id, members: [{ userId: user.id, role: "owner" }], createdAt: now, updatedAt: now };
    await mutateNotebooks((items) => [notebook, ...items]);
    return Response.json({ notebook }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = await request.json() as { id?: string; name?: string };
    const { notebook } = await assertNotebookAccess(body.id, user.id, "edit");
    const updated = { ...notebook, name: cleanName(body.name), updatedAt: new Date().toISOString() };
    await mutateNotebooks((items) => items.map((item) => item.id === updated.id ? updated : item));
    return Response.json({ notebook: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "重命名失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const id = new URL(request.url).searchParams.get("id") || "";
    await assertNotebookAccess(id, user.id, "owner");
    await removeNotebookData(id);
    const notebooks = await mutateNotebooks((items) => items.filter((item) => item.id !== id));
    return Response.json({ notebooks: notebooks.filter((item) => item.ownerId === user.id || item.members?.some((member) => member.userId === user.id)) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 });
  }
}

function authError(error: unknown) {
  const status = error instanceof AuthError ? error.status : (error instanceof Error && error.message.startsWith("无权") ? 403 : 400);
  return Response.json({ error: error instanceof Error ? error.message : "请求失败" }, { status });
}
