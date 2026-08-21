import { access } from "node:fs/promises";
import { getDataDirectory } from "@/lib/source-store";

export async function GET() { try { await access(getDataDirectory()); return Response.json({ status: "ok", timestamp: new Date().toISOString(), modelConfigured: Boolean(process.env.MINIMAX_API_KEY) }); } catch { return Response.json({ status: "degraded", timestamp: new Date().toISOString() }, { status: 503 }); } }
