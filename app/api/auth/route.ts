import { authenticate, authState, AuthError, changePassword, clearSessionHeader, createInitialUser, createSession, getRequestUser, publicUser, requireRequestUser, revokeSession, sessionHeader } from "@/lib/auth-store";
import { claimLegacyNotebooks } from "@/lib/notebook-store";

export async function GET(request: Request) {
  const state = await authState();
  const user = await getRequestUser(request);
  return Response.json({ ...state, user: user ? publicUser(user) : null });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; email?: string; password?: string; displayName?: string };
    const user = body.action === "setup"
      ? await createInitialUser({ email: body.email || "", password: body.password || "", displayName: body.displayName || "" })
      : await authenticate(body.email || "", body.password || "");
    if (body.action === "setup") await claimLegacyNotebooks(user.id);
    const session = await createSession(user.id);
    return Response.json({ user: publicUser(user) }, { headers: { "set-cookie": sessionHeader(request, session.token, session.expiresAt) } });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return Response.json({ error: error instanceof Error ? error.message : "认证失败" }, { status });
  }
}

export async function DELETE(request: Request) {
  await revokeSession(request);
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionHeader(request) } });
}

export async function PATCH(request: Request) {
  try { const user = await requireRequestUser(request); const body = await request.json() as { currentPassword?: string; newPassword?: string }; await changePassword(user.id, body.currentPassword || "", body.newPassword || ""); return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionHeader(request) } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "密码修改失败" }, { status: error instanceof AuthError ? error.status : 500 }); }
}
