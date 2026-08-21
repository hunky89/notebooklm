import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { readSources } from "@/lib/source-store";
import { assertNotebookAccess } from "@/lib/notebook-store";
import { requireRequestUser } from "@/lib/auth-store";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const user = await requireRequestUser(request);
  const { notebook } = await assertNotebookAccess(params.get("notebookId"), user.id);
  const source = (await readSources(notebook.id)).find((item) => item.id === id);
  if (!source?.originalFile) return Response.json({ error: "原文件不存在" }, { status: 404 });
  try {
    const info = await stat(source.originalFile.path);
    const stream = Readable.toWeb(createReadStream(source.originalFile.path)) as ReadableStream;
    const safeName = encodeURIComponent(source.originalFile.name);
    return new Response(stream, {
      headers: {
        "Content-Type": source.originalFile.mime,
        "Content-Length": String(info.size),
        "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "原文件读取失败" }, { status: 404 });
  }
}
