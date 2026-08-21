import { assertNotebook, mutateNotebooks, readNotebooks, removeNotebookData, type Notebook } from "@/lib/notebook-store";

function cleanName(value: unknown) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("笔记本名称不能为空");
  return name.slice(0, 60);
}

export async function GET() {
  return Response.json({ notebooks: await readNotebooks() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string };
    const now = new Date().toISOString();
    const notebook: Notebook = { id: crypto.randomUUID(), name: cleanName(body.name), createdAt: now, updatedAt: now };
    await mutateNotebooks((items) => [notebook, ...items]);
    return Response.json({ notebook }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "创建失败" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; name?: string };
    const notebook = await assertNotebook(body.id);
    const updated = { ...notebook, name: cleanName(body.name), updatedAt: new Date().toISOString() };
    await mutateNotebooks((items) => items.map((item) => item.id === updated.id ? updated : item));
    return Response.json({ notebook: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "重命名失败" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    await assertNotebook(id);
    await removeNotebookData(id);
    const notebooks = await mutateNotebooks((items) => items.filter((item) => item.id !== id));
    return Response.json({ notebooks });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 });
  }
}
