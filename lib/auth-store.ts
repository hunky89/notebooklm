import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { join } from "node:path";
import { getDataDirectory } from "@/lib/source-store";
import { mutateJson, readJson } from "@/lib/json-store";

const scrypt = promisify(scryptCallback);
const storePath = join(getDataDirectory(), "auth.json");
const sessionCookie = "nota_session";

export type User = { id: string; email: string; displayName: string; passwordHash: string; salt: string; createdAt: string };
type Session = { tokenHash: string; userId: string; expiresAt: string };
type AuthData = { users: User[]; sessions: Session[] };
const emptyAuth: AuthData = { users: [], sessions: [] };

export class AuthError extends Error { status: number; constructor(message: string, status = 401) { super(message); this.status = status; } }

function normalizeEmail(value: string) { return value.trim().toLowerCase().slice(0, 180); }
function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
async function passwordHash(password: string, salt: string) { return (await scrypt(password, salt, 64) as Buffer).toString("hex"); }

export async function authState() {
  const data = await readJson(storePath, emptyAuth);
  return { needsSetup: data.users.length === 0, userCount: data.users.length };
}

export async function createInitialUser(input: { email: string; password: string; displayName: string }) {
  if (input.password.length < 10) throw new AuthError("密码至少需要 10 个字符", 400);
  const email = normalizeEmail(input.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AuthError("邮箱格式无效", 400);
  const salt = randomBytes(16).toString("hex");
  const user: User = { id: crypto.randomUUID(), email, displayName: input.displayName.trim().slice(0, 60) || email.split("@")[0], passwordHash: await passwordHash(input.password, salt), salt, createdAt: new Date().toISOString() };
  await mutateJson(storePath, emptyAuth, (data) => {
    if (data.users.length) throw new AuthError("系统已经完成初始化", 409);
    return { ...data, users: [user] };
  });
  return user;
}

export async function authenticate(emailInput: string, password: string) {
  const data = await readJson(storePath, emptyAuth);
  const user = data.users.find((item) => item.email === normalizeEmail(emailInput));
  if (!user) throw new AuthError("邮箱或密码错误");
  const actual = Buffer.from(await passwordHash(password, user.salt), "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AuthError("邮箱或密码错误");
  return user;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await mutateJson(storePath, emptyAuth, (data) => ({ ...data, sessions: [...data.sessions.filter((item) => new Date(item.expiresAt).getTime() > Date.now()), { tokenHash: tokenHash(token), userId, expiresAt }] }));
  return { token, expiresAt };
}

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1) || "";
}

export async function getRequestUser(request: Request): Promise<User | null> {
  const data = await readJson(storePath, emptyAuth);
  if (!data.users.length) return null;
  const token = cookieValue(request);
  if (!token) return null;
  const session = data.sessions.find((item) => item.tokenHash === tokenHash(token) && new Date(item.expiresAt).getTime() > Date.now());
  return session ? data.users.find((item) => item.id === session.userId) || null : null;
}

export async function requireRequestUser(request: Request) {
  const user = await getRequestUser(request);
  if (!user) throw new AuthError("请先登录");
  return user;
}

export async function revokeSession(request: Request) {
  const token = cookieValue(request);
  if (!token) return;
  await mutateJson(storePath, emptyAuth, (data) => ({ ...data, sessions: data.sessions.filter((item) => item.tokenHash !== tokenHash(token)) }));
}

export function sessionHeader(request: Request, token: string, expiresAt: string) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}
export function clearSessionHeader(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function publicUser(user: User) { return { id: user.id, email: user.email, displayName: user.displayName }; }
