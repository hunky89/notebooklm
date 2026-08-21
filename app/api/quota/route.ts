import { AuthError, requireRequestUser } from "@/lib/auth-store";
import { readNotebooksForUser } from "@/lib/notebook-store";
import { getAiUsage, quotaLimits } from "@/lib/quota-store";

export async function GET(request: Request) { try { const user = await requireRequestUser(request); return Response.json({ limits: quotaLimits, usage: { notebooks: (await readNotebooksForUser(user.id)).length, aiRequests: await getAiUsage(user.id) } }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "请求失败" }, { status: error instanceof AuthError ? error.status : 400 }); } }
